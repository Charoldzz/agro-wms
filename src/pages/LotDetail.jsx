import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Camera, Download, Printer, QrCode, Save } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../hooks/useAuth.jsx'
import { formatDate, formatNumber, movementLabel } from '../lib/format'
import { createLotQrDataUrl } from '../lib/qr'
import { supabase } from '../lib/supabase'
import { cleanProductName, displayLotCode } from '../lib/display'
import { isNetworkMovementError, queueMovement } from '../lib/offlineQueue'
import { compressImageFile } from '../lib/image'

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

const internalLocations = ['Nave 1', 'Nave 2', 'Nave 3', 'Playa']
const incidentTypes = [
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
    const mode = location.state?.movementMode || sessionStorage.getItem(`lot-mode-${id}`)
    if (mode === 'despacho') {
      setMovement((value) => ({ ...value, type: 'salida' }))
    } else if (mode === 'reparo') {
      setMovement((value) => ({ ...value, type: 'ajuste' }))
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
        .select('id, lot_code, expiry_date, current_quantity, location')
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
      supabase.from('lots').select('*, clients(name, contact)').eq('id', id).single(),
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

  const statusWarning = lot && lot.status !== 'activo'
  const blocksSale = lot && ['retenido', 'cerrado'].includes(lot.status)
  const scannedAccess = Boolean(location.state?.scanned) || sessionStorage.getItem(`scanned-lot-${id}`) === '1'
  const movementMode = location.state?.movementMode || sessionStorage.getItem(`lot-mode-${id}`) || ''
  const canRegisterMovement = ['despacho', 'reparo', 'traslado'].includes(movementMode)
  const expiryDaysLeft = useMemo(() => {
    if (!lot?.expiry_date) return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const expiry = new Date(`${lot.expiry_date}T00:00:00`)
    return Math.ceil((expiry - today) / 86400000)
  }, [lot?.expiry_date])
  const isExpired = expiryDaysLeft !== null && expiryDaysLeft < 0
  const saleExpiryWarning = movement.type === 'salida' && expiryDaysLeft !== null && expiryDaysLeft <= 90
  const isLargeSale =
    movement.type === 'salida' &&
    Number(lot?.current_quantity || 0) > 0 &&
    stockQuantity >= Number(lot.current_quantity) * 0.5

  const currentEquivalent = lot ? Number(lot.current_quantity || 0) * Number(lot.package_size || 0) : 0
  const visibleMovements = showFullHistory ? movements : movements.slice(0, 3)

  async function handleSubmit(event) {
    event.preventDefault()
    if (!lot) return

    const quantity = movement.type === 'traslado' ? 0 : movement.type === 'ajuste' ? repairQuantity : Number(stockQuantity)
    if (movement.type === 'salida' && blocksSale) {
      setError('No se puede registrar salida porque este lote esta retenido o cerrado.')
      return
    }

    if (movement.type === 'salida' && isExpired) {
      setError('No se puede registrar salida porque este lote esta vencido.')
      return
    }

    if (movement.type === 'salida' && (!scannedAccess || movementMode !== 'despacho')) {
      setError('Para registrar salida debes entrar por Despacho.')
      return
    }

    if (movement.type === 'salida' && quantity > Number(lot.current_quantity)) {
      setError('No hay inventario suficiente.')
      return
    }

    if (movement.type === 'salida' && fefoLot) {
      setError(`FEFO bloquea esta salida. Primero revisa ${displayLotCode(fefoLot.lot_code)}, que vence antes.`)
      return
    }

    if (movement.type === 'salida' && !movement.receiver_name.trim()) {
      setError('Escribe el nombre de la persona que recibe.')
      return
    }

    if (movement.type === 'salida' && !movement.receiver_document.trim()) {
      setError('Escribe el numero de documento de la persona que recibe.')
      return
    }

    if (quantity < 0 || (!['traslado', 'ajuste'].includes(movement.type) && quantity === 0)) {
      setError('La cantidad debe ser mayor a cero.')
      return
    }

    if (movement.type === 'traslado' && !movement.to_location) {
      setError('Selecciona la nueva ubicacion.')
      return
    }

    if (movement.type === 'ajuste' && !movement.incident_type) {
      setError('Selecciona que paso con el lote.')
      return
    }

    if (movement.type === 'ajuste' && selectedIncident?.needsAffected && Number(movement.affected_packages || 0) <= 0) {
      setError('Escribe cuantos envases estan afectados.')
      return
    }

    if (movement.type === 'ajuste' && selectedIncident?.needsPhysicalCount && movement.physical_count === '') {
      setError('Escribe la cantidad fisica contada.')
      return
    }

    if (movement.type === 'ajuste' && selectedIncident?.needsPhysicalCount && Number(movement.physical_count || 0) < 0) {
      setError('La cantidad fisica no puede ser negativa.')
      return
    }

    if (movement.type === 'ajuste' && !movement.notes.trim()) {
      setError('Escribe un motivo u observacion.')
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
          notes: movementNotes || null,
          lot_code: displayLotCode(lot.lot_code),
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
        setMovementPhotoFile(null)
        setMovementPhotoPreview('')
        setPendingMovement(null)
        setEmailStatus('Sin señal: movimiento guardado en cola. Se sincronizara automaticamente al volver internet.')
        setTimeout(() => navigate(isOperator ? '/operacion' : '/'), 1200)
      } else if (rpcError.message.includes('inventario')) {
        setError('No hay inventario suficiente.')
      } else {
        setError(rpcError.message)
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
      setMovementPhotoFile(null)
      setMovementPhotoPreview('')
      setPendingMovement(null)
      await loadLot()
      if (canRegisterMovement) {
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
      const fileName = `${displayLotCode(lot.lot_code)}-qr.png`
      const file = new File([blob], fileName, { type: 'image/png' })
      const isPhoneLike = window.matchMedia?.('(pointer: coarse)').matches

      if (isPhoneLike && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `QR ${displayLotCode(lot.lot_code)}`,
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
            <p>${escapeHtml(displayLotCode(lot.lot_code))}</p>
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
        <h2>${escapeHtml(displayLotCode(lot.lot_code))}</h2>
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

  return (
    <div>
      <PageHeader title={displayLotCode(lot.lot_code)} subtitle={`${cleanProductName(lot.product)} - ${lot.clients?.name}`} />

      {isOperator && canRegisterMovement ? (
        <div className="mb-4 rounded-lg bg-campo-50 p-4 text-sm font-bold text-campo-700">
          Modo operario: registra el movimiento y confirma antes de guardar.
        </div>
      ) : null}

      {statusWarning ? (
        <div className="mb-4 rounded-lg bg-amber-50 p-4 text-sm font-bold text-amber-800">
          Alerta: este lote esta {lot.status}. Las salidas quedan bloqueadas si el lote esta retenido o cerrado.
        </div>
      ) : null}

      {isExpired ? (
        <div className="mb-4 rounded-lg bg-red-50 p-4 text-sm font-bold text-red-700">
          Lote vencido. Las salidas quedan bloqueadas.
        </div>
      ) : null}

      <section className="panel mb-4 border-campo-200 bg-white/95">
        <div className="grid gap-3 sm:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-400">Lectura rapida</p>
            <h2 className="mt-1 text-2xl font-black leading-tight text-slate-950">{cleanProductName(lot.product)}</h2>
            <p className="mt-1 text-sm font-bold text-slate-500">{displayLotCode(lot.lot_code)}</p>
          </div>
          <div className="rounded-lg bg-campo-50 p-3">
            <p className="text-xs font-semibold uppercase text-campo-700">Disponible</p>
            <p className="mt-1 text-3xl font-black text-campo-800">{formatNumber(lot.current_quantity)}</p>
            <p className="text-sm font-bold text-campo-700">envases</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase text-slate-500">Equivalente actual</p>
            <p className="mt-1 text-2xl font-black text-slate-950">
              {Number(lot.package_size) > 0 ? `${formatNumber(currentEquivalent)} ${lot.package_unit || ''}` : 'Sin dato'}
            </p>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-sm font-bold text-slate-700 sm:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-3">Ubicacion: {lot.location || '-'}</div>
          <div className="rounded-lg bg-slate-50 p-3">Vence: {lot.expiry_date ? formatDate(lot.expiry_date) : 'Sin dato'}</div>
          <div className="rounded-lg bg-slate-50 p-3">Estado: {lot.status}</div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="panel">
          {lot.photo_url ? <img className="mb-4 h-48 w-full rounded-lg object-cover" src={lot.photo_url} alt={cleanProductName(lot.product)} /> : null}
          <div className="grid grid-cols-2 gap-3">
            <Info label="Envases actuales" value={formatNumber(lot.current_quantity)} strong />
            <Info
              label="Presentacion"
              value={lot.package_size ? `${formatNumber(lot.package_size)} ${lot.package_unit || ''}` : 'Sin dato'}
            />
            <Info label="Ubicacion" value={lot.location} />
            <Info label="Fecha ingreso" value={formatDate(lot.entry_date)} />
            <Info label="Vencimiento" value={lot.expiry_date ? formatDate(lot.expiry_date) : 'Sin dato'} />
            <Info label="Estado" value={lot.status} />
            <Info label="Cliente" value={lot.clients?.name} />
            <Info label="Contacto" value={lot.clients?.contact || '-'} />
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
                <select
                  className="input mt-1"
                  value={movement.incident_type}
                  onChange={(event) => setMovement({ ...movement, incident_type: event.target.value, affected_packages: '', physical_count: '' })}
                  required
                >
                  <option value="">Seleccionar incidencia</option>
                  {incidentTypes.map((incident) => (
                    <option key={incident.value} value={incident.value}>{incident.label}</option>
                  ))}
                </select>
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
              <span className="label">Foto opcional</span>
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
            FEFO: existe un lote que vence antes ({displayLotCode(fefoLot.lot_code)}, vence {formatDate(fefoLot.expiry_date)}, {formatNumber(fefoLot.current_quantity)} envases en {fefoLot.location}). Revisa antes de despachar este lote.
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
        <div className="fixed inset-0 z-40 flex items-end bg-slate-950/45 p-4 sm:items-center sm:justify-center">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
            <h3 className="text-xl font-bold text-slate-950">Confirmar movimiento</h3>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              {pendingMovement.type === 'ajuste'
                ? `Vas a enviar ${getIncidentConfig(pendingMovement.incident_type)?.label || 'reparacion'} a revision.`
                : `Vas a registrar ${movementLabel(pendingMovement.type).toLowerCase()} de ${formatNumber(pendingMovement.quantity)} envases.`}
            </p>

            <div className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-700">
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

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button className="btn-secondary w-full" type="button" onClick={() => setPendingMovement(null)} disabled={saving}>
                Cancelar
              </button>
              <button className="btn-primary w-full" type="button" onClick={confirmMovement} disabled={saving}>
                {saving ? 'Guardando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="mt-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-950">Ultimos movimientos</h3>
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
