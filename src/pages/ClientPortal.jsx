import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, CalendarClock, Download, FileText, History, Mail, PackageCheck, Plus, Search, Send, Trash2, Truck } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useAuth } from '../hooks/useAuth.jsx'
import { cleanProductName, displayLotCode, packageLabel } from '../lib/display'
import { formatDate, formatNumber, movementLabel } from '../lib/format'
import { supabase } from '../lib/supabase'

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function daysUntil(expiryDate) {
  if (!expiryDate) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((new Date(`${expiryDate}T00:00:00`) - today) / 86400000)
}

function lotStatus(lot) {
  const days = daysUntil(lot.expiry_date)
  if (days !== null && days < 0) return { label: 'Vencido', className: 'bg-red-50 text-red-700' }
  if (lot.status === 'retenido') return { label: 'Retenido', className: 'bg-orange-50 text-orange-700' }
  if (lot.status === 'cerrado') return { label: 'Cerrado', className: 'bg-slate-100 text-slate-600' }
  if (days !== null && days <= 90) return { label: 'Por vencer', className: 'bg-amber-50 text-amber-800' }
  return { label: 'Disponible', className: 'bg-campo-50 text-campo-700' }
}

const REQUEST_DRAFT_KEY = 'todo-agricola-client-dispatch-draft'

function readRequestDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(REQUEST_DRAFT_KEY) || 'null')
    if (!draft) return { lotId: '', quantity: '', notes: '', items: [] }
    return {
      lotId: draft.lotId || '',
      quantity: draft.quantity || '',
      notes: draft.notes || '',
      items: Array.isArray(draft.items) ? draft.items : [],
    }
  } catch {
    return { lotId: '', quantity: '', notes: '', items: [] }
  }
}

function writeRequestDraft(draft) {
  localStorage.setItem(REQUEST_DRAFT_KEY, JSON.stringify(draft))
}

function clearRequestDraft() {
  localStorage.removeItem(REQUEST_DRAFT_KEY)
}

export default function ClientPortal() {
  const { user } = useAuth()
  const initialDraft = useMemo(readRequestDraft, [])
  const [lots, setLots] = useState([])
  const [movements, setMovements] = useState([])
  const [requests, setRequests] = useState([])
  const [search, setSearch] = useState('')
  const [requestLotId, setRequestLotId] = useState(initialDraft.lotId)
  const [requestQuantity, setRequestQuantity] = useState(initialDraft.quantity)
  const [requestNotes, setRequestNotes] = useState(initialDraft.notes)
  const [requestItems, setRequestItems] = useState(initialDraft.items)
  const [requestMessage, setRequestMessage] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    writeRequestDraft({
      lotId: requestLotId,
      quantity: requestQuantity,
      notes: requestNotes,
      items: requestItems,
    })
  }, [requestLotId, requestQuantity, requestNotes, requestItems])

  async function loadData() {
    const { data: lotsData } = await supabase
      .from('lots')
      .select('id, lot_code, client_id, product, current_quantity, package_size, package_unit, location, entry_date, expiry_date, status, clients(name, contact)')
      .order('product')

    setLots(lotsData || [])

    const lotIds = (lotsData || []).map((lot) => lot.id)
    const { data: movementData } = lotIds.length
      ? await supabase
        .from('movements')
        .select('id, type, quantity, previous_quantity, new_quantity, to_location, notes, created_at, lots(lot_code, product, package_size, package_unit, location)')
        .in('lot_id', lotIds)
        .in('type', ['entrada', 'salida'])
        .order('created_at', { ascending: false })
        .limit(80)
      : { data: [] }

    setMovements(movementData || [])

    const { data: requestData } = await supabase
      .from('client_dispatch_requests')
      .select('id, product, quantity, items, notes, status, admin_notes, created_at, reviewed_at, lots(lot_code, product)')
      .order('created_at', { ascending: false })

    setRequests(requestData || [])
  }

  const filteredLots = useMemo(() => {
    const term = search.toLowerCase()
    return lots.filter((lot) =>
      [lot.product, lot.lot_code, displayLotCode(lot.lot_code), lot.location, lot.status]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(term)),
    )
  }, [lots, search])

  const totalStock = lots.reduce((sum, lot) => sum + Number(lot.current_quantity || 0), 0)
  const expiring = lots.filter((lot) => {
    const days = daysUntil(lot.expiry_date)
    return days !== null && days <= 90
  })
  const productCount = new Set(lots.map((lot) => lot.product).filter(Boolean)).size
  const clientName = lots[0]?.clients?.name || 'Cliente'
  const dispatchReceipts = movements.filter((movement) => movement.type === 'salida')
  const history = movements.slice(0, 12)

  function addRequestItem() {
    setRequestMessage('')

    const selectedLot = lots.find((lot) => lot.id === requestLotId)
    const quantity = Number(requestQuantity || 0)

    if (!selectedLot) {
      setRequestMessage('Selecciona un lote.')
      return
    }
    if (quantity <= 0) {
      setRequestMessage('Escribe una cantidad mayor a cero.')
      return
    }

    setRequestItems((current) => {
      const existing = current.find((item) => item.lot_id === selectedLot.id)
      if (existing) {
        return current.map((item) =>
          item.lot_id === selectedLot.id
            ? { ...item, quantity: item.quantity + quantity }
            : item,
        )
      }
      return [
        ...current,
        {
          lot_id: selectedLot.id,
          lot_code: selectedLot.lot_code,
          product: selectedLot.product,
          quantity,
          package_size: selectedLot.package_size,
          package_unit: selectedLot.package_unit,
          location: selectedLot.location,
          available: selectedLot.current_quantity,
        },
      ]
    })
    setRequestLotId('')
    setRequestQuantity('')
  }

  function removeRequestItem(lotId) {
    setRequestItems((current) => current.filter((item) => item.lot_id !== lotId))
  }

  function clearRequestCart() {
    setRequestLotId('')
    setRequestQuantity('')
    setRequestItems([])
    setRequestNotes('')
    setRequestMessage('')
    clearRequestDraft()
  }

  async function createDispatchRequest(event) {
    event.preventDefault()
    setRequestMessage('')

    if (requestItems.length === 0) {
      setRequestMessage('Agrega al menos un producto a la lista.')
      return
    }

    const firstItem = requestItems[0]
    const firstLot = lots.find((lot) => lot.id === firstItem.lot_id)
    const totalQuantity = requestItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)

    if (!firstLot) {
      setRequestMessage('No se pudo validar el primer lote de la lista. Recarga la pagina e intenta de nuevo.')
      return
    }

    const { error } = await supabase.from('client_dispatch_requests').insert({
      client_id: firstLot.client_id,
      lot_id: firstLot.id,
      product: requestItems.length === 1 ? firstItem.product : `Lista de despacho (${requestItems.length} productos)`,
      quantity: totalQuantity,
      items: requestItems,
      notes: requestNotes.trim() || null,
      requested_by: user.id,
    })

    if (error) {
      setRequestMessage('No se pudo enviar la solicitud. Ejecuta el SQL client_dispatch_requests.sql en Supabase.')
      return
    }

    setRequestLotId('')
    setRequestQuantity('')
    setRequestItems([])
    setRequestNotes('')
    clearRequestDraft()
    setRequestMessage('Solicitud enviada. Administracion la revisara.')
    loadData()
  }

  function exportInventoryExcel() {
    const headers = ['Cliente', 'Producto', 'Lote', 'Envases', 'Presentacion', 'Equivalente', 'Ubicacion', 'Ingreso', 'Vencimiento', 'Estado']
    const rows = lots.map((lot) => [
      clientName,
      cleanProductName(lot.product),
      displayLotCode(lot.lot_code),
      formatNumber(lot.current_quantity),
      lot.package_size ? `${formatNumber(lot.package_size)} ${lot.package_unit || ''}` : '',
      lot.package_size ? `${formatNumber(Number(lot.current_quantity || 0) * Number(lot.package_size || 0))} ${lot.package_unit || ''}` : '',
      lot.location || '',
      lot.entry_date ? formatDate(lot.entry_date) : '',
      lot.expiry_date ? formatDate(lot.expiry_date) : '',
      lotStatus(lot).label,
    ])
    const htmlRows = [headers, ...rows]
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
      .join('')
    const html = `<html><head><meta charset="utf-8" /></head><body><table>${htmlRows}</table></body></html>`
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `inventario-${clientName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xls`
    link.click()
    URL.revokeObjectURL(url)
  }

  function printInventoryPdf() {
    const rows = lots
      .map((lot) => {
        const equivalent = Number(lot.current_quantity || 0) * Number(lot.package_size || 0)
        return `
          <tr>
            <td>${escapeHtml(cleanProductName(lot.product))}</td>
            <td>${escapeHtml(displayLotCode(lot.lot_code))}</td>
            <td>${escapeHtml(formatNumber(lot.current_quantity))}</td>
            <td>${escapeHtml(Number(lot.package_size) > 0 ? `${formatNumber(equivalent)} ${lot.package_unit || ''}` : '-')}</td>
            <td>${escapeHtml(lot.location || '-')}</td>
            <td>${escapeHtml(lot.expiry_date ? formatDate(lot.expiry_date) : '-')}</td>
            <td>${escapeHtml(lotStatus(lot).label)}</td>
          </tr>
        `
      })
      .join('')
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Inventario ${escapeHtml(clientName)}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            body { color: #0f172a; font-family: Arial, sans-serif; margin: 24px; }
            h1 { margin: 0 0 4px; }
            table { border-collapse: collapse; margin-top: 18px; width: 100%; }
            th, td { border-bottom: 1px solid #cbd5e1; font-size: 12px; padding: 8px; text-align: left; }
            th { background: #f1f5f9; }
            .terms { color: #475569; font-size: 11px; margin-top: 18px; }
            @media print { body { margin: 12mm; } }
          </style>
        </head>
        <body>
          <h1>Todo Agricola Boliviana Ltda</h1>
          <strong>Inventario actual - ${escapeHtml(clientName)}</strong>
          <p>Emitido: ${escapeHtml(formatDate(new Date().toISOString()))}</p>
          <table>
            <thead>
              <tr><th>Producto</th><th>Lote</th><th>Envases</th><th>Equivalente</th><th>Ubicacion</th><th>Vence</th><th>Estado</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p class="terms">Informacion referencial sujeta a validacion operativa de Todo Agricola.</p>
          <script>window.addEventListener('load', () => window.print())</script>
        </body>
      </html>
    `)
    printWindow.document.close()
  }

  function printMovementReceipt(movement) {
    const lot = movement.lots || {}
    const equivalent = Number(movement.quantity || 0) * Number(lot.package_size || 0)
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Comprobante ${escapeHtml(displayLotCode(lot.lot_code))}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            body { color: #0f172a; font-family: Arial, sans-serif; margin: 24px; }
            h1 { margin: 0 0 4px; }
            .box { border: 1px solid #cbd5e1; border-radius: 8px; margin-top: 14px; padding: 12px; }
            .grid { display: grid; gap: 10px; grid-template-columns: repeat(2, 1fr); }
            strong { display: block; }
            @media print { body { margin: 12mm; } }
          </style>
        </head>
        <body>
          <h1>Todo Agricola Boliviana Ltda</h1>
          <p>Comprobante de despacho para ${escapeHtml(clientName)}</p>
          <div class="box grid">
            <div><strong>Fecha</strong>${escapeHtml(formatDate(movement.created_at))}</div>
            <div><strong>Lote</strong>${escapeHtml(displayLotCode(lot.lot_code))}</div>
            <div><strong>Producto</strong>${escapeHtml(cleanProductName(lot.product))}</div>
            <div><strong>Cantidad</strong>${escapeHtml(formatNumber(movement.quantity))} envases</div>
            <div><strong>Equivalente</strong>${escapeHtml(Number(lot.package_size) > 0 ? `${formatNumber(equivalent)} ${lot.package_unit || ''}` : '-')}</div>
            <div><strong>Ubicacion</strong>${escapeHtml(lot.location || '-')}</div>
          </div>
          ${movement.notes ? `<div class="box"><strong>Referencia</strong>${escapeHtml(movement.notes)}</div>` : ''}
          <script>window.addEventListener('load', () => window.print())</script>
        </body>
      </html>
    `)
    printWindow.document.close()
  }

  return (
    <div>
      <PageHeader
        title={clientName}
        subtitle="Inventario, comprobantes y solicitudes de despacho"
        action={
          <div className="flex gap-2">
            <button className="btn-secondary !min-h-11 !px-3" type="button" onClick={exportInventoryExcel}>
              <Download size={20} /> Excel
            </button>
            <button className="btn-secondary !min-h-11 !px-3" type="button" onClick={printInventoryPdf}>
              <FileText size={20} /> PDF
            </button>
          </div>
        }
      />

      <section className="grid grid-cols-3 gap-1.5 sm:gap-2">
        <Metric icon={Boxes} label="Envases disponibles" value={formatNumber(totalStock)} />
        <Metric icon={PackageCheck} label="Productos" value={productCount} />
        <Metric icon={CalendarClock} label="Por vencer" value={expiring.length} accent="text-maiz" />
      </section>

      <section className="my-4 flex items-center rounded-lg border border-slate-200 bg-white px-3">
        <Search size={20} className="text-slate-400" />
        <input
          className="min-h-12 flex-1 bg-transparent px-2 outline-none"
          placeholder="Buscar producto, lote, estado o ubicacion..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.3fr_.7fr]">
        <div className="space-y-3">
          {filteredLots.length === 0 ? (
            <EmptyState title="Sin lotes visibles" text="No hay inventario autorizado para este usuario." />
          ) : (
            filteredLots.map((lot) => {
              const equivalent = Number(lot.current_quantity || 0) * Number(lot.package_size || 0)
              const status = lotStatus(lot)
              return (
                <Link key={lot.id} className="panel block" to={`/lotes/${lot.id}`}>
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-bold text-slate-950">{cleanProductName(lot.product)}</p>
                        <span className={`rounded-full px-2 py-1 text-xs font-bold ${status.className}`}>{status.label}</span>
                      </div>
                      <p className="text-sm font-semibold text-slate-500">{displayLotCode(lot.lot_code)} - {lot.location || '-'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-black text-campo-700">{formatNumber(lot.current_quantity)}</p>
                      <p className="text-xs font-bold text-slate-500">envases</p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs font-bold text-slate-600 sm:grid-cols-3">
                    <span className="rounded-lg bg-slate-50 p-2">
                      Equivalente: {Number(lot.package_size) > 0 ? `${formatNumber(equivalent)} ${lot.package_unit || ''}` : 'Sin dato'}
                    </span>
                    <span className="rounded-lg bg-slate-50 p-2">
                      Ingreso: {lot.entry_date ? formatDate(lot.entry_date) : 'Sin dato'}
                    </span>
                    <span className="rounded-lg bg-slate-50 p-2">
                      Vence: {lot.expiry_date ? formatDate(lot.expiry_date) : 'Sin dato'}
                    </span>
                  </div>
                </Link>
              )
            })
          )}
        </div>

        <aside className="space-y-4">
          <section className="panel">
            <div className="mb-3 flex items-center gap-2">
              <Send size={20} className="text-campo-700" />
              <h3 className="font-bold text-slate-950">Solicitar despacho</h3>
            </div>
            <form className="space-y-3" onSubmit={createDispatchRequest} noValidate>
              <label>
                <span className="label">Producto / lote</span>
                <select className="input mt-1" value={requestLotId} onChange={(event) => setRequestLotId(event.target.value)}>
                  <option value="">Seleccionar</option>
                  {lots.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {cleanProductName(lot.product)} - {displayLotCode(lot.lot_code)} ({formatNumber(lot.current_quantity)} env.)
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">Envases solicitados</span>
                <input
                  className="input mt-1"
                  inputMode="decimal"
                  type="text"
                  value={requestQuantity}
                  onChange={(event) => {
                    const value = event.target.value.replace(',', '.')
                    if (/^\d*\.?\d*$/.test(value)) setRequestQuantity(value)
                  }}
                />
              </label>
              <button className="btn-secondary w-full" type="button" onClick={addRequestItem}>
                <Plus size={20} /> Agregar a la lista
              </button>
              {requestItems.length > 0 ? (
                <div className="space-y-2 rounded-lg bg-slate-50 p-2">
                  {requestItems.map((item) => (
                    <div key={item.lot_id} className="flex items-center justify-between gap-2 rounded-lg bg-white p-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-start gap-2">
                          <p className="min-w-0 flex-1 text-sm font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(item.product)}</p>
                          <span className="rounded-lg bg-campo-50 px-2 py-1 text-sm font-black text-campo-800">{formatNumber(item.quantity)} env.</span>
                        </div>
                        <p className="text-xs font-semibold text-slate-500">
                          {displayLotCode(item.lot_code)} - Presentacion: {packageLabel(item) || 'Sin dato'}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-lg bg-amber-50 px-2 py-1 text-sm font-black text-amber-800">
                            {formatNumber(Number(item.quantity || 0) * Number(item.package_size || 0))} {item.package_unit || ''}
                          </span>
                        </div>
                      </div>
                      <button className="btn-secondary !min-h-9 !px-2 !py-1" type="button" onClick={() => removeRequestItem(item.lot_id)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                  <button className="btn-secondary w-full !min-h-10 !py-2" type="button" onClick={clearRequestCart}>
                    Vaciar carrito
                  </button>
                </div>
              ) : null}
              <label>
                <span className="label">Observacion</span>
                <textarea className="input mt-1" rows="3" value={requestNotes} onChange={(event) => setRequestNotes(event.target.value)} />
              </label>
              {requestMessage ? (
                <div className="rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">{requestMessage}</div>
              ) : null}
              <button className="btn-primary w-full" type="submit">
                <Truck size={20} /> Enviar solicitud
              </button>
            </form>
          </section>

          <section className="panel">
            <div className="mb-3 flex items-center gap-2">
              <Mail size={20} className="text-campo-700" />
              <h3 className="font-bold text-slate-950">Contacto rapido</h3>
            </div>
            <p className="text-sm font-semibold text-slate-600">Para consultas o coordinacion, escribe a Todo Agricola.</p>
            <a className="btn-secondary mt-3 w-full" href="mailto:hgarayd@outlook.com?subject=Consulta%20de%20inventario%20Todo%20Agricola">
              <Mail size={20} /> Solicitar informacion
            </a>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white/80 p-3 text-xs font-semibold text-slate-500">
            La informacion del portal es referencial y queda sujeta a validacion operativa de Todo Agricola. Las solicitudes de despacho requieren aprobacion antes de ejecutarse.
          </section>
        </aside>
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-3">
        <Panel title="Comprobantes de despacho" icon={FileText}>
          {dispatchReceipts.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-600">Sin despachos registrados.</p>
          ) : (
            dispatchReceipts.slice(0, 6).map((movement) => (
              <button key={movement.id} className="block w-full rounded-lg bg-slate-50 p-3 text-left transition hover:bg-slate-100" type="button" onClick={() => printMovementReceipt(movement)}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(movement.lots?.product)}</p>
                  <span className="rounded-lg bg-campo-50 px-2 py-1 text-sm font-black text-campo-800">{formatNumber(movement.quantity)} env.</span>
                </div>
                <p className="text-sm font-semibold text-slate-500">{displayLotCode(movement.lots?.lot_code)}</p>
                <p className="mt-1 text-xs font-bold text-campo-700">{formatDate(movement.created_at)} - Ver comprobante</p>
              </button>
            ))
          )}
        </Panel>

        <Panel title="Historial simple" icon={History}>
          {history.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-600">Sin movimientos visibles.</p>
          ) : (
            history.map((movement) => (
              <div key={movement.id} className="rounded-lg bg-slate-50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(movement.lots?.product)}</p>
                  <p className="rounded-lg bg-campo-50 px-2 py-1 text-sm font-black text-campo-800">{formatNumber(movement.quantity)} env.</p>
                </div>
                <p className="text-sm font-semibold text-slate-500">{movementLabel(movement.type)} - {displayLotCode(movement.lots?.lot_code)}</p>
                <p className="mt-1 text-xs font-semibold text-slate-400">{formatDate(movement.created_at)}</p>
              </div>
            ))
          )}
        </Panel>

        <Panel title="Solicitudes" icon={Truck}>
          {requests.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-600">Todavia no hay solicitudes.</p>
          ) : (
            requests.slice(0, 8).map((request) => (
              <div key={request.id} className="rounded-lg bg-slate-50 p-3">
                <div className="flex justify-between gap-3">
                <p className="font-bold text-slate-950">{cleanProductName(request.product || request.lots?.product)}</p>
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${request.status === 'aprobado' ? 'bg-campo-50 text-campo-700' : request.status === 'rechazado' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>
                    {request.status}
                  </span>
                </div>
                <p className="text-sm font-semibold text-slate-500">
                  {Array.isArray(request.items) && request.items.length > 1
                    ? `${request.items.length} productos - ${formatNumber(request.quantity)} env.`
                    : `${displayLotCode(request.lots?.lot_code)} - ${formatNumber(request.quantity)} env.`}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-400">{formatDate(request.created_at)}</p>
                {request.admin_notes ? <p className="mt-2 text-xs font-semibold text-slate-600">{request.admin_notes}</p> : null}
              </div>
            ))
          )}
        </Panel>
      </section>
    </div>
  )
}

function Metric({ icon: Icon, label, value, accent = 'text-campo-700' }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white/80 px-2 py-2 shadow-soft sm:px-3">
      <div className="flex items-center gap-1.5">
        <Icon className={`${accent} shrink-0`} size={15} />
        <p className="min-w-0 text-[10px] font-bold leading-tight text-slate-500 [overflow-wrap:anywhere] sm:text-xs">{label}</p>
      </div>
      <p className="mt-1 text-base font-black leading-tight text-slate-950 tabular-nums sm:text-lg">{value}</p>
    </div>
  )
}

function Panel({ title, icon: Icon, children }) {
  return (
    <section className="panel">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={20} className="text-campo-700" />
        <h3 className="font-bold text-slate-950">{title}</h3>
      </div>
      <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">{children}</div>
    </section>
  )
}
