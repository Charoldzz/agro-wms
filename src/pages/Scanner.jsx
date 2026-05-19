import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, ImagePlus, QrCode } from 'lucide-react'
import PageHeader from '../components/PageHeader'

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
  const cameraInputRef = useRef(null)
  const galleryInputRef = useRef(null)
  const [status, setStatus] = useState('Listo para leer QR')
  const [error, setError] = useState('')

  const goToScannedLot = useCallback(
    (decodedText) => {
      const path = getLotPath(decodedText)
      if (!path) return false
      navigate(path)
      return true
    },
    [navigate],
  )

  async function decodeImageFile(file) {
    setError('')
    setStatus('Leyendo QR...')

    try {
      const nativeDecodedText = await decodeWithBarcodeDetector(file)
      if (nativeDecodedText) {
        if (!goToScannedLot(nativeDecodedText)) {
          setError('La imagen no contiene un QR de un lote de esta app.')
          setStatus('Listo para leer QR')
        }
        return
      }

      const { Html5Qrcode } = await import('html5-qrcode')
      const imageScanner = new Html5Qrcode(fileReaderId)
      const decodedText = await imageScanner.scanFile(file, true)
      await imageScanner.clear().catch(() => null)

      if (!goToScannedLot(decodedText)) {
        setError('La imagen no contiene un QR de un lote de esta app.')
        setStatus('Listo para leer QR')
      }
    } catch {
      setError('No se pudo leer un QR en esa imagen. Usa la camara normal del telefono para abrir el enlace.')
      setStatus('Listo para leer QR')
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
      <PageHeader title="Escanear QR" subtitle="El QR abre directamente la ficha del lote" />

      <div className="panel space-y-4">
        <div className="flex items-center gap-2">
          <QrCode size={22} className="text-campo-700" />
          <h3 className="font-bold text-slate-900">Metodo recomendado</h3>
        </div>
        <p className="text-sm font-medium leading-relaxed text-slate-600">
          Para mayor estabilidad, escanea el QR con la camara normal del telefono. El QR ya contiene el link
          directo a la ficha del lote en Agro WMS.
        </p>
        <input
          ref={cameraInputRef}
          className="hidden"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleImageFile}
        />
        <button className="btn-primary w-full" type="button" onClick={() => cameraInputRef.current?.click()}>
          <Camera size={20} /> Tomar foto del QR
        </button>
      </div>

      <div className="panel mt-4 space-y-4">
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

      <div className="mt-4 rounded-lg bg-white/85 p-3 text-sm font-bold text-slate-700 shadow-sm">
        {status}
      </div>
      {error ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
    </div>
  )
}
