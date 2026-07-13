import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { supabase } from '../lib/supabase'

// Pantalla que ve un usuario invitado al aceptar la invitación:
// crea su contraseña y recién ahí pasa a la app (portal o almacén según rol).
export default function SetPassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    if (password.length < 6) return setError('La contraseña debe tener al menos 6 caracteres.')
    if (password !== confirm) return setError('Las contraseñas no coinciden.')
    setSaving(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (err) return setError(err.message)
    onDone()
  }

  return (
    <div className="app-bg flex min-h-screen items-center justify-center p-4">
      <form className="w-full max-w-sm rounded-xl border border-slate-200 bg-white/95 p-5 shadow-soft" onSubmit={handleSubmit}>
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-campo-50 text-campo-700">
            <KeyRound size={20} />
          </span>
          <div>
            <h1 className="text-base font-black text-slate-950">Bienvenido</h1>
            <p className="text-xs font-semibold text-slate-500">Creá tu contraseña para entrar</p>
          </div>
        </div>

        <label className="block">
          <span className="label">Contraseña nueva</span>
          <input
            className="input mt-1 w-full"
            type="password"
            required
            minLength={6}
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="mt-3 block">
          <span className="label">Repetir contraseña</span>
          <input
            className="input mt-1 w-full"
            type="password"
            required
            minLength={6}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </label>

        {error ? <p className="mt-3 text-xs font-bold text-red-600">{error}</p> : null}

        <button className="btn-primary mt-4 w-full" type="submit" disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar y entrar'}
        </button>
      </form>
    </div>
  )
}
