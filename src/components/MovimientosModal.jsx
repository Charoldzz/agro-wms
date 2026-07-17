import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowLeftRight, ArrowUp, RotateCcw, Save, Search, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatNumber, normalizeEquivalent, pluralUnit, equivalentLabel } from '../lib/format'
import { cleanProductName, displayLotCode } from '../lib/display'
import { desgloseEnvases } from '../lib/envases'

// Etiquetas técnicas del concepto que NO son observación del usuario
const CONCEPT_TAGS = [
  'Despacho manual (app)', 'Despacho de solicitud del cliente', 'Despacho por lista',
  'Ingreso manual (app)', 'Nuevo ingreso desde almacen.', 'Nuevo ingreso desde almacen',
]

// Separa el concepto crudo ("Placa: X | Transportista: Y | Documento: Z | ... | FRAGIL")
// en campos ordenados; lo que no es campo ni etiqueta técnica es la observación
function parseConcepto(notes) {
  const out = { placa: '', transportista: '', documento: '', obs: '' }
  const obsParts = []
  String(notes || '').split('|').map((p) => p.trim()).filter(Boolean).forEach((part) => {
    if (/^placa:/i.test(part)) out.placa = part.replace(/^placa:\s*/i, '')
    else if (/^transportista:/i.test(part)) out.transportista = part.replace(/^transportista:\s*/i, '')
    else if (/^recibe:/i.test(part)) out.transportista = part.replace(/^recibe:\s*/i, '')
    else if (/^documento:/i.test(part)) out.documento = part.replace(/^documento:\s*/i, '')
    else if (CONCEPT_TAGS.includes(part)) { /* etiqueta técnica: se omite */ }
    else obsParts.push(part)
  })
  out.obs = obsParts.join(' · ')
  return out
}

// Cantidad de unidades → texto con su envase ("6 bolsas", "53 bidones + 15 lt")
function stockEnvaseLabel(uds, lot) {
  const size = Number(lot?.package_size) || 0
  const q = Number(uds) || 0
  const eqRaw = size > 0 ? q * size : q
  return desgloseEnvases(eqRaw, size, lot?.package_unit, 0).unidadesLabel || `${formatNumber(q)} uds`
}

const TYPE_LABELS = { entrada: 'INGRESO', salida: 'SALIDA', traslado: 'TRASLADO', ajuste: 'AJUSTE' }
const TYPE_COLORS = {
  entrada: 'bg-campo-100 text-campo-800',
  salida: 'bg-red-100 text-red-800',
  traslado: 'bg-blue-100 text-blue-800',
  ajuste: 'bg-amber-100 text-amber-800',
}

function fmtDate(str) {
  if (!str) return '-'
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(str))
}

const PACKAGE_FIELDS = [
  ['package_boxes', 'cajas'],
  ['package_units', 'uds'],
  ['package_gallons', 'galones'],
  ['package_bidones', 'bidones'],
  ['package_drums', 'tambores'],
  ['package_pallets', 'pallets'],
]

function packageChips(row) {
  return PACKAGE_FIELDS
    .map(([field, label]) => ({ label, value: Number(row[field]) }))
    .filter((p) => p.value > 0)
}

// Normaliza una cantidad a lts/kgs (ml→lt, gr→kg); sin unidad conocida → uds.
// Unidad canónica singular ('lt'/'kg'/'uds') como clave de los totales.
const normalizaUnidad = normalizeEquivalent

const equivalenteLabel = equivalentLabel

function PackageChips({ chips }) {
  if (!chips || chips.length === 0) return null
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {chips.map((p) => (
        <span key={p.label} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
          {formatNumber(p.value)} {p.label}
        </span>
      ))}
    </span>
  )
}

export default function MovimientosModal({ onClose, canEdit = true }) {
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [editing, setEditing] = useState(false)
  const [editNotes, setEditNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [webResult, desktopResult, clientsResult, catalogResult] = await Promise.all([
      supabase
        .from('movements')
        .select('*, lots(lot_code, product, package_size, package_unit, location, expiry_date, clients(name)), profiles!movements_user_id_fkey(full_name)')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('desktop_movements')
        .select('*')
        .order('date', { ascending: false })
        .limit(5000),
      supabase
        .from('clients')
        .select('name, product_code_prefix')
        .eq('inventory_source', 'stock_independiente'),
      supabase
        .from('product_catalog')
        .select('code, package_unit')
        .limit(2000),
    ])

    // Unidad de cada producto del programa, por CÓDIGO (desktop_movements.product_code ↔ catalog.code)
    const unitByCode = new Map()
    ;(catalogResult.data || []).forEach((p) => {
      if (p.code && p.package_unit) unitByCode.set(p.code.toUpperCase(), p.package_unit)
    })

    let rawWebMovements = webResult.data || []
    if (webResult.error) {
      const { data: raw } = await supabase
        .from('movements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
      rawWebMovements = raw || []
    }

    // Guías de las operaciones web, en consulta aparte (por id de operación)
    const opIds = [...new Set(rawWebMovements.map((m) => m.operation_id).filter(Boolean))]
    const guideMap = new Map()
    if (opIds.length > 0) {
      const { data: ops } = await supabase
        .from('warehouse_operations')
        .select('id, guide_number')
        .in('id', opIds)
      ;(ops || []).forEach((op) => guideMap.set(op.id, op.guide_number))
    }

    // Cantidad total en equivalente, separada por unidad (lts · kgs)
    function totalesPorUnidad(pares) {
      const totals = new Map()
      for (const par of pares) {
        const n = normalizaUnidad(par.value, par.unit)
        totals.set(n.unit, (totals.get(n.unit) || 0) + n.value)
      }
      return [...totals.entries()].map(([u, v]) => `${formatNumber(v)} ${pluralUnit(u, v)}`).join(' · ')
    }

    // Web: la cantidad está en unidades → equivalente = unidades × tamaño del lote
    function cantidadPorUnidad(group) {
      return totalesPorUnidad(group.map((m) => {
        const size = Number(m.lots?.package_size) || 0
        return { value: size > 0 ? Number(m.quantity || 0) * size : Number(m.quantity || 0), unit: m.lots?.package_unit }
      }))
    }

    // Programa: la cantidad ya es equivalente; la unidad sale del catálogo por código
    function cantidadDesktop(rows) {
      return totalesPorUnidad(rows.map((r) => ({
        value: r.quantity,
        unit: unitByCode.get(String(r.product_code || '').toUpperCase()),
      })))
    }

    // Agrupar movimientos web que pertenecen a la misma operación (misma guía)
    const webByOperation = new Map()
    const webMovements = []
    for (const m of rawWebMovements) {
      const noteNumber = guideMap.get(m.operation_id) || null
      if (m.operation_id && (m.type === 'entrada' || m.type === 'salida')) {
        if (!webByOperation.has(m.operation_id)) webByOperation.set(m.operation_id, [])
        webByOperation.get(m.operation_id).push({ ...m, note_number: noteNumber })
      } else {
        webMovements.push({ ...m, note_number: noteNumber })
      }
    }
    for (const group of webByOperation.values()) {
      if (group.length === 1) {
        webMovements.push({ ...group[0], cantidadLabel: cantidadPorUnidad(group) })
        continue
      }
      const first = group[0]
      webMovements.push({
        ...first,
        id: `op-${first.operation_id}`,
        grouped: true,
        quantity: group.reduce((sum, m) => sum + Number(m.quantity || 0), 0),
        cantidadLabel: cantidadPorUnidad(group),
        created_at: group.reduce((max, m) => (m.created_at > max ? m.created_at : max), first.created_at),
        items: group.map((m) => {
          const size = Number(m.lots?.package_size) || 0
          return {
            product: m.lots?.product,
            lot: displayLotCode(m.lots?.lot_code, m.lots),
            quantity: m.quantity,
            cantidadLabel: equivalenteLabel(
              size > 0 ? Number(m.quantity || 0) * size : Number(m.quantity || 0),
              size > 0 ? m.lots?.package_unit : null,
            ),
            envaseLabel: stockEnvaseLabel(m.quantity, m.lots),
            expiry_date: m.lots?.expiry_date || null,
            location: m.lots?.location || '',
          }
        }),
        lots: {
          ...first.lots,
          product: `${group.length} ITEMS`,
          lot_code: 'VARIOS',
          expiry_date: null,
        },
      })
    }

    const prefixMap = new Map(
      (clientsResult.data || [])
        .filter((c) => c.product_code_prefix)
        .map((c) => [c.product_code_prefix.toUpperCase(), c.name]),
    )
    const groupedByNote = new Map()
    for (const row of desktopResult.data || []) {
      const key = row.note_number || `sin-nota-${row.id}`
      if (!groupedByNote.has(key)) groupedByNote.set(key, [])
      groupedByNote.get(key).push(row)
    }
    const desktopRows = [...groupedByNote.values()].map((rows) => {
      const first = rows[0]
      const multi = rows.length > 1
      const empresa = rows.find((r) => r.dispatch_company)?.dispatch_company
        || prefixMap.get((first.client_prefix || '').toUpperCase())
        || ''
      return {
        id: `desktop-${first.note_number || first.id}`,
        source: 'desktop',
        type: first.type === 'INGRESO' ? 'entrada' : 'salida',
        created_at: rows.reduce((max, r) => (r.date > max ? r.date : max), first.date),
        quantity: rows.reduce((sum, r) => sum + Number(r.quantity || 0), 0),
        cantidadLabel: cantidadDesktop(rows),
        notes: first.concept,
        note_number: first.note_number,
        transporter: rows.find((r) => r.transporter)?.transporter || '',
        plate: rows.find((r) => r.plate)?.plate || '',
        contact_person: rows.find((r) => r.contact_person)?.contact_person || '',
        observations: rows.find((r) => r.observations)?.observations || '',
        items: rows.map((r) => ({
          product: r.product_name,
          lot: r.lot,
          expiry_date: r.expiry_date,
          quantity: r.quantity,
          cantidadLabel: equivalenteLabel(r.quantity, unitByCode.get(String(r.product_code || '').toUpperCase())),
          chips: packageChips(r),
        })),
        lots: {
          product: multi ? `${rows.length} ITEMS` : first.product_name,
          lot_code: multi ? 'VARIOS' : first.lot,
          expiry_date: multi ? null : first.expiry_date,
          location: null,
          clients: { name: empresa },
        },
      }
    })

    const merged = [...webMovements, ...desktopRows].sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0),
    )
    setMovements(merged)
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim()
    return movements.filter((m) => {
      if (typeFilter && m.type !== typeFilter) return false
      if (!term) return true
      const lot = m.lots || {}
      return [
        m.notes,
        m.type,
        TYPE_LABELS[m.type],
        m.note_number,
        m.transporter,
        m.plate,
        m.observations,
        ...(m.items ? m.items.map((item) => item.product) : []),
        ...(m.items ? m.items.map((item) => item.lot) : []),
        cleanProductName(lot.product),
        displayLotCode(lot.lot_code, lot),
        lot.clients?.name,
        lot.location,
        m.profiles?.full_name,
      ].filter(Boolean).some((v) => String(v).toLowerCase().includes(term))
    })
  }, [movements, search, typeFilter])

  const selected = movements.find((m) => m.id === selectedId)

  function openDetail(m) {
    setSelectedId(m.id)
    setEditing(false)
    setEditNotes(m.notes || '')
    setError('')
  }

  function startEdit() {
    setEditing(true)
    setEditNotes(selected?.notes || '')
  }

  async function saveEdit(e) {
    e.preventDefault()
    if (!selectedId) return
    setSaving(true)
    const { error: err } = await supabase.from('movements').update({ notes: editNotes.trim() || null }).eq('id', selectedId)
    setSaving(false)
    if (err) return setError(err.message)
    setEditing(false)
    setMovements((prev) => prev.map((m) => m.id === selectedId ? { ...m, notes: editNotes.trim() || null } : m))
  }

  const lot = selected?.lots || {}

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex h-[92dvh] max-h-[760px] w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-black text-slate-950">Historial de ingresos y salidas</h2>
            {!loading && <p className="text-xs font-semibold text-slate-400">{filtered.length} movimientos</p>}
          </div>
          <button className="btn-secondary !min-h-9 !p-2" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          <div className="relative flex-1 min-w-[160px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input w-full pl-8 text-sm"
              placeholder="Buscar producto, lote, empresa..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="input text-sm sm:w-40" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">Todos</option>
            <option value="entrada">Ingresos</option>
            <option value="salida">Salidas</option>
            <option value="traslado">Traslados</option>
            <option value="ajuste">Ajustes</option>
          </select>
        </div>

        {/* Body: table + detail panel */}
        <div className="flex min-h-0 flex-1">

          {/* Table */}
          <div className={`flex flex-col overflow-hidden ${selected ? 'hidden lg:flex lg:flex-1' : 'flex-1'}`}>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <p className="py-12 text-center text-sm font-bold text-slate-400">Cargando movimientos...</p>
              ) : filtered.length === 0 ? (
                <p className="py-12 text-center text-sm font-bold text-slate-400">Sin resultados.</p>
              ) : (
                <table className="w-full border-collapse" style={{ minWidth: '600px' }}>
                  <colgroup>
                    <col style={{ width: '86px' }} />
                    <col style={{ width: '80px' }} />
                    <col style={{ width: '90px' }} />
                    <col />
                    <col />
                    <col style={{ width: '90px' }} />
                    <col style={{ width: '100px' }} />
                  </colgroup>
                  <thead className="sticky top-0">
                    <tr className="bg-campo-700 text-white">
                      <th className="px-3 py-2.5 text-left text-xs font-black uppercase tracking-wide">NOTA</th>
                      <th className="px-3 py-2.5 text-left text-xs font-black uppercase tracking-wide">TIPO</th>
                      <th className="px-3 py-2.5 text-left text-xs font-black uppercase tracking-wide">FECHA</th>
                      <th className="px-3 py-2.5 text-left text-xs font-black uppercase tracking-wide">EMPRESA</th>
                      <th className="px-3 py-2.5 text-left text-xs font-black uppercase tracking-wide">PRODUCTO</th>
                      <th className="px-3 py-2.5 text-right text-xs font-black uppercase tracking-wide">CANTIDAD</th>
                      <th className="px-3 py-2.5 text-left text-xs font-black uppercase tracking-wide">CONCEPTO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((m, i) => {
                      const mLot = m.lots || {}
                      const isSelected = selectedId === m.id
                      return (
                        <tr
                          key={m.id}
                          className={`cursor-pointer border-b border-slate-100 transition-colors ${
                            isSelected ? 'bg-campo-100' : i % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50 hover:bg-slate-100'
                          }`}
                          onClick={() => openDetail(m)}
                        >
                          <td className="px-3 py-2 font-mono text-xs font-bold text-campo-700 whitespace-nowrap">{m.note_number || '-'}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-black uppercase ${TYPE_COLORS[m.type] || 'bg-slate-100 text-slate-700'}`}>
                              {TYPE_LABELS[m.type] || m.type}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs font-semibold text-slate-600 whitespace-nowrap">{fmtDate(m.created_at)}</td>
                          <td className="px-3 py-2 text-xs font-semibold text-slate-700 max-w-[120px] truncate">{mLot.clients?.name || '-'}</td>
                          <td className="px-3 py-2 text-xs font-semibold text-slate-900 max-w-[160px] truncate">{cleanProductName(mLot.product) || '-'}</td>
                          <td className="px-3 py-2 text-right text-sm font-black leading-snug text-campo-700">{m.cantidadLabel || formatNumber(m.quantity)}</td>
                          <td className="px-3 py-2 text-xs text-slate-500 max-w-[100px] truncate">{m.notes || '-'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Detail / edit panel */}
          {selected && (
            <div className="flex w-full flex-col border-l border-slate-200 lg:w-72 xl:w-80">
              {/* Detail header */}
              <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-black uppercase ${TYPE_COLORS[selected.type] || ''}`}>
                    {TYPE_LABELS[selected.type] || selected.type}
                  </span>
                  <span className="text-xs font-semibold text-slate-400">{fmtDate(selected.created_at)}</span>
                </div>
                <button
                  className="rounded p-1 text-slate-400 hover:text-slate-700"
                  type="button"
                  onClick={() => { setSelectedId(null); setEditing(false) }}
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {(() => {
                  const isSalida = selected.type === 'salida'
                  const isDesktop = selected.source === 'desktop'
                  const isMulti = Array.isArray(selected.items) && selected.items.length > 1
                  const isSingleLot = !isMulti && !isDesktop && !selected.grouped
                  // Lista de productos unificada: individual = 1 item; multi/desktop = su lista
                  const displayItems = isMulti
                    ? selected.items
                    : [{
                        product: cleanProductName(lot.product),
                        lot: displayLotCode(lot.lot_code, lot),
                        cantidadLabel: selected.cantidadLabel || formatNumber(selected.quantity),
                        envaseLabel: isSingleLot ? stockEnvaseLabel(selected.quantity, lot) : '',
                        expiry_date: lot.expiry_date || null,
                        location: lot.location || '',
                      }]
                  // Datos de la operación: campos directos o parseados del concepto
                  const c = parseConcepto(selected.notes)
                  const transp = selected.transporter || c.transportista
                  const placa = selected.plate || c.placa
                  const tel = selected.contact_person || c.documento
                  const obs = selected.observations || c.obs
                  return (
                    <>
                      {/* Nota + empresa */}
                      <div>
                        <p className="font-mono text-sm font-black text-campo-700">{selected.note_number || '-'}</p>
                        <p className="mt-0.5 text-xs font-semibold text-slate-500">{lot.clients?.name || '-'}</p>
                      </div>

                      {/* Productos (1 o N, mismo formato) */}
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Productos ({displayItems.length})</p>
                        <div className="mt-1 space-y-1">
                          {displayItems.map((item, idx) => (
                            <div key={idx} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                              <div className="flex items-start justify-between gap-2">
                                <p className="min-w-0 text-xs font-bold text-slate-800 [overflow-wrap:anywhere]">{cleanProductName(item.product)}</p>
                                <p className="shrink-0 text-sm font-black text-campo-700">{item.cantidadLabel || formatNumber(item.quantity)}</p>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[10px] font-semibold text-slate-400">
                                  {item.lot ? `Lote ${item.lot}` : ''}{item.expiry_date ? ` · Vence ${fmtDate(item.expiry_date + 'T00:00:00')}` : ''}
                                </p>
                                {item.envaseLabel ? <p className="shrink-0 text-[10px] font-semibold text-slate-400">{item.envaseLabel}</p> : null}
                              </div>
                              {item.location ? <p className="text-[10px] font-semibold text-slate-400">{item.location}</p> : null}
                              <PackageChips chips={item.chips} />
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Cantidad total destacada */}
                      <div className={`rounded-xl px-3 py-3 text-center ${isSalida ? 'bg-red-50' : 'bg-campo-50'}`}>
                        <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Cantidad total</p>
                        <p className={`mt-0.5 text-xl font-black ${isSalida ? 'text-red-700' : 'text-campo-800'}`}>
                          {selected.cantidadLabel || formatNumber(selected.quantity)}
                        </p>
                      </div>

                      {/* Stock antes/después: solo en movimiento de un lote */}
                      {isSingleLot && (
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Stock antes</p>
                            <p className="mt-0.5 text-sm font-bold text-slate-700">{stockEnvaseLabel(selected.previous_quantity, lot)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Stock después</p>
                            <p className="mt-0.5 text-sm font-bold text-slate-700">{stockEnvaseLabel(selected.new_quantity, lot)}</p>
                          </div>
                        </div>
                      )}

                      {/* Datos de la operación */}
                      <div className="border-t border-slate-100 pt-3">
                        <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-slate-400">
                          Datos de {isSalida ? 'la salida' : 'el ingreso'}
                        </p>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                          {transp && <MiniField label="Transportista" value={transp} />}
                          {placa && <MiniField label="Placa" value={placa} />}
                          {tel && <MiniField label="Teléfono" value={tel} />}
                          {selected.profiles?.full_name && <MiniField label="Usuario" value={selected.profiles.full_name} />}
                        </div>
                        {obs && (
                          <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2">
                            <span className="text-xs font-semibold italic text-amber-800">Obs.: {obs}</span>
                          </div>
                        )}
                      </div>

                      {isDesktop && (
                        <p className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">Registrado en el programa</p>
                      )}

                      {/* Editar concepto: solo movimientos web y con permiso */}
                      {!isDesktop && editing ? (
                        <form onSubmit={saveEdit} className="space-y-2 border-t border-slate-100 pt-3">
                          <label className="block">
                            <span className="text-xs font-bold text-slate-700">Concepto</span>
                            <textarea
                              className="input mt-1 w-full text-sm"
                              rows={3}
                              value={editNotes}
                              onChange={(e) => setEditNotes(e.target.value)}
                              placeholder="Observaciones..."
                            />
                          </label>
                          {error && <p className="text-xs font-bold text-red-600">{error}</p>}
                          <div className="flex gap-2">
                            <button className="btn-primary flex-1 !min-h-9 !py-1.5 text-sm" type="submit" disabled={saving}>
                              <Save size={14} />{saving ? 'Guardando...' : 'Guardar'}
                            </button>
                            <button className="btn-secondary !min-h-9 !px-3 !py-1.5 text-sm" type="button" onClick={() => setEditing(false)}>
                              Cancelar
                            </button>
                          </div>
                        </form>
                      ) : !isDesktop && canEdit && !selected.grouped ? (
                        <button
                          className="btn-secondary w-full !min-h-9 !py-1.5 text-sm"
                          type="button"
                          onClick={startEdit}
                        >
                          Editar concepto
                        </button>
                      ) : null}
                    </>
                  )
                })()}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

function InfoRow({ label, value, bold }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-sm ${bold ? 'font-black text-campo-700' : 'font-semibold text-slate-700'} [overflow-wrap:anywhere]`}>{value}</p>
    </div>
  )
}

function MiniField({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase text-slate-400">{label}</p>
      <p className="text-xs font-bold text-slate-700 [overflow-wrap:anywhere]">{value}</p>
    </div>
  )
}
