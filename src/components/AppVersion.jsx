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
    <div className="fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-3 sm:bottom-3">
      <div className={`flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 shadow-md ${hasUpdate ? 'border-campo-300' : 'border-white/70'}`}>
        {hasUpdate ? (
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-campo-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-campo-600" />
          </span>
        ) : null}
        <span className="text-[10px] font-bold text-slate-500">
          {hasUpdate ? `Nueva ${latestVersion}` : APP_VERSION_LABEL}
        </span>
        <button
          type="button"
          className={`rounded-full px-2.5 py-1 text-[10px] font-black transition ${
            hasUpdate
              ? 'bg-campo-700 text-white hover:bg-campo-800'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
          onClick={() => window.location.reload()}
        >
          Actualizar
        </button>
      </div>
    </div>
  )
}
