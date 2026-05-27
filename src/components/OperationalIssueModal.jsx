import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

const issueTypes = [
  { value: 'qr_danado', label: 'QR dañado' },
  { value: 'producto_danado', label: 'Producto dañado' },
  { value: 'ubicacion_no_coincide', label: 'No coincide ubicación' },
  { value: 'falta_producto', label: 'Falta producto' },
  { value: 'otro', label: 'Otro' },
]

export default function OperationalIssueModal({ lot, userId, onClose }) {
  const [issueType, setIssueType] = useState('qr_danado')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function saveIssue() {
    setSaving(true)
    setError('')

    const { error: issueError } = await supabase.from('operational_issue_reports').insert({
      lot_id: lot.id,
      issue_type: issueType,
      notes: notes.trim() || null,
      reported_by: userId,
    })

    if (issueError) {
      setError(issueError.message?.includes('operational_issue_reports') ? 'Falta actualizar el SQL de reportes operativos.' : issueError.message)
      setSaving(false)
      return
    }

    setStatus('Reporte enviado a administración.')
    setSaving(false)
  }

  return (
    <div data-modal-backdrop="true" className="fixed inset-0 z-50 flex items-end overflow-y-auto bg-slate-950/45 p-4 sm:items-center sm:justify-center" onClick={onClose}>
      <section className="max-h-[92dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-xl bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-orange-700">Almacen</p>
            <h3 className="text-xl font-black text-slate-950">Reportar problema</h3>
          </div>
          <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={onClose} title="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="mt-3 rounded-lg bg-orange-50 p-3 text-sm font-bold text-orange-900">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} />
            <span className="min-w-0 [overflow-wrap:anywhere]">{lot.product}</span>
          </div>
          <p className="mt-1 text-xs font-semibold text-orange-800">Lote {lot.lot_code}</p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {issueTypes.map((item) => (
            <button
              key={item.value}
              className={`min-h-12 rounded-lg border px-2 py-2 text-sm font-black ${
                issueType === item.value ? 'border-orange-500 bg-orange-50 text-orange-800' : 'border-slate-200 bg-white text-slate-700'
              }`}
              type="button"
              onClick={() => setIssueType(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <label className="mt-3 block">
          <span className="label">Observación</span>
          <textarea className="input mt-1" rows="3" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Opcional, explica lo que viste." />
        </label>

        {error ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
        {status ? <p className="mt-3 rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">{status}</p> : null}

        <button className="btn-primary mt-4 w-full" type="button" onClick={saveIssue} disabled={saving || Boolean(status)}>
          {saving ? 'Enviando...' : status ? 'Reporte enviado' : 'Enviar reporte'}
        </button>
      </section>
    </div>
  )
}
