import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth.jsx'
import AppLayout from './components/AppLayout'
import ConfigWarning from './components/ConfigWarning'
import AppVersion from './components/AppVersion'
import InteractionGuard from './components/InteractionGuard'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Clients from './pages/Clients'
import Lots from './pages/Lots'
import LotDetail from './pages/LotDetail'
import Scanner from './pages/Scanner'
import Movements from './pages/Movements'
import ProductLots from './pages/ProductLots'
import Operation from './pages/Operation'
import ExpiringLots from './pages/ExpiringLots'
import OperatorEntry from './pages/OperatorEntry'
import NuevaSalida from './pages/NuevaSalida'
import Kardex from './pages/Kardex'
import OperatorService from './pages/OperatorService'
import DispatchList from './pages/DispatchList'
import OfflineAudit from './pages/OfflineAudit'
import QrGate from './pages/QrGate'
import ClientPortal from './pages/ClientPortal'
import ClientRequestsAdmin from './pages/ClientRequestsAdmin'
import AdminPending from './pages/AdminPending'
import CorrectionRequests from './pages/CorrectionRequests'
import AdminExports from './pages/AdminExports'
import Backups from './pages/Backups'
import ProductCatalog from './pages/ProductCatalog'
import { isSupabaseConfigured } from './lib/supabase'

function ProtectedRoute({ children }) {
  const { user, profile, loading, profileLoading } = useAuth()

  if (!isSupabaseConfigured) return <ConfigWarning />
  if (loading || (user && profileLoading && !profile)) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />

  return children
}

function RoleRoute({ roles, children }) {
  const { profile, profileLoading } = useAuth()

  if (profileLoading && !profile) return <LoadingScreen />
  if (!roles.includes(profile?.role)) return <Navigate to="/" replace />

  return children
}

function AppRoutes() {
  const { profile, profileLoading } = useAuth()
  if (profileLoading && !profile) return <LoadingScreen />

  const homeElement = profile?.role === 'cliente' ? <ClientPortal /> : <Navigate to="/lotes" replace />

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={homeElement} />
        <Route path="operacion" element={<Operation />} />
        <Route path="qr/:token" element={<QrGate />} />
        <Route path="operacion/nuevo-ingreso" element={<RoleRoute roles={['administrador', 'operador']}><OperatorEntry /></RoleRoute>} />
        <Route path="nueva-salida" element={<RoleRoute roles={['administrador', 'operador']}><NuevaSalida /></RoleRoute>} />
        <Route path="kardex" element={<RoleRoute roles={['administrador', 'operador']}><Kardex /></RoleRoute>} />
        <Route path="operacion/despacho-lista" element={<RoleRoute roles={['administrador', 'operador']}><DispatchList /></RoleRoute>} />
        <Route path="operacion/reparacion-traslado" element={<RoleRoute roles={['administrador', 'operador']}><OperatorService /></RoleRoute>} />
        <Route path="operacion/correcciones" element={<RoleRoute roles={['administrador', 'operador']}><CorrectionRequests /></RoleRoute>} />
        <Route path="clientes" element={<RoleRoute roles={['administrador']}><Clients /></RoleRoute>} />
        <Route path="lotes" element={<RoleRoute roles={['administrador', 'operador', 'cliente']}><Lots /></RoleRoute>} />
        <Route path="lotes/:id" element={<LotDetail />} />
        <Route path="productos/:name" element={<RoleRoute roles={['administrador', 'operador', 'cliente']}><ProductLots /></RoleRoute>} />
        <Route path="vencimientos" element={<RoleRoute roles={['administrador', 'operador', 'cliente']}><ExpiringLots /></RoleRoute>} />
        <Route path="scanner" element={<Scanner />} />
        <Route path="movimientos" element={<RoleRoute roles={['administrador', 'operador']}><Movements /></RoleRoute>} />
        <Route path="offline" element={<RoleRoute roles={['administrador']}><OfflineAudit /></RoleRoute>} />
        <Route path="solicitudes" element={<RoleRoute roles={['administrador']}><ClientRequestsAdmin /></RoleRoute>} />
        <Route path="despachos" element={<RoleRoute roles={['cliente']}><ClientPortal view="requests" /></RoleRoute>} />
        <Route path="historial" element={<RoleRoute roles={['cliente']}><ClientPortal view="movements" /></RoleRoute>} />
        <Route path="pendientes" element={<RoleRoute roles={['administrador']}><AdminPending /></RoleRoute>} />
        <Route path="exportes" element={<RoleRoute roles={['administrador']}><AdminExports /></RoleRoute>} />
        <Route path="backups" element={<RoleRoute roles={['administrador']}><Backups /></RoleRoute>} />
        <Route path="catalogo" element={<RoleRoute roles={['administrador']}><ProductCatalog /></RoleRoute>} />
      </Route>
    </Routes>
  )
}

function LoadingScreen() {
  return (
    <div className="app-bg flex min-h-screen items-center justify-center p-4">
      <div className="rounded-lg border border-slate-200 bg-white/95 px-5 py-4 text-center shadow-soft">
        <p className="text-sm font-black text-slate-950">Preparando app...</p>
        <p className="mt-1 text-xs font-semibold text-slate-500">Un momento.</p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <InteractionGuard />
      <AppRoutes />
      <AppVersion />
    </AuthProvider>
  )
}
