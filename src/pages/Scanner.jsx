import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, ImagePlus, RefreshCcw } from 'lucide-react'
import PageHeader from '../components/PageHeader'

const readerId = 'qr-live-reader'
const fileReaderId = 'qr-file-reader'

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

function getLotPath(decodedText) {
  const value = decodedText.trim()
  const hashPathMatch = value.match(/#(\/lotes\/[^?#\s]+)/i)
  if (hashPathMatch) return hashPathMatch[1]

  const lotPathMatch = value.match(/\/lotes\/[^?#\s]+/i)
  if (lotPathMatch) return lotPathMatch[0]

  try {
    const url = new URL(value, window.location.origin)
    if (url.hash.startsWith('#/lotes/')) return url.hash.slice(1)
    if (url.pathname.startsWith('/lotes/')) return url.pathname
  } catch {
    return null
  }

  return null
}

export default function Scanner() {
  const navigate = useNavigate()
  const scannerRef = useRef(null)
  const galleryInputRef = useRef(null)
  const [status, setStatus] = useState('Preparando camara...')
  const [error, setError] = useState('')
  const [restartKey, setRestartKey] = useState(0)

  const goToScannedLot = useCallback(
    (decodedText) => {
      const path = getLotPath(decodedText)
      if (!path) return false
      navigate(path)
      return true
    },
    [navigate],
  )

  useEffect(() => {
    let cancelled = false

    async function stopScanner() {
      const scanner = scannerRef.current
      scannerRef.current = null
      if (!scanner) return

      try {
        if (scanner.isScanning) await scanner.stop()
      } catch {
        // La camara puede ya estar cerrada al cambiar de pestaña.
      }

      try {
        await scanner.clear()
      } catch {
        // El lector puede no haberse montado si el permiso fue rechazado.
      }
    }

    async function startScanner() {
      await stopScanner()
      setError('')
      setStatus('Solicitando permiso de camara...')

      if (!window.isSecureContext && window.location.hostname !== 'localhost') {
        setStatus('Camara bloqueada')
        setError('El scanner en vivo necesita HTTPS. En Vercel debe funcionar; en red local HTTP el navegador lo bloquea.')
        return
      }

      try {
        const { Html5Qrcode } = await import('html5-qrcode')
        if (cancelled) return

        const scanner = new Html5Qrcode(readerId, { verbose: false })
        scannerRef.current = scanner

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 8,
            aspectRatio: 1.333,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const minEdge = Math.min(viewfinderWidth, viewfinderHeight)
              const size = Math.floor(minEdge * 0.72)
              return { width: size, height: size }
            },
          },
          async (decodedText) => {
            setStatus('QR detectado')
            await stopScanner()
            if (!goToScannedLot(decodedText)) {
              setError('El QR no corresponde a un lote de esta app.')
              setStatus('Listo para escanear')
              setRestartKey((value) => value + 1)
            }
          },
        )

        if (!cancelled) setStatus('Listo para escanear')
      } catch {
        if (!cancelled) {
          setStatus('Camara no disponible')
          setError('No se pudo abrir la camara. Revisa permisos del navegador o prueba desde Vercel con HTTPS.')
        }
      }
    }

    startScanner()

    return () => {
      cancelled = true
      stopScanner()
    }
  }, [goToScannedLot, restartKey])

  async function decodeImageFile(file) {
    setError('')
    setStatus('Leyendo imagen...')

    try {
      const nativeDecodedText = await decodeWithBarcodeDetector(file)
      if (nativeDecodedText) {
        if (!goToScannedLot(nativeDecodedText)) {
          setError('La imagen no contiene un QR de un lote de esta app.')
          setStatus('Listo para escanear')
        }
        return
      }

      const { Html5Qrcode } = await import('html5-qrcode')
      const imageScanner = new Html5Qrcode(fileReaderId)
      const decodedText = await imageScanner.scanFile(file, true)
      await imageScanner.clear().catch(() => null)

      if (!goToScannedLot(decodedText)) {
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
      <PageHeader title="Escanear QR" subtitle="Apunta al codigo del lote" />

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

        <div className="overflow-hidden rounded-lg bg-slate-950">
          <div id={readerId} className="min-h-[320px] w-full" />
        </div>

        {error ? <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
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
        <div id={fileReaderId} className="max-h-0 overflow-hidden opacity-0" />
        <button className="btn-secondary w-full" type="button" onClick={() => galleryInputRef.current?.click()}>
          <ImagePlus size={20} /> Elegir imagen con QR
        </button>
      </div>
    </div>
  )
}
