import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Boxes, ClipboardList, Home, LogOut, ScanLine, ShieldAlert, Users, Warehouse } from 'lucide-react'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth.jsx'
import { getQueuedMovementCount, syncQueuedMovements } from '../lib/offlineQueue'

const navItems = [
  { to: '/', label: 'Inicio', icon: Home },
  { to: '/operacion', label: 'Operar', icon: Warehouse, roles: ['operador'] },
  { to: '/lotes', label: 'Lotes', icon: Boxes, roles: ['administrador', 'operador'] },
  { to: '/scanner', label: 'Scan', icon: ScanLine, roles: ['administrador'] },
  { to: '/movimientos', label: 'Mov.', icon: ClipboardList },
  { to: '/offline', label: 'Offline', icon: ShieldAlert },
  { to: '/clientes', label: 'Clientes', icon: Users },
]

export default function AppLayout() {
  const navigate = useNavigate()
  const { profile, user } = useAuth()
  const [queuedMovements, setQueuedMovements] = useState(getQueuedMovementCount())
  const visibleNavItems =
    profile?.role === 'operador'
      ? navItems.filter((item) => item.roles?.includes('operador'))
      : profile?.role === 'cliente'
        ? navItems.filter((item) => item.to === '/' || item.roles?.includes('cliente'))
        : navItems.filter((item) => !item.roles || item.roles.includes('administrador'))

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  useEffect(() => {
    if (!user) return undefined

    async function syncQueue() {
      const result = await syncQueuedMovements()
      setQueuedMovements(result.remaining)
    }

    syncQueue()
    window.addEventListener('online', syncQueue)
    const queueListener = (event) => setQueuedMovements(event.detail || getQueuedMovementCount())
    window.addEventListener('offline-movement-queue', queueListener)

    return () => {
      window.removeEventListener('online', syncQueue)
      window.removeEventListener('offline-movement-queue', queueListener)
    }
  }, [user])

  return (
    <div className="app-bg min-h-screen pb-24">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-24 items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm">
              <img className="max-h-full max-w-full object-contain" src="/images/todo-logo.png" alt="Todo Agricola" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight text-slate-950">Todo Agricola Boliviana Ltda</h1>
              <p className="text-xs font-medium text-slate-500">
                {profile?.full_name || 'Operación agrícola'}
              </p>
            </div>
          </div>
          <button className="btn-secondary !min-h-10 !px-3 !py-2" onClick={signOut} title="Salir">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5">
        {queuedMovements > 0 ? (
          <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-800">
            {queuedMovements} movimiento{queuedMovements === 1 ? '' : 's'} pendiente{queuedMovements === 1 ? '' : 's'} por sincronizar.
          </div>
        ) : null}
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className={`mx-auto grid max-w-5xl gap-1 px-2 py-2 ${visibleNavItems.length <= 1 ? 'grid-cols-1' : visibleNavItems.length <= 2 ? 'grid-cols-2' : visibleNavItems.length <= 3 ? 'grid-cols-3' : visibleNavItems.length <= 5 ? 'grid-cols-5' : 'grid-cols-6'}`}>
          {visibleNavItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex min-h-16 flex-col items-center justify-center rounded-lg text-[11px] font-semibold ${
                    isActive ? 'bg-campo-50 text-campo-700' : 'text-slate-500'
                  }`
                }
              >
                <Icon size={22} />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
