import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BrowserQRCodeReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { Html5Qrcode } from 'html5-qrcode'
import { Camera, ImagePlus, Search, TriangleAlert, RefreshCcw } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { supabase } from '../lib/supabase'

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
  const [restartKey, setRestartKey] = useState(0)
  const searchParams = new URLSearchParams(location.search)
  const movementMode = searchParams.get('modo') || ''
  const returnTo = searchParams.get('return') || ''
  const validMovementMode = ['despacho', 'reparo', 'traslado'].includes(movementMode) ? movementMode : ''

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
        sessionStorage.setItem(`scanned-lot-${lotId}`, '1')
        if (validMovementMode) {
          sessionStorage.setItem(`lot-mode-${lotId}`, validMovementMode)
        } else {
          sessionStorage.removeItem(`lot-mode-${lotId}`)
        }
      }
      if (returnTo && lotId) {
        const separator = returnTo.includes('?') ? '&' : '?'
        navigate(`${returnTo}${separator}lot=${lotId}`, { state: { scanned: true, movementMode: validMovementMode } })
        return true
      }
      navigate(path, { state: { scanned: true, movementMode: validMovementMode, returnTo } })
      return true
    },
    [navigate, returnTo, validMovementMode],
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
    setStatus('Leyendo imagen...')

    try {
      const nativeDecodedText = await decodeWithBarcodeDetector(file)
      if (nativeDecodedText) {
        if (!(await goToScannedLot(nativeDecodedText))) {
          setError('La imagen no contiene un QR de un lote de esta app.')
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
          setStatus('Listo para escanear')
        }
        return
      } catch {
        const html5Reader = new Html5Qrcode(html5ReaderId, { verbose: false })
        const decodedText = await html5Reader.scanFile(file, false)
        html5Reader.clear()
        if (await goToScannedLot(decodedText)) return
        setError('La imagen no contiene un QR de un lote de esta app.')
        setStatus('Listo para escanear')
      }
    } catch {
      setError('No se pudo leer un QR en esa imagen. Prueba descargar un QR nuevo desde la ficha del lote.')
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
        {error ? (
          <button
            className="btn-secondary mt-3 w-full justify-between"
            type="button"
            onClick={() => navigate('/lotes', { state: { qrFallback: true } })}
          >
            <span className="inline-flex items-center gap-2"><TriangleAlert size={18} /> QR no se puede leer</span>
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
