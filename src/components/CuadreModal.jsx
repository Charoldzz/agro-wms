import { AlertTriangle, ChevronRight, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { equivalentLabel } from '../lib/format'
import { cleanProductName } from '../lib/display'

// Las empresas donde la cuenta de los movimientos no da lo mismo que el stock
// que hay hoy. Un descuadre significa que el papel y el depósito no dicen lo
// mismo: casi siempre falta cargar el movimiento de entrada de un lote.
export default function CuadreModal({ empresas, onClose }) {
  const navigate = useNavigate()

  const irAlKardex = (clientId) => {
    onClose()
    navigate('/kardex', { state: { clientId } })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl">

        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <AlertTriangle size={22} className="mt-0.5 shrink-0 text-orange-600" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black text-slate-950">
              {empresas.length === 1
                ? '1 empresa con la cuenta descuadrada'
                : `${empresas.length} empresas con la cuenta descuadrada`}
            </h2>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">
              Lo que sale de sumar los movimientos no da lo mismo que el stock que hay hoy.
              Lo más común es que falte cargar el ingreso de ese lote.
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

        <div className="max-h-[70vh] overflow-y-auto">
          {empresas.map((e) => (
            <div key={e.client_id} className="border-b border-slate-100 last:border-b-0">
              <button
                type="button"
                onClick={() => irAlKardex(e.client_id)}
                className="flex w-full items-center gap-3 bg-slate-50 px-5 py-3 text-left transition hover:bg-orange-50"
              >
                <span className="min-w-0 flex-1 text-sm font-black text-slate-900 [overflow-wrap:anywhere]">
                  {e.cliente}
                </span>
                <span className="shrink-0 text-xs font-bold text-orange-800">
                  {e.lotes === 1 ? '1 lote' : `${e.lotes} lotes`}
                </span>
                <ChevronRight size={16} className="shrink-0 text-slate-400" />
              </button>

              <div className="divide-y divide-slate-100">
                {(e.detalle || []).slice(0, 6).map((d, i) => (
                  <div key={i} className="grid grid-cols-1 gap-1 px-5 py-2.5 sm:grid-cols-[1fr_auto]">
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-slate-800 [overflow-wrap:anywhere]">
                        {cleanProductName(d.producto)}
                      </p>
                      {d.lote ? (
                        <p className="text-[11px] font-semibold text-slate-500">Lote {d.lote}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-4 text-right sm:justify-end">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Movimientos</p>
                        <p className="text-[13px] font-black text-slate-700">
                          {equivalentLabel(d.segun_movimientos, d.unidad)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Stock hoy</p>
                        <p className="text-[13px] font-black text-campo-700">
                          {equivalentLabel(d.stock_actual, d.unidad)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Falta</p>
                        <p className="text-[13px] font-black text-orange-700">
                          {equivalentLabel(Math.abs(Number(d.diferencia || 0)), d.unidad)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                {(e.detalle || []).length > 6 && (
                  <p className="px-5 py-2 text-[11px] font-bold text-slate-500">
                    …y {e.detalle.length - 6} lotes más. Tocá la empresa para verlos en el Kardex.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-5 py-3">
          <p className="text-[11px] font-semibold text-slate-500">
            Tocá una empresa para abrir su Kardex y ver movimiento por movimiento.
          </p>
        </div>
      </div>
    </div>
  )
}
