import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { CheckCircle2, LogOut, Plus, Trash2, X } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'
import { formatNumber } from '../lib/format'
import { cleanProductName, displayLotCode } from '../lib/display'
import { vibrateSuccess } from '../lib/haptics'

const today = new Date().toISOString().slice(0, 10)
const DRAFT_KEY = 'draft_salida'

function emptyRow() {
  return {
    id: crypto.randomUUID(),
    lot_id: '',
    product: '',
    lot_code: '',
    expiry_date: '',
    saldo: 0,
    quantity: '',
  }
}

function displayClientName(name) {
  return String(name || '').replaceAll('"', '').replace(/\s+/g, ' ').trim()
}

function lotOptionLabel(lot) {
  const lote = displayLotCode(lot.lot_code)
  const venc = lot.expiry_date
    ? new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: 'short', year: 'numeric' }).format(
        new Date(`${lot.expiry_date}T00:00:00`),
      )
    : 'SIN VENC'
  const saldo = formatNumber(lot.current_quantity)
  return `${cleanProductName(lot.product)}   Lote: ${lote}   Venc: ${venc}   Saldo: ${saldo}`
}

export default function NuevaSalida() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const restoringRef = useRef(false)

  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [guiaPreview, setGuiaPreview] = useState('')
  const [concepto, setConcepto] = useState('Salida de producto')
  const [lotesAutomaticos, setLotesAutomaticos] = useState(false)
  const [lots, setLots] = useState([])
  const [rows, setRows] = useState([emptyRow()])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  // Cargar preview del número de guía automático
  useEffect(() => {
    supabase.rpc('preview_next_warehouse_guide', { p_type: 'sal' })
      .then(({ data }) => { if (data) setGuiaPreview(data) })
  }, [])

  // Restaurar borrador solo en F5 o navegación "atrás"; limpiar en navegación fresca
  useEffect(() => {
    const navType = performance.getEntriesByType?.('navigation')?.[0]?.type
    const prevKey = sessionStorage.getItem('salida_loc_key')
    const isReload = navType === 'reload'
    const isBackNav = prevKey !== null && prevKey === location.key
    sessionStorage.setItem('salida_loc_key', location.key)

    if (isReload || isBackNav) {
      try {
        const saved = localStorage.getItem(DRAFT_KEY)
        if (saved) {
          const d = JSON.parse(saved)
          if (d.concepto) setConcepto(d.concepto)
          if (d.rows?.length) setRows(d.rows)
          if (d.clientId) {
            restoringRef.current = true
            setClientId(d.clientId)
          }
        }
      } catch {}
    } else {
      localStorage.removeItem(DRAFT_KEY)
    }
  }, [])

  // Guardar borrador en cada cambio
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ clientId, concepto, rows }))
  }, [clientId, concepto, rows])

  useEffect(() => { loadClients() }, [])

  useEffect(() => {
    if (clientId) loadClientLots(clientId)
    else setLots([])
  }, [clientId])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'F12') { e.preventDefault(); addRow() }
      if (e.key === 'F10') { e.preventDefault(); removeSelectedRow() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function loadClients() {
    const { data } = await supabase
      .from('clients')
      .select('id, name')
      .eq('inventory_source', 'stock_independiente')
      .order('name')
    const seen = new Set()
    setClients((data || []).filter((c) => {
      const key = displayClientName(c.name).toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }))
  }

  function clearDraft() { localStorage.removeItem(DRAFT_KEY) }

  async function loadClientLots(cid) {
    const { data } = await supabase
      .from('lots')
      .select('id, product, lot_code, expiry_date, current_quantity, location')
      .eq('inventory_source', 'stock_independiente')
      .eq('client_id', cid)
      .gt('current_quantity', 0)
      .order('product')
      .order('expiry_date', { ascending: true, nullsFirst: false })
    setLots(data || [])
    if (!restoringRef.current) setRows([emptyRow()])
    restoringRef.current = false
  }

  function addRow() {
    setRows((r) => {
      const next = [...r, emptyRow()]
      setSelectedIdx(next.length - 1)
      return next
    })
  }

  function removeSelectedRow() {
    if (rows.length <= 1) return
    setRows((r) => {
      const next = r.filter((_, i) => i !== selectedIdx)
      setSelectedIdx(Math.max(0, selectedIdx - 1))
      return next
    })
  }

  function removeRow(id) {
    if (rows.length <= 1) return
    const index = rows.findIndex((r) => r.id === id)
    setRows((r) => r.filter((row) => row.id !== id))
    setSelectedIdx((prev) => Math.max(0, index <= prev ? prev - 1 : prev))
  }

  function selectLot(rowId, lotId) {
    const lot = lots.find((l) => l.id === lotId)
    if (!lot) return
    setRows((r) =>
      r.map((row) =>
        row.id === rowId
          ? {
              ...row,
              lot_id: lot.id,
              product: cleanProductName(lot.product),
              lot_code: displayLotCode(lot.lot_code),
              expiry_date: lot.expiry_date || '',
              saldo: lot.current_quantity,
            }
          : row,
      ),
    )
  }

  function clearLot(rowId) {
    setRows((r) => r.map((row) => row.id === rowId ? { ...emptyRow(), id: rowId } : row))
  }

  function updateQuantity(rowId, value) {
    const v = value.replace(',', '.')
    if (/^\d*\.?\d*$/.test(v))
      setRows((r) => r.map((row) => row.id === rowId ? { ...row, quantity: v } : row))
  }

  const totalQuantity = useMemo(
    () => rows.reduce((sum, r) => sum + Number(r.quantity || 0), 0),
    [rows],
  )

  async function save() {
    setError('')
    if (!clientId) { setError('Selecciona la empresa.'); return }
    const validRows = rows.filter((r) => r.lot_id && Number(r.quantity || 0) > 0)
    if (validRows.length === 0) { setError('Agrega al menos un item con lote y cantidad.'); return }

    const overStock = validRows.find((r) => Number(r.quantity) > Number(r.saldo))
    if (overStock) {
      setError(`Cantidad excede el saldo disponible para: ${overStock.product} (saldo: ${formatNumber(overStock.saldo)}).`)
      return
    }

    setSaving(true)
    try {
      const operationItems = validRows.map((r) => ({
        lot_id: r.lot_id,
        quantity: Number(r.quantity),
      }))

      const { error: rpcError } = await supabase.rpc('create_dispatch_operation', {
        p_client_id: clientId,
        p_receiver_name: concepto || 'Salida de producto',
        p_receiver_document: '',
        p_vehicle_plate: null,
        p_notes: concepto.trim() || null,
        p_items: operationItems,
        p_request_id: null,
        p_user_id: user.id,
      })

      if (rpcError) {
        if (rpcError.message?.includes('inventario') || rpcError.message?.includes('stock'))
          throw new Error('No hay inventario suficiente para completar esta salida.')
        throw rpcError
      }

      clearDraft()
      vibrateSuccess()
      setSuccess(true)
      setTimeout(() => navigate(-1), 2200)
    } catch (err) {
      setError(err.message || 'Error al guardar la salida.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader title="Salida" subtitle="Nota de salida de mercadería" />

      <section className="panel mb-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Empresa</span>
          <select className="input mt-1" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
            <option value="">Seleccionar empresa</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{displayClientName(c.name)}</option>
            ))}
          </select>
        </label>
        <div>
          <span className="label">Fecha</span>
          <div className="input mt-1 cursor-not-allowed select-none bg-slate-100 font-semibold text-slate-600">{today}</div>
        </div>
        <div>
          <span className="label">N° Guía</span>
          <div className="input mt-1 cursor-not-allowed select-none bg-slate-100 font-mono font-bold text-campo-700">{guiaPreview || '...'}</div>
        </div>
        <label className="block">
          <span className="label">Concepto</span>
          <input className="input mt-1" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
        </label>
      </section>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button className="btn-primary !min-h-10 !px-4 !py-2 text-sm" type="button" onClick={addRow} disabled={!clientId}>
          <Plus size={17} /> Agregar item (F12)
        </button>
        <button
          className="btn-secondary !min-h-10 !px-4 !py-2 text-sm"
          type="button"
          onClick={removeSelectedRow}
          disabled={rows.length <= 1}
        >
          <Trash2 size={17} /> Quitar seleccionado (F10)
        </button>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded accent-campo-700"
            checked={lotesAutomaticos}
            onChange={(e) => setLotesAutomaticos(e.target.checked)}
          />
          Lotes automáticos
        </label>
      </div>

      {!clientId && (
        <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-500">
          Selecciona la empresa para ver los lotes disponibles.
        </div>
      )}

      {clientId && lots.length === 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-700">
          Esta empresa no tiene stock disponible.
        </div>
      )}

      <div className="mb-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full border-collapse" style={{ minWidth: '680px' }}>
          <colgroup>
            <col style={{ width: '40px' }} />
            <col />
            <col style={{ width: '105px' }} />
            <col style={{ width: '110px' }} />
            <col style={{ width: '80px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '34px' }} />
          </colgroup>
          <thead>
            <tr className="bg-campo-700 text-white">
              <th className="border-b border-campo-600 px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide">N°</th>
              <th className="border-b border-campo-600 px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide">PRODUCTO</th>
              <th className="border-b border-campo-600 px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide">LOTE</th>
              <th className="border-b border-campo-600 px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide">VENC</th>
              <th className="border-b border-campo-600 px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide">SALDO</th>
              <th className="border-b border-campo-600 px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide">CANTIDAD</th>
              <th className="border-b border-campo-600 px-1 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.id}
                className={`cursor-pointer border-b border-slate-100 transition-colors ${selectedIdx === i ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : 'hover:bg-slate-50'}`}
                onClick={() => setSelectedIdx(i)}
              >
                <td className="px-3 py-1.5 text-center text-sm font-bold text-slate-500">{i + 1}</td>
                <td className="px-2 py-1">
                  {row.lot_id ? (
                    <div className="flex min-w-0 items-center gap-1">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900" title={row.product}>
                        {row.product}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 rounded p-0.5 text-slate-400 hover:text-red-500"
                        onClick={(e) => { e.stopPropagation(); setSelectedIdx(i); clearLot(row.id) }}
                        title="Cambiar lote"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <select
                      className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-sm focus:border-campo-400 focus:bg-white focus:outline-none"
                      value=""
                      onChange={(e) => { setSelectedIdx(i); selectLot(row.id, e.target.value) }}
                      onFocus={() => setSelectedIdx(i)}
                      disabled={!clientId || lots.length === 0}
                    >
                      <option value="">— Seleccionar lote —</option>
                      {lots.map((lot) => (
                        <option key={lot.id} value={lot.id}>{lotOptionLabel(lot)}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-3 py-1.5 text-center text-sm font-semibold text-slate-700">
                  {row.lot_code || <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-1.5 text-center text-sm font-semibold text-slate-700">
                  {row.expiry_date
                    ? new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${row.expiry_date}T00:00:00`))
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-1.5 text-right text-sm font-semibold text-slate-500">
                  {row.lot_id ? formatNumber(row.saldo) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-2 py-1">
                  <input
                    className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-right text-sm font-bold focus:border-campo-400 focus:bg-white focus:outline-none"
                    inputMode="decimal"
                    value={row.quantity}
                    onChange={(e) => updateQuantity(row.id, e.target.value)}
                    onFocus={() => setSelectedIdx(i)}
                    placeholder="0"
                    disabled={!row.lot_id}
                  />
                </td>
                <td className="px-1 py-1 text-center">
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded text-slate-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-30"
                    onClick={(e) => { e.stopPropagation(); removeRow(row.id) }}
                    disabled={rows.length <= 1}
                    title="Eliminar fila"
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50">
              <td colSpan={5} className="px-3 py-2.5 text-sm font-black uppercase text-slate-600">Total cantidad:</td>
              <td className="px-3 py-2.5 text-right text-sm font-black text-slate-950">{formatNumber(totalQuantity)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {error ? <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

      {success ? (
        <div className="mb-4 rounded-xl border border-campo-200 bg-campo-50 p-5 text-center">
          <CheckCircle2 className="mx-auto mb-2 text-campo-700" size={38} />
          <p className="text-base font-black text-campo-800">Salida guardada correctamente.</p>
          <p className="mt-1 text-sm font-semibold text-campo-600">Redirigiendo...</p>
        </div>
      ) : (
        <div className="flex gap-3">
          <button className="btn-primary flex-1" type="button" onClick={save} disabled={saving || !clientId}>
            <LogOut size={20} /> {saving ? 'Guardando...' : 'Guardar'}
          </button>
          <button className="btn-secondary flex-1" type="button" onClick={() => { clearDraft(); navigate(-1) }} disabled={saving}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}
