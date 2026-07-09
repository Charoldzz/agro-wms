import { useState } from 'react'
import { Edit2, Trash2, X } from 'lucide-react'
import { formatNumber } from '../lib/format'

export default function ListProductCard({
  title,
  boxes,
  unidades,
  unidadesLabel = 'env.',
  unidadesVariant = 'neutral',
  equivalent,
  equivalentUnit,
  presentation,
  secondary,
  detailTitle = 'Producto en la lista',
  detailRows = [],
  onEdit,
  onRemove,
  children,
}) {
  const [open, setOpen] = useState(false)

  function openDetail() {
    setOpen(true)
  }

  function openDetailWithKeyboard(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openDetail()
    }
  }

  return (
    <>
      <article
        className="grid cursor-pointer gap-2 rounded-lg border-2 border-campo-200 bg-white p-3 transition hover:border-campo-300 hover:bg-campo-50/40 focus:border-campo-400 focus:bg-campo-50 focus:outline-none focus:ring-2 focus:ring-campo-100 active:scale-[0.995] sm:grid-cols-[1fr_auto]"
        role="button"
        tabIndex={0}
        onClick={openDetail}
        onKeyDown={openDetailWithKeyboard}
        title="Ver detalle del producto"
      >
        <div className="min-w-0 text-left">
          <p className="text-base font-black leading-snug text-slate-950 [overflow-wrap:anywhere]">{title}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {boxes !== undefined && boxes !== null ? (
              <strong className="rounded-lg bg-campo-50 px-2 py-1 text-sm font-black text-campo-800">{formatNumber(boxes)} cajas</strong>
            ) : null}
            {unidades !== undefined && unidades !== null ? (
              <strong className={`rounded-lg px-2 py-1 text-sm font-black ${unidadesVariant === 'available' ? 'bg-campo-50 text-campo-800' : 'bg-slate-100 text-slate-800'}`}>
                {formatNumber(unidades)} {unidadesLabel}
              </strong>
            ) : null}
            {equivalent !== undefined && equivalent !== null && Number.isFinite(Number(equivalent)) ? (
              <strong className="rounded-lg bg-maiz/25 px-2 py-1 text-sm font-black text-slate-900">
                {formatNumber(equivalent)} {equivalentUnit || ''}
              </strong>
            ) : null}
          </div>
          {presentation ? <p className="mt-2 text-xs font-bold text-slate-600">Presentacion: {presentation}</p> : null}
          {secondary ? <p className="text-xs font-semibold text-slate-500 [overflow-wrap:anywhere]">{secondary}</p> : null}
        </div>
        {onEdit || onRemove ? (
          <div className="flex gap-1 sm:grid sm:self-start" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            {onEdit ? (
              <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={onEdit} title="Editar producto">
                <Edit2 size={17} />
              </button>
            ) : null}
            {onRemove ? (
              <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={onRemove} title="Quitar producto">
                <Trash2 size={17} />
              </button>
            ) : null}
          </div>
        ) : null}
        {children ? <div className="sm:col-span-2" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>{children}</div> : null}
      </article>

      {open ? (
        <div data-modal-backdrop="true" className="fixed inset-0 z-50 flex items-end overflow-y-auto bg-slate-950/45 p-4 sm:items-center sm:justify-center" onClick={() => setOpen(false)}>
          <section data-overlay-panel="true" className="max-h-[92dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-xl bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase text-campo-700">{detailTitle}</p>
                <h3 className="mt-1 text-lg font-black leading-snug text-slate-950 [overflow-wrap:anywhere]">{title}</h3>
              </div>
              <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={() => setOpen(false)} title="Cerrar">
                <X size={18} />
              </button>
            </div>
            <dl className="mt-4 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-700">
              {detailRows.map((row) => (
                <DetailRow key={`${row.label}-${row.value}`} label={row.label} value={row.value} />
              ))}
            </dl>
          </section>
        </div>
      ) : null}
    </>
  )
}

function DetailRow({ label, value }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,13rem)] items-start gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right text-slate-950 [overflow-wrap:anywhere]">{value || '-'}</dd>
    </div>
  )
}
