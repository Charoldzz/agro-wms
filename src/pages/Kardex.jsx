import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, movementLabel, normalizeEquivalent, pluralUnit, equivalentLabel } from '../lib/format'
import { cleanProductName, displayLotCode } from '../lib/display'

const TYPE_COLORS = {
  entrada: 'text-campo-700',
  salida: 'text-red-700',
  traslado: 'text-blue-700',
  ajuste: 'text-orange-700',
}

const CONCEPT_TAGS = [
  'Despacho manual (app)', 'Despacho de solicitud del cliente', 'Despacho por lista',
  'Ingreso manual (app)', 'Nuevo ingreso desde almacen.', 'Nuevo ingreso desde almacen',
]

// Separa el concepto crudo en datos de operación ordenados (Transportista, Placa,
// Teléfono) + observación; omite etiquetas técnicas. "Documento" = el teléfono.
function parseConcepto(notes) {
  const out = { transportista: '', placa: '', telefono: '', obs: '' }
  const obsParts = []
  String(notes || '').split('|').map((p) => p.trim()).filter(Boolean).forEach((part) => {
    if (/^placa:/i.test(part)) out.placa = part.replace(/^placa:\s*/i, '')
    else if (/^transportista:/i.test(part)) out.transportista = part.replace(/^transportista:\s*/i, '')
    else if (/^recibe:/i.test(part)) out.transportista = part.replace(/^recibe:\s*/i, '')
    else if (/^(documento|tel[eé]fono):/i.test(part)) out.telefono = part.replace(/^(documento|tel[eé]fono):\s*/i, '')
    else if (CONCEPT_TAGS.includes(part)) { /* etiqueta técnica: se omite */ }
    else obsParts.push(part)
  })
  out.obs = obsParts.join(' · ')
  return out
}

function displayClientName(name) {
  return String(name || '').replaceAll('"', '').replace(/\s+/g, ' ').trim()
}

export default function Kardex() {
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [search, setSearch] = useState('')
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    loadClients()
  }, [])

  useEffect(() => {
    if (clientId) loadKardex()
    else setMovements([])
  }, [clientId])

  async function loadClients() {
    const { data } = await supabase
      .from('clients')
      .select('id, name, product_code_prefix')
      .eq('inventory_source', 'stock_independiente')
      .order('name')
    const seen = new Set()
    const unique = (data || []).filter((c) => {
      const key = displayClientName(c.name).toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    setClients(unique)
  }

  async function loadKardex() {
    setLoading(true)
    setLoadError('')

    const { data: lotsData, error: lotsError } = await supabase
      .from('lots')
      .select('id, product, lot_code, package_size, package_unit')
      .eq('inventory_source', 'stock_independiente')
      .eq('client_id', clientId)

    if (lotsError) {
      setLoadError('No se pudieron cargar los lotes.')
      setLoading(false)
      return
    }

    const lotIds = (lotsData || []).map((l) => l.id)
    if (lotIds.length === 0) {
      setMovements([])
      setLoading(false)
      return
    }

    const prefix = (clients.find((c) => c.id === clientId)?.product_code_prefix || '').toUpperCase()

    const [webResult, desktopResult] = await Promise.all([
      supabase
        .from('movements')
        .select('id, type, quantity, previous_quantity, new_quantity, notes, created_at, lot_id, operation_id, lots(lot_code, product, package_size, package_unit, clients(name))')
        .in('lot_id', lotIds)
        .order('created_at', { ascending: false })
        .limit(1000),
      prefix
        ? supabase
            .from('desktop_movements')
            .select('id, note_number, type, date, product_name, lot, quantity')
            .eq('client_prefix', prefix)
            .order('date', { ascending: false })
            .limit(3000)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (webResult.error && desktopResult.error) {
      setLoadError('No se pudieron cargar los movimientos.')
      setMovements([])
      setLoading(false)
      return
    }

    // Mapa producto → presentación para etiquetar unidades de las filas del programa
    const productInfo = new Map()
    for (const lot of lotsData || []) {
      const key = String(lot.product || '').toUpperCase()
      if (!productInfo.has(key) && Number(lot.package_size) > 0) {
        productInfo.set(key, { size: Number(lot.package_size), unit: lot.package_unit || '' })
      }
    }

    // Guías de las operaciones web, en consulta aparte (por id de operación)
    const opIds = [...new Set((webResult.data || []).map((m) => m.operation_id).filter(Boolean))]
    const guideMap = new Map()
    if (opIds.length > 0) {
      const { data: ops } = await supabase
        .from('warehouse_operations')
        .select('id, guide_number')
        .in('id', opIds)
      ;(ops || []).forEach((op) => guideMap.set(op.id, op.guide_number))
    }

    // La web guarda unidades; el programa guarda el equivalente en lts/kgs.
    // Todo se muestra en equivalente.
    const webRows = (webResult.data || []).map((m) => {
      const size = Number(m.lots?.package_size) || 0
      return {
        ...m,
        note: guideMap.get(m.operation_id) || null,
        eqQuantity: Number(m.quantity || 0),
        unit: m.lots?.package_unit || '',
      }
    })
    const desktopRows = (desktopResult.data || []).map((r) => {
      const info = productInfo.get(String(r.product_name || '').toUpperCase())
      return {
        id: `desktop-${r.id}`,
        type: r.type === 'INGRESO' ? 'entrada' : 'salida',
        eqQuantity: Number(r.quantity || 0),
        unit: info?.unit || '',
        note: r.note_number || null,
        notes: null,
        created_at: r.date,
        lots: { product: r.product_name, lot_code: r.lot },
      }
    })

    // Saldo acumulado por producto+lote, en orden cronológico (arranca del inventario inicial)
    const merged = [...webRows, ...desktopRows].sort(
      (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0),
    )
    const balance = new Map()
    for (const row of merged) {
      const key = `${String(row.lots?.product || '').toUpperCase()}|${String(row.lots?.lot_code || '').toUpperCase()}`
      const prev = balance.get(key) || 0
      const next = row.type === 'entrada' ? prev + row.eqQuantity : prev - row.eqQuantity
      balance.set(key, next)
      row.saldo = next
    }

    setMovements(merged.reverse())
    setLoading(false)
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return movements
    const q = search.toLowerCase().trim()
    return movements.filter((m) => {
      const product = cleanProductName(m.lots?.product || '').toLowerCase()
      const lotCode = displayLotCode(m.lots?.lot_code || '').toLowerCase()
      const notes = (m.notes || '').toLowerCase()
      const note = (m.note || '').toLowerCase()
      return product.includes(q) || lotCode.includes(q) || notes.includes(q) || note.includes(q)
    })
  }, [movements, search])

  function totalsByUnit(rows) {
    const totals = new Map()
    for (const m of rows) {
      const eq = normalizeEquivalent(m.eqQuantity, m.unit)
      totals.set(eq.unit, (totals.get(eq.unit) || 0) + eq.value)
    }
    return [...totals.entries()].map(([unit, value]) => `${formatNumber(value)} ${pluralUnit(unit, value)}`).join(' · ') || '0'
  }

  const totalEntradas = useMemo(
    () => totalsByUnit(filtered.filter((m) => m.type === 'entrada')),
    [filtered],
  )
  const totalSalidas = useMemo(
    () => totalsByUnit(filtered.filter((m) => m.type === 'salida')),
    [filtered],
  )

  return (
    <div>
      <PageHeader title="Kardex" subtitle="Historial de movimientos por empresa" />

      <section className="panel mb-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Empresa</span>
          <select
            className="input mt-1"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">Seleccionar empresa</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{displayClientName(c.name)}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Buscar producto / lote</span>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              className="input pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar por producto o lote..."
              disabled={!clientId}
            />
          </div>
        </label>
      </section>

      {!clientId && (
        <div className="rounded-lg bg-slate-50 p-4 text-center text-sm font-semibold text-slate-500">
          Selecciona una empresa para ver su kardex.
        </div>
      )}

      {clientId && loading && (
        <div className="rounded-lg bg-slate-50 p-4 text-center text-sm font-semibold text-slate-500">
          Cargando movimientos...
        </div>
      )}

      {loadError && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{loadError}</div>
      )}

      {clientId && !loading && movements.length === 0 && !loadError && (
        <EmptyState
          icon="📋"
          title="Sin movimientos"
          description="Esta empresa no tiene movimientos registrados."
        />
      )}

      {filtered.length > 0 && (
        <>
          <div className="mb-3 grid grid-cols-3 divide-x divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="px-4 py-3 text-center">
              <p className="text-xs font-bold uppercase text-slate-500">Movimientos</p>
              <p className="mt-0.5 text-lg font-black text-slate-950">{formatNumber(filtered.length)}</p>
            </div>
            <div className="px-4 py-3 text-center">
              <p className="text-xs font-bold uppercase text-campo-700">Total entradas</p>
              <p className="mt-0.5 text-lg font-black text-campo-800">{totalEntradas}</p>
            </div>
            <div className="px-4 py-3 text-center">
              <p className="text-xs font-bold uppercase text-red-600">Total salidas</p>
              <p className="mt-0.5 text-lg font-black text-red-700">{totalSalidas}</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full border-collapse" style={{ minWidth: '700px' }}>
              <colgroup>
                <col style={{ width: '140px' }} />
                <col style={{ width: '95px' }} />
                <col style={{ width: '80px' }} />
                <col />
                <col style={{ width: '90px' }} />
                <col style={{ width: '90px' }} />
                <col style={{ width: '90px' }} />
              </colgroup>
              <thead>
                <tr className="bg-slate-700 text-white">
                  <th className="border-b border-slate-600 px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide">FECHA</th>
                  <th className="border-b border-slate-600 px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide">NOTA</th>
                  <th className="border-b border-slate-600 px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide">TIPO</th>
                  <th className="border-b border-slate-600 px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide">PRODUCTO / LOTE</th>
                  <th className="border-b border-slate-600 px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-campo-300">ENTRADA</th>
                  <th className="border-b border-slate-600 px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-red-300">SALIDA</th>
                  <th className="border-b border-slate-600 px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide">SALDO</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const isEntry = m.type === 'entrada'
                  const isSalida = m.type === 'salida'
                  const qty = Number(m.eqQuantity || 0)
                  const saldo = m.saldo != null ? Number(m.saldo) : null

                  return (
                    <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 text-xs font-semibold text-slate-600">
                        {formatDate(m.created_at)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs font-bold text-campo-700 whitespace-nowrap">
                        {m.note || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`text-xs font-black ${TYPE_COLORS[m.type] || 'text-slate-600'}`}>
                          {movementLabel(m.type)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <p className="text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">
                          {cleanProductName(m.lots?.product || '—')}
                        </p>
                        {m.lots?.lot_code ? (
                          <p className="text-xs font-bold text-slate-600">Lote {displayLotCode(m.lots.lot_code)}</p>
                        ) : null}
                        {(() => {
                          const c = parseConcepto(m.notes)
                          const datos = [
                            c.transportista && `Transportista: ${c.transportista}`,
                            c.placa && `Placa: ${c.placa}`,
                            c.telefono && `Teléfono: ${c.telefono}`,
                          ].filter(Boolean).join(' · ')
                          const linea = [datos, c.obs].filter(Boolean).join(' · ')
                          return linea ? <p className="mt-0.5 text-[11px] font-semibold text-slate-400 [overflow-wrap:anywhere]">{linea}</p> : null
                        })()}
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-black text-campo-700">
                        {isEntry ? equivalentLabel(qty, m.unit) : <span className="text-slate-200">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-black text-red-700">
                        {isSalida ? equivalentLabel(qty, m.unit) : <span className="text-slate-200">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-bold text-slate-700">
                        {saldo != null ? equivalentLabel(saldo, m.unit) : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {filtered.length < movements.length && (
            <p className="mt-2 text-center text-xs font-semibold text-slate-500">
              Mostrando {filtered.length} de {movements.length} movimientos
            </p>
          )}
        </>
      )}
    </div>
  )
}
