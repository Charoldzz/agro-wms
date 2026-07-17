import { CheckCircle2, FileText, RotateCcw } from 'lucide-react'
import { formatNumber, formatDate } from '../lib/format'
import { desgloseEnvases } from '../lib/envases'

function cantidadTexto(row) {
  const size = Number(row.package_size) || 0
  return size > 0 && row.package_unit
    ? `${formatNumber(Number(row.cantidad || 0))} ${row.package_unit}`
    : `${formatNumber(Number(row.cantidad || 0))} uds`
}

function envaseTexto(row) {
  const size = Number(row.package_size) || 0
  if (!(size > 0)) return ''
  return desgloseEnvases(Number(row.cantidad || 0), size, row.package_unit, 0).unidadesLabel || ''
}

// Pantalla completa de éxito tras guardar una operación (ingreso o salida):
// reemplaza al formulario para no dejar la lista vieja a la vista.
export default function OperationSuccess({
  titulo,
  guide,
  empresa,
  itemsCount,
  totalLabel,
  rows,
  isSalida,
  onViewReceipt,
  onNew,
  newLabel,
  onBack,
}) {
  return (
    <div className="mx-auto max-w-lg">
      <div className="overflow-hidden rounded-2xl border border-campo-200 bg-white shadow-soft">
        <div className="bg-campo-50 px-6 py-8 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-campo-100">
            <CheckCircle2 size={38} className="text-campo-700" />
          </span>
          <h2 className="mt-3 text-xl font-black text-campo-900">{titulo}</h2>
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

        {/* Detalle de productos */}
        {Array.isArray(rows) && rows.length > 0 && (
          <div className="px-6 pt-3">
            <p className="mb-1.5 text-[10px] font-black uppercase tracking-wide text-slate-400">Detalle</p>
            <div className="space-y-1">
              {rows.map((row, i) => (
                <div key={i} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 text-sm font-bold text-slate-800 [overflow-wrap:anywhere]">{row.product}</p>
                    <p className={`shrink-0 text-sm font-black ${isSalida ? 'text-red-700' : 'text-campo-700'}`}>{cantidadTexto(row)}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold text-slate-400">
                      Lote {row.lot_code}{row.expiry_date ? ` · Vence ${formatDate(row.expiry_date)}` : ''}
                    </p>
                    {envaseTexto(row) ? <p className="shrink-0 text-[10px] font-semibold text-slate-400">{envaseTexto(row)}</p> : null}
                  </div>
                  {row.note ? <p className="text-[10px] font-semibold italic text-amber-700">Obs.: {row.note}</p> : null}
                </div>
              ))}
            </div>
          </div>
        )}

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
