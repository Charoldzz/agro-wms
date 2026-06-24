import { useEffect, useState } from 'react'
import { APP_VERSION, APP_VERSION_LABEL } from '../lib/version'

export default function AppVersion() {
  const [latestVersion, setLatestVersion] = useState('')
  const hasUpdate = latestVersion && latestVersion !== APP_VERSION

  useEffect(() => {
    let cancelled = false

    async function checkVersion() {
      try {
        const response = await fetch(`/app-version.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!response.ok) return
        const data = await response.json()
        if (!cancelled && data.version && data.version !== APP_VERSION) {
          setLatestVersion(data.version)
        }
      } catch {
        // Si falla la red, se revisa de nuevo en el siguiente intento.
      }
    }

    const visibilityCheck = () => { if (document.visibilityState === 'visible') checkVersion() }

    checkVersion()
    const intervalId = window.setInterval(checkVersion, 90000)
    window.addEventListener('focus', checkVersion)
    document.addEventListener('visibilitychange', visibilityCheck)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      window.removeEventListener('focus', checkVersion)
      document.removeEventListener('visibilitychange', visibilityCheck)
    }
  }, [])

  return (
    <div className="fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom))] right-2 z-40 sm:bottom-3">
      {hasUpdate ? (
        <div className="flex items-center gap-2 rounded-full border border-campo-300 bg-white px-3 py-1.5 shadow-md">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-campo-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-campo-600" />
          </span>
          <span className="text-[10px] font-bold text-slate-500">Nueva versión disponible</span>
          <button
            type="button"
            className="rounded-full bg-campo-700 px-2.5 py-1 text-[10px] font-black text-white transition hover:bg-campo-800"
            onClick={() => window.location.reload()}
          >
            Actualizar
          </button>
        </div>
      ) : (
        <div className="pointer-events-none hidden rounded-full border border-white/60 bg-white/70 px-2 py-1 text-[10px] font-bold text-slate-500 shadow-sm sm:block">
          {APP_VERSION_LABEL}
        </div>
      )}
    </div>
  )
}
