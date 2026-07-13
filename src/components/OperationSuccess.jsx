import { CheckCircle2, FileText, RotateCcw } from 'lucide-react'

// Pantalla completa de éxito tras guardar una operación (ingreso o salida):
// reemplaza al formulario para no dejar la lista vieja a la vista.
export default function OperationSuccess({
  titulo,
  guide,
  empresa,
  itemsCount,
  totalLabel,
  onViewReceipt,
  onNew,
  newLabel,
  onBack,
}) {
  return (
    <div className="mx-auto max-w-lg">
      <div className="overflow-hidden rounded-2xl border border-campo-200 bg-white shadow-soft">
        <div className="bg-campo-50 px-6 py-10 text-center">
          <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-campo-100">
            <CheckCircle2 size={44} className="text-campo-700" />
          </span>
          <h2 className="mt-4 text-xl font-black text-campo-900">{titulo}</h2>
          {guide ? (
            <p className="mt-3 inline-block rounded-lg border-2 border-campo-600 px-5 py-1.5 font-mono text-lg font-black tracking-wide text-campo-700">
              {guide}
            </p>
          ) : null}
        </div>

        <div className="divide-y divide-slate-100 px-6">
          <SummaryRow label="Empresa" value={empresa || '—'} />
          <SummaryRow label="Productos" value={itemsCount} />
          {totalLabel ? <SummaryRow label="Cantidad total" value={totalLabel} strong /> : null}
        </div>

        <div className="grid gap-2 px-6 py-6">
          <button className="btn-primary w-full" type="button" onClick={onViewReceipt}>
            <FileText size={18} /> Ver comprobante
          </button>
          {onNew ? (
            <button className="btn-secondary w-full" type="button" onClick={onNew}>
              <RotateCcw size={18} /> {newLabel}
            </button>
          ) : null}
          <button className="btn-secondary w-full" type="button" onClick={onBack}>
            Volver
          </button>
        </div>
      </div>
    </div>
  )
}

function SummaryRow({ label, value, strong }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-sm text-right ${strong ? 'font-black text-campo-700' : 'font-bold text-slate-900'}`}>{value}</p>
    </div>
  )
}
