import { useState } from 'react'
import { MailWarning, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/format'

// Los avisos que NO le llegaron al cliente. No es un historial de correos:
// acá solo entra lo que falló, para poder resolverlo.
export default function CorreosFallidosModal({ fallos, onClose, onResuelto }) {
  const [resolviendo, setResolviendo] = useState(null)

  const marcarResuelto = async (id) => {
    setResolviendo(id)
    const { error } = await supabase.rpc('resolver_correo_fallido', { p_id: id })
    setResolviendo(null)
    if (!error) onResuelto?.()
  }

  const etiqueta = (tipo) => (tipo === 'inventario' ? 'Resumen de inventario' : 'Aviso de movimiento')

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl">

        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <MailWarning size={22} className="mt-0.5 shrink-0 text-orange-600" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black text-slate-950">
              {fallos.length === 1
                ? '1 aviso no le llegó al cliente'
                : `${fallos.length} avisos no le llegaron al cliente`}
            </h2>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">
              El movimiento se guardó bien; lo que falló fue el correo. Avisale al cliente
              por otro medio, o corregí su dirección en Empresas → Acceso al portal.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>

        <div className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
          {fallos.map((f) => (
            <div key={f.id} className="px-5 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-black text-slate-900 [overflow-wrap:anywhere]">
                  {f.client_name || 'Empresa sin nombre'}
                </span>
                {f.guia ? (
                  <span className="font-mono text-xs font-bold text-campo-700">{f.guia}</span>
                ) : null}
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                  {etiqueta(f.tipo)}
                </span>
                <span className="text-xs font-semibold text-slate-400">{formatDate(f.created_at)}</span>
              </div>

              {f.destinatarios?.length ? (
                <p className="mt-1 text-xs font-semibold text-slate-600 [overflow-wrap:anywhere]">
                  No llegó a: {f.destinatarios.join(' · ')}
                </p>
              ) : null}

              {f.motivo ? (
                <p className="mt-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 [overflow-wrap:anywhere]">
                  {String(f.motivo).slice(0, 300)}
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => marcarResuelto(f.id)}
                disabled={resolviendo === f.id}
                className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {resolviendo === f.id ? 'Guardando...' : 'Ya lo resolví'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
