import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Search } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, movementLabel, normalizeEquivalent, pluralUnit, equivalentLabel } from '../lib/format'
import { cleanProductName } from '../lib/display'

// Cuántos movimientos se bajan por vez. El saldo NO depende de esto: lo calcula
// la base sobre toda la historia de la empresa, así que mostrar una página o
// mil da el mismo número.
const POR_PAGINA = 300

const TYPE_COLORS = {
  entrada: 'text-campo-700',
  salida: 'text-red-700',
  traslado: 'text-blue-700',
  ajuste: 'text-orange-700',
  traspaso: 'text-blue-700',
  fraccionamiento: 'text-orange-700',
}

const TYPE_LABELS = {
  traspaso: 'Traspaso',
  fraccionamiento: 'Fraccionamiento',
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

// Los totales vienen de la base separados por unidad cruda (lt, kg, gr, ml).
// Acá se pasan a la unidad de siempre y se juntan: "5.160 lts · 320 kgs".
function totalLegible(items) {
  const totals = new Map()
  for (const it of items || []) {
    const eq = normalizeEquivalent(it.valor, it.unidad)
    totals.set(eq.unit, (totals.get(eq.unit) || 0) + eq.value)
  }
  return [...totals.entries()]
    .map(([unit, value]) => `${formatNumber(value)} ${pluralUnit(unit, value)}`)
    .join(' · ') || '0'
}

export default function Kardex() {
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [search, setSearch] = useState('')
  const [busqueda, setBusqueda] = useState('')      // la búsqueda ya aquietada
  const [movements, setMovements] = useState([])
  const [resumen, setResumen] = useState(null)
  const [loading, setLoading] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [loadError, setLoadError] = useState('')
  const pedido = useRef(0)

  useEffect(() => {
    loadClients()
  }, [])

  // Se espera a que deje de escribir antes de ir a la base
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])

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

  const loadKardex = useCallback(async () => {
    if (!clientId) {
      setMovements([])
      setResumen(null)
      return
    }
    const marca = ++pedido.current
    setLoading(true)
    setLoadError('')

    const [pagina, resumenRes] = await Promise.all([
      supabase.rpc('kardex_pagina', {
        p_client_id: clientId,
        p_busqueda: busqueda || null,
        p_limite: POR_PAGINA,
        p_desde: 0,
      }),
      supabase.rpc('kardex_resumen', {
        p_client_id: clientId,
        p_busqueda: busqueda || null,
      }),
    ])

    if (marca !== pedido.current) return   // llegó tarde, ya hay otra búsqueda

    if (pagina.error || resumenRes.error) {
      setLoadError('No se pudieron cargar los movimientos.')
      setMovements([])
      setResumen(null)
      setLoading(false)
      return
    }

    setMovements(pagina.data || [])
    setResumen(resumenRes.data || null)
    setLoading(false)
  }, [clientId, busqueda])

  useEffect(() => {
    loadKardex()
  }, [loadKardex])

  async function verMas() {
    setCargandoMas(true)
    const { data, error } = await supabase.rpc('kardex_pagina', {
      p_client_id: clientId,
      p_busqueda: busqueda || null,
      p_limite: POR_PAGINA,
      p_desde: movements.length,
    })
    if (!error) setMovements((prev) => [...prev, ...(data || [])])
    setCargandoMas(false)
  }

  const totalEntradas = useMemo(() => totalLegible(resumen?.entradas), [resumen])
  const totalSalidas = useMemo(() => totalLegible(resumen?.salidas), [resumen])
  const descuadres = resumen?.descuadres || []
  const totalMovimientos = resumen?.movimientos ?? 0

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

      {/* El control de cuadre. Si el saldo que sale de los movimientos no da lo
          mismo que el stock de hoy, se avisa. Antes un número mal se mostraba
          igual, sin decir nada. */}
      {clientId && !loading && descuadres.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={18} />
            <div className="min-w-0">
              <p className="text-sm font-black text-amber-900">
                {descuadres.length === 1
                  ? 'Hay 1 lote donde la cuenta no cierra'
                  : `Hay ${descuadres.length} lotes donde la cuenta no cierra`}
              </p>
              <p className="mt-0.5 text-xs font-semibold text-amber-800">
                El saldo que sale de los movimientos no da lo mismo que el stock de hoy.
                Suele ser que falta cargar el movimiento de entrada del lote.
              </p>
              <ul className="mt-2 space-y-1">
                {descuadres.slice(0, 5).map((d, i) => (
                  <li key={i} className="text-xs font-semibold text-amber-900 [overflow-wrap:anywhere]">
                    <span className="font-black">{cleanProductName(d.producto)}</span>
                    {d.lote ? <> · Lote {d.lote}</> : null}
                    {' — '}movimientos: {equivalentLabel(d.segun_movimientos, d.unidad)}
                    {' · '}stock: {equivalentLabel(d.stock_actual, d.unidad)}
                  </li>
                ))}
                {descuadres.length > 5 && (
                  <li className="text-xs font-bold text-amber-700">…y {descuadres.length - 5} más</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {clientId && !loading && movements.length === 0 && !loadError && (
        <EmptyState
          icon="📋"
          title="Sin movimientos"
          description={busqueda
            ? 'Ningún movimiento coincide con la búsqueda.'
            : 'Esta empresa no tiene movimientos registrados.'}
        />
      )}

      {movements.length > 0 && (
        <>
          <div className="mb-3 grid grid-cols-3 divide-x divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="px-4 py-3 text-center">
              <p className="text-xs font-bold uppercase text-slate-500">Movimientos</p>
              <p className="mt-0.5 text-lg font-black text-slate-950">{formatNumber(totalMovimientos)}</p>
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
                {movements.map((m) => {
                  const isEntry = m.tipo === 'entrada'
                  const isSalida = m.tipo === 'salida'
                  const qty = Number(m.cantidad || 0)
                  const saldo = m.saldo != null ? Number(m.saldo) : null

                  return (
                    <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 text-xs font-semibold text-slate-600">
                        {formatDate(m.fecha)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs font-bold text-campo-700 whitespace-nowrap">
                        {m.nota || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`text-xs font-black ${TYPE_COLORS[m.tipo] || 'text-slate-600'}`}>
                          {TYPE_LABELS[m.tipo] || movementLabel(m.tipo)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <p className="text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">
                          {cleanProductName(m.producto || '—')}
                        </p>
                        {m.lote ? (
                          <p className="text-xs font-bold text-slate-600">Lote {m.lote}</p>
                        ) : null}
                        {(() => {
                          const c = parseConcepto(m.detalle)
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
                        {isEntry ? equivalentLabel(qty, m.unidad) : <span className="text-slate-200">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-black text-red-700">
                        {isSalida ? equivalentLabel(qty, m.unidad) : <span className="text-slate-200">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-bold text-slate-700">
                        {saldo != null ? equivalentLabel(saldo, m.unidad) : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {movements.length < totalMovimientos && (
            <div className="mt-3 text-center">
              <button
                type="button"
                className="btn-secondary"
                onClick={verMas}
                disabled={cargandoMas}
              >
                {cargandoMas
                  ? 'Cargando...'
                  : `Ver más (${formatNumber(movements.length)} de ${formatNumber(totalMovimientos)})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
