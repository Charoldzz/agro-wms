import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle2, LogOut, Plus, ScanLine, Trash2 } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useAuth } from '../hooks/useAuth.jsx'
import { cleanProductName, displayLotCode } from '../lib/display'
import { formatDate, formatNumber } from '../lib/format'
import { isNetworkMovementError, queueMovement } from '../lib/offlineQueue'
import { supabase } from '../lib/supabase'
import { vibrateError, vibrateSuccess, vibrateWarning } from '../lib/haptics'

const DISPATCH_DRAFT_KEY = 'todo-agricola-dispatch-list-draft'

function emptyDraft() {
  return { items: [], receiverName: '', receiverDocument: '', vehiclePlate: '' }
}

function readDraft() {
  try {
    const draft = JSON.parse(sessionStorage.getItem(DISPATCH_DRAFT_KEY) || 'null')
    if (!draft) return emptyDraft()
    return {
      items: Array.isArray(draft.items) ? draft.items : [],
      receiverName: draft.receiverName || '',
      receiverDocument: draft.receiverDocument || '',
      vehiclePlate: draft.vehiclePlate || '',
    }
  } catch {
    return emptyDraft()
  }
}

function writeDraft(draft) {
  sessionStorage.setItem(DISPATCH_DRAFT_KEY, JSON.stringify(draft))
}

function clearDraft() {
  sessionStorage.removeItem(DISPATCH_DRAFT_KEY)
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

export default function DispatchList() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const [items, setItems] = useState(() => readDraft().items)
  const [receiverName, setReceiverName] = useState(() => readDraft().receiverName)
  const [receiverDocument, setReceiverDocument] = useState(() => readDraft().receiverDocument)
  const [vehiclePlate, setVehiclePlate] = useState(() => readDraft().vehiclePlate)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [approvedRequest, setApprovedRequest] = useState(null)

  const lotId = new URLSearchParams(location.search).get('lot')
  const requestId = new URLSearchParams(location.search).get('request')

  useEffect(() => {
    async function loadApprovedRequest() {
      if (!requestId) {
        setApprovedRequest(null)
        return
      }

      const { data } = await supabase
        .from('client_dispatch_requests')
        .select('*, clients(name), lots(id, lot_code, product, current_quantity, location)')
        .eq('id', requestId)
        .single()

      setApprovedRequest(data || null)
    }

    loadApprovedRequest()
  }, [requestId])

  useEffect(() => {
    writeDraft({ items, receiverName, receiverDocument, vehiclePlate })
  }, [items, receiverName, receiverDocument, vehiclePlate])

  useEffect(() => {
    async function addScannedLot() {
      if (!lotId) return

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

      const { data: earlierLots } = await supabase
        .from('lots')
        .select('id, lot_code, expiry_date, current_quantity, location')
        .eq('product', data.product)
        .neq('id', data.id)
        .gt('current_quantity', 0)
        .not('expiry_date', 'is', null)
        .lt('expiry_date', data.expiry_date || '9999-12-31')
        .order('expiry_date', { ascending: true })
        .limit(1)

      const approvedItems = Array.isArray(approvedRequest?.items) ? approvedRequest.items : []
      const approvedItem = approvedItems.find((item) => item.lot_id === data.id)
      const approvedLotId = approvedItems.length > 0 ? null : approvedRequest?.lot_id
      const scannedItem = {
        lot: data,
        package_count: approvedItem ? String(approvedItem.quantity || '') : approvedLotId === data.id ? String(approvedRequest.quantity || '') : '',
        fefo_lot: earlierLots?.[0] || null,
      }

      if (approvedItems.length > 0 && !approvedItem) {
        setError('Este lote no esta en la lista aprobada. Verifica antes de continuar.')
        vibrateWarning()
      } else if (approvedLotId && data.id !== approvedLotId) {
        setError(`Este no es el lote asignado. Debia ser ${displayLotCode(approvedRequest.lots?.lot_code)}. Verifica antes de continuar.`)
        vibrateWarning()
      }

      setItems((current) => {
        if (current.some((item) => item.lot.id === data.id)) {
          setStatus(`${displayLotCode(data.lot_code)} ya esta en la lista. Puedes cambiar la cantidad.`)
          return current
        }
        setStatus(`${displayLotCode(data.lot_code)} agregado. Puedes escanear otro QR.`)
        return [...current, scannedItem]
      })
      navigate(requestId ? `/operacion/despacho-lista?request=${requestId}` : '/operacion/despacho-lista', { replace: true })
    }

    addScannedLot()
  }, [lotId, navigate, approvedRequest, requestId])

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
      const missing = approvedItems.find((approvedItem) => !items.some((item) => item.lot.id === approvedItem.lot_id))
      if (missing) return `Falta escanear ${displayLotCode(missing.lot_code)} de la lista aprobada.`
    }

    for (const item of items) {
      const quantity = Number(item.package_count || 0)
      if (quantity <= 0) return `Escribe cantidad para ${displayLotCode(item.lot.lot_code)}.`
      if (quantity > Number(item.lot.current_quantity || 0)) return `No hay inventario suficiente en ${displayLotCode(item.lot.lot_code)}.`
      if (['retenido', 'cerrado'].includes(item.lot.status)) return `${displayLotCode(item.lot.lot_code)} esta ${item.lot.status}.`
      if (expiryDays(item.lot.expiry_date) < 0) return `${displayLotCode(item.lot.lot_code)} esta vencido.`
      if (approvedItems.length > 0 && !approvedItems.some((approvedItem) => approvedItem.lot_id === item.lot.id)) {
        return `${displayLotCode(item.lot.lot_code)} no pertenece a la lista aprobada.`
      }
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
    const validationError = validateDispatch()
    if (validationError) {
      setError(validationError)
      vibrateError()
      return
    }

    setSaving(true)
    setError('')
    setStatus('')

    let queued = 0
    const receiptItems = []

    for (const item of items) {
      const quantity = Number(item.package_count)
      const notes = [
        vehiclePlate.trim() ? `Placa: ${vehiclePlate.trim()}` : null,
        `Recibe: ${receiverName.trim()}`,
        `Documento: ${receiverDocument.trim()}`,
        'Despacho por lista',
      ]
        .filter(Boolean)
        .join(' | ')

      const { error: rpcError } = await supabase.rpc('register_movement', {
        p_lot_id: item.lot.id,
        p_type: 'salida',
        p_quantity: quantity,
        p_to_location: vehiclePlate.trim() || null,
        p_notes: notes,
        p_user_id: user.id,
      })

      if (rpcError) {
        if (isNetworkMovementError(rpcError)) {
          queueMovement({
            lot_id: item.lot.id,
            type: 'salida',
            quantity,
            to_location: vehiclePlate.trim() || null,
            notes: `[OFFLINE] [REQUIERE REVISION] ${notes}`,
            user_id: user.id,
            email: null,
          })
          queued += 1
          receiptItems.push({ ...item, quantity, pending: true })
          continue
        }

        setError(rpcError.message?.includes('inventario') ? `No hay inventario suficiente en ${displayLotCode(item.lot.lot_code)}.` : rpcError.message)
        vibrateError()
        setSaving(false)
        return
      }

      receiptItems.push({ ...item, quantity, pending: false })
    }

    setItems([])
    setReceiverName('')
    setReceiverDocument('')
    setVehiclePlate('')
    clearDraft()
    if (requestId && queued === 0) {
      await supabase.rpc('complete_client_dispatch_request', {
        p_request_id: requestId,
        p_user_id: user.id,
      })
    }
    setReceipt({
      id: `DESP-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`,
      createdAt: new Date().toISOString(),
      receiverName: receiverName.trim(),
      receiverDocument: receiverDocument.trim(),
      vehiclePlate: vehiclePlate.trim(),
      items: receiptItems,
      totalPackages,
      userEmail: user.email,
      queued,
    })
    setConfirming(false)
    if (queued === 0) {
      await supabase.functions.invoke('send-movement-email', {
        body: {
          to: 'hgarayd@outlook.com',
          movement_type: 'salida_lista',
          client: receiptItems[0]?.lot?.clients?.name || approvedRequest?.clients?.name || 'Sin cliente',
          quantity: receiptItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
          to_location: vehiclePlate.trim() || null,
          notes: [
            vehiclePlate.trim() ? `Placa: ${vehiclePlate.trim()}` : null,
            `Recibe: ${receiverName.trim()}`,
            `Documento: ${receiverDocument.trim()}`,
            requestId ? `Solicitud: ${requestId}` : null,
          ].filter(Boolean).join(' | '),
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
    }
    setStatus(queued > 0 ? `${queued} salida(s) quedaron pendientes de revision admin al sincronizar. El correo se enviara despues de revision.` : 'Despacho guardado y correo resumen enviado a oficina.')
    vibrateSuccess()
    setSaving(false)
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
                <p key={item.lot_id} className="text-sm font-semibold text-slate-700">
                  {displayLotCode(item.lot_code)} - {cleanProductName(item.product)} - {formatNumber(item.quantity)} env.
                </p>
              ))}
            </div>
          ) : (
            <p className="text-sm font-semibold text-slate-700">
              {cleanProductName(approvedRequest.product || approvedRequest.lots?.product)} - {displayLotCode(approvedRequest.lots?.lot_code)} - {formatNumber(approvedRequest.quantity)} env.
            </p>
          )}
          <p className="mt-1 text-xs font-bold text-amber-700">
            Escanea el QR del lote asignado. Si escaneas otro lote, la app te advertira.
          </p>
        </section>
      ) : null}

      <section className="panel mb-4 grid gap-3 sm:grid-cols-2">
        <h3 className="text-lg font-bold text-slate-950 sm:col-span-2">Datos del despacho</h3>
        <label>
          <span className="label">Nombre del que recibe</span>
          <input className="input mt-1" value={receiverName} onChange={(event) => setReceiverName(event.target.value)} />
        </label>
        <label>
          <span className="label">Numero de documento</span>
          <input className="input mt-1" value={receiverDocument} onChange={(event) => setReceiverDocument(event.target.value)} />
        </label>
        <label className="sm:col-span-2">
          <span className="label">Placa del vehiculo</span>
          <input className="input mt-1 uppercase" value={vehiclePlate} onChange={(event) => setVehiclePlate(event.target.value.toUpperCase())} placeholder="Opcional" />
        </label>
      </section>

      <section className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px]">
        <h3 className="text-lg font-bold text-slate-950 sm:col-span-2">Carga del despacho</h3>
        <button className="btn-primary min-h-14" type="button" onClick={scanLot}>
          <ScanLine size={22} /> Escanear lote
        </button>
        <div className="rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-800">
          Total: {formatNumber(totalPackages)} envases
        </div>
      </section>

      {items.length > 0 ? (
        <button className="btn-primary mb-4 min-h-16 w-full text-lg" type="button" onClick={scanLot}>
          <ScanLine size={24} /> Escanear otro QR
        </button>
      ) : null}

      <div className="space-y-3">
        {items.length === 0 ? (
          <EmptyState title="Sin lotes en despacho" text="Escanea el primer QR para agregarlo a la lista." />
        ) : (
          items.map((item) => {
            const days = expiryDays(item.lot.expiry_date)
            const equivalent = Number(item.package_count || 0) * Number(item.lot.package_size || 0)
            return (
              <article key={item.lot.id} className="panel">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-950">{cleanProductName(item.lot.product)}</p>
                    <p className="text-sm font-semibold text-slate-500">
                      {displayLotCode(item.lot.lot_code)} · {item.lot.location || '-'}
                    </p>
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
                  <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={() => removeItem(item.lot.id)}>
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
                      className="input mt-1"
                      inputMode="decimal"
                      type="text"
                      value={item.package_count}
                      onChange={(event) => updateQuantity(item.lot.id, event.target.value)}
                      onWheel={(event) => event.currentTarget.blur()}
                    />
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
        <div className="fixed inset-0 z-40 flex items-end bg-slate-950/45 p-4 sm:items-center sm:justify-center">
          <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl">
            <h3 className="text-xl font-bold text-slate-950">Confirmar despacho</h3>
            <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-700 sm:grid-cols-2">
              <div>Productos: {items.length}</div>
              <div>Total envases: {formatNumber(totalPackages)}</div>
              <div>Recibe: {receiverName}</div>
              <div>Documento: {receiverDocument}</div>
              <div className="sm:col-span-2">Placa: {vehiclePlate || 'Sin placa'}</div>
            </div>

            <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
              {items.map((item) => {
                const quantity = Number(item.package_count || 0)
                const remaining = Number(item.lot.current_quantity || 0) - quantity
                return (
                  <div key={item.lot.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-slate-950">{cleanProductName(item.lot.product)}</p>
                        <p className="text-xs font-semibold text-slate-500">{displayLotCode(item.lot.lot_code)}</p>
                      </div>
                      <p className="text-lg font-black text-campo-700">{formatNumber(quantity)}</p>
                    </div>
                    <p className="mt-1 text-xs font-bold text-slate-500">
                      Disponible: {formatNumber(item.lot.current_quantity)} · Queda: {formatNumber(remaining)} envases
                    </p>
                  </div>
                )
              })}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button className="btn-secondary w-full" type="button" onClick={() => setConfirming(false)} disabled={saving}>
                Cancelar
              </button>
              <button className="btn-primary w-full" type="button" onClick={confirmDispatch} disabled={saving}>
                {saving ? <LogOut size={20} /> : <CheckCircle2 size={20} />}
                {saving ? 'Guardando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {receipt ? (
        <div className="fixed inset-0 z-40 flex items-end bg-slate-950/45 p-4 sm:items-center sm:justify-center">
          <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl">
            <h3 className="text-xl font-bold text-slate-950">Comprobante de despacho</h3>
            <p className="mt-1 text-sm font-bold text-slate-500">{receipt.id}</p>
            <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-700 sm:grid-cols-2">
              <div>Total envases: {formatNumber(receipt.totalPackages)}</div>
              <div>Productos: {receipt.items.length}</div>
              <div>Recibe: {receipt.receiverName}</div>
              <div>Documento: {receipt.receiverDocument}</div>
              <div className="sm:col-span-2">Placa: {receipt.vehiclePlate || 'Sin placa'}</div>
              {receipt.queued > 0 ? (
                <div className="sm:col-span-2 rounded-lg bg-amber-50 p-2 text-amber-800">
                  {receipt.queued} salida(s) offline quedan pendientes de revision admin.
                </div>
              ) : null}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button className="btn-secondary w-full" type="button" onClick={printReceipt}>
                Imprimir
              </button>
              <button className="btn-primary w-full" type="button" onClick={() => navigate('/operacion')}>
                Volver a operar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
