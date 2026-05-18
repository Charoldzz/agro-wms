import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth.jsx'
import AppLayout from './components/AppLayout'
import ConfigWarning from './components/ConfigWarning'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Clients from './pages/Clients'
import Lots from './pages/Lots'
import LotDetail from './pages/LotDetail'
import Scanner from './pages/Scanner'
import Movements from './pages/Movements'
import { isSupabaseConfigured } from './lib/supabase'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  if (!isSupabaseConfigured) return <ConfigWarning />
  if (loading) return <div className="p-6 text-center text-slate-600">Cargando...</div>
  if (!user) return <Navigate to="/login" replace />

  return children
}

function AppRoutes() {
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
        <Route index element={<Dashboard />} />
        <Route path="clientes" element={<Clients />} />
        <Route path="lotes" element={<Lots />} />
        <Route path="lotes/:id" element={<LotDetail />} />
        <Route path="scanner" element={<Scanner />} />
        <Route path="movimientos" element={<Movements />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
