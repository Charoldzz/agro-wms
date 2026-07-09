import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, BarChart2, Boxes, ClipboardCheck, ClipboardList, LogOut, PackagePlus, RefreshCcw, ShieldAlert, Truck, Wifi, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth.jsx'
import { getQueuedMovementCount, syncQueuedMovements } from '../lib/offlineQueue'
import { clearOperationalDrafts } from '../lib/drafts'

const adminNavItems = [
  { to: '/lotes', label: 'Almacenes', icon: Boxes },
  { to: '/operacion', label: 'Pendientes', icon: ClipboardCheck },
  { to: '/offline', label: 'Offline', icon: ShieldAlert },
]

const clienteNavItems = [
  { to: '/', label: 'Inicio', icon: Boxes },
  { to: '/despachos', label: 'Solicitudes', icon: Truck },
  { to: '/historial', label: 'Movimientos', icon: ClipboardList },
]

const operadorNavItems = [
  { to: '/lotes',  label: 'Almacenes', icon: Boxes },
  { to: '/kardex', label: 'Kardex',    icon: BarChart2 },
]

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile, user } = useAuth()
  const [queuedMovements, setQueuedMovements] = useState(getQueuedMovementCount())
  const [online, setOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState('')
  const [pendingDispatch, setPendingDispatch] = useState(0)
  const visibleNavItems =
    profile?.role === 'operador'
      ? operadorNavItems
      : profile?.role === 'cliente'
        ? clienteNavItems
        : adminNavItems
  const mainTabPaths = new Set(['/', '/operacion', '/lotes', '/offline', '/despachos', '/historial', '/solicitudes', '/operacion/salidas'])
  const showBackButton = !mainTabPaths.has(location.pathname)

  async function signOut() {
    window.dispatchEvent(new Event('todo-close-temporary-overlays'))
    clearOperationalDrafts()
    await supabase.auth.signOut()
    navigate('/login')
  }

  function goBackInsideApp() {
    const path = location.pathname
    if (location.state?.backTo) return navigate(location.state.backTo)
    if (path === '/scanner') {
      const returnTo = new URLSearchParams(location.search).get('return')
      if (returnTo) return navigate(returnTo)
    }
    navigate(-1)
  }

  useEffect(() => {
    if (!user) return undefined

    async function syncQueue() {
      setOnline(navigator.onLine)
      setSyncing(true)
      const result = await syncQueuedMovements()
      setQueuedMovements(result.remaining)
      if (navigator.onLine) setLastSync(result.remaining ? 'Aun hay pendientes' : 'Sincronizado')
      setSyncing(false)
    }

    syncQueue()
    const offlineListener = () => setOnline(false)
    window.addEventListener('online', syncQueue)
    window.addEventListener('offline', offlineListener)
    const queueListener = (event) => setQueuedMovements(event.detail || getQueuedMovementCount())
    window.addEventListener('offline-movement-queue', queueListener)

    return () => {
      window.removeEventListener('online', syncQueue)
      window.removeEventListener('offline', offlineListener)
      window.removeEventListener('offline-movement-queue', queueListener)
    }
  }, [user])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.documentElement.style.setProperty('--route-repaint', String(Date.now()))
      window.dispatchEvent(new Event('resize'))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [location.pathname])

  async function syncNow() {
    setSyncing(true)
    const result = await syncQueuedMovements()
    setQueuedMovements(result.remaining)
    setOnline(navigator.onLine)
    setLastSync(navigator.onLine && result.remaining === 0 ? 'Sincronizado' : result.remaining ? 'Pendiente de sincronizar' : '')
    setSyncing(false)
  }

  const hasSyncRisk = !online || queuedMovements > 0
  const isOperatorRoot = profile?.role === 'operador' && (location.pathname === '/' || location.pathname === '/operacion')

  useEffect(() => {
    if (!isOperatorRoot) return undefined

    function cleanupTemporaryOverlays() {
      window.dispatchEvent(new Event('todo-close-temporary-overlays'))
      document.documentElement.style.overflow = ''
      document.body.style.overflow = ''
    }

    cleanupTemporaryOverlays()
    window.addEventListener('focus', cleanupTemporaryOverlays)
    window.addEventListener('pageshow', cleanupTemporaryOverlays)
    document.addEventListener('visibilitychange', cleanupTemporaryOverlays)

    return () => {
      window.removeEventListener('focus', cleanupTemporaryOverlays)
      window.removeEventListener('pageshow', cleanupTemporaryOverlays)
      document.removeEventListener('visibilitychange', cleanupTemporaryOverlays)
    }
  }, [isOperatorRoot])

  useEffect(() => {
    if (!user || !['operador', 'administrador'].includes(profile?.role)) return undefined

    async function loadCount() {
      const { count } = await supabase
        .from('client_dispatch_requests')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pendiente', 'aprobado', 'en_preparacion'])
      setPendingDispatch(count || 0)
    }

    loadCount()
    const channel = supabase
      .channel('pending-dispatch-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_dispatch_requests' }, loadCount)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [user, profile?.role])

  if (profile?.role === 'cliente') {
    return (
      <div className="app-bg min-h-screen">
        <Outlet />
      </div>
    )
  }

  return (
    <div className="app-bg min-h-screen pb-[calc(7.5rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-20 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm sm:w-24">
              <img className="max-h-full max-w-full object-contain" src="/images/todo-logo.png" alt="Todo Agricola" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold leading-tight text-slate-950 sm:text-lg">Todo Agricola Boliviana Ltda</h1>
              <p className="text-xs font-medium text-slate-500">
                {profile?.full_name || 'Operación agrícola'}
              </p>
            </div>
          </div>
          <button className="btn-secondary shrink-0 !min-h-10 !px-3 !py-2" onClick={signOut} title="Salir">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl overflow-x-hidden px-4 py-5">
        {showBackButton ? (
          <button className="btn-secondary mb-4 !min-h-10 !px-3 !py-2 text-sm" type="button" onClick={goBackInsideApp}>
            <ArrowLeft size={18} />
            Volver
          </button>
        ) : null}
        {hasSyncRisk ? (
          <section className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                {!online ? <WifiOff className="mt-0.5 shrink-0" size={20} /> : <Wifi className="mt-0.5 shrink-0" size={20} />}
                <div>
                  <p className="font-black">{!online ? 'Sin internet' : 'Guardado pendiente de sincronizar'}</p>
                  <p className="text-xs font-bold">
                    {queuedMovements > 0
                      ? `${queuedMovements} movimiento${queuedMovements === 1 ? '' : 's'} pendiente${queuedMovements === 1 ? '' : 's'}. No hagas salidas criticas sin revision.`
                      : 'La app conserva borradores y cola offline cuando corresponde.'}
                  </p>
                </div>
              </div>
              {online ? (
                <button className="btn-secondary !min-h-10 !px-3 !py-2" type="button" onClick={syncNow} disabled={syncing} title="Sincronizar">
                  <RefreshCcw size={16} className={syncing ? 'animate-spin' : ''} />
                  <span className="sr-only">{syncing ? 'Sincronizando' : 'Sincronizar'}</span>
                </button>
              ) : null}
            </div>
          </section>
        ) : lastSync ? (
          <div className="mb-3 flex items-center justify-between gap-2 px-1 text-xs font-black text-campo-800">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/70 px-2.5 py-1.5 shadow-sm">
              <Wifi size={15} />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.13)]" />
              <span>Sincronizado</span>
            </div>
            <button
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-slate-600 shadow-sm transition hover:text-campo-700"
              type="button"
              onClick={syncNow}
              disabled={syncing}
              title="Sincronizar"
            >
              <RefreshCcw size={15} className={syncing ? 'animate-spin' : ''} />
              <span className="sr-only">{syncing ? 'Sincronizando' : 'Sincronizar'}</span>
            </button>
          </div>
        ) : null}
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-5xl gap-1.5 px-3 py-2.5">
          {visibleNavItems.map((item) => {
            const Icon = item.icon
            const badge = item.to === '/operacion/salidas' && pendingDispatch > 0 ? pendingDispatch : 0
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `relative flex flex-1 flex-col items-center justify-center gap-1 rounded-xl py-3 text-xs font-bold transition-colors ${
                    isActive
                      ? 'bg-campo-700 text-white shadow-sm'
                      : badge > 0
                        ? 'bg-amber-50 text-amber-700 ring-2 ring-amber-400'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`
                }
              >
                <span className="relative">
                  <Icon size={26} strokeWidth={2} />
                  {badge > 0 && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </span>
                <span className="leading-none">{item.label}</span>
              </NavLink>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
