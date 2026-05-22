import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.jsx'
import { APP_VERSION, APP_VERSION_LABEL } from '../lib/version'

export default function AppVersion() {
  const location = useLocation()
  const { profile } = useAuth()
  const [latestVersion, setLatestVersion] = useState('')
  const [reloading, setReloading] = useState(false)
  const timeoutRef = useRef(null)
  const canAutoRefresh = isSafeRefreshRoute(location.pathname, profile?.role)
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

  useEffect(() => {
    if (!hasUpdate || !canAutoRefresh) return undefined

    setReloading(true)
    timeoutRef.current = window.setTimeout(() => window.location.reload(), 1200)

    return () => window.clearTimeout(timeoutRef.current)
  }, [canAutoRefresh, hasUpdate])

  function reloadNow() {
    setReloading(true)
    window.location.reload()
  }

  return (
    <>
      {hasUpdate && !canAutoRefresh ? (
        <div className="fixed inset-x-3 bottom-[calc(6.3rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md rounded-lg border border-campo-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:bottom-4 sm:left-auto sm:right-4 sm:mx-0">
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
      {hasUpdate && canAutoRefresh ? (
        <div className="pointer-events-none fixed inset-x-3 bottom-[calc(6.3rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-xs rounded-lg border border-campo-200 bg-white/95 p-3 text-center text-sm font-black text-campo-800 shadow-lg backdrop-blur sm:bottom-4">
          {reloading ? 'Actualizando app...' : 'Nueva version detectada'}
        </div>
      ) : null}
      <div className="pointer-events-none fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] right-2 z-50 rounded-full border border-white/60 bg-white/70 px-2 py-1 text-[10px] font-bold text-slate-500 shadow-sm backdrop-blur sm:bottom-3">
        {APP_VERSION_LABEL}
      </div>
    </>
  )
}

function isSafeRefreshRoute(pathname, role) {
  if (pathname === '/login') return true
  if (pathname === '/') return ['administrador', 'operador'].includes(role)
  if (['/operacion', '/lotes', '/clientes', '/movimientos', '/offline', '/pendientes', '/vencimientos', '/historial'].includes(pathname)) return true
  return pathname.startsWith('/productos/')
}
