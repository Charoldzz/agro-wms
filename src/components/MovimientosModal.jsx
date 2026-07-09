import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowLeftRight, ArrowUp, RotateCcw, Save, Search, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatNumber } from '../lib/format'
import { cleanProductName, displayLotCode } from '../lib/display'

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

export default function MovimientosModal({ onClose }) {
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
    const [webResult, desktopResult, clientsResult] = await Promise.all([
      supabase
        .from('movements')
        .select('*, lots(lot_code, product, location, expiry_date, clients(name)), profiles(full_name), warehouse_operations(guide_number)')
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
    ])

    let rawWebMovements = webResult.data || []
    if (webResult.error) {
      const { data: raw } = await supabase
        .from('movements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
      rawWebMovements = raw || []
    }

    // Agrupar movimientos web que pertenecen a la misma operación (misma guía)
    const webByOperation = new Map()
    const webMovements = []
    for (const m of rawWebMovements) {
      const noteNumber = m.warehouse_operations?.guide_number || null
      if (m.operation_id && (m.type === 'entrada' || m.type === 'salida')) {
        if (!webByOperation.has(m.operation_id)) webByOperation.set(m.operation_id, [])
        webByOperation.get(m.operation_id).push({ ...m, note_number: noteNumber })
      } else {
        webMovements.push({ ...m, note_number: noteNumber })
      }
    }
    for (const group of webByOperation.values()) {
      if (group.length === 1) {
        webMovements.push(group[0])
        continue
      }
      const first = group[0]
      webMovements.push({
        ...first,
        id: `op-${first.operation_id}`,
        grouped: true,
        quantity: group.reduce((sum, m) => sum + Number(m.quantity || 0), 0),
        created_at: group.reduce((max, m) => (m.created_at > max ? m.created_at : max), first.created_at),
        items: group.map((m) => ({ product: m.lots?.product, lot: displayLotCode(m.lots?.lot_code, m.lots), quantity: m.quantity })),
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
        notes: first.concept,
        note_number: first.note_number,
        transporter: rows.find((r) => r.transporter)?.transporter || '',
        plate: rows.find((r) => r.plate)?.plate || '',
        contact_person: rows.find((r) => r.contact_person)?.contact_person || '',
        observations: rows.find((r) => r.observations)?.observations || '',
        items: rows.map((r) => ({ product: r.product_name, lot: r.lot, expiry_date: r.expiry_date, quantity: r.quantity })),
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
                          <td className="px-3 py-2 text-right text-sm font-black text-campo-700 whitespace-nowrap">{formatNumber(m.quantity)}</td>
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
                {selected.source === 'desktop' || selected.grouped ? (
                  <>
                    <InfoRow label="Nota" value={selected.note_number || '-'} bold />
                    <InfoRow label="Empresa" value={lot.clients?.name || '-'} />
                    {selected.items && selected.items.length > 1 ? (
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Productos ({selected.items.length})</p>
                        <div className="mt-1 space-y-1">
                          {selected.items.map((item, idx) => (
                            <div key={idx} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                              <div className="flex items-start justify-between gap-2">
                                <p className="min-w-0 text-xs font-bold text-slate-800 [overflow-wrap:anywhere]">{cleanProductName(item.product)}</p>
                                <p className="shrink-0 text-sm font-black text-campo-700">{formatNumber(item.quantity)}</p>
                              </div>
                              {item.lot ? <p className="text-[10px] font-semibold text-slate-400">Lote: {item.lot}</p> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <>
                        <InfoRow label="Producto" value={cleanProductName(lot.product) || '-'} />
                        <InfoRow label="Lote" value={lot.lot_code || '-'} />
                        <InfoRow label="Vencimiento" value={lot.expiry_date ? fmtDate(lot.expiry_date + 'T00:00:00') : 'Sin venc.'} />
                      </>
                    )}
                    <InfoRow label="Cantidad total" value={formatNumber(selected.quantity)} bold />
                    {selected.transporter ? <InfoRow label="Transportista" value={selected.transporter} /> : null}
                    {selected.plate ? <InfoRow label="Placa" value={selected.plate} /> : null}
                    {selected.contact_person ? <InfoRow label="Contacto" value={selected.contact_person} /> : null}
                    {selected.observations ? <InfoRow label="Observaciones" value={selected.observations} /> : null}
                    {selected.profiles?.full_name ? <InfoRow label="Usuario" value={selected.profiles.full_name} /> : null}
                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                      <p className="text-xs font-semibold text-slate-400">Concepto</p>
                      <p className="mt-0.5 text-sm font-semibold text-slate-700">{selected.notes || 'Sin concepto'}</p>
                    </div>
                    {selected.source === 'desktop' ? (
                      <p className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">Registrado en el programa</p>
                    ) : null}
                  </>
                ) : (
                <>
                <InfoRow label="Empresa" value={lot.clients?.name || '-'} />
                <InfoRow label="Producto" value={cleanProductName(lot.product) || '-'} />
                <InfoRow label="Lote" value={displayLotCode(lot.lot_code, lot) || '-'} />
                <InfoRow label="Vencimiento" value={lot.expiry_date ? fmtDate(lot.expiry_date + 'T00:00:00') : 'Sin venc.'} />
                <InfoRow label="Ubicación" value={lot.location || '-'} />
                <InfoRow label="Cantidad" value={formatNumber(selected.quantity)} bold />
                <InfoRow label="Stock anterior" value={formatNumber(selected.previous_quantity)} />
                <InfoRow label="Stock nuevo" value={formatNumber(selected.new_quantity)} />
                <InfoRow label="Usuario" value={selected.profiles?.full_name || '-'} />

                {editing ? (
                  <form onSubmit={saveEdit} className="space-y-2 pt-1">
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
                ) : (
                  <div className="pt-1">
                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                      <p className="text-xs font-semibold text-slate-400">Concepto</p>
                      <p className="mt-0.5 text-sm font-semibold text-slate-700">{selected.notes || 'Sin concepto'}</p>
                    </div>
                    <button
                      className="btn-secondary mt-3 w-full !min-h-9 !py-1.5 text-sm"
                      type="button"
                      onClick={startEdit}
                    >
                      Editar concepto
                    </button>
                  </div>
                )}
                </>
                )}
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
