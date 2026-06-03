import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, CalendarClock, ChevronDown, Download, FileText, History, Mail, PackageCheck, Plus, Printer, Search, Send, Truck, X } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import ListProductCard from '../components/ListProductCard'
import { useAuth } from '../hooks/useAuth.jsx'
import { cleanProductName, displayLotCode, packageLabel } from '../lib/display'
import { normalizeDispatchRequests } from '../lib/dispatchRequests'
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

function lotEquivalent(lot) {
  const packageSize = Number(lot?.package_size || 0)
  if (packageSize <= 0 || !lot?.package_unit) return null
  return {
    quantity: Number(lot.current_quantity || 0) * packageSize,
    unit: lot.package_unit,
  }
}

function equivalentTotalsLabel(equivalents = {}) {
  const totals = Object.entries(equivalents)
    .filter(([, quantity]) => Number(quantity || 0) > 0)
    .sort(([a], [b]) => a.localeCompare(b, 'es'))

  if (totals.length === 0) return 'Equivalente sin dato'
  return totals.map(([unit, quantity]) => `${formatNumber(quantity)} ${unit}`).join(' / ')
}

function normalizeClientName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

async function findClientIdByName(clientName) {
  const normalizedName = normalizeClientName(clientName)
  if (!normalizedName || normalizedName === 'CLIENTE') return null

  const { data: exactMatches } = await supabase
    .from('clients')
    .select('id, name')
    .not('solucion_codigo', 'is', null)
    .ilike('name', clientName)
    .limit(2)

  if ((exactMatches || []).length === 1) return exactMatches[0].id

  const { data: clients } = await supabase
    .from('clients')
    .select('id, name')
    .not('solucion_codigo', 'is', null)
    .limit(10000)

  const matches = (clients || []).filter((client) => normalizeClientName(client.name) === normalizedName)
  return matches.length === 1 ? matches[0].id : null
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

export default function ClientPortal({ view = 'inventory' }) {
  const { user, profile } = useAuth()
  const initialDraft = useMemo(readRequestDraft, [])
  const [lots, setLots] = useState([])
  const [movements, setMovements] = useState([])
  const [requests, setRequests] = useState([])
  const [search, setSearch] = useState('')
  const [requestLotId, setRequestLotId] = useState(initialDraft.lotId)
  const [requestQuantity, setRequestQuantity] = useState(initialDraft.quantity)
  const [requestNotes, setRequestNotes] = useState(initialDraft.notes)
  const [requestItems, setRequestItems] = useState(initialDraft.items)
  const [editingRequestLotId, setEditingRequestLotId] = useState('')
  const [requestMessage, setRequestMessage] = useState('')
  const [expandedInventoryProduct, setExpandedInventoryProduct] = useState('')
  const [showAllInventoryProducts, setShowAllInventoryProducts] = useState(false)
  const [selectedMovement, setSelectedMovement] = useState(null)

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
      .eq('inventory_source', 'solucion')
      .eq('status', 'activo')
      .gt('current_quantity', 0)
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
      .select('id, client_id, lot_id, product, quantity, items, notes, status, admin_notes, created_at, reviewed_at, clients(name), lots(id, lot_code, product, current_quantity, package_size, package_unit, location, expiry_date, status)')
      .order('created_at', { ascending: false })

    setRequests(await normalizeDispatchRequests(requestData || [], lotsData || []))
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
  const retainedLots = lots.filter((lot) => ['retenido', 'cerrado'].includes(lot.status) || lotStatus(lot).label === 'Vencido')
  const activeRequests = requests.filter((request) => !['despachado', 'rechazado'].includes(request.status))
  const productCount = new Set(lots.map((lot) => lot.product).filter(Boolean)).size
  const clientName = lots[0]?.clients?.name || profile?.full_name || 'Cliente'
  const selectedRequestLot = lots.find((lot) => lot.id === requestLotId)
  const requestsView = view === 'requests'
  const movementsView = view === 'movements'
  const inventoryView = !requestsView && !movementsView
  const inventoryProducts = useMemo(() => {
    const groups = filteredLots.reduce((acc, lot) => {
      const product = cleanProductName(lot.product)
      if (!acc[product]) {
        acc[product] = {
          product,
          quantity: 0,
          equivalents: {},
          lots: [],
          expiring: 0,
          retained: 0,
        }
      }

      acc[product].quantity += Number(lot.current_quantity || 0)
      acc[product].lots.push(lot)

      const equivalent = lotEquivalent(lot)
      if (equivalent) {
        acc[product].equivalents[equivalent.unit] = Number(acc[product].equivalents[equivalent.unit] || 0) + equivalent.quantity
      }

      const status = lotStatus(lot).label
      if (status === 'Por vencer' || status === 'Vencido') acc[product].expiring += 1
      if (status === 'Retenido') acc[product].retained += 1

      return acc
    }, {})

    return Object.values(groups)
      .map((group) => ({
        ...group,
        lots: group.lots.sort((a, b) => {
          const expiryOrder = (a.expiry_date || '9999-12-31').localeCompare(b.expiry_date || '9999-12-31')
          if (expiryOrder !== 0) return expiryOrder
          return displayLotCode(a.lot_code).localeCompare(displayLotCode(b.lot_code), 'es', { numeric: true })
        }),
      }))
      .sort((a, b) => a.product.localeCompare(b.product, 'es', { numeric: true }))
  }, [filteredLots])
  const visibleInventoryProducts = showAllInventoryProducts || search.trim()
    ? inventoryProducts
    : inventoryProducts.slice(0, 8)

  function addRequestItem() {
    setRequestMessage('')

    const selectedLot = selectedRequestLot
    const quantity = Number(requestQuantity || 0)

    if (!selectedLot) {
      setRequestMessage('Selecciona un lote.')
      return
    }
    if (quantity <= 0) {
      setRequestMessage('Escribe una cantidad mayor a cero.')
      return
    }
    if (quantity > Number(selectedLot.current_quantity || 0)) {
      setRequestMessage('La cantidad solicitada supera los envases disponibles en ese lote.')
      return
    }
    if (lotStatus(selectedLot).label !== 'Disponible' && lotStatus(selectedLot).label !== 'Por vencer') {
      setRequestMessage('Este lote no esta disponible para solicitar despacho.')
      return
    }

    setRequestItems((current) => {
      const existing = current.find((item) => item.lot_id === selectedLot.id)
      if (existing) {
        const nextQuantity = editingRequestLotId === selectedLot.id ? quantity : Number(existing.quantity || 0) + quantity
        if (nextQuantity > Number(selectedLot.current_quantity || 0)) {
          setRequestMessage('Ese lote no tiene suficientes envases disponibles para sumar esa cantidad.')
          return current
        }
        return current.map((item) =>
          item.lot_id === selectedLot.id
            ? {
                ...item,
                client_id: selectedLot.client_id,
                client_name: selectedLot.clients?.name || clientName,
                quantity: nextQuantity,
                available: selectedLot.current_quantity,
              }
            : item,
        )
      }
      return [
        ...current,
        {
          lot_id: selectedLot.id,
          client_id: selectedLot.client_id,
          client_name: selectedLot.clients?.name || clientName,
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
    setEditingRequestLotId('')
  }

  function removeRequestItem(lotId) {
    setRequestItems((current) => current.filter((item) => item.lot_id !== lotId))
    if (editingRequestLotId === lotId) {
      setEditingRequestLotId('')
      setRequestLotId('')
      setRequestQuantity('')
    }
  }

  function editRequestItem(item) {
    setEditingRequestLotId(item.lot_id)
    setRequestLotId(item.lot_id)
    setRequestQuantity(String(item.quantity || ''))
    setRequestMessage('Editando producto de la solicitud.')
  }

  function clearRequestCart() {
    setRequestLotId('')
    setRequestQuantity('')
    setRequestItems([])
    setRequestNotes('')
    setEditingRequestLotId('')
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

    const normalizedRequest = await normalizeDispatchRequests({
      items: requestItems,
      client_id: profile?.client_id || null,
      client_name: clientName,
      clients: { name: clientName },
    }, lots)
    const freshItems = normalizedRequest?.items || []
    const firstItem = freshItems[0]
    const firstLot = lots.find((lot) => lot.id === firstItem?.lot_id)
    const overStockItem = freshItems.find((item) => Number(item.quantity || 0) > Number(item.current_quantity ?? item.available ?? 0))
    const requestClientIds = Array.from(new Set(freshItems.map((item) => item.client_id).filter(Boolean)))
    const requestClientId = profile?.client_id || (requestClientIds.length === 1 ? requestClientIds[0] : firstLot?.client_id) || await findClientIdByName(clientName)
    const totalQuantity = freshItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)

    if (!firstItem || !requestClientId) {
      setRequestMessage('No se pudo validar el cliente de la solicitud. Recarga la pagina e intenta de nuevo.')
      return
    }
    if (requestClientIds.length > 1) {
      setRequestMessage('La solicitud debe tener productos de un solo cliente.')
      return
    }
    if (overStockItem) {
      setRequestMessage(`${cleanProductName(overStockItem.product)} solo tiene ${formatNumber(overStockItem.current_quantity ?? overStockItem.available ?? 0)} envases disponibles.`)
      return
    }

    const { error } = await supabase.from('client_dispatch_requests').insert({
      client_id: requestClientId,
      lot_id: firstItem.lot_id,
      product: freshItems.length === 1 ? firstItem.product : `Lista de despacho (${freshItems.length} productos)`,
      quantity: totalQuantity,
      items: freshItems.map((item) => ({
        ...item,
        client_id: item.client_id || requestClientId,
        client_name: item.client_name || clientName,
      })),
      notes: requestNotes.trim() || null,
      status: 'aprobado',
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
    setEditingRequestLotId('')
    clearRequestDraft()
    setRequestMessage('Solicitud enviada a almacen.')
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
    const receiptType = movement.type === 'salida' ? 'despacho' : movementLabel(movement.type).toLowerCase()
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
          <p>Comprobante de ${escapeHtml(receiptType)} para ${escapeHtml(clientName)}</p>
          <div class="box grid">
            <div><strong>Fecha</strong>${escapeHtml(formatDate(movement.created_at))}</div>
            <div><strong>Movimiento</strong>${escapeHtml(movementLabel(movement.type))}</div>
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
        title={requestsView ? 'Solicitudes de despacho' : movementsView ? 'Movimientos' : clientName}
        subtitle={requestsView ? 'Arma listas para almacen y revisa tus solicitudes enviadas' : movementsView ? 'Historial visible de tus productos en almacen' : 'Inventario disponible en almacen'}
        action={inventoryView ? (
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <button className="btn-secondary !min-h-11 !px-3" type="button" onClick={exportInventoryExcel}>
              <Download size={20} /> Excel
            </button>
            <button className="btn-secondary !min-h-11 !px-3" type="button" onClick={printInventoryPdf}>
              <FileText size={20} /> PDF
            </button>
          </div>
        ) : null}
      />

      {inventoryView ? (
      <section className="grid grid-cols-3 gap-1.5 sm:gap-2">
        <Metric icon={Boxes} label="Envases disponibles" value={formatNumber(totalStock)} />
        <Metric icon={PackageCheck} label="Productos" value={productCount} />
        <Metric icon={CalendarClock} label="Por vencer" value={expiring.length} accent="text-maiz" />
      </section>
      ) : null}

      {inventoryView ? (
      <section className="panel mt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-campo-700">Estado de cuenta</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">{clientName}</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              Resumen ejecutivo del inventario disponible y movimientos visibles.
            </p>
          </div>
          <div className="rounded-lg bg-campo-50 px-3 py-2 text-right text-campo-800">
            <p className="text-xs font-black uppercase">Inventario actual</p>
            <p className="text-2xl font-black">{formatNumber(totalStock)} env.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <StatementItem label="Lotes visibles" value={lots.length} />
          <StatementItem label="Solicitudes activas" value={activeRequests.length} />
          <StatementItem label="Por vencer" value={expiring.length} tone="amber" />
          <StatementItem label="Observados" value={retainedLots.length} tone={retainedLots.length ? 'red' : 'campo'} />
        </div>
        <div className="mt-4 grid gap-2 lg:grid-cols-2">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-black uppercase text-slate-400">Ultimos movimientos</p>
            <div className="mt-2 space-y-1.5">
              {movements.slice(0, 3).length === 0 ? (
                <p className="text-sm font-bold text-slate-500">Sin movimientos visibles.</p>
              ) : movements.slice(0, 3).map((movement) => (
                <p key={movement.id} className="text-sm font-bold text-slate-700 [overflow-wrap:anywhere]">
                  {movementLabel(movement.type)} - {cleanProductName(movement.lots?.product)} - {formatNumber(movement.quantity)} env.
                </p>
              ))}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-black uppercase text-slate-400">Solicitudes</p>
            <div className="mt-2 space-y-1.5">
              {activeRequests.slice(0, 3).length === 0 ? (
                <p className="text-sm font-bold text-slate-500">Sin solicitudes activas.</p>
              ) : activeRequests.slice(0, 3).map((request) => (
                <p key={request.id} className="text-sm font-bold text-slate-700 [overflow-wrap:anywhere]">
                  {clientRequestStatusLabel(request.status)} - {Array.isArray(request.items) ? `${request.items.length} productos` : cleanProductName(request.product)}
                </p>
              ))}
            </div>
          </div>
        </div>
      </section>
      ) : null}

      {inventoryView ? (
      <section className="my-4 flex items-center rounded-lg border border-slate-200 bg-white px-3">
        <Search size={20} className="text-slate-400" />
        <input
          className="min-h-12 flex-1 bg-transparent px-2 outline-none"
          placeholder="Buscar producto, lote, estado o ubicacion..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </section>
      ) : null}

      {inventoryView || requestsView ? (
      <section className={`grid gap-4 ${requestsView ? '' : 'lg:grid-cols-[1.3fr_.7fr]'}`}>
        {inventoryView ? (
        <div className="panel">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-black text-slate-950">Productos almacenados</h2>
              <p className="text-sm font-semibold text-slate-500">Resumen ordenado por producto. Abre uno para revisar sus lotes.</p>
            </div>
            <span className="rounded-lg bg-slate-50 px-2 py-1 text-xs font-black text-slate-500">
              {inventoryProducts.length} producto{inventoryProducts.length === 1 ? '' : 's'}
            </span>
          </div>
          {filteredLots.length === 0 ? (
            <EmptyState title="Sin lotes visibles" text="Este usuario cliente todavia no esta vinculado al cliente correcto del inventario actual." />
          ) : (
            <div className={`${showAllInventoryProducts && !search.trim() ? 'clean-scroll max-h-[62vh] overflow-y-auto overscroll-contain rounded-lg border border-slate-100 bg-white/70 p-1 pr-2' : 'space-y-2'}`}>
              {visibleInventoryProducts.map((group) => {
                const isExpanded = expandedInventoryProduct === group.product
                return (
                  <article key={group.product} className={`${showAllInventoryProducts && !search.trim() ? 'mb-2 last:mb-0' : ''} overflow-hidden rounded-lg border border-slate-100 bg-slate-50/90`}>
                    <button
                      className="flex w-full flex-col gap-3 p-3 text-left transition hover:bg-campo-50/70 sm:flex-row sm:items-center sm:justify-between"
                      type="button"
                      onClick={() => setExpandedInventoryProduct(isExpanded ? '' : group.product)}
                    >
                      <div className="min-w-0">
                        <p className="font-black text-slate-950 [overflow-wrap:anywhere]">{group.product}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5 text-xs font-bold text-slate-500">
                          <span>{group.lots.length} lote{group.lots.length === 1 ? '' : 's'}</span>
                          {group.expiring ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">{group.expiring} por vencer</span> : null}
                          {group.retained ? <span className="rounded-full bg-orange-50 px-2 py-0.5 text-orange-700">{group.retained} retenido{group.retained === 1 ? '' : 's'}</span> : null}
                        </div>
                      </div>
                      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
                        <div className="rounded-lg bg-white px-3 py-2 text-right shadow-sm">
                          <p className="text-lg font-black leading-none text-campo-800">{formatNumber(group.quantity)} env.</p>
                          <p className="mt-1 text-xs font-bold text-slate-500">{equivalentTotalsLabel(group.equivalents)}</p>
                        </div>
                        <ChevronDown className={`shrink-0 text-slate-400 transition ${isExpanded ? 'rotate-180' : ''}`} size={20} />
                      </div>
                    </button>

                    {isExpanded ? (
                      <div className="grid gap-2 border-t border-slate-100 bg-white p-2">
                        {group.lots.map((lot) => {
                          const status = lotStatus(lot)
                          const equivalent = lotEquivalent(lot)
                          return (
                            <Link key={lot.id} className="rounded-lg border border-slate-100 p-3 transition hover:border-campo-100 hover:bg-campo-50/60" to={`/lotes/${lot.id}`}>
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-black text-slate-900">{displayLotCode(lot.lot_code)}</p>
                                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${status.className}`}>{status.label}</span>
                                  </div>
                                  <p className="text-sm font-semibold text-slate-500">{lot.location || '-'} - Vence: {lot.expiry_date ? formatDate(lot.expiry_date) : 'Sin dato'}</p>
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs font-black">
                                  <span className="rounded-lg bg-campo-50 px-2 py-1 text-campo-800">{formatNumber(lot.current_quantity)} env.</span>
                                  <span className="rounded-lg bg-slate-50 px-2 py-1 text-slate-600">
                                    {equivalent ? `${formatNumber(equivalent.quantity)} ${equivalent.unit}` : 'Equivalente sin dato'}
                                  </span>
                                </div>
                              </div>
                            </Link>
                          )
                        })}
                      </div>
                    ) : null}
                  </article>
                )
              })}
              {!search.trim() && inventoryProducts.length > 8 ? (
                <button className="btn-secondary w-full !min-h-11" type="button" onClick={() => setShowAllInventoryProducts((value) => !value)}>
                  {showAllInventoryProducts ? 'Ver menos productos' : `Ver todos los productos (${inventoryProducts.length})`}
                </button>
              ) : null}
            </div>
          )}
        </div>
        ) : null}

        <aside className="space-y-4">
          {requestsView ? (
          <section className="panel">
            <div className="mb-3 flex items-start gap-2">
              <Send size={20} className="mt-0.5 text-campo-700" />
              <div>
                <h3 className="font-bold text-slate-950">Solicitar despacho</h3>
                <p className="text-xs font-semibold text-slate-500">Arma una lista por producto. Al enviarla, almacen la recibe directamente.</p>
              </div>
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
              {selectedRequestLot ? (
                <div className="rounded-lg border border-campo-100 bg-campo-50/80 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(selectedRequestLot.product)}</p>
                      <p className="text-xs font-bold text-slate-600">
                        Presentacion: {packageLabel(selectedRequestLot) || 'Sin dato'} - Lote {displayLotCode(selectedRequestLot.lot_code)}
                      </p>
                    </div>
                    <span className="rounded-lg bg-white px-2 py-1 text-sm font-black text-campo-800">
                      {formatNumber(selectedRequestLot.current_quantity)} env. disponibles
                    </span>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-slate-500">
                    {selectedRequestLot.location || '-'} - {lotStatus(selectedRequestLot).label}
                  </p>
                </div>
              ) : null}
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
                <Plus size={20} /> {editingRequestLotId ? 'Guardar cambio en lista' : 'Agregar a la lista'}
              </button>
              {requestItems.length > 0 ? (
                <div className="space-y-2 rounded-lg bg-slate-50 p-2">
                  <div className="rounded-lg bg-white p-3">
                    <p className="text-xs font-bold uppercase text-campo-700">Lista de despacho</p>
                    <p className="text-sm font-semibold text-slate-600">
                      {requestItems.length} producto{requestItems.length === 1 ? '' : 's'} agregado{requestItems.length === 1 ? '' : 's'}. Revisa cada cantidad antes de enviar.
                    </p>
                  </div>
                  {requestItems.map((item) => (
                    <ListProductCard
                      key={item.lot_id}
                      title={cleanProductName(item.product)}
                      envases={item.quantity}
                      equivalent={Number(item.package_size) > 0 ? Number(item.quantity || 0) * Number(item.package_size || 0) : null}
                      equivalentUnit={item.package_unit}
                      presentation={packageLabel(item) || 'Sin dato'}
                      secondary={`${displayLotCode(item.lot_code)} - ${item.location || '-'}`}
                      detailTitle="Producto solicitado"
                      detailRows={[
                        { label: 'Envases solicitados', value: `${formatNumber(item.quantity)} env.` },
                        { label: 'Equivalente', value: Number(item.package_size) > 0 ? `${formatNumber(Number(item.quantity || 0) * Number(item.package_size || 0))} ${item.package_unit || ''}` : 'Sin dato' },
                        { label: 'Presentacion', value: packageLabel(item) || 'Sin dato' },
                        { label: 'Lote', value: displayLotCode(item.lot_code) },
                        { label: 'Ubicacion', value: item.location || '-' },
                        { label: 'Disponible', value: `${formatNumber(item.available)} env.` },
                      ]}
                      onEdit={() => editRequestItem(item)}
                      onRemove={() => removeRequestItem(item.lot_id)}
                    />
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
          ) : null}

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
            La informacion del portal es referencial y queda sujeta a validacion operativa de Todo Agricola. La solicitud pasa directo a almacen para preparar el despacho.
          </section>
        </aside>
      </section>
      ) : null}

      {movementsView ? (
      <section className="mt-5 grid gap-4">
        <Panel title="Historial de movimientos" icon={History} scroll={false}>
          {movements.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-600">Sin movimientos visibles.</p>
          ) : (
            movements.map((movement) => (
              <MovementHistoryCard key={movement.id} movement={movement} onOpen={setSelectedMovement} onPrint={printMovementReceipt} />
            ))
          )}
        </Panel>
      </section>
      ) : null}

      {requestsView ? (
      <section className="mt-5 grid gap-4">
        <Panel title="Solicitudes" icon={Truck}>
          {requests.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-600">Todavia no hay solicitudes.</p>
          ) : (
            requests.slice(0, 8).map((request) => (
              <div key={request.id} className="rounded-lg bg-slate-50 p-3">
                <div className="flex justify-between gap-3">
                <p className="font-bold text-slate-950">{cleanProductName(request.product || request.lots?.product)}</p>
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${request.status === 'aprobado' ? 'bg-campo-50 text-campo-700' : request.status === 'rechazado' ? 'bg-red-50 text-red-700' : request.status === 'despachado' ? 'bg-slate-100 text-slate-700' : 'bg-amber-50 text-amber-800'}`}>
                    {clientRequestStatusLabel(request.status)}
                  </span>
                </div>
                <p className="text-sm font-semibold text-slate-500">
                  {Array.isArray(request.items) && request.items.length > 1
                    ? `${request.items.length} productos en la solicitud`
                    : `${displayLotCode(request.lots?.lot_code)} - ${formatNumber(request.quantity)} env.`}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-400">{formatDate(request.created_at)}</p>
                {request.admin_notes ? <p className="mt-2 text-xs font-semibold text-slate-600">{request.admin_notes}</p> : null}
              </div>
            ))
          )}
        </Panel>
      </section>
      ) : null}

      {selectedMovement ? (
        <MovementDetail
          movement={selectedMovement}
          onClose={() => setSelectedMovement(null)}
          onPrint={() => printMovementReceipt(selectedMovement)}
        />
      ) : null}
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

function StatementItem({ label, value, tone = 'campo' }) {
  const toneClass = {
    campo: 'bg-campo-50 text-campo-800',
    amber: 'bg-amber-50 text-amber-800',
    red: 'bg-red-50 text-red-700',
  }[tone]

  return (
    <div className={`rounded-lg px-3 py-2 ${toneClass}`}>
      <p className="text-xs font-black uppercase opacity-70">{label}</p>
      <p className="mt-1 text-xl font-black">{formatNumber(value)}</p>
    </div>
  )
}

function Panel({ title, icon: Icon, children, scroll = true }) {
  return (
    <section className="panel">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={20} className="text-campo-700" />
        <h3 className="font-bold text-slate-950">{title}</h3>
      </div>
      <div className={`${scroll ? 'max-h-[360px] overflow-y-auto pr-1' : ''} space-y-2`}>{children}</div>
    </section>
  )
}

function MovementHistoryCard({ movement, onOpen, onPrint }) {
  const lot = movement.lots || {}
  const equivalent = Number(movement.quantity || 0) * Number(lot.package_size || 0)

  return (
    <article
      className="grid cursor-pointer gap-2 rounded-lg bg-slate-50 p-3 transition hover:bg-campo-50/70 sm:grid-cols-[1fr_auto]"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(movement)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(movement)
        }
      }}
      title="Ver movimiento"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-start gap-2">
          <p className="min-w-0 flex-1 font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(lot.product)}</p>
          <span className="rounded-lg bg-campo-50 px-2 py-1 text-sm font-black text-campo-800">{formatNumber(movement.quantity)} env.</span>
        </div>
        <p className="text-sm font-semibold text-slate-500">{movementLabel(movement.type)} - {displayLotCode(lot.lot_code)}</p>
        <p className="text-xs font-semibold text-slate-400">
          {formatDate(movement.created_at)}
          {Number(lot.package_size) > 0 ? ` - ${formatNumber(equivalent)} ${lot.package_unit || ''}` : ''}
        </p>
      </div>
      <button
        className="btn-secondary !min-h-10 !px-3 self-start"
        type="button"
        title="Imprimir comprobante"
        onClick={(event) => {
          event.stopPropagation()
          onPrint(movement)
        }}
      >
        <Printer size={17} />
      </button>
    </article>
  )
}

function MovementDetail({ movement, onClose, onPrint }) {
  const lot = movement.lots || {}
  const equivalent = Number(movement.quantity || 0) * Number(lot.package_size || 0)

  return (
    <div data-modal-backdrop="true" className="fixed inset-0 z-50 flex items-end overflow-y-auto bg-slate-950/45 p-4 sm:items-center sm:justify-center" onClick={onClose}>
      <section className="max-h-[92dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-xl bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase text-campo-700">Movimiento en almacen</p>
            <h3 className="mt-1 text-lg font-black leading-snug text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(lot.product)}</h3>
          </div>
          <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={onClose} title="Cerrar">
            <X size={18} />
          </button>
        </div>
        <dl className="mt-4 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-700">
          <DetailRow label="Movimiento" value={movementLabel(movement.type)} />
          <DetailRow label="Fecha" value={formatDate(movement.created_at)} />
          <DetailRow label="Lote" value={displayLotCode(lot.lot_code)} />
          <DetailRow label="Envases" value={`${formatNumber(movement.quantity)} env.`} />
          <DetailRow label="Equivalente" value={Number(lot.package_size) > 0 ? `${formatNumber(equivalent)} ${lot.package_unit || ''}` : 'Sin dato'} />
          <DetailRow label="Ubicacion" value={lot.location || '-'} />
        </dl>
        <button className="btn-primary mt-3 w-full" type="button" onClick={onPrint}>
          <Printer size={18} /> Imprimir comprobante
        </button>
      </section>
    </div>
  )
}

function DetailRow({ label, value }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,13rem)] items-start gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right text-slate-950 [overflow-wrap:anywhere]">{value || '-'}</dd>
    </div>
  )
}

function clientRequestStatusLabel(status) {
  if (status === 'aprobado') return 'En almacen'
  if (status === 'despachado') return 'Despachado'
  if (status === 'rechazado') return 'No atendido'
  return 'Recibido'
}
