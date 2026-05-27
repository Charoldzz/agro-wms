import { useEffect, useState } from 'react'
import { APP_VERSION, APP_VERSION_LABEL } from '../lib/version'

export default function AppVersion() {
  const [latestVersion, setLatestVersion] = useState('')
  const hasUpdate = latestVersion && latestVersion !== APP_VERSION

  useEffect(() => {
    let cancelled = false

    async function checkVersion() {
      try {
        const response = await fetch(`/app-version.json?t=${Date.now()}`, {
          cache: 'no-store',
        })
        if (!response.ok) return

        const data = await response.json()
        if (!cancelled && data.version && data.version !== APP_VERSION) {
          setLatestVersion(data.version)
        }
      } catch {
        // Si falla la red, se revisa de nuevo en el siguiente intento.
      }
    }

    const visibilityCheck = () => {
      if (document.visibilityState === 'visible') checkVersion()
    }

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

  function reloadNow() {
    window.location.reload()
  }

  return (
    <>
      {hasUpdate ? (
        <div className="fixed inset-x-3 bottom-[calc(6.3rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md rounded-lg border border-campo-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:bottom-4 sm:left-auto sm:right-4 sm:mx-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-black text-slate-950">Nueva version disponible</p>
              <p className="mt-0.5 text-xs font-semibold text-slate-500">Actualiza cuando termines esta operacion.</p>
            </div>
            <button className="btn-primary shrink-0 !min-h-10 !px-3 !py-2 text-sm" type="button" onClick={reloadNow}>
              Actualizar
            </button>
          </div>
        </div>
      ) : null}
      <div data-version-badge="true" className="pointer-events-none fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] right-2 z-40 rounded-full border border-white/60 bg-white/70 px-2 py-1 text-[10px] font-bold text-slate-500 shadow-sm backdrop-blur sm:bottom-3">
        {APP_VERSION_LABEL}
      </div>
    </>
  )
}
