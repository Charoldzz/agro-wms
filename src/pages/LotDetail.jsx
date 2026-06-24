import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Camera, CheckCircle2, Download, Printer, QrCode, Save } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import ListProductCard from '../components/ListProductCard'
import { useAuth } from '../hooks/useAuth.jsx'
import { formatDate, formatNumber, movementLabel } from '../lib/format'
import { createLotQrDataUrl } from '../lib/qr'
import { supabase } from '../lib/supabase'
import { cleanProductName, displayLotCode, productCodeLabel } from '../lib/display'
import { isNetworkMovementError, queueMovement } from '../lib/offlineQueue'
import { compressImageFile } from '../lib/image'
import { vibrateError, vibrateSuccess } from '../lib/haptics'
import ConfirmChecks, { allConfirmChecksDone, emptyConfirmChecks } from '../components/ConfirmChecks'
import OperationalIssueModal from '../components/OperationalIssueModal'
import { clearDraft, readDraft, writeDraft } from '../lib/drafts'
import { internalLocations } from '../lib/locations'

const initialMovement = {
  type: 'entrada',
  quantity: '',
  package_count: '',
  incident_type: '',
  affected_packages: '',
  physical_count: '',
  to_location: '',
  receiver_name: '',
  receiver_document: '',
  notes: '',
}

const incidentTypes = [
  { value: 'envases', label: 'Envases', needsAffected: true, needsPhysicalCount: false },
  { value: 'cajas', label: 'Cajas', needsAffected: true, needsPhysicalCount: false },
  { value: 'etiquetado', label: 'Etiquetado', needsAffected: false, needsPhysicalCount: false },
  { value: 'reempaquetado', label: 'Reempaquetado', needsAffected: true, needsPhysicalCount: false },
  { value: 'etiqueta_danada', label: 'Etiqueta dañada', needsAffected: false, needsPhysicalCount: false },
  { value: 'envase_danado', label: 'Envase dañado', needsAffected: true, needsPhysicalCount: false },
  { value: 'reempaque', label: 'Reempaque', needsAffected: true, needsPhysicalCount: false },
  { value: 'fraccionamiento', label: 'Fraccionamiento', needsAffected: true, needsPhysicalCount: true },
  { value: 'diferencia_stock', label: 'Diferencia de stock', needsAffected: false, needsPhysicalCount: true },
  { value: 'otro', label: 'Otro', needsAffected: false, needsPhysicalCount: false },
]

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function getIncidentConfig(value) {
  return incidentTypes.find((incident) => incident.value === value) || null
}

function getLotOperationalState(lot, daysLeft) {
  if (!lot) {
    return {
      label: 'Sin estado',
      note: '',
      badge: 'bg-slate-100 text-slate-700',
      panel: 'bg-slate-50 text-slate-700',
    }
  }

  const rawStatus = String(lot.status || '').toLowerCase()
  if (rawStatus === 'retenido') {
    return {
      label: 'Retenido',
      note: 'No permitir salidas hasta liberacion.',
      badge: 'bg-red-50 text-red-700 ring-1 ring-red-100',
      panel: 'bg-red-50 text-red-700',
    }
  }
  if (rawStatus === 'cerrado' || rawStatus === 'inactivo') {
    return {
      label: rawStatus === 'cerrado' ? 'Cerrado' : 'Inactivo',
      note: 'Lote fuera de operacion.',
      badge: 'bg-slate-200 text-slate-800 ring-1 ring-slate-300',
      panel: 'bg-slate-100 text-slate-700',
    }
  }
  if (daysLeft !== null && daysLeft < 0) {
    return {
      label: 'Vencido',
      note: 'Salida bloqueada por vencimiento.',
      badge: 'bg-red-600 text-white ring-1 ring-red-700',
      panel: 'bg-red-50 text-red-700',
    }
  }
  if (daysLeft !== null && daysLeft <= 90) {
    return {
      label: 'Por vencer',
      note: daysLeft === 0 ? 'Vence hoy. Revisar antes de operar.' : `Vence en ${daysLeft} dias. Revisar FEFO.`,
      badge: 'bg-amber-100 text-amber-900 ring-1 ring-amber-200',
      panel: 'bg-amber-50 text-amber-800',
    }
  }

  return {
    label: 'Disponible',
    note: 'Lote disponible para operar.',
    badge: 'bg-campo-50 text-campo-800 ring-1 ring-campo-100',
    panel: 'bg-campo-50 text-campo-800',
  }
}

function LotStateBadge({ state }) {
  return (
    <div className={`rounded-lg px-3 py-2 text-sm font-black ${state.badge}`}>
      {state.label}
    </div>
  )
}

function LotStateNotice({ state, saleBlocked = false }) {
  if (state.label === 'Disponible') return null
  return (
    <div className={`mb-4 rounded-lg p-4 text-sm font-bold ${state.panel}`}>
      {state.label}. {state.note}{saleBlocked ? ' Las salidas quedan bloqueadas.' : ''}
    </div>
  )
}

export default function LotDetail() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { user, isAdmin, isOperator } = useAuth()
  const [lot, setLot] = useState(null)
  const [movements, setMovements] = useState([])
  const [movement, setMovement] = useState(initialMovement)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [error, setError] = useState('')
  const [emailStatus, setEmailStatus] = useState('')
  const [pendingMovement, setPendingMovement] = useState(null)
  const [saving, setSaving] = useState(false)
  const [fefoLot, setFefoLot] = useState(null)
  const [movementPhotoFile, setMovementPhotoFile] = useState(null)
  const [movementPhotoPreview, setMovementPhotoPreview] = useState('')
  const [showFullHistory, setShowFullHistory] = useState(false)
  const [movementSuccess, setMovementSuccess] = useState(null)
  const [confirmChecks, setConfirmChecks] = useState(emptyConfirmChecks())
  const [showIssueReport, setShowIssueReport] = useState(false)

  useEffect(() => {
    loadLot()

    const channel = supabase
      .channel(`lot-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lots', filter: `id=eq.${id}` }, loadLot)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movements', filter: `lot_id=eq.${id}` }, loadLot)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [id])

  useEffect(() => {
    if (!lot?.qr_token) {
      setQrDataUrl('')
      return
    }

    createLotQrDataUrl(lot.qr_token).then(setQrDataUrl)
  }, [lot?.qr_token])

  useEffect(() => {
    const mode = location.state?.movementMode || ''
    const repairType = location.state?.repairType || ''
    if (mode === 'despacho') {
      setMovement((value) => ({ ...value, type: 'salida' }))
    } else if (mode === 'reparo') {
      setMovement((value) => ({ ...value, type: 'ajuste', incident_type: repairType || value.incident_type }))
    } else if (mode === 'traslado') {
      setMovement((value) => ({ ...value, type: 'traslado' }))
    }
  }, [id, location.state])

  useEffect(() => {
    async function loadFefoWarning() {
      if (!lot?.product || movement.type !== 'salida') {
        setFefoLot(null)
        return
      }

      const { data } = await supabase
        .from('lots')
        .select('id, lot_code, solucion_product_code, expiry_date, current_quantity, location')
        .eq('inventory_source', 'stock_independiente')
        .eq('product', lot.product)
        .neq('id', lot.id)
        .gt('current_quantity', 0)
        .not('expiry_date', 'is', null)
        .order('expiry_date', { ascending: true })
        .limit(1)

      const earlierLot = data?.[0]
      if (!earlierLot) {
        setFefoLot(null)
        return
      }

      if (!lot.expiry_date || new Date(`${earlierLot.expiry_date}T00:00:00`) < new Date(`${lot.expiry_date}T00:00:00`)) {
        setFefoLot(earlierLot)
      } else {
        setFefoLot(null)
      }
    }

    loadFefoWarning()
  }, [lot, movement.type])

  async function loadLot() {
    const [{ data: lotData }, { data: movementsData }] = await Promise.all([
      supabase.from('lots').select('*, clients(name, contact)').eq('id', id).eq('inventory_source', 'stock_independiente').single(),
      supabase
        .from('movements')
        .select('*, profiles(full_name)')
        .eq('lot_id', id)
        .order('created_at', { ascending: false }),
    ])
    setLot(lotData)
    setMovements(movementsData || [])
  }

  const stockQuantity = useMemo(() => {
    if (!lot) return 0
    if (['entrada', 'salida'].includes(movement.type) && Number(lot.package_size) > 0) {
      return Number(movement.package_count || 0)
    }

    return Number(movement.quantity || 0)
  }, [lot, movement])

  const calculatedPresentationQuantity = useMemo(() => {
    if (!lot || !['entrada', 'salida'].includes(movement.type)) return 0
    return Number(movement.package_count || 0) * Number(lot.package_size || 0)
  }, [lot, movement])

  const selectedIncident = getIncidentConfig(movement.incident_type)
  const repairQuantity = useMemo(() => {
    if (!lot || movement.type !== 'ajuste') return 0
    if (selectedIncident?.needsPhysicalCount) return Number(movement.physical_count || 0)
    return Number(lot.current_quantity || 0)
  }, [lot, movement.type, movement.physical_count, selectedIncident])

  const nextQuantity = useMemo(() => {
    const quantity = stockQuantity
    if (!lot) return 0
    if (movement.type === 'entrada') return Number(lot.current_quantity) + quantity
    if (movement.type === 'salida') return Number(lot.current_quantity) - quantity
    if (movement.type === 'ajuste') return repairQuantity
    return Number(lot.current_quantity)
  }, [lot, movement.type, stockQuantity, repairQuantity])

  const blocksSale = lot && ['retenido', 'cerrado'].includes(lot.status)
  const scannedAccess = Boolean(location.state?.scanned) || sessionStorage.getItem(`scanned-lot-${id}`) === '1'
  const movementMode = location.state?.movementMode || ''
  const canRegisterMovement = ['despacho', 'reparo', 'traslado'].includes(movementMode)
  const compactServiceView = canRegisterMovement && ['reparo', 'traslado'].includes(movementMode)
  const operatorQrConsultation = isOperator && !canRegisterMovement
  const adminLotConsultation = isAdmin && !canRegisterMovement
  const clientLotConsultation = !isAdmin && !isOperator && !canRegisterMovement
  const expiryDaysLeft = useMemo(() => {
    if (!lot?.expiry_date) return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const expiry = new Date(`${lot.expiry_date}T00:00:00`)
    return Math.ceil((expiry - today) / 86400000)
  }, [lot?.expiry_date])
  const isExpired = expiryDaysLeft !== null && expiryDaysLeft < 0
  const lotState = useMemo(() => getLotOperationalState(lot, expiryDaysLeft), [lot, expiryDaysLeft])
  const saleExpiryWarning = movement.type === 'salida' && expiryDaysLeft !== null && expiryDaysLeft <= 90
  const visibleLotCode = lot ? displayLotCode(lot.lot_code, lot) : ''
  const isLargeSale =
    movement.type === 'salida' &&
    Number(lot?.current_quantity || 0) > 0 &&
    stockQuantity >= Number(lot.current_quantity) * 0.5

  const currentEquivalent = lot ? Number(lot.current_quantity || 0) * Number(lot.package_size || 0) : 0
  const visibleMovements = showFullHistory ? movements : movements.slice(0, 3)
  const movementDraftKey = canRegisterMovement ? `todo-agricola-lot-movement-draft:${id}:${movementMode}` : ''

  useEffect(() => {
    if (!movementDraftKey) return
    const draft = readDraft(movementDraftKey, { movement: initialMovement })
    if (draft.movement) setMovement((value) => ({ ...value, ...draft.movement }))
  }, [movementDraftKey])

  useEffect(() => {
    if (!movementDraftKey) return
    writeDraft(movementDraftKey, { movement })
  }, [movementDraftKey, movement])

  async function handleSubmit(event) {
    event.preventDefault()
    if (!lot) return

    const quantity = movement.type === 'traslado' ? 0 : movement.type === 'ajuste' ? repairQuantity : Number(stockQuantity)
    if (movement.type === 'salida' && blocksSale) {
      setError('No se puede registrar salida porque este lote esta retenido o cerrado.')
      vibrateError()
      return
    }

    if (movement.type === 'salida' && isExpired) {
      setError('No se puede registrar salida porque este lote esta vencido.')
      vibrateError()
      return
    }

    if (movement.type === 'salida' && (!scannedAccess || movementMode !== 'despacho')) {
      setError('Para registrar salida debes entrar por Despacho.')
      vibrateError()
      return
    }

    if (movement.type === 'salida' && quantity > Number(lot.current_quantity)) {
      setError('No hay inventario suficiente.')
      vibrateError()
      return
    }

    if (movement.type === 'salida' && !movement.receiver_name.trim()) {
      setError('Escribe el nombre de la persona que recibe.')
      vibrateError()
      return
    }

    if (movement.type === 'salida' && !movement.receiver_document.trim()) {
      setError('Escribe el numero de documento de la persona que recibe.')
      vibrateError()
      return
    }

    if (quantity < 0 || (!['traslado', 'ajuste'].includes(movement.type) && quantity === 0)) {
      setError('La cantidad debe ser mayor a cero.')
      vibrateError()
      return
    }

    if (movement.type === 'traslado' && !movement.to_location) {
      setError('Selecciona la nueva ubicacion.')
      vibrateError()
      return
    }

    if (movement.type === 'ajuste' && !movement.incident_type) {
      setError('Selecciona que paso con el lote.')
      vibrateError()
      return
    }

    if (movement.type === 'ajuste' && selectedIncident?.needsAffected && Number(movement.affected_packages || 0) <= 0) {
      setError('Escribe cuantos envases estan afectados.')
      vibrateError()
      return
    }

    if (movement.type === 'ajuste' && selectedIncident?.needsPhysicalCount && movement.physical_count === '') {
      setError('Escribe la cantidad fisica contada.')
      vibrateError()
      return
    }

    if (movement.type === 'ajuste' && selectedIncident?.needsPhysicalCount && Number(movement.physical_count || 0) < 0) {
      setError('La cantidad fisica no puede ser negativa.')
      vibrateError()
      return
    }

    if (movement.type === 'ajuste' && !movement.notes.trim()) {
      setError('Escribe un motivo u observacion.')
      vibrateError()
      return
    }

    if (movement.type === 'ajuste' && !movementPhotoFile) {
      setError('La foto es obligatoria para reparaciones.')
      vibrateError()
      return
    }

    setError('')
    setPendingMovement({
      ...movement,
      quantity,
      calculatedQuantity: calculatedPresentationQuantity,
      previousQuantity: Number(lot.current_quantity),
      newQuantity: nextQuantity,
      fefoLot,
      isLargeSale,
    })
  }

  async function confirmMovement() {
    if (saving) return
    if (!pendingMovement || !lot) return

    const quantity = Number(pendingMovement.quantity)
    setSaving(true)
    setError('')
    setEmailStatus('')

    let photoUrl = ''
    if (movementPhotoFile) {
      try {
        photoUrl = await uploadMovementPhoto(lot.lot_code)
      } catch (photoError) {
        setError(photoError.message || 'No se pudo guardar la foto del movimiento.')
        vibrateError()
        setSaving(false)
        return
      }
    }

    const movementNotes = [
      pendingMovement.type === 'ajuste' && pendingMovement.incident_type ? `Incidencia: ${getIncidentConfig(pendingMovement.incident_type)?.label || pendingMovement.incident_type}` : null,
      pendingMovement.type === 'ajuste' && pendingMovement.affected_packages ? `Envases afectados: ${pendingMovement.affected_packages}` : null,
      pendingMovement.type === 'ajuste' && pendingMovement.physical_count !== '' ? `Cantidad fisica: ${pendingMovement.physical_count}` : null,
      pendingMovement.notes || null,
      pendingMovement.type === 'salida' && pendingMovement.to_location ? `Placa: ${pendingMovement.to_location}` : null,
      pendingMovement.receiver_name ? `Recibe: ${pendingMovement.receiver_name}` : null,
      pendingMovement.receiver_document ? `Documento: ${pendingMovement.receiver_document}` : null,
      photoUrl ? `Foto: ${photoUrl}` : null,
    ]
      .filter(Boolean)
      .join(' | ')

    const emailPayload = ['entrada', 'salida'].includes(pendingMovement.type)
      ? {
          to: 'hgarayd@outlook.com',
          movement_type: pendingMovement.type,
          quantity,
          previous_quantity: Number(lot.current_quantity),
          new_quantity: pendingMovement.newQuantity,
          to_location: pendingMovement.to_location || null,
          notes: pendingMovement.notes || null,
          receiver_name: pendingMovement.receiver_name || null,
          receiver_document: pendingMovement.receiver_document || null,
          vehicle_plate: pendingMovement.type === 'salida' ? pendingMovement.to_location || null : null,
          lot_code: visibleLotCode,
          product: cleanProductName(lot.product),
          client: lot.clients?.name || 'Sin cliente',
          location: lot.location,
          user_email: user.email,
        }
      : null

    const { error: rpcError } = await supabase.rpc('register_movement', {
      p_lot_id: lot.id,
      p_type: pendingMovement.type,
      p_quantity: quantity,
      p_to_location: pendingMovement.to_location || null,
      p_notes: movementNotes || null,
      p_user_id: user.id,
    })

    if (rpcError) {
      if (isNetworkMovementError(rpcError)) {
        queueMovement({
          lot_id: lot.id,
          type: pendingMovement.type,
          quantity,
          to_location: pendingMovement.to_location || null,
          notes: pendingMovement.type === 'salida' ? `[OFFLINE] [REQUIERE REVISION] ${movementNotes || ''}`.trim() : movementNotes || null,
          user_id: user.id,
          email: emailPayload,
        })
        setMovement(initialMovement)
        clearDraft(movementDraftKey)
        setMovementPhotoFile(null)
        setMovementPhotoPreview('')
        setPendingMovement(null)
        setEmailStatus('Sin señal: movimiento guardado en cola. Se sincronizara automaticamente al volver internet.')
        vibrateSuccess()
        if (['ajuste', 'traslado'].includes(pendingMovement.type) && canRegisterMovement) {
          setMovementSuccess({
            title: pendingMovement.type === 'traslado' ? 'Traslado guardado' : 'Reparacion guardada',
            text: pendingMovement.type === 'traslado' ? 'Quedo pendiente de revision al volver la senal.' : 'Quedo pendiente de revision al volver la senal.',
          })
        } else {
          setTimeout(() => navigate(isOperator ? '/operacion' : '/'), 1200)
        }
      } else if (rpcError.message.includes('inventario')) {
        setError('No hay inventario suficiente.')
        vibrateError()
      } else {
        setError(rpcError.message)
        vibrateError()
      }
    } else {
      if (['entrada', 'salida'].includes(pendingMovement.type)) {
        await notifyOfficeMovement(emailPayload)
      } else if (pendingMovement.type === 'ajuste') {
        setEmailStatus(isOperator ? 'Reparacion enviada para aprobacion del administrador.' : 'Reparacion aplicada.')
      } else if (pendingMovement.type === 'traslado') {
        setEmailStatus(isOperator ? 'Traslado enviado para aprobacion del administrador.' : 'Traslado aplicado.')
      } else {
        setEmailStatus('Movimiento guardado.')
      }
      setMovement(initialMovement)
      clearDraft(movementDraftKey)
      setMovementPhotoFile(null)
      setMovementPhotoPreview('')
      setPendingMovement(null)
      await loadLot()
      vibrateSuccess()
      if (['ajuste', 'traslado'].includes(pendingMovement.type) && canRegisterMovement) {
        setMovementSuccess({
          title: pendingMovement.type === 'traslado' ? 'Traslado guardado' : 'Reparacion guardada',
          text: isOperator
            ? `${pendingMovement.type === 'traslado' ? 'Traslado' : 'Reparacion'} enviada a aprobacion.`
            : `${pendingMovement.type === 'traslado' ? 'Traslado' : 'Reparacion'} aplicada.`,
        })
      } else if (canRegisterMovement) {
        setTimeout(() => navigate(isOperator ? '/operacion' : '/'), 900)
      }
    }

    setSaving(false)
  }

  async function selectMovementPhoto(file) {
    if (!file) return
    const compressed = await compressImageFile(file)
    setMovementPhotoFile(compressed)
    setMovementPhotoPreview(URL.createObjectURL(compressed))
  }

  async function uploadMovementPhoto(lotCode) {
    const extension = movementPhotoFile.name.split('.').pop() || 'jpg'
    const cleanCode = displayLotCode(lotCode).replace(/[^a-z0-9_-]/gi, '-')
    const path = `movimiento-${cleanCode}-${Date.now()}.${extension}`
    const { error: uploadError } = await supabase.storage.from('lot-photos').upload(path, movementPhotoFile, {
      cacheControl: '3600',
      upsert: false,
    })

    if (uploadError) throw uploadError

    const { data } = supabase.storage.from('lot-photos').getPublicUrl(path)
    return data.publicUrl
  }

  async function notifyOfficeMovement(payload) {
    if (!payload) return

    const { error: emailError } = await supabase.functions.invoke('send-movement-email', {
      body: payload,
    })

    setEmailStatus(
      emailError
        ? 'Movimiento guardado. Falta configurar el envio automatico de correo.'
        : 'Movimiento guardado y correo enviado a oficina.',
    )
  }

  async function saveQrImage() {
    if (!qrDataUrl || !lot) return

    try {
      const response = await fetch(qrDataUrl)
      const blob = await response.blob()
      const fileName = `${visibleLotCode || displayLotCode(lot.lot_code, lot)}-qr.png`
      const file = new File([blob], fileName, { type: 'image/png' })
      const isPhoneLike = window.matchMedia?.('(pointer: coarse)').matches

      if (isPhoneLike && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `QR ${visibleLotCode}`,
        })
        return
      }

      if (!isPhoneLike) {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = fileName
        link.click()
        URL.revokeObjectURL(url)
        return
      }
    } catch {
      // Si compartir no esta disponible, se abre la imagen como alternativa.
    }

    openQrImage()
  }

  function openQrImage() {
    if (!qrDataUrl) return
    const imageWindow = window.open('', '_blank')
    if (!imageWindow) return

    imageWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>QR ${lot.lot_code}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            body {
              margin: 0;
              min-height: 100vh;
              display: grid;
              place-items: center;
              background: #f6f7f3;
              font-family: Arial, sans-serif;
            }
            img {
              width: min(86vw, 420px);
              height: auto;
              background: white;
              padding: 16px;
              border-radius: 8px;
            }
            p {
              color: #334155;
              text-align: center;
              font-weight: 700;
            }
          </style>
        </head>
        <body>
          <main>
            <img src="${qrDataUrl}" alt="QR ${lot.lot_code}" />
            <p>${escapeHtml(visibleLotCode)}</p>
          </main>
        </body>
      </html>
    `)
    imageWindow.document.close()
  }

  function printQrLabels() {
    if (!qrDataUrl || !lot) return
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    const label = `
      <article class="label">
        <div class="brand">Todo Agricola</div>
        <img src="${qrDataUrl}" alt="QR ${escapeHtml(lot.lot_code)}" />
        <h2>${escapeHtml(visibleLotCode)}</h2>
        <small>Escanear para ver ficha</small>
      </article>
    `

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Etiquetas QR ${escapeHtml(lot.lot_code)}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            * {
              box-sizing: border-box;
            }
            body {
              margin: 0;
              background: #fff;
              color: #0f172a;
              font-family: Arial, sans-serif;
            }
            .sheet {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 12mm;
              min-height: 100vh;
              padding: 12mm;
            }
            .label {
              align-items: center;
              border: 2px solid #0f172a;
              border-radius: 8px;
              display: flex;
              flex-direction: column;
              justify-content: center;
              min-height: 120mm;
              padding: 10mm;
              text-align: center;
            }
            .brand {
              color: #000;
              font-size: 14px;
              font-weight: 800;
              margin-bottom: 3mm;
              text-transform: uppercase;
            }
            img {
              height: 72mm;
              image-rendering: pixelated;
              width: 72mm;
            }
            h2 {
              font-size: 16px;
              font-weight: 700;
              margin: 4mm 0 1mm;
            }
            small {
              color: #334155;
              display: block;
              font-size: 11px;
              font-weight: 700;
              margin-top: 1mm;
            }
            @media print {
              @page {
                margin: 0;
                size: A4;
              }
              body {
                print-color-adjust: exact;
                -webkit-print-color-adjust: exact;
              }
            }
          </style>
        </head>
        <body>
          <main class="sheet">
            ${label}
            ${label}
            ${label}
            ${label}
          </main>
          <script>
            window.addEventListener('load', () => {
              window.print()
            })
          </script>
        </body>
      </html>
    `)
    printWindow.document.close()
  }

  if (!lot) return <div className="p-6 text-center text-slate-600">Cargando lote...</div>

  if (operatorQrConsultation) {
    return (
      <div>
        <LotStateNotice state={lotState} saleBlocked={blocksSale || isExpired} />

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-soft">
          <div className="bg-campo-800 px-4 py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-campo-300">
                  {lot.package_size ? `Presentación · ${formatNumber(lot.package_size)} ${lot.package_unit || ''}` : 'Sin presentación'}
                </p>
                <h2 className="mt-1 text-xl font-black leading-tight text-white [overflow-wrap:anywhere]">
                  {cleanProductName(lot.product)}
                </h2>
                <p className="mt-1 font-mono text-xs font-bold text-campo-300">{visibleLotCode}</p>
              </div>
              <div className="shrink-0"><LotStateBadge state={lotState} /></div>
            </div>
          </div>

          <div className="p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase text-slate-500">Envases disponibles</p>
                <p className="mt-1 text-4xl font-black text-slate-950">{formatNumber(lot.current_quantity)}</p>
              </div>
              <div className="rounded-lg bg-campo-50 p-4">
                <p className="text-xs font-bold uppercase text-campo-700">Equivalente actual</p>
                <p className="mt-1 text-3xl font-black text-campo-800">
                  {Number(lot.package_size) > 0 ? `${formatNumber(currentEquivalent)} ${lot.package_unit || ''}` : 'Sin dato'}
                </p>
              </div>
            </div>

            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <ConsultInfo label="Cliente" value={lot.clients?.name || '-'} strong />
              <ConsultInfo label="Ubicacion" value={lot.location || '-'} />
              <ConsultInfo label="Vencimiento" value={lot.expiry_date ? formatDate(lot.expiry_date) : 'Sin dato'} />
              <ConsultInfo label="Fecha ingreso" value={lot.entry_date ? formatDate(lot.entry_date) : 'Sin dato'} />
            </div>
            <button className="btn-secondary mt-4 w-full" type="button" onClick={() => setShowIssueReport(true)}>
              Reportar problema
            </button>
          </div>
        </section>
        {showIssueReport ? <OperationalIssueModal lot={lot} userId={user.id} onClose={() => setShowIssueReport(false)} /> : null}
      </div>
    )
  }

  if (adminLotConsultation) {
    return (
      <div>
        <LotStateNotice state={lotState} saleBlocked={blocksSale || isExpired} />

        <section className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-soft">
            <div className="bg-campo-800 px-4 py-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-campo-300">
                    {lot.package_size ? `Presentación · ${formatNumber(lot.package_size)} ${lot.package_unit || ''}` : 'Sin presentación'}
                  </p>
                  <h2 className="mt-1 text-xl font-black leading-tight text-white [overflow-wrap:anywhere]">
                    {cleanProductName(lot.product)}
                  </h2>
                  <p className="mt-1 font-mono text-xs font-bold text-campo-300">{visibleLotCode}</p>
                </div>
                <div className="shrink-0"><LotStateBadge state={lotState} /></div>
              </div>
            </div>

            <div className="p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase text-slate-500">Envases disponibles</p>
                  <p className="mt-1 text-4xl font-black text-slate-950">{formatNumber(lot.current_quantity)}</p>
                </div>
                <div className="rounded-lg bg-campo-50 p-4">
                  <p className="text-xs font-bold uppercase text-campo-700">Equivalente actual</p>
                  <p className="mt-1 text-3xl font-black text-campo-800">
                    {Number(lot.package_size) > 0 ? `${formatNumber(currentEquivalent)} ${lot.package_unit || ''}` : 'Sin dato'}
                  </p>
                </div>
              </div>

              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <ConsultInfo label="Cliente" value={lot.clients?.name || '-'} strong />
                <ConsultInfo label="Ubicacion" value={lot.location || '-'} />
                <ConsultInfo label="Vencimiento" value={lot.expiry_date ? formatDate(lot.expiry_date) : 'Sin dato'} />
                <ConsultInfo label="Fecha ingreso" value={lot.entry_date ? formatDate(lot.entry_date) : 'Sin dato'} />
              </div>
            </div>
          </div>

          <div className="panel text-center">
            <div className="mb-3 flex items-center justify-center gap-2">
              <QrCode className="text-campo-700" />
              <h3 className="font-bold text-slate-900">QR del lote</h3>
            </div>
            {qrDataUrl ? (
              <button className="mx-auto block" type="button" onClick={openQrImage} title="Abrir QR">
                <img src={qrDataUrl} alt={`QR ${lot.lot_code}`} className="h-56 w-56" />
              </button>
            ) : null}
            {qrDataUrl ? (
              <div className="mt-3 grid gap-2">
                <button className="btn-primary w-full" type="button" onClick={printQrLabels}>
                  <Printer size={20} /> QR Pallets
                </button>
                <button className="btn-secondary w-full" type="button" onClick={saveQrImage}>
                  <Download size={20} /> Descargar QR
                </button>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    )
  }

  if (clientLotConsultation) {
    return (
      <div className="px-4 py-4 sm:px-6">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="btn-secondary mb-4 !min-h-10 !px-3 !py-2 text-sm"
        >
          <ArrowLeft size={18} /> Volver
        </button>

        <LotStateNotice state={lotState} saleBlocked={blocksSale || isExpired} />

        <div className="mx-auto max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {/* Campo header inside card */}
          <div className="bg-campo-800 px-5 py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-campo-300">
                  {lot.package_size ? `Presentación · ${formatNumber(lot.package_size)} ${lot.package_unit || ''}` : 'Sin presentación'}
                </p>
                <h2 className="mt-1 text-xl font-black leading-tight text-white [overflow-wrap:anywhere]">
                  {cleanProductName(lot.product)}
                </h2>
                <p className="mt-1 font-mono text-xs font-bold text-campo-300">{visibleLotCode}</p>
              </div>
              <div className="shrink-0"><LotStateBadge state={lotState} /></div>
            </div>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-2 divide-x divide-slate-100 border-b border-slate-100">
            <div className="px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Envases</p>
              <p className="mt-1 text-3xl font-black text-slate-900">{formatNumber(lot.current_quantity)}</p>
            </div>
            <div className="px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Equivalente</p>
              <p className="mt-1 text-3xl font-black text-campo-700">
                {Number(lot.package_size) > 0 ? `${formatNumber(currentEquivalent)} ${lot.package_unit || ''}` : '—'}
              </p>
            </div>
          </div>

          {/* Detail rows */}
          <div className="divide-y divide-slate-100 px-5">
            <LotRow label="Ubicación" value={lot.location || '—'} />
            <LotRow label="Vencimiento" value={(() => {
              if (!lot.expiry_date) return '—'
              if (expiryDaysLeft < 0) return <span className="font-bold text-red-600">Venció hace {Math.abs(expiryDaysLeft)} días</span>
              if (expiryDaysLeft === 0) return <span className="font-bold text-red-600">Vence hoy</span>
              if (expiryDaysLeft <= 30) return <span className="font-bold text-amber-600">Vence en {expiryDaysLeft} días</span>
              return `${formatDate(lot.expiry_date)} · en ${expiryDaysLeft} días`
            })()} />
            <LotRow label="Ingreso" value={lot.entry_date ? formatDate(lot.entry_date) : '—'} />
          </div>

          {/* Recent movements */}
          <div className="border-t border-slate-100 px-5 pb-5 pt-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Últimos movimientos</p>
              {movements.length > 3 && (
                <button
                  type="button"
                  className="text-xs font-bold text-campo-700 hover:text-campo-900"
                  onClick={() => setShowFullHistory(v => !v)}
                >
                  {showFullHistory ? 'Ver menos' : `Ver todos (${movements.length})`}
                </button>
              )}
            </div>
            {movements.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center">
                <p className="text-sm font-semibold text-slate-400">Sin movimientos registrados</p>
              </div>
            ) : (
              <div className="space-y-2">
                {(showFullHistory ? movements : movements.slice(0, 3)).map(item => (
                  <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{movementLabel(item.type)}</p>
                      <p className="text-xs font-semibold text-slate-400">{formatDate(item.created_at)}</p>
                    </div>
                    <p className={`text-base font-black ${item.type === 'salida' ? 'text-red-600' : 'text-campo-700'}`}>
                      {item.type === 'salida' ? '−' : '+'}{formatNumber(item.quantity)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={cleanProductName(lot.product)}
        subtitle={
          <span>
            <strong className="font-black text-slate-700">{lot.clients?.name || 'Cliente sin nombre'}</strong>
            <span className="block text-xs font-semibold text-slate-500">{visibleLotCode}</span>
          </span>
        }
      />

      {isOperator && canRegisterMovement ? (
        <div className="mb-4 rounded-lg bg-campo-50 p-4 text-sm font-bold text-campo-700">
          Modo operario: registra el movimiento y confirma antes de guardar.
        </div>
      ) : null}

      <LotStateNotice state={lotState} saleBlocked={blocksSale || isExpired} />

      {isOperator ? (
        <button className="btn-secondary mb-4 w-full sm:w-auto" type="button" onClick={() => setShowIssueReport(true)}>
          Reportar problema
        </button>
      ) : null}

      {compactServiceView ? (
        <section className="panel mb-4 border-orange-200 bg-white/95">
          <p className="mb-2 text-xs font-bold uppercase text-orange-700">
            Lote para {movementMode === 'traslado' ? 'traslado' : 'reparacion'}
          </p>
          <ListProductCard
            title={cleanProductName(lot.product)}
            envases={lot.current_quantity}
            equivalent={Number(lot.package_size) > 0 ? currentEquivalent : null}
            equivalentUnit={lot.package_unit}
            presentation={lot.package_size ? `${formatNumber(lot.package_size)} ${lot.package_unit || ''}` : 'Sin dato'}
            secondary={`${visibleLotCode} - ${lot.location || '-'}`}
            detailTitle={movementMode === 'traslado' ? 'Producto para traslado' : 'Producto para reparacion'}
            detailRows={[
              { label: 'Cliente', value: lot.clients?.name || '-' },
              { label: 'Codigo', value: productCodeLabel(lot) || '-' },
              { label: 'Lote', value: visibleLotCode },
              { label: 'Disponible', value: `${formatNumber(lot.current_quantity)} env.` },
              { label: 'Equivalente', value: Number(lot.package_size) > 0 ? `${formatNumber(currentEquivalent)} ${lot.package_unit || ''}` : 'Sin dato' },
              { label: 'Presentacion', value: lot.package_size ? `${formatNumber(lot.package_size)} ${lot.package_unit || ''}` : 'Sin dato' },
              { label: 'Ubicacion', value: lot.location || '-' },
              { label: 'Vencimiento', value: lot.expiry_date ? formatDate(lot.expiry_date) : 'Sin dato' },
              { label: 'Estado', value: lot.status || '-' },
            ]}
          />
        </section>
      ) : (
      <section className="panel mb-4 border-campo-200 bg-white/95">
        <div className="grid gap-3 sm:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-400">Lectura rapida</p>
            <h2 className="mt-1 text-2xl font-black leading-tight text-slate-950">{cleanProductName(lot.product)}</h2>
            <p className="mt-1 text-sm font-bold text-slate-500">{visibleLotCode}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase text-slate-500">Disponible</p>
            <p className="mt-1 text-3xl font-black text-slate-950">{formatNumber(lot.current_quantity)}</p>
            <p className="text-sm font-bold text-slate-500">envases</p>
          </div>
          <div className="rounded-lg bg-campo-50 p-3">
            <p className="text-xs font-semibold uppercase text-campo-700">Equivalente actual</p>
            <p className="mt-1 text-2xl font-black text-campo-800">
              {Number(lot.package_size) > 0 ? `${formatNumber(currentEquivalent)} ${lot.package_unit || ''}` : 'Sin dato'}
            </p>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-sm font-bold text-slate-700 sm:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-3">Ubicacion: {lot.location || '-'}</div>
          <div className="rounded-lg bg-slate-50 p-3">Vence: {lot.expiry_date ? formatDate(lot.expiry_date) : 'Sin dato'}</div>
          <div className={`rounded-lg p-3 ${lotState.panel}`}>Estado: {lotState.label}</div>
        </div>
      </section>
      )}

      {!compactServiceView ? (
      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="panel">
          {lot.photo_url ? <img className="mb-4 h-48 w-full rounded-lg object-cover" src={lot.photo_url} alt={cleanProductName(lot.product)} /> : null}
          <h3 className="mb-3 text-base font-black text-slate-950">Datos del lote</h3>
          <div className="grid grid-cols-2 gap-3">
            <Info label="Cliente" value={lot.clients?.name} strong />
            <Info label="Contacto" value={lot.clients?.contact || '-'} />
            <Info
              label="Presentacion"
              value={lot.package_size ? `${formatNumber(lot.package_size)} ${lot.package_unit || ''}` : 'Sin dato'}
            />
            <Info label="Fecha ingreso" value={formatDate(lot.entry_date)} />
          </div>
        </div>

        {isAdmin ? (
          <div className="panel text-center">
          <div className="mb-3 flex items-center justify-center gap-2">
            <QrCode className="text-campo-700" />
            <h3 className="font-bold text-slate-900">QR del lote</h3>
          </div>
          {qrDataUrl ? (
            <button className="mx-auto block" type="button" onClick={openQrImage} title="Abrir QR">
              <img src={qrDataUrl} alt={`QR ${lot.lot_code}`} className="h-56 w-56" />
            </button>
          ) : null}
          {qrDataUrl ? (
            <div className="mt-3 grid gap-2">
              <button className="btn-primary w-full" type="button" onClick={printQrLabels}>
                <Printer size={20} /> QR Pallets
              </button>
              <button className="btn-secondary w-full" type="button" onClick={saveQrImage}>
                <Download size={20} /> Descargar QR
              </button>
            </div>
          ) : null}
          </div>
        ) : null}
      </section>
      ) : null}

      {canRegisterMovement ? (
      <form className="panel mt-4 space-y-3" onSubmit={handleSubmit}>
        <h3 className="text-lg font-bold text-slate-950">Registrar movimiento</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase text-slate-500">Tipo</p>
            <p className="mt-1 text-lg font-black text-slate-950">{movementLabel(movement.type)}</p>
          </div>
          {['entrada', 'salida'].includes(movement.type) && Number(lot.package_size) > 0 ? (
            <>
              <label>
                <span className="label">Cantidad de envases</span>
                <input
                  className="input mt-1"
                  type="text"
                  inputMode="decimal"
                  value={movement.package_count}
                  onChange={(event) => {
                    const value = event.target.value.replace(',', '.')
                    if (/^\d*\.?\d*$/.test(value)) setMovement({ ...movement, package_count: value })
                  }}
                  onWheel={(event) => event.currentTarget.blur()}
                  required
                />
              </label>
              <div>
                <span className="label">Cantidad calculada</span>
                <div className="mt-1 flex min-h-12 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-base font-bold text-slate-950">
                  {formatNumber(calculatedPresentationQuantity)} {lot.package_unit || ''}
                </div>
              </div>
            </>
          ) : movement.type === 'ajuste' ? (
            <>
              <label className="sm:col-span-2">
                <span className="label">¿Que paso?</span>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {incidentTypes.map((incident) => (
                    <button
                      key={incident.value}
                      className={`min-h-12 rounded-lg border px-3 py-2 text-sm font-bold ${
                        movement.incident_type === incident.value
                          ? 'border-orange-500 bg-orange-50 text-orange-800'
                          : 'border-slate-200 bg-white text-slate-700'
                      }`}
                      type="button"
                      onClick={() => setMovement({ ...movement, incident_type: incident.value, affected_packages: '', physical_count: '' })}
                    >
                      {incident.label}
                    </button>
                  ))}
                </div>
              </label>
              {selectedIncident?.needsAffected ? (
                <label>
                  <span className="label">Envases afectados</span>
                  <input
                    className="input mt-1"
                    type="text"
                    inputMode="decimal"
                    value={movement.affected_packages}
                    onChange={(event) => {
                      const value = event.target.value.replace(',', '.')
                      if (/^\d*\.?\d*$/.test(value)) setMovement({ ...movement, affected_packages: value })
                    }}
                    onWheel={(event) => event.currentTarget.blur()}
                    required
                  />
                </label>
              ) : null}
              {selectedIncident?.needsPhysicalCount ? (
                <label>
                  <span className="label">Cantidad fisica contada</span>
                  <input
                    className="input mt-1"
                    type="text"
                    inputMode="decimal"
                    value={movement.physical_count}
                    onChange={(event) => {
                      const value = event.target.value.replace(',', '.')
                      if (/^\d*\.?\d*$/.test(value)) setMovement({ ...movement, physical_count: value })
                    }}
                    onWheel={(event) => event.currentTarget.blur()}
                    required
                  />
                </label>
              ) : null}
              <div className="rounded-lg bg-orange-50 p-3 text-sm font-bold text-orange-800 sm:col-span-2">
                Se enviara a revision del administrador. El operador solo reporta la incidencia.
              </div>
            </>
          ) : movement.type !== 'traslado' ? (
            <label>
              <span className="label">{movement.type === 'ajuste' ? 'Nueva cantidad' : 'Cantidad'}</span>
              <input
                className="input mt-1"
                type="text"
                inputMode="decimal"
                value={movement.quantity}
                onChange={(event) => {
                  const value = event.target.value.replace(',', '.')
                  if (/^\d*\.?\d*$/.test(value)) setMovement({ ...movement, quantity: value })
                }}
                onWheel={(event) => event.currentTarget.blur()}
                required
              />
            </label>
          ) : (
            <div className="rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-600">
              El traslado solo cambia la ubicacion. El stock no cambia.
            </div>
          )}
          {movement.type === 'traslado' ? (
            <label className="sm:col-span-2">
              <span className="label">Nueva ubicación</span>
              <select className="input mt-1" value={movement.to_location} onChange={(event) => setMovement({ ...movement, to_location: event.target.value })} required>
                <option value="">Seleccionar ubicacion</option>
                {internalLocations.map((locationName) => (
                  <option key={locationName} value={locationName}>{locationName}</option>
                ))}
              </select>
            </label>
          ) : null}
          {movement.type === 'salida' ? (
            <>
              <label className="sm:col-span-2">
                <span className="label">Placa del vehiculo</span>
                <input className="input mt-1 uppercase" value={movement.to_location} onChange={(event) => setMovement({ ...movement, to_location: event.target.value.toUpperCase() })} placeholder="Opcional" />
              </label>
              <label>
                <span className="label">Nombre del que recibe</span>
                <input className="input mt-1" value={movement.receiver_name} onChange={(event) => setMovement({ ...movement, receiver_name: event.target.value })} required />
              </label>
              <label>
                <span className="label">Numero de documento</span>
                <input className="input mt-1" value={movement.receiver_document} onChange={(event) => setMovement({ ...movement, receiver_document: event.target.value })} required />
              </label>
            </>
          ) : null}
          {['ajuste', 'traslado'].includes(movement.type) ? (
            <label className="block sm:col-span-2">
              <span className="label">{movement.type === 'ajuste' ? 'Foto obligatoria' : 'Foto opcional'}</span>
              <div className="mt-1 grid gap-3">
                {movementPhotoPreview ? (
                  <img className="h-44 w-full rounded-lg object-cover" src={movementPhotoPreview} alt="Movimiento" />
                ) : null}
                <input className="hidden" id="movement-photo" type="file" accept="image/*" capture="environment" onChange={(event) => selectMovementPhoto(event.target.files?.[0])} />
                <label className="btn-secondary w-full cursor-pointer" htmlFor="movement-photo">
                  <Camera size={20} /> Tomar o elegir foto
                </label>
              </div>
            </label>
          ) : null}
          <label className="sm:col-span-2">
            <span className="label">Observaciones</span>
            <textarea className="input mt-1" rows="3" value={movement.notes} onChange={(event) => setMovement({ ...movement, notes: event.target.value })} />
          </label>
        </div>

        {movement.type === 'ajuste' ? (
          <div className="rounded-lg bg-orange-50 p-3 text-sm font-semibold text-orange-800">
            <div className="flex justify-between gap-3">
              <span>Stock actual</span>
              <span>{formatNumber(lot.current_quantity)} envases</span>
            </div>
            {selectedIncident?.needsPhysicalCount ? (
              <div className="mt-1 flex justify-between gap-3">
                <span>Stock propuesto</span>
                <span>{formatNumber(nextQuantity)} envases</span>
              </div>
            ) : (
              <p className="mt-1">No cambia stock automaticamente hasta revision administrativa.</p>
            )}
          </div>
        ) : (
        <div className="rounded-lg bg-campo-50 p-3 text-sm font-semibold text-campo-700">
          <div className="flex justify-between gap-3">
            <span>Stock despues</span>
            <span>{formatNumber(nextQuantity)} envases</span>
          </div>
          {Number(lot.package_size) > 0 ? (
            <div className="mt-1 flex justify-between gap-3 text-campo-800">
              <span>Equivalente despues</span>
              <span>{formatNumber(nextQuantity * Number(lot.package_size))} {lot.package_unit || ''}</span>
            </div>
          ) : null}
        </div>
        )}
        {isLargeSale ? (
          <div className="rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-800">
            Advertencia: esta salida representa 50% o mas del stock disponible.
          </div>
        ) : null}
        {saleExpiryWarning && !isExpired ? (
          <div className="rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-800">
            Advertencia: este lote vence {expiryDaysLeft === 0 ? 'hoy' : `en ${expiryDaysLeft} dias`}. Verifica antes de despachar.
          </div>
        ) : null}
        {movement.type === 'salida' && fefoLot ? (
          <div className="rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-800">
            FEFO: existe un lote que vence antes ({displayLotCode(fefoLot.lot_code, fefoLot)}, vence {formatDate(fefoLot.expiry_date)}, {formatNumber(fefoLot.current_quantity)} envases en {fefoLot.location}). Es una advertencia para considerar, no bloquea la salida.
          </div>
        ) : null}
        {movement.type === 'salida' && movementMode !== 'despacho' ? (
          <div className="rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">
            Salida bloqueada: entra por Despacho para confirmar que estas frente al lote correcto.
          </div>
        ) : null}
        {error ? <div className="rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}
        {emailStatus ? <div className="rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">{emailStatus}</div> : null}

        <button className="btn-primary w-full" disabled={saving}>
          <Save size={20} /> Revisar y confirmar
        </button>
      </form>
      ) : (
        <div className="panel mt-4 rounded-lg bg-slate-50 p-4 text-sm font-bold text-slate-600">
          Scan solo muestra la ficha del producto. Para registrar movimientos usa Nuevo ingreso, Despacho o Reparacion / Traslado.
        </div>
      )}

      {pendingMovement ? (
        <div data-modal-backdrop="true" className="fixed inset-0 z-40 flex items-end overflow-y-auto bg-slate-950/45 p-3 sm:items-center sm:justify-center">
          <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="shrink-0 border-b border-slate-100 p-4">
              <h3 className="text-xl font-bold text-slate-950">Confirmar movimiento</h3>
              <p className="mt-2 text-sm font-semibold text-slate-500">
                {pendingMovement.type === 'ajuste'
                  ? `Vas a enviar ${getIncidentConfig(pendingMovement.incident_type)?.label || 'reparacion'} a revision.`
                  : `Vas a registrar ${movementLabel(pendingMovement.type).toLowerCase()} de ${formatNumber(pendingMovement.quantity)} envases.`}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">

            <div className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-700">
              <div className="rounded-lg bg-white p-2">
                <p className="font-black leading-snug text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(lot.product)}</p>
                <p className="text-xs font-semibold text-slate-500">Cliente: {lot.clients?.name || '-'}</p>
                <p className="text-xs font-semibold text-slate-500">{visibleLotCode}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-white p-2">
                  <span className="block text-xs uppercase text-slate-400">Cantidad</span>
                  <span className="text-slate-950">{formatNumber(pendingMovement.quantity)} env.</span>
                </div>
                <div className={`rounded-lg p-2 ${lotState.panel}`}>
                  <span className="block text-xs uppercase opacity-70">Estado</span>
                  <span>{lotState.label}</span>
                </div>
              </div>
              {pendingMovement.type === 'ajuste' && pendingMovement.affected_packages ? (
                <div className="flex justify-between gap-3">
                  <span>Envases afectados</span>
                  <span>{formatNumber(pendingMovement.affected_packages)}</span>
                </div>
              ) : null}
              <div className="flex justify-between gap-3">
                <span>Stock actual</span>
                <span>{formatNumber(pendingMovement.previousQuantity)} envases</span>
              </div>
              {pendingMovement.type !== 'ajuste' || getIncidentConfig(pendingMovement.incident_type)?.needsPhysicalCount ? (
                <div className="flex justify-between gap-3">
                  <span>{pendingMovement.type === 'ajuste' ? 'Stock propuesto' : 'Stock despues'}</span>
                  <span>{formatNumber(pendingMovement.newQuantity)} envases</span>
                </div>
              ) : null}
              {pendingMovement.calculatedQuantity ? (
                <div className="flex justify-between gap-3">
                  <span>Equivalente actual</span>
                  <span>{formatNumber(pendingMovement.previousQuantity * Number(lot.package_size || 0))} {lot.package_unit || ''}</span>
                </div>
              ) : null}
              {Number(lot.package_size) > 0 ? (
                <div className="flex justify-between gap-3">
                  <span>Equivalente despues</span>
                  <span>{formatNumber(pendingMovement.newQuantity * Number(lot.package_size))} {lot.package_unit || ''}</span>
                </div>
              ) : null}
              {pendingMovement.to_location ? (
                <div className="flex justify-between gap-3">
                  <span>{pendingMovement.type === 'salida' ? 'Placa' : 'Nueva ubicacion'}</span>
                  <span>{pendingMovement.to_location}</span>
                </div>
              ) : null}
              {pendingMovement.receiver_name ? (
                <div className="flex justify-between gap-3">
                  <span>Recibe</span>
                  <span>{pendingMovement.receiver_name}</span>
                </div>
              ) : null}
              {pendingMovement.receiver_document ? (
                <div className="flex justify-between gap-3">
                  <span>Documento</span>
                  <span>{pendingMovement.receiver_document}</span>
                </div>
              ) : null}
            </div>

            {pendingMovement.isLargeSale ? (
              <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-800">
                Esta salida es grande. Revisa antes de confirmar.
              </div>
            ) : null}
            {pendingMovement.fefoLot ? (
              <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-800">
                FEFO advierte que hay un lote con vencimiento anterior.
              </div>
            ) : null}
            <ConfirmChecks checks={confirmChecks} onChange={setConfirmChecks} />
            </div>

            <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-slate-100 bg-white p-4">
              <button className="btn-secondary w-full" type="button" onClick={() => setPendingMovement(null)} disabled={saving}>
                Cancelar
              </button>
              <button className="btn-primary w-full" type="button" onClick={confirmMovement} disabled={saving || !allConfirmChecksDone(confirmChecks)}>
                {saving ? 'Guardando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {movementSuccess ? (
        <div data-modal-backdrop="true" className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-campo-700 p-6 text-white">
          <section className="w-full max-w-sm py-8 text-center">
            <span className="mx-auto flex h-40 w-40 items-center justify-center rounded-full border border-white/25 text-white">
              <CheckCircle2 size={118} strokeWidth={1.8} />
            </span>
            <h2 className="mt-5 text-3xl font-black">{movementSuccess.title}</h2>
            <p className="mt-2 text-base font-semibold text-campo-50">{movementSuccess.text}</p>
            <button className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-white/20 bg-white/10 px-4 py-3 font-black text-white transition active:scale-[0.99]" type="button" onClick={() => navigate(isOperator ? '/operacion' : '/')}>
              Volver a operar
            </button>
          </section>
        </div>
      ) : null}

      <section className="mt-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-950">{showFullHistory ? 'Historial completo' : 'Historial corto del lote'}</h3>
          {movements.length > 3 ? (
            <button className="text-sm font-bold text-campo-700" type="button" onClick={() => setShowFullHistory((value) => !value)}>
              {showFullHistory ? 'Ver menos' : 'Ver historial completo'}
            </button>
          ) : null}
        </div>
        <div className="space-y-3">
          {visibleMovements.map((item) => (
            <article key={item.id} className="panel">
              <div className="flex justify-between gap-3">
                <div>
                <p className="font-bold text-slate-900">{movementLabel(item.type)}</p>
                <p className="text-sm text-slate-500">{formatDate(item.created_at)}</p>
                {item.approval_status === 'pendiente' ? (
                  <p className="mt-1 inline-flex rounded-full bg-orange-50 px-2 py-1 text-xs font-bold text-orange-700">Pendiente de aprobacion</p>
                ) : null}
                {item.approval_status === 'rechazado' ? (
                  <p className="mt-1 inline-flex rounded-full bg-red-50 px-2 py-1 text-xs font-bold text-red-700">Rechazado</p>
                ) : null}
                </div>
                <p className="text-xl font-bold text-campo-700">{formatNumber(item.quantity)}</p>
              </div>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <p className="rounded-lg bg-slate-50 p-2 font-semibold text-slate-600">Usuario: {item.profiles?.full_name || 'Usuario'}</p>
                <p className="rounded-lg bg-slate-50 p-2 font-semibold text-slate-600">Stock anterior: {formatNumber(item.previous_quantity)} envases</p>
                <p className="rounded-lg bg-slate-50 p-2 font-semibold text-slate-600">Stock nuevo: {formatNumber(item.new_quantity)} envases</p>
                {item.to_location ? (
                  <p className="rounded-lg bg-slate-50 p-2 font-semibold text-slate-600">Nueva ubicacion: {item.to_location}</p>
                ) : null}
              </div>
              {Number(lot.package_size) > 0 ? (
                <p className="mt-1 text-sm font-semibold text-slate-600">
                  Equivalente nuevo: {formatNumber(Number(item.new_quantity || 0) * Number(lot.package_size))} {lot.package_unit || ''}
                </p>
              ) : null}
              {item.notes ? <p className="mt-1 text-sm text-slate-600">{item.notes}</p> : null}
            </article>
          ))}
        </div>
      </section>
      {showIssueReport ? <OperationalIssueModal lot={lot} userId={user.id} onClose={() => setShowIssueReport(false)} /> : null}
    </div>
  )
}

function Info({ label, value, strong }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase text-slate-400">{label}</p>
      <p className={`${strong ? 'text-2xl' : 'text-base'} mt-1 font-bold text-slate-950`}>{value}</p>
    </div>
  )
}

function ConsultInfo({ label, value, strong }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-[11px] font-bold uppercase text-slate-400">{label}</p>
      <p className={`${strong ? 'font-black text-slate-950' : 'font-bold text-slate-700'} mt-1 [overflow-wrap:anywhere]`}>{value}</p>
    </div>
  )
}

function LotRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="shrink-0 text-xs font-semibold text-slate-400">{label}</span>
      <span className="text-right text-sm font-bold text-slate-700 [overflow-wrap:anywhere]">{value}</span>
    </div>
  )
}
