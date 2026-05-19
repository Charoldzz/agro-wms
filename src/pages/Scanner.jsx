import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, RefreshCcw } from 'lucide-react'
import PageHeader from '../components/PageHeader'

const readerId = 'qr-reader'

function openLotPath(path) {
  window.location.assign(`${window.location.origin}/#${path}`)
}

export default function Scanner() {
  const qrRef = useRef(null)
  const fileInputRef = useRef(null)
  const [status, setStatus] = useState('Preparando camara...')
  const [error, setError] = useState('')
  const [restartKey, setRestartKey] = useState(0)

  const goToScannedLot = useCallback(
    (decodedText) => {
      const value = decodedText.trim()
      const hashPathMatch = value.match(/#(\/lotes\/[^?#\s]+)/i)
      if (hashPathMatch) {
        openLotPath(hashPathMatch[1])
        return true
      }

      const lotPathMatch = value.match(/\/lotes\/[^?#\s]+/i)
      if (lotPathMatch) {
        openLotPath(lotPathMatch[0])
        return true
      }

      const url = new URL(value, window.location.origin)
      if (url.hash.startsWith('#/lotes/')) {
        openLotPath(url.hash.slice(1))
        return true
      }

      if (url.pathname.startsWith('/lotes/')) {
        openLotPath(url.pathname)
        return true
      }

      return false
    },
    [],
  )

  useEffect(() => {
    let cancelled = false

    async function startScanner() {
      setError('')
      setStatus('Solicitando permiso de camara...')

      try {
        const { Html5Qrcode } = await import('html5-qrcode')
        if (cancelled) return

        const scanner = new Html5Qrcode(readerId)
        qrRef.current = scanner

        if (!window.isSecureContext && window.location.hostname !== 'localhost') {
          setStatus('Camara bloqueada')
          setError('El navegador bloquea la camara en HTTP. Usa localhost en la PC o publica la app con HTTPS.')
          return
        }

        const cameras = await Html5Qrcode.getCameras()
        if (cancelled) return

        if (!cameras.length) {
          setStatus('Sin camaras detectadas')
          setError('No se detecto ninguna camara disponible.')
          return
        }

        const backCamera =
          cameras.find((camera) => /back|rear|environment|trasera/i.test(camera.label)) || cameras[0]

        await scanner.start(
          backCamera.id,
          {
            fps: 10,
            qrbox: { width: 260, height: 260 },
            aspectRatio: 1,
          },
          (decodedText) => {
            setStatus('QR detectado')
            scanner.stop().finally(() => {
              if (!goToScannedLot(decodedText)) {
                setError('El QR no corresponde a un lote de esta app.')
                setStatus('Listo para escanear')
              }
            })
          },
        )

        if (!cancelled) setStatus('Listo para escanear')
      } catch {
        if (!cancelled) {
          setStatus('Camara no disponible')
          setError('No se pudo abrir la camara. Revisa permisos del navegador o usa HTTPS.')
        }
      }
    }

    startScanner()

    return () => {
      cancelled = true
      qrRef.current?.stop().catch(() => null)
    }
  }, [goToScannedLot, restartKey])

  async function handleImageFile(event) {
    const file = event.target.files?.[0]
    if (!file) return

    setError('')
    setStatus('Leyendo imagen...')

    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      const imageScanner = new Html5Qrcode('qr-file-reader')
      const decodedText = await imageScanner.scanFile(file, true)
      await imageScanner.clear().catch(() => null)

      if (!goToScannedLot(decodedText)) {
        setError('La imagen no contiene un QR de un lote de esta app.')
        setStatus('Listo para escanear')
      }
    } catch {
      setError('No se pudo leer un QR en esa imagen.')
      setStatus('Listo para escanear')
    } finally {
      event.target.value = ''
    }
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
            title="Reintentar camara"
          >
            <RefreshCcw size={18} />
          </button>
        </div>

        <div className="relative min-h-[320px] overflow-hidden rounded-lg bg-slate-950">
          <div id={readerId} className="min-h-[320px] w-full" />
          {status !== 'Listo para escanear' && !error ? (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950 text-sm font-semibold text-white">
              {status}
            </div>
          ) : null}
        </div>

        {error ? <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
      </div>

      <div className="panel mt-4 space-y-3">
        <div className="flex items-center gap-2">
          <ImagePlus size={20} className="text-campo-700" />
          <h3 className="font-bold text-slate-900">Escanear desde galeria</h3>
        </div>
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept="image/*"
          onChange={handleImageFile}
        />
        <div id="qr-file-reader" className="hidden" />
        <button className="btn-secondary w-full" type="button" onClick={() => fileInputRef.current?.click()}>
          <ImagePlus size={20} /> Elegir imagen con QR
        </button>
      </div>
    </div>
  )
}
