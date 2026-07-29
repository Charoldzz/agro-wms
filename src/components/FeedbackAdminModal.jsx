import { useEffect, useState } from 'react'
import { X, LifeBuoy, Bug, AlertTriangle, Lightbulb, Trash2, Search, StickyNote } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/format'

const TIPO_META = {
  bug:    { label: 'No funciona', Icon: Bug,           cls: 'bg-red-100 text-red-700' },
  error:  { label: 'Dato mal',    Icon: AlertTriangle, cls: 'bg-amber-100 text-amber-700' },
  mejora: { label: 'Sugerencia',  Icon: Lightbulb,     cls: 'bg-blue-100 text-blue-700' },
}
const STATUS_META = {
  nuevo:    { label: 'Nuevo',    cls: 'bg-campo-100 text-campo-800' },
  resuelto: { label: 'Resuelto', cls: 'bg-emerald-100 text-emerald-700' },
}
const STATUS_FILTERS = [['', 'Todos'], ['nuevo', 'Nuevos'], ['resuelto', 'Resueltos']]

export default function FeedbackAdminModal({ onClose }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [tipoFilter, setTipoFilter] = useState('')
  const [search, setSearch] = useState('')
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

  async function saveNote(id, admin_notes) {
    await supabase.from('portal_feedback').update({ admin_notes }).eq('id', id)
    setRows(rows => rows.map(r => (r.id === id ? { ...r, admin_notes } : r)))
  }

  const q = search.trim().toLowerCase()
  const filtered = rows.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false
    if (tipoFilter && r.tipo !== tipoFilter) return false
    if (q) {
      const hay = `${r.mensaje || ''} ${r.client_name || ''} ${r.reporter_email || ''} ${r.page || ''} ${r.admin_notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
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

        {/* Buscador + filtro por tipo */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          <div className="relative min-w-[160px] flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input w-full pl-8 text-sm"
              placeholder="Buscar en reportes, empresa, correo..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select className="input text-sm sm:w-44" value={tipoFilter} onChange={e => setTipoFilter(e.target.value)}>
            <option value="">Todos los tipos</option>
            <option value="bug">No funciona</option>
            <option value="error">Dato mal</option>
            <option value="mejora">Sugerencia</option>
          </select>
        </div>

        {/* Filtro por estado */}
        <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-slate-100 px-4 py-2.5">
          {STATUS_FILTERS.map(([v, l]) => (
            <button key={v} type="button" onClick={() => setStatusFilter(v)}
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${statusFilter === v ? 'bg-campo-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
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
              {filtered.map(r => (
                <ReportRow key={r.id} r={r} busy={busy === r.id} onStatus={setStatus} onDelete={remove} onSaveNote={saveNote} />
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 px-4 py-2 text-xs font-semibold text-slate-400">
          {filtered.length} reporte{filtered.length !== 1 ? 's' : ''}{filtered.length !== rows.length ? ` de ${rows.length}` : ''}
        </div>
      </div>
    </div>
  )
}

function ReportRow({ r, busy, onStatus, onDelete, onSaveNote }) {
  const [openNote, setOpenNote] = useState(false)
  const [note, setNote] = useState(r.admin_notes || '')
  const [saved, setSaved] = useState(r.admin_notes || '')
  const [savingNote, setSavingNote] = useState(false)
  const dirty = note !== saved

  async function save() {
    setSavingNote(true)
    await onSaveNote(r.id, note.trim())
    setSaved(note.trim())
    setNote(note.trim())
    setSavingNote(false)
  }

  const t = TIPO_META[r.tipo] || {}
  const TIcon = t.Icon

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5">
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

      {/* Nota interna (privada del admin) */}
      <div className="mt-2.5">
        <button
          type="button"
          onClick={() => setOpenNote(o => !o)}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 transition hover:text-campo-700"
        >
          <StickyNote size={13} />
          {saved ? 'Nota interna' : 'Agregar nota interna'}
          {saved && <span className="h-1.5 w-1.5 rounded-full bg-campo-500" />}
        </button>
        {!openNote && saved && (
          <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-600">{saved}</p>
        )}
        {openNote && (
          <div className="mt-1.5">
            <textarea
              className="input w-full text-xs"
              rows={2}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Nota privada, solo la ve el admin (ej: 'ya le escribí', 'es del programa C#')..."
            />
            {dirty && (
              <button
                type="button"
                onClick={save}
                disabled={savingNote}
                className="mt-1 rounded-lg bg-campo-100 px-2.5 py-1 text-xs font-bold text-campo-800 transition hover:bg-campo-200 disabled:opacity-50"
              >
                {savingNote ? 'Guardando...' : 'Guardar nota'}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5">
        {r.status !== 'resuelto' ? (
          <button disabled={busy} onClick={() => onStatus(r.id, 'resuelto')}
            className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700 transition hover:bg-emerald-200 disabled:opacity-50">Marcar resuelto</button>
        ) : (
          <button disabled={busy} onClick={() => onStatus(r.id, 'nuevo')}
            className="rounded-lg bg-campo-100 px-2.5 py-1 text-xs font-bold text-campo-800 transition hover:bg-campo-200 disabled:opacity-50">Reabrir</button>
        )}
        <button disabled={busy} onClick={() => onDelete(r.id)}
          className="ml-auto rounded-lg p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50" title="Eliminar"><Trash2 size={15} /></button>
      </div>
    </div>
  )
}
