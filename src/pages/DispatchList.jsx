import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle2, LogOut, Plus, ScanLine, Trash2 } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import ListProductCard from '../components/ListProductCard'
import { useAuth } from '../hooks/useAuth.jsx'
import { cleanProductName, displayLotCode, packageLabel } from '../lib/display'
import { normalizeDispatchRequests } from '../lib/dispatchRequests'
import { formatDate, formatNumber } from '../lib/format'
import { supabase } from '../lib/supabase'
import { vibrateError, vibrateSuccess, vibrateWarning } from '../lib/haptics'
import ConfirmChecks, { allConfirmChecksDone, emptyConfirmChecks } from '../components/ConfirmChecks'
import { clearDraft, readDraft, writeDraft } from '../lib/drafts'

const DISPATCH_DRAFT_KEY = 'todo-agricola-dispatch-list-draft'

function emptyDraft() {
  return { items: [], receiverName: '', receiverDocument: '', vehiclePlate: '', dispatchNotes: '' }
}

function expiryDays(expiryDate) {
  if (!expiryDate) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((new Date(`${expiryDate}T00:00:00`) - today) / 86400000)
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function isMissingDispatchOperationRpc(error) {
  return String(error?.message || '').includes('create_dispatch_operation')
}

function normalizeClientName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toUpperCase()
}

function normalizeLotCode(value) {
  return normalizeText(displayLotCode(value))
}

function normalizeUnit(value) {
  const unit = normalizeText(value)
  if (['L', 'LT', 'LTS', 'LITRO', 'LITROS'].includes(unit)) return 'LT'
  if (['K', 'KG', 'KGS', 'KILO', 'KILOS'].includes(unit)) return 'KG'
  if (['G', 'GR', 'GRS', 'GRAMO', 'GRAMOS'].includes(unit)) return 'GR'
  if (['ML', 'MLS', 'MILILITRO', 'MILILITROS'].includes(unit)) return 'ML'
  return unit
}

function isSameProductName(a, b) {
  const left = normalizeText(cleanProductName(a))
  const right = normalizeText(cleanProductName(b))
  if (!left || !right) return false
  return left === right || left.includes(right) || right.includes(left)
}

function sameNumber(a, b) {
  if (a === null || a === undefined || a === '' || b === null || b === undefined || b === '') return false
  return Number(a) === Number(b)
}

function isSameClient(lot, request) {
  if (!request?.client_id) return true
  if (lot.client_id === request.client_id) return true
  return normalizeClientName(lot.clients?.name) === normalizeClientName(request.clients?.name)
}

function isSameApprovedLot(lot, approvedItem) {
  if (!lot || !approvedItem) return false
  if (approvedItem.lot_id && approvedItem.lot_id === lot.id) return true

  const scannedLotCode = normalizeLotCode(lot.lot_code)
  const requestedLotCode = normalizeLotCode(approvedItem.lot_code)
  if (scannedLotCode && requestedLotCode && (scannedLotCode.includes(requestedLotCode) || requestedLotCode.includes(scannedLotCode))) return true

  const sameProduct = isSameProductName(lot.product, approvedItem.product)
  const sameUnit = !approvedItem.package_unit || normalizeUnit(lot.package_unit) === normalizeUnit(approvedItem.package_unit)
  const samePresentation =
    !approvedItem.package_size ||
    sameNumber(lot.package_size, approvedItem.package_size)

  return sameProduct && sameUnit && samePresentation
}

function deriveDispatchClientId(approvedRequest, items) {
  if (approvedRequest?.client_id) return approvedRequest.client_id

  const clientIds = Array.from(
    new Set(
      items
        .map((item) => item?.lot?.client_id)
        .filter(Boolean),
    ),
  )

  if (clientIds.length === 1) return clientIds[0]
  return null
}

export default function DispatchList() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const lotId = new URLSearchParams(location.search).get('lot')
  const requestId = new URLSearchParams(location.search).get('request')
  const startNew = new URLSearchParams(location.search).get('nuevo') === '1'
  const draftKey = requestId ? `${DISPATCH_DRAFT_KEY}:${requestId}` : `${DISPATCH_DRAFT_KEY}:manual`
  const initialDraft = startNew ? emptyDraft() : readDraft(draftKey, emptyDraft())
  const [items, setItems] = useState(initialDraft.items)
  const [receiverName, setReceiverName] = useState(initialDraft.receiverName)
  const [receiverDocument, setReceiverDocument] = useState(initialDraft.receiverDocument)
  const [vehiclePlate, setVehiclePlate] = useState(initialDraft.vehiclePlate)
  const [dispatchNotes, setDispatchNotes] = useState(initialDraft.dispatchNotes)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [approvedRequest, setApprovedRequest] = useState(null)
  const [approvedRequestLoaded, setApprovedRequestLoaded] = useState(false)
  const [focusedLotId, setFocusedLotId] = useState('')
  const [confirmChecks, setConfirmChecks] = useState(emptyConfirmChecks())
  const [guidePreview, setGuidePreview] = useState('TAB---')

  const isApprovedDispatch = Boolean(requestId)

  useEffect(() => {
    loadGuidePreview()
  }, [])

  async function loadGuidePreview() {
    const { data } = await supabase.rpc('preview_next_warehouse_guide')
    if (data) setGuidePreview(data)
  }

  useEffect(() => {
    if (startNew) {
      clearDraft(draftKey)
      setItems([])
      navigate('/operacion/despacho-lista', { replace: true })
      return
    }

    const draft = readDraft(draftKey, emptyDraft())
    setItems(draft.items)
    setReceiverName(draft.receiverName)
    setReceiverDocument(draft.receiverDocument)
    setVehiclePlate(draft.vehiclePlate)
    setDispatchNotes(draft.dispatchNotes)
    setReceipt(null)
    setConfirming(false)
    setError('')
    setStatus('')
  }, [draftKey, startNew, navigate])

  useEffect(() => {
    async function loadApprovedRequest() {
      if (!requestId) {
        setApprovedRequest(null)
        setApprovedRequestLoaded(true)
        return
      }

      setApprovedRequestLoaded(false)
      const { data } = await supabase
        .from('client_dispatch_requests')
        .select('*, clients(name), lots(id, lot_code, client_id, product, current_quantity, package_size, package_unit, location, expiry_date, status)')
        .eq('id', requestId)
        .single()

      setApprovedRequest(data ? await normalizeDispatchRequests(data) : null)
      setApprovedRequestLoaded(true)
    }

    loadApprovedRequest()
  }, [requestId])

  useEffect(() => {
    writeDraft(draftKey, { items, receiverName, receiverDocument, vehiclePlate, dispatchNotes })
  }, [draftKey, items, receiverName, receiverDocument, vehiclePlate, dispatchNotes])

  useEffect(() => {
    if (!focusedLotId || !items.some((item) => item.lot.id === focusedLotId)) return

    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`dispatch-lot-${focusedLotId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    })
    const clearFocus = window.setTimeout(() => {
      setFocusedLotId((current) => (current === focusedLotId ? '' : current))
    }, 1800)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(clearFocus)
    }
  }, [focusedLotId, items])

  useEffect(() => {
    async function addScannedLot() {
      if (!lotId) return
      if (requestId && !approvedRequestLoaded) return

      if (requestId && !approvedRequest) {
        setError('No se pudo cargar la orden aprobada. Vuelve a abrir el despacho desde Trabajo del dia.')
        vibrateError()
        navigate('/operacion/despacho-lista', { replace: true })
        return
      }

      const { data, error: lotError } = await supabase
        .from('lots')
        .select('*, clients(name)')
        .eq('id', lotId)
        .single()

      if (lotError || !data) {
        setError('No se pudo cargar el lote escaneado.')
        vibrateError()
        return
      }

      const approvedItems = Array.isArray(approvedRequest?.items) ? approvedRequest.items : []
      const approvedItem = approvedItems.find((item) => isSameApprovedLot(data, item))
      const approvedLotId = approvedItems.length > 0 ? null : approvedRequest?.lot_id

      if (approvedRequest?.client_id && !isSameClient(data, approvedRequest) && !approvedItem && data.id !== approvedLotId) {
        setError(`Este QR pertenece a ${data.clients?.name || 'otro cliente'}, pero la orden es de ${approvedRequest.clients?.name || 'otro cliente'}.`)
        vibrateError()
        navigate(requestId ? `/operacion/despacho-lista?request=${requestId}` : '/operacion/despacho-lista', { replace: true })
        return
      }

      const { data: earlierLots } = await supabase
        .from('lots')
        .select('id, lot_code, expiry_date, current_quantity, location')
        .eq('product', data.product)
        .neq('id', data.id)
        .eq('status', 'activo')
        .gt('current_quantity', 0)
        .not('expiry_date', 'is', null)
        .lt('expiry_date', data.expiry_date || '9999-12-31')
        .order('expiry_date', { ascending: true })
        .limit(1)

      const scannedItem = {
        lot: data,
        package_count: approvedItem ? String(approvedItem.quantity || '') : approvedLotId === data.id ? String(approvedRequest.quantity || '') : '',
        fefo_lot: earlierLots?.[0] || null,
      }

      if (approvedItems.length > 0 && !approvedItem) {
        setError('Este lote no esta en la lista aprobada. Verifica antes de continuar.')
        vibrateError()
        navigate(requestId ? `/operacion/despacho-lista?request=${requestId}` : '/operacion/despacho-lista', { replace: true })
        return
      } else if (approvedLotId && data.id !== approvedLotId) {
        setError(`Este no es el lote asignado. Debia ser ${displayLotCode(approvedRequest.lots?.lot_code)}. Verifica antes de continuar.`)
        vibrateError()
        navigate(requestId ? `/operacion/despacho-lista?request=${requestId}` : '/operacion/despacho-lista', { replace: true })
        return
      }

      setFocusedLotId(data.id)
      setItems((current) => {
        if (current.some((item) => item.lot.id === data.id)) {
          setStatus(`Producto ${cleanProductName(data.product)} ya esta en la lista.`)
          return current
        }
        setStatus(`Producto ${cleanProductName(data.product)} agregado a la lista.`)
        return [...current, scannedItem]
      })
      navigate(requestId ? `/operacion/despacho-lista?request=${requestId}` : '/operacion/despacho-lista', { replace: true })
    }

    addScannedLot()
  }, [lotId, navigate, approvedRequest, approvedRequestLoaded, requestId])

  const totalPackages = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.package_count || 0), 0),
    [items],
  )

  function scanLot() {
    const returnTo = requestId ? `/operacion/despacho-lista?request=${requestId}` : '/operacion/despacho-lista'
    navigate(`/scanner?modo=despacho&return=${encodeURIComponent(returnTo)}`)
  }

  function updateQuantity(lotIdToUpdate, value) {
    const nextValue = value.replace(',', '.')
    if (!/^\d*\.?\d*$/.test(nextValue)) return
    setItems((current) =>
      current.map((item) => (item.lot.id === lotIdToUpdate ? { ...item, package_count: nextValue } : item)),
    )
  }

  function removeItem(lotIdToRemove) {
    setItems((current) => current.filter((item) => item.lot.id !== lotIdToRemove))
  }

  function validateDispatch() {
    if (items.length === 0) return 'Escanea al menos un lote.'
    if (!receiverName.trim()) return 'Escribe el nombre de quien recibe.'
    if (!receiverDocument.trim()) return 'Escribe el numero de documento.'

    const approvedItems = Array.isArray(approvedRequest?.items) ? approvedRequest.items : []
    if (approvedItems.length > 0) {
      const missing = approvedItems.find((approvedItem) => !items.some((item) => isSameApprovedLot(item.lot, approvedItem)))
      if (missing) return `Falta escanear ${displayLotCode(missing.lot_code)} de la lista aprobada.`
    }

    for (const item of items) {
      const quantity = Number(item.package_count || 0)
      if (quantity <= 0) return `Escribe cantidad para ${displayLotCode(item.lot.lot_code)}.`
      if (quantity > Number(item.lot.current_quantity || 0)) return `No hay inventario suficiente en ${displayLotCode(item.lot.lot_code)}.`
      if (['retenido', 'cerrado'].includes(item.lot.status)) return `${displayLotCode(item.lot.lot_code)} esta ${item.lot.status}.`
      if (expiryDays(item.lot.expiry_date) < 0) return `${displayLotCode(item.lot.lot_code)} esta vencido.`
      if (approvedRequest?.client_id && !isSameClient(item.lot, approvedRequest)) {
        return `${displayLotCode(item.lot.lot_code)} pertenece a otro cliente.`
      }
      if (approvedItems.length > 0 && !approvedItems.some((approvedItem) => isSameApprovedLot(item.lot, approvedItem))) {
        return `${displayLotCode(item.lot.lot_code)} no pertenece a la lista aprobada.`
      }
    }

    if (!deriveDispatchClientId(approvedRequest, items)) {
      return 'No se pudo identificar un unico cliente para este despacho. Verifica que todos los lotes escaneados pertenezcan al mismo cliente.'
    }

    return ''
  }

  function reviewDispatch() {
    const validationError = validateDispatch()
    if (validationError) {
      setError(validationError)
      vibrateError()
      return
    }

    setError('')
    setConfirming(true)
  }

  async function confirmDispatch() {
    if (saving) return

    const validationError = validateDispatch()
    if (validationError) {
      setError(validationError)
      vibrateError()
      return
    }

    setSaving(true)
    setError('')
    setStatus('')

    const queued = 0
    const receiptItems = items.map((item) => ({ ...item, quantity: Number(item.package_count), pending: false }))
    const operationItems = items.map((item) => ({
      lot_id: item.lot.id,
      quantity: Number(item.package_count),
    }))
    const operationNotes = dispatchNotes.trim() || null
    const dispatchClientId = deriveDispatchClientId(approvedRequest, items)
    const receiverNameValue = receiverName.trim()
    const receiverDocumentValue = receiverDocument.trim()
    const vehiclePlateValue = vehiclePlate.trim()
    const dispatchNotesValue = dispatchNotes.trim()

    try {
      const { data: operation, error: operationError } = await supabase.rpc('create_dispatch_operation', {
        p_client_id: dispatchClientId,
        p_receiver_name: receiverNameValue,
        p_receiver_document: receiverDocumentValue,
        p_vehicle_plate: vehiclePlateValue || null,
        p_notes: operationNotes,
        p_items: operationItems,
        p_request_id: requestId || null,
        p_user_id: user.id,
      })

      if (operationError) {
        setConfirming(false)
        setError(
          isMissingDispatchOperationRpc(operationError)
            ? 'Falta actualizar Supabase con operaciones de almacen. Ejecuta supabase/warehouse_operations.sql para habilitar despachos por operacion.'
            : operationError.message?.includes('inventario')
              ? 'No hay inventario suficiente para completar este despacho.'
              : operationError.message,
        )
        vibrateError()
        return
      }

      const operationCode = operation?.operation_code || ''
      const nextReceipt = {
        id: operationCode || `DESP-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`,
        guideNumber: operation?.guide_number || guidePreview,
        createdAt: new Date().toISOString(),
        receiverName: receiverNameValue,
        receiverDocument: receiverDocumentValue,
        vehiclePlate: vehiclePlateValue,
        items: receiptItems,
        totalPackages,
        userEmail: user.email,
        queued,
      }

      setItems([])
      setReceiverName('')
      setReceiverDocument('')
      setVehiclePlate('')
      setDispatchNotes('')
      clearDraft(draftKey)

      if (requestId) {
        const { error: completeError } = await supabase.rpc('complete_client_dispatch_request', {
          p_request_id: requestId,
          p_user_id: user.id,
        })
        if (completeError) {
          console.warn('No se pudo marcar la solicitud como completada.', completeError)
        }
      }

      setReceipt(nextReceipt)
      setConfirming(false)
      setStatus('Despacho guardado. Enviando correo resumen a oficina.')
      vibrateSuccess()

      supabase.functions
        .invoke('send-movement-email', {
          body: {
            to: 'hgarayd@outlook.com',
            movement_type: 'salida_lista',
            client: receiptItems[0]?.lot?.clients?.name || approvedRequest?.clients?.name || 'Sin cliente',
            quantity: receiptItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
            to_location: vehiclePlateValue || null,
            receiver_name: receiverNameValue,
            receiver_document: receiverDocumentValue,
            vehicle_plate: vehiclePlateValue || null,
            notes: dispatchNotesValue || null,
            user_email: user.email,
            items: receiptItems.map((item) => ({
              lot_code: displayLotCode(item.lot.lot_code),
              product: cleanProductName(item.lot.product),
              quantity: item.quantity,
              previous_quantity: Number(item.lot.current_quantity || 0),
              new_quantity: Number(item.lot.current_quantity || 0) - Number(item.quantity || 0),
              location: item.lot.location,
              package_size: item.lot.package_size,
              package_unit: item.lot.package_unit,
            })),
          },
        })
        .then(({ error: emailError }) => {
          if (emailError) {
            setStatus('Despacho guardado. No se pudo enviar el correo automatico; revisa Resend/Supabase.')
          } else {
            setStatus('Despacho guardado y correo resumen enviado a oficina.')
          }
        })
        .catch(() => {
          setStatus('Despacho guardado. No se pudo enviar el correo automatico; revisa Resend/Supabase.')
        })
    } catch (saveError) {
      setConfirming(false)
      setError(saveError?.message || 'No se pudo guardar el despacho. Intenta nuevamente.')
      vibrateError()
    } finally {
      setSaving(false)
    }
  }

  function printReceipt() {
    if (!receipt) return
    const rows = receipt.items
      .map((item) => {
        const equivalent = Number(item.quantity || 0) * Number(item.lot.package_size || 0)
        return `
          <tr>
            <td>${escapeHtml(cleanProductName(item.lot.product))}</td>
            <td>${escapeHtml(displayLotCode(item.lot.lot_code))}</td>
            <td>${escapeHtml(formatNumber(item.quantity))}</td>
            <td>${escapeHtml(Number(item.lot.package_size) > 0 ? `${formatNumber(equivalent)} ${item.lot.package_unit || ''}` : '-')}</td>
            <td>${escapeHtml(item.lot.location || '-')}</td>
            <td>${escapeHtml(item.lot.expiry_date ? formatDate(item.lot.expiry_date) : '-')}</td>
            <td>${item.pending ? 'Pendiente offline' : 'Aplicado'}</td>
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
          <title>Comprobante ${escapeHtml(receipt.id)}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            body { color: #0f172a; font-family: Arial, sans-serif; margin: 24px; }
            h1 { margin: 0 0 4px; }
            .meta { display: grid; gap: 8px; grid-template-columns: repeat(2, 1fr); margin: 18px 0; }
            .box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border-bottom: 1px solid #cbd5e1; font-size: 12px; padding: 8px; text-align: left; }
            th { background: #f1f5f9; }
            @media print { body { margin: 12mm; } }
          </style>
        </head>
        <body>
          <h1>Todo Agricola</h1>
          <strong>Comprobante de despacho ${escapeHtml(receipt.id)}</strong>
          <div class="meta">
            <div class="box">Nº guia: ${escapeHtml(receipt.guideNumber || '-')}</div>
            <div class="box">Fecha: ${escapeHtml(formatDate(receipt.createdAt))}</div>
            <div class="box">Usuario: ${escapeHtml(receipt.userEmail)}</div>
            <div class="box">Recibe: ${escapeHtml(receipt.receiverName)}</div>
            <div class="box">Documento: ${escapeHtml(receipt.receiverDocument)}</div>
            <div class="box">Placa: ${escapeHtml(receipt.vehiclePlate || '-')}</div>
            <div class="box">Total envases: ${escapeHtml(formatNumber(receipt.totalPackages))}</div>
          </div>
          <table>
            <thead>
              <tr><th>Producto</th><th>Lote</th><th>Envases</th><th>Equivalente</th><th>Ubicacion</th><th>Vence</th><th>Estado</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <script>window.addEventListener('load', () => window.print())</script>
        </body>
      </html>
    `)
    printWindow.document.close()
  }

  return (
    <div>
      <PageHeader title="Despacho" subtitle="Datos del despacho, carga por QR y comprobante" />

      {approvedRequest ? (
        <section className="panel mb-4 border-amber-200 bg-amber-50">
          <p className="text-sm font-bold uppercase text-amber-700">Despacho aprobado</p>
          <p className="mt-1 text-lg font-black text-slate-950">{approvedRequest.clients?.name || 'Cliente'}</p>
          {Array.isArray(approvedRequest.items) && approvedRequest.items.length > 1 ? (
            <div className="mt-2 space-y-1">
              {approvedRequest.items.map((item) => (
                <div key={item.lot_id} className="rounded-lg bg-white/80 p-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(item.product)}</p>
                    <span className="rounded-lg bg-campo-50 px-2 py-1 text-sm font-black text-campo-800">{formatNumber(item.quantity)} env.</span>
                  </div>
                  <p className="text-xs font-semibold text-slate-600">
                    {displayLotCode(item.lot_code)} - Presentacion: {packageLabel(item) || 'Sin dato'}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2 rounded-lg bg-white/80 p-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(approvedRequest.product || approvedRequest.lots?.product)}</p>
                <span className="rounded-lg bg-campo-50 px-2 py-1 text-sm font-black text-campo-800">{formatNumber(approvedRequest.quantity)} env.</span>
              </div>
              <p className="text-xs font-semibold text-slate-600">
                {displayLotCode(approvedRequest.lots?.lot_code)} - Presentacion: {packageLabel(approvedRequest.lots) || 'Sin dato'}
              </p>
            </div>
          )}
          <p className="mt-1 text-xs font-bold text-amber-700">
            Escanea el QR del lote asignado. Si escaneas otro lote, la app te advertira.
          </p>
        </section>
      ) : null}

      <section className="panel mb-4 grid gap-3 sm:grid-cols-2">
        <h3 className="text-lg font-bold text-slate-950 sm:col-span-2">Datos del despacho</h3>
        <label className="sm:col-span-2">
          <span className="label">Nº guía</span>
          <input className="input mt-1 bg-slate-100 font-black text-slate-700" value={guidePreview} readOnly />
          <span className="mt-1 block text-xs font-semibold text-slate-500">Se asigna automaticamente al guardar la operacion.</span>
        </label>
        <label>
          <span className="label">Nombre del que recibe</span>
          <input className="input mt-1" autoComplete="off" value={receiverName} onChange={(event) => setReceiverName(event.target.value)} />
        </label>
        <label>
          <span className="label">Numero de documento</span>
          <input className="input mt-1" autoComplete="off" value={receiverDocument} onChange={(event) => setReceiverDocument(event.target.value)} />
        </label>
        <label className="sm:col-span-2">
          <span className="label">Placa del vehiculo</span>
          <input className="input mt-1 uppercase" autoComplete="off" value={vehiclePlate} onChange={(event) => setVehiclePlate(event.target.value.toUpperCase())} placeholder="Opcional" />
        </label>
        <label className="sm:col-span-2">
          <span className="label">Observaciones</span>
          <textarea className="input mt-1" rows="2" value={dispatchNotes} onChange={(event) => setDispatchNotes(event.target.value)} placeholder="Opcional" />
        </label>
      </section>

      <section className="mb-4 grid gap-3">
        <h3 className="text-lg font-bold text-slate-950">Carga del despacho</h3>
        <button className="btn-primary min-h-14" type="button" onClick={scanLot}>
          <ScanLine size={22} /> Escanear lote
        </button>
      </section>

      <div className="space-y-3">
        {items.length === 0 ? (
          <EmptyState title="Sin lotes en despacho" text="Escanea el primer QR para agregarlo a la lista." />
        ) : (
          items.map((item) => {
            const days = expiryDays(item.lot.expiry_date)
            const equivalent = Number(item.package_count || 0) * Number(item.lot.package_size || 0)
            const availableEquivalent = Number(item.lot.current_quantity || 0) * Number(item.lot.package_size || 0)
            return (
              <article
                key={item.lot.id}
                id={`dispatch-lot-${item.lot.id}`}
                className={`panel scroll-mt-28 transition ${focusedLotId === item.lot.id ? 'ring-2 ring-campo-100 ring-offset-2' : ''}`}
              >
                <ListProductCard
                  title={cleanProductName(item.lot.product)}
                  envases={item.lot.current_quantity || 0}
                  envasesLabel="env. disponibles"
                  envasesVariant="available"
                  equivalent={Number(item.lot.package_size) > 0 ? availableEquivalent : null}
                  equivalentUnit={item.lot.package_unit}
                  presentation={packageLabel(item.lot) || 'Sin dato'}
                  secondary={`${displayLotCode(item.lot.lot_code)} - ${item.lot.location || '-'}`}
                  detailTitle="Producto del despacho"
                  detailRows={[
                    { label: 'Envases a despachar', value: `${formatNumber(item.package_count || 0)} env.` },
                    { label: 'Equivalente', value: Number(item.lot.package_size) > 0 ? `${formatNumber(equivalent)} ${item.lot.package_unit || ''}` : 'Sin dato' },
                    { label: 'Presentacion', value: packageLabel(item.lot) || 'Sin dato' },
                    { label: 'Lote', value: displayLotCode(item.lot.lot_code) },
                    { label: 'Cliente', value: item.lot.clients?.name || '-' },
                    { label: 'Ubicacion', value: item.lot.location || '-' },
                    { label: 'Disponible', value: `${formatNumber(item.lot.current_quantity)} env.` },
                    { label: 'Vencimiento', value: item.lot.expiry_date ? formatDate(item.lot.expiry_date) : 'Sin dato' },
                    { label: 'Estado', value: item.lot.status || 'activo' },
                  ]}
                  onRemove={() => removeItem(item.lot.id)}
                />
                <div className="hidden">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-lg font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(item.lot.product)}</p>
                      <span className="rounded-lg bg-campo-50 px-2.5 py-1 text-base font-black text-campo-800">{formatNumber(item.package_count)} env.</span>
                    </div>
                    <p className="text-sm font-semibold text-slate-500">
                      {displayLotCode(item.lot.lot_code)} · {item.lot.location || '-'}
                    </p>
                    <p className="mt-1 text-xs font-bold text-slate-500">Presentacion: {packageLabel(item.lot) || 'Sin dato'}</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-lg bg-campo-50 p-3">
                        <p className="text-xs font-semibold uppercase text-campo-700">Disponible</p>
                        <p className="mt-1 text-3xl font-black text-campo-800">{formatNumber(item.lot.current_quantity)}</p>
                        <p className="text-sm font-bold text-campo-700">envases</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase text-slate-500">Vencimiento</p>
                        <p className="mt-1 text-base font-black text-slate-950">
                          {item.lot.expiry_date ? formatDate(item.lot.expiry_date) : 'Sin dato'}
                        </p>
                        <p className="text-xs font-bold text-slate-500">{item.lot.status || 'activo'}</p>
                      </div>
                    </div>
                  </div>
                  <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={() => removeItem(item.lot.id)} title="Quitar de la lista">
                    <Trash2 size={17} />
                  </button>
                </div>
                {days !== null && days <= 90 ? (
                  <div className={`mt-3 rounded-lg p-2 text-xs font-bold ${days < 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>
                    {days < 0 ? 'Lote vencido, salida bloqueada.' : `Vence en ${days} dias. Revisa FEFO antes de confirmar.`}
                  </div>
                ) : null}
                {item.fefo_lot ? (
                  <div className="mt-3 rounded-lg bg-red-50 p-2 text-xs font-bold text-red-700">
                    FEFO: existe un lote anterior ({displayLotCode(item.fefo_lot.lot_code)}, vence {formatDate(item.fefo_lot.expiry_date)}, {formatNumber(item.fefo_lot.current_quantity)} envases en {item.fefo_lot.location}). Es una advertencia para considerar antes de confirmar, no bloquea la salida.
                  </div>
                ) : null}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label>
                    <span className="label">Envases a despachar</span>
                    <input
                      className={`input mt-1 ${isApprovedDispatch ? 'bg-slate-100 font-black text-slate-700' : ''}`}
                      inputMode="decimal"
                      readOnly={isApprovedDispatch}
                      type="text"
                      value={item.package_count}
                      onChange={(event) => updateQuantity(item.lot.id, event.target.value)}
                      onWheel={(event) => event.currentTarget.blur()}
                    />
                    {isApprovedDispatch ? (
                      <span className="mt-1 block text-xs font-bold text-slate-500">Cantidad aprobada</span>
                    ) : null}
                  </label>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">Equivalente</p>
                    <p className="mt-1 text-lg font-black text-slate-950">
                      {Number(item.lot.package_size) > 0 ? `${formatNumber(equivalent)} ${item.lot.package_unit || ''}` : 'Sin dato'}
                    </p>
                  </div>
                </div>
              </article>
            )
          })
        )}
      </div>

      {error ? <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}
      {status ? <div className="mt-4 rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">{status}</div> : null}

      <button className="btn-primary mt-4 w-full" type="button" onClick={reviewDispatch} disabled={saving}>
        <CheckCircle2 size={20} /> Revisar despacho
      </button>

      <Link className="btn-secondary mt-3 w-full" to="/operacion">
        <Plus size={20} /> Volver a operar
      </Link>

      {confirming ? (
        <div data-modal-backdrop="true" className="fixed inset-0 z-[70] flex items-end overflow-y-auto overscroll-contain bg-slate-950/45 p-3 sm:items-center sm:justify-center">
          <div data-overlay-panel="true" className="max-h-[calc(100dvh-1rem)] w-full max-w-xl overflow-y-auto overscroll-contain rounded-xl bg-white shadow-xl sm:max-h-[88dvh]" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-slate-100 p-4">
              <h3 className="text-xl font-bold text-slate-950">Confirmar despacho</h3>
            </div>
            <div className="touch-pan-y px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-700">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <span className="block text-xs uppercase text-slate-400">Nº guía</span>
                  <strong className="text-slate-950">{guidePreview}</strong>
                </div>
                <div>
                  <span className="block text-xs uppercase text-slate-400">Cliente</span>
                  <strong className="text-slate-950">{items[0]?.lot?.clients?.name || approvedRequest?.clients?.name || '-'}</strong>
                </div>
                <div>
                  <span className="block text-xs uppercase text-slate-400">Productos</span>
                  <strong className="text-slate-950">{items.length}</strong>
                </div>
                <div>
                  <span className="block text-xs uppercase text-slate-400">Recibe</span>
                  <strong className="text-slate-950">{receiverName}</strong>
                </div>
                <div>
                  <span className="block text-xs uppercase text-slate-400">Documento</span>
                  <strong className="text-slate-950">{receiverDocument}</strong>
                </div>
                <div className="sm:col-span-2">
                  <span className="block text-xs uppercase text-slate-400">Placa</span>
                  <strong className="text-slate-950">{vehiclePlate || 'Sin placa'}</strong>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {items.map((item) => {
                const quantity = Number(item.package_count || 0)
                const remaining = Number(item.lot.current_quantity || 0) - quantity
                const equivalent = quantity * Number(item.lot.package_size || 0)
                return (
                  <div key={item.lot.id} className="rounded-lg border border-slate-100 bg-white p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-black leading-snug text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(item.lot.product)}</p>
                        <p className="text-xs font-semibold text-slate-500">
                          Lote {displayLotCode(item.lot.lot_code)} - {packageLabel(item.lot) || 'Sin presentacion'}
                        </p>
                        <p className="mt-1 text-xs font-bold text-slate-500">Stock: {formatNumber(item.lot.current_quantity)} a {formatNumber(remaining)} env.</p>
                      </div>
                      <div className="shrink-0 rounded-lg bg-campo-50 px-3 py-2 text-right text-campo-800">
                        <p className="text-base font-black">{formatNumber(quantity)} env.</p>
                        <p className="text-xs font-black">
                          {Number(item.lot.package_size) > 0 ? `${formatNumber(equivalent)} ${item.lot.package_unit || ''}` : 'Sin equiv.'}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <ConfirmChecks checks={confirmChecks} onChange={setConfirmChecks} />

            <div className="sticky bottom-0 z-10 mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 bg-white/95 pt-4 pb-[env(safe-area-inset-bottom)] backdrop-blur">
              <button className="btn-secondary w-full" type="button" onClick={() => setConfirming(false)} disabled={saving}>
                Cancelar
              </button>
              <button className="btn-primary w-full" type="button" onClick={confirmDispatch} disabled={saving || !allConfirmChecksDone(confirmChecks)}>
                {saving ? <LogOut size={20} /> : <CheckCircle2 size={20} />}
                {saving ? 'Guardando...' : 'Confirmar'}
              </button>
            </div>
            </div>
          </div>
        </div>
      ) : null}

      {receipt ? (
        <div data-modal-backdrop="true" className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-campo-700 p-6 text-white">
          <section className="w-full max-w-md py-8 text-center">
            <span className="mx-auto flex h-40 w-40 items-center justify-center rounded-full border border-white/25 text-white">
              <CheckCircle2 size={118} strokeWidth={1.8} />
            </span>
            <h3 className="mt-5 text-3xl font-black">Despacho guardado</h3>
            <p className="mt-2 text-2xl font-black text-white">{receipt.guideNumber}</p>
            <p className="mt-2 text-sm font-bold text-campo-50">El movimiento quedo registrado.</p>
            {receipt.queued > 0 ? (
              <p className="mt-3 rounded-lg border border-amber-100/30 bg-amber-100/15 p-2 text-sm font-bold text-amber-50">
                {receipt.queued} salida(s) offline quedan pendientes de revision admin.
              </p>
            ) : null}
            <div className="mt-6 grid grid-cols-2 gap-2">
              <button className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-white/25 bg-white/10 px-4 py-3 font-black text-white transition active:scale-[0.99]" type="button" onClick={printReceipt}>
                Imprimir
              </button>
              <button className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-white/15 px-4 py-3 font-black text-white shadow-soft transition active:scale-[0.99]" type="button" onClick={() => navigate('/operacion')}>
                Volver a operar
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
