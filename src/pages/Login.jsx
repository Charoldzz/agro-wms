import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Lock, Mail } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth.jsx'
import ConfigWarning from '../components/ConfigWarning'

export default function Login() {
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!isSupabaseConfigured) return <ConfigWarning />
  if (user) return <Navigate to="/" replace />

  async function handleSubmit(event) {
    event.preventDefault()
    setLoading(true)
    setError('')

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) setError('Credenciales incorrectas o usuario no registrado.')
    setLoading(false)
  }

  return (
    <div className="app-bg flex min-h-screen items-center justify-center p-4">
      <form className="panel w-full max-w-md" onSubmit={handleSubmit}>
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-950">Agro WMS</h1>
          <p className="mt-2 text-slate-600">Control simple de lotes agrícolas con QR.</p>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="label">Correo</span>
            <div className="mt-1 flex items-center rounded-lg border border-slate-200 bg-white px-3">
              <Mail className="text-slate-400" size={20} />
              <input
                className="min-h-12 flex-1 border-0 bg-transparent px-3 outline-none"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
          </label>
          <label className="block">
            <span className="label">Contraseña</span>
            <div className="mt-1 flex items-center rounded-lg border border-slate-200 bg-white px-3">
              <Lock className="text-slate-400" size={20} />
              <input
                className="min-h-12 flex-1 border-0 bg-transparent px-3 outline-none"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
          </label>
        </div>

        {error ? <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p> : null}

        <button className="btn-primary mt-6 w-full" disabled={loading}>
          {loading ? 'Ingresando...' : 'Ingresar'}
        </button>
      </form>
    </div>
  )
}
