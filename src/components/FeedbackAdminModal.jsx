import { useEffect, useState } from 'react'
import { X, LifeBuoy, Bug, AlertTriangle, Lightbulb, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/format'

const TIPO_META = {
  bug:    { label: 'No funciona', Icon: Bug,           cls: 'bg-red-100 text-red-700' },
  error:  { label: 'Dato mal',    Icon: AlertTriangle, cls: 'bg-amber-100 text-amber-700' },
  mejora: { label: 'Sugerencia',  Icon: Lightbulb,     cls: 'bg-blue-100 text-blue-700' },
}
const STATUS_META = {
  nuevo:    { label: 'Nuevo',    cls: 'bg-campo-100 text-campo-800' },
  visto:    { label: 'Visto',    cls: 'bg-slate-200 text-slate-700' },
  resuelto: { label: 'Resuelto', cls: 'bg-emerald-100 text-emerald-700' },
}
const FILTERS = [['', 'Todos'], ['nuevo', 'Nuevos'], ['visto', 'Vistos'], ['resuelto', 'Resueltos']]

export default function FeedbackAdminModal({ onClose }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('portal_feedback').select('*').order('created_at', { ascending: false })
    setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function setStatus(id, status) {
    setBusy(id)
    await supabase.from('portal_feedback')
      .update({ status, resolved_at: status === 'resuelto' ? new Date().toISOString() : null })
      .eq('id', id)
    setBusy('')
    load()
  }

  async function remove(id) {
    if (!window.confirm('¿Eliminar este reporte? No se puede deshacer.')) return
    setBusy(id)
    await supabase.from('portal_feedback').delete().eq('id', id)
    setBusy('')
    load()
  }

  const filtered = filter ? rows.filter(r => r.status === filter) : rows
  const nuevos = rows.filter(r => r.status === 'nuevo').length

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-white shadow-xl sm:h-[88vh] sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-campo-100"><LifeBuoy size={18} className="text-campo-700" /></div>
            <div>
              <p className="font-black leading-tight text-slate-950">Reportes de soporte</p>
              <p className="text-xs font-semibold text-slate-500">{nuevos > 0 ? `${nuevos} nuevo${nuevos === 1 ? '' : 's'} sin revisar` : 'Reportes de los clientes'}</p>
            </div>
          </div>
          <button className="rounded-lg p-1 text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-slate-100 px-4 py-2.5">
          {FILTERS.map(([v, l]) => (
            <button key={v} type="button" onClick={() => setFilter(v)}
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${filter === v ? 'bg-campo-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {l}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <p className="py-12 text-center text-sm font-bold text-slate-400">Cargando...</p>
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-sm font-bold text-slate-400">Sin reportes.</p>
          ) : (
            <div className="space-y-2.5">
              {filtered.map(r => {
                const t = TIPO_META[r.tipo] || {}
                const TIcon = t.Icon
                return (
                  <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-black ${t.cls || 'bg-slate-100 text-slate-700'}`}>
                        {TIcon && <TIcon size={12} />}{t.label || r.tipo}
                      </span>
                      <span className={`rounded px-2 py-0.5 text-[11px] font-black ${STATUS_META[r.status]?.cls || 'bg-slate-100 text-slate-700'}`}>
                        {STATUS_META[r.status]?.label || r.status}
                      </span>
                      <span className="text-xs font-semibold text-slate-400">{formatDate(r.created_at)}</span>
                    </div>

                    <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold text-slate-800">{r.mensaje}</p>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-slate-400">
                      <span>{r.client_name || 'Sin empresa'}</span>
                      <span>{r.reporter_email || r.reporter_name || '—'}</span>
                      <span>Pantalla: {r.page || '—'}</span>
                      <span>{r.app_version || '—'}</span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5">
                      {r.status !== 'visto' && (
                        <button disabled={busy === r.id} onClick={() => setStatus(r.id, 'visto')}
                          className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 transition hover:bg-slate-200 disabled:opacity-50">Marcar visto</button>
                      )}
                      {r.status !== 'resuelto' && (
                        <button disabled={busy === r.id} onClick={() => setStatus(r.id, 'resuelto')}
                          className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700 transition hover:bg-emerald-200 disabled:opacity-50">Marcar resuelto</button>
                      )}
                      {r.status !== 'nuevo' && (
                        <button disabled={busy === r.id} onClick={() => setStatus(r.id, 'nuevo')}
                          className="rounded-lg bg-campo-100 px-2.5 py-1 text-xs font-bold text-campo-800 transition hover:bg-campo-200 disabled:opacity-50">Reabrir</button>
                      )}
                      <button disabled={busy === r.id} onClick={() => remove(r.id)}
                        className="ml-auto rounded-lg p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50" title="Eliminar"><Trash2 size={15} /></button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 px-4 py-2 text-xs font-semibold text-slate-400">
          {filtered.length} reporte{filtered.length !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  )
}
