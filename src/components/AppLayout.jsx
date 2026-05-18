import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Boxes, Home, LogOut, QrCode, ScanLine, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth.jsx'

const navItems = [
  { to: '/', label: 'Inicio', icon: Home },
  { to: '/lotes', label: 'Lotes', icon: Boxes },
  { to: '/scanner', label: 'Scan', icon: ScanLine },
  { to: '/clientes', label: 'Clientes', icon: Users },
]

export default function AppLayout() {
  const navigate = useNavigate()
  const { profile } = useAuth()

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-[#f6f7f3] pb-24">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-campo-600 text-white">
              <QrCode size={24} />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight text-slate-950">Agro WMS</h1>
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
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-5xl grid-cols-4 gap-1 px-2 py-2">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex min-h-16 flex-col items-center justify-center rounded-lg text-xs font-semibold ${
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
