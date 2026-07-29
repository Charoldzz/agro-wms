import { useState } from 'react'
import { X, LifeBuoy, Bug, AlertTriangle, Lightbulb, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { APP_VERSION } from '../lib/version'

// Tipos de reporte, en lenguaje de cliente (no técnico)
const TIPOS = [
  { key: 'bug',    label: 'Algo no funciona', Icon: Bug,           hint: 'Un botón que no responde, algo que falla' },
  { key: 'error',  label: 'Un dato está mal', Icon: AlertTriangle, hint: 'Una cantidad, un nombre o un total incorrecto' },
  { key: 'mejora', label: 'Una sugerencia',   Icon: Lightbulb,     hint: 'Algo que te gustaría que mejore' },
]

const PAGE_LABELS = { inventory: 'Inventario', requests: 'Solicitudes', movements: 'Movimientos' }

export default function FeedbackModal({ page = 'inventory', onClose }) {
  const [tipo, setTipo] = useState('bug')
  const [mensaje, setMensaje] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!mensaje.trim()) { setError('Escribí una breve descripción.'); return }
    setSending(true); setError('')
    const { error: e } = await supabase.rpc('submit_portal_feedback', {
      p_tipo: tipo,
      p_mensaje: mensaje.trim(),
      p_page: PAGE_LABELS[page] || page,
      p_app_version: APP_VERSION,
      p_user_agent: navigator.userAgent,
    })
    setSending(false)
    if (e) { setError('No se pudo enviar. Revisá tu conexión e intentá de nuevo.'); return }
    setDone(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-campo-100"><LifeBuoy size={18} className="text-campo-700" /></div>
            <div>
              <p className="font-black leading-tight text-slate-950">Contactar a soporte</p>
              <p className="text-xs font-semibold text-slate-500">Reportá un problema o una sugerencia</p>
            </div>
          </div>
          <button className="rounded-lg p-1 text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </div>

        {done ? (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-campo-50 ring-8 ring-campo-100"><CheckCircle2 size={34} className="text-campo-600" /></div>
            <h2 className="mt-4 text-xl font-black text-slate-950">¡Gracias por avisar!</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">Recibimos tu reporte. El equipo de Todo Agrícola lo va a revisar.</p>
            <button className="btn-primary mt-6 w-full" type="button" onClick={onClose}>Listo</button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">¿Qué querés reportar?</p>
              <div className="grid gap-2">
                {TIPOS.map(({ key, label, Icon, hint }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTipo(key)}
                    className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition ${tipo === key ? 'border-campo-500 bg-campo-50 ring-1 ring-campo-500' : 'border-slate-200 hover:bg-slate-50'}`}
                  >
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tipo === key ? 'bg-campo-600 text-white' : 'bg-slate-100 text-slate-500'}`}><Icon size={17} /></div>
                    <div>
                      <p className="text-sm font-black text-slate-900">{label}</p>
                      <p className="text-xs font-semibold text-slate-500">{hint}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Contanos qué pasó</span>
              <textarea
                className="input mt-1.5 w-full"
                rows={5}
                value={mensaje}
                maxLength={2000}
                onChange={e => setMensaje(e.target.value)}
                placeholder="Describí lo que viste o lo que te gustaría. Cuanto más detalle, mejor."
                autoFocus
              />
            </label>

            <p className="text-[11px] font-semibold text-slate-400">
              Se enviará junto con la pantalla donde estás y la versión de la app, para ayudarnos a resolverlo más rápido.
            </p>

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}

            <button className="btn-primary w-full" type="button" onClick={submit} disabled={sending}>
              {sending ? 'Enviando...' : 'Enviar reporte'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
