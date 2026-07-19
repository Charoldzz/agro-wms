import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BrowserQRCodeReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { Html5Qrcode } from 'html5-qrcode'
import { Camera, ImagePlus, Search, TriangleAlert, RefreshCcw } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { supabase } from '../lib/supabase'
import { cleanProductName, displayLotCode, packageLabel } from '../lib/display'
import { normalizeDispatchRequests } from '../lib/dispatchRequests'
import { formatNumber, equivalentLabel } from '../lib/format'

async function decodeWithBarcodeDetector(file) {
  if (!('BarcodeDetector' in window) || !('createImageBitmap' in window)) return null

  try {
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
    const bitmap = await createImageBitmap(file)
    const codes = await detector.detect(bitmap)
    bitmap.close?.()
    return codes[0]?.rawValue || null
  } catch {
    return null
  }
}

function createQrReader() {
  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE])
  hints.set(DecodeHintType.TRY_HARDER, true)
  return new BrowserQRCodeReader(hints, {
    delayBetweenScanAttempts: 120,
    delayBetweenScanSuccess: 500,
  })
}

function getLotPath(decodedText) {
  const value = decodedText.trim()
  const qrPathMatch = value.match(/\/qr\/[^?#\s]+/i)
  if (qrPathMatch) return qrPathMatch[0]

  const hashQrPathMatch = value.match(/#(\/qr\/[^?#\s]+)/i)
  if (hashQrPathMatch) return hashQrPathMatch[1]

  const hashPathMatch = value.match(/#(\/lotes\/[^?#\s]+)/i)
  if (hashPathMatch) return hashPathMatch[1]

  const lotPathMatch = value.match(/\/lotes\/[^?#\s]+/i)
  if (lotPathMatch) return lotPathMatch[0]

  try {
    const url = new URL(value, window.location.origin)
    if (url.hash.startsWith('#/qr/')) return url.hash.slice(1)
    if (url.pathname.startsWith('/qr/')) return url.pathname
    if (url.hash.startsWith('#/lotes/')) return url.hash.slice(1)
    if (url.pathname.startsWith('/lotes/')) return url.pathname
  } catch {
    return null
  }

  return null
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const imageUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => resolve({ image, imageUrl })
    image.onerror = () => {
      URL.revokeObjectURL(imageUrl)
      reject(new Error('No se pudo cargar la imagen.'))
    }
    image.src = imageUrl
  })
}

export default function Scanner() {
  const navigate = useNavigate()
  const location = useLocation()
  const videoRef = useRef(null)
  const controlsRef = useRef(null)
  const galleryInputRef = useRef(null)
  const foundQrRef = useRef(false)
  const html5ReaderId = 'todo-agricola-html5-qr-reader'
  const [status, setStatus] = useState('Preparando camara...')
  const [error, setError] = useState('')
  const [showQrFallback, setShowQrFallback] = useState(false)
  const [restartKey, setRestartKey] = useState(0)
  const searchParams = new URLSearchParams(location.search)
  const movementMode = searchParams.get('modo') || ''
  const repairType = searchParams.get('reparacion') || ''
  const returnTo = searchParams.get('return') || ''
  const validMovementMode = ['despacho', 'reparo', 'traslado'].includes(movementMode) ? movementMode : ''
  const requestId = (() => {
    if (!returnTo) return ''
    try {
      const url = new URL(returnTo, window.location.origin)
      return url.searchParams.get('request') || ''
    } catch {
      const requestMatch = returnTo.match(/[?&]request=([^&]+)/)
      return requestMatch ? decodeURIComponent(requestMatch[1]) : ''
    }
  })()
  const [dispatchReference, setDispatchReference] = useState(null)

  useEffect(() => {
    async function loadDispatchReference() {
      if (!requestId || validMovementMode !== 'despacho') {
        setDispatchReference(null)
        return
      }

      const { data } = await supabase
        .from('client_dispatch_requests')
        .select('*, clients(name), lots(id, lot_code, client_id, product, current_quantity, package_size, package_unit, location, expiry_date, status)')
        .eq('id', requestId)
        .maybeSingle()

      setDispatchReference(data ? await normalizeDispatchRequests(data) : null)
    }

    loadDispatchReference()
  }, [requestId, validMovementMode])

  const goToScannedLot = useCallback(
    async (decodedText) => {
      let path = getLotPath(decodedText)
      if (!path) return false
      const parts = path.split('/').filter(Boolean)
      let lotId = parts[0] === 'lotes' ? parts.pop() : ''

      if (!lotId && returnTo && parts[0] === 'qr' && parts[1]) {
        const { data, error: qrError } = await supabase.rpc('resolve_lot_qr', {
          p_token: parts[1],
        })

        if (qrError || !data) {
          const { data: lotByToken } = await supabase
            .from('lots')
            .select('id')
            .eq('inventory_source', 'stock_independiente')
            .eq('qr_token', parts[1])
            .maybeSingle()

          lotId = lotByToken?.id || ''
          if (!lotId) return false
        } else {
          lotId = Array.isArray(data) ? data[0]?.lot_id : data
        }
        if (!lotId) return false
        path = `/lotes/${lotId}`
      }

      if (lotId) {
        const { data: activeLot } = await supabase
          .from('lots')
          .select('id')
          .eq('id', lotId)
          .eq('inventory_source', 'stock_independiente')
          .maybeSingle()
        if (!activeLot) return false

        sessionStorage.setItem(`scanned-lot-${lotId}`, '1')
        if (validMovementMode) {
          sessionStorage.setItem(`lot-mode-${lotId}`, validMovementMode)
        } else {
          sessionStorage.removeItem(`lot-mode-${lotId}`)
        }
      }
      if (returnTo && lotId) {
        const separator = returnTo.includes('?') ? '&' : '?'
        navigate(`${returnTo}${separator}lot=${lotId}`, { state: { scanned: true, movementMode: validMovementMode, repairType } })
        return true
      }
      navigate(path, { state: { scanned: true, movementMode: validMovementMode, repairType, returnTo } })
      return true
    },
    [navigate, returnTo, validMovementMode, repairType],
  )

  useEffect(() => {
    let cancelled = false

    async function stopCamera() {
      try {
        controlsRef.current?.stop()
      } catch {
        // La camara puede cerrarse sola al cambiar de pestaña.
      }
      controlsRef.current = null
    }

    async function startCamera() {
      await stopCamera()
      foundQrRef.current = false
      setError('')
      setShowQrFallback(false)
      setStatus('Solicitando permiso de camara...')

      if (!window.isSecureContext && window.location.hostname !== 'localhost') {
        setStatus('Camara bloqueada')
        setError('El scanner en vivo necesita HTTPS. Usa la app publicada en Vercel para probar desde celular.')
        return
      }

      try {
        const reader = createQrReader()
        const controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          videoRef.current,
          (result) => {
            if (!result || foundQrRef.current) return

            foundQrRef.current = true
            const decodedText = result.getText()
            goToScannedLot(decodedText).then((loaded) => {
              if (!loaded) {
                foundQrRef.current = false
                setStatus('QR leido, pero no es de un lote')
                setError('No se pudo autorizar este QR. Revisa que sea un QR nuevo del lote y que el usuario operador tenga permiso.')
                setShowQrFallback(true)
                return
              }

              setStatus('QR detectado')
              controls.stop()
            })
          },
        )

        if (cancelled) {
          controls.stop()
          return
        }

        controlsRef.current = controls
        setStatus('Listo para escanear')
      } catch {
        if (!cancelled) {
          setStatus('Camara no disponible')
          setError('No se pudo abrir la camara. Revisa permisos del navegador o entra desde Vercel con HTTPS.')
        }
      }
    }

    startCamera()

    return () => {
      cancelled = true
      stopCamera()
    }
  }, [goToScannedLot, restartKey])

  async function decodeImageFile(file) {
    setError('')
    setShowQrFallback(false)
    setStatus('Leyendo imagen...')

    try {
      const nativeDecodedText = await decodeWithBarcodeDetector(file)
      if (nativeDecodedText) {
        if (!(await goToScannedLot(nativeDecodedText))) {
          setError('La imagen no contiene un QR de un lote de esta app.')
          setShowQrFallback(true)
          setStatus('Listo para escanear')
        }
        return
      }

      try {
        const reader = createQrReader()
        const { image, imageUrl } = await loadImageFromFile(file)
        const result = await reader.decodeFromImageElement(image)
        URL.revokeObjectURL(imageUrl)

        if (!(await goToScannedLot(result.getText()))) {
          setError('La imagen no contiene un QR de un lote de esta app.')
          setShowQrFallback(true)
          setStatus('Listo para escanear')
        }
        return
      } catch {
        const html5Reader = new Html5Qrcode(html5ReaderId, { verbose: false })
        const decodedText = await html5Reader.scanFile(file, false)
        html5Reader.clear()
        if (await goToScannedLot(decodedText)) return
        setError('La imagen no contiene un QR de un lote de esta app.')
        setShowQrFallback(true)
        setStatus('Listo para escanear')
      }
    } catch {
      setError('No se pudo leer un QR en esa imagen. Prueba descargar un QR nuevo desde la ficha del lote.')
      setShowQrFallback(true)
      setStatus('Listo para escanear')
    }
  }

  async function handleImageFile(event) {
    const file = event.target.files?.[0]
    if (!file) return

    await decodeImageFile(file)
    event.target.value = ''
  }

  return (
    <div>
      <div id={html5ReaderId} className="hidden" />
      <PageHeader
        title={validMovementMode === 'despacho' ? 'Despacho' : validMovementMode ? 'Escanear lote' : 'Escanear QR'}
        subtitle={validMovementMode === 'despacho' ? 'Escanea el lote para registrar salida' : validMovementMode ? 'Escanea el lote para continuar' : 'Solo consulta la ficha del producto'}
      />

      {dispatchReference ? (
        <section className="mb-4 rounded-lg border border-amber-200 bg-amber-50/85 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase text-amber-700">Buscar para despacho</p>
              <p className="truncate text-sm font-black text-slate-950">{dispatchReference.clients?.name || 'Cliente'}</p>
            </div>
            <span className="rounded-lg bg-white px-2.5 py-1 text-xs font-black text-amber-800">
              {Array.isArray(dispatchReference.items) && dispatchReference.items.length > 1 ? `${dispatchReference.items.length} productos` : '1 producto'}
            </span>
          </div>
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
            {(Array.isArray(dispatchReference.items) && dispatchReference.items.length > 0
              ? dispatchReference.items
              : [{
                  lot_id: dispatchReference.lot_id,
                  lot_code: dispatchReference.lots?.lot_code,
                  product: dispatchReference.product || dispatchReference.lots?.product,
                  quantity: dispatchReference.quantity,
                }])
              .slice(0, 4)
              .map((item) => {
                const size = Number(item.package_size ?? dispatchReference.lots?.package_size) || 0
                const unit = item.package_unit ?? dispatchReference.lots?.package_unit
                const label = size > 0 ? equivalentLabel(Number(item.quantity || 0), unit) : `${formatNumber(item.quantity)} uds`
                return (
                  <span key={item.lot_id || item.lot_code || item.product} className="shrink-0 rounded-lg bg-white px-2 py-1 text-xs font-bold text-slate-700">
                    {cleanProductName(item.product)} · {label}
                  </span>
                )
              })}
            {Array.isArray(dispatchReference.items) && dispatchReference.items.length > 4 ? (
              <span className="shrink-0 rounded-lg bg-white px-2 py-1 text-xs font-bold text-slate-500">+{dispatchReference.items.length - 4}</span>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="panel">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <Camera size={20} className="text-campo-700" />
            {status}
          </div>
          <button
            className="btn-secondary !min-h-10 !px-3 !py-2"
            onClick={() => setRestartKey((value) => value + 1)}
            type="button"
            title="Reiniciar camara"
          >
            <RefreshCcw size={18} />
          </button>
        </div>

        <div className="relative overflow-hidden rounded-lg bg-slate-950">
          <video
            ref={videoRef}
            className="h-[360px] w-full object-cover"
            muted
            playsInline
          />
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="h-56 w-56 rounded-xl border-4 border-white/90 shadow-[0_0_0_999px_rgba(2,6,23,0.25)]" />
          </div>
        </div>

        {error ? <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
        {showQrFallback ? (
          <button
            className="mt-3 flex min-h-12 w-full items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm font-black text-amber-900 transition hover:bg-amber-100 active:scale-[0.99]"
            type="button"
            onClick={() => navigate('/lotes', { state: { qrFallback: true } })}
          >
            <span className="inline-flex items-center gap-2"><TriangleAlert size={18} /> QR con problema</span>
            <Search size={18} />
          </button>
        ) : null}
      </div>

      <div className="panel mt-4 space-y-3">
        <div className="flex items-center gap-2">
          <ImagePlus size={20} className="text-campo-700" />
          <h3 className="font-bold text-slate-900">Leer QR guardado</h3>
        </div>
        <input
          ref={galleryInputRef}
          className="hidden"
          type="file"
          accept="image/*"
          onChange={handleImageFile}
        />
        <button className="btn-secondary w-full" type="button" onClick={() => galleryInputRef.current?.click()}>
          <ImagePlus size={20} /> Elegir imagen con QR
        </button>
      </div>
    </div>
  )
}
