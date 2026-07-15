import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Clock3, Paperclip, Printer, Truck, X } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useAuth } from '../hooks/useAuth.jsx'
import { cleanProductName, displayLotCode, packageLabel } from '../lib/display'
import { normalizeDispatchRequests } from '../lib/dispatchRequests'
import { itemEnvLabel, itemEqLabel } from '../lib/envases'
import { formatDate, formatNumber } from '../lib/format'
import { supabase } from '../lib/supabase'

function attachmentViewerUrl(url) {
  if (!url) return url
  const ext = url.split('?')[0].split('.').pop().toLowerCase()
  if (['xlsx', 'xls', 'docx', 'doc'].includes(ext))
    return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(url)}`
  return url
}

const STATUS_STYLES = {
  pendiente:      { border: 'border-l-amber-400',  bg: 'bg-amber-50',   badge: 'bg-amber-100 text-amber-800',   label: 'Pendiente' },
  aprobado:       { border: 'border-l-amber-400',  bg: 'bg-amber-50',   badge: 'bg-amber-100 text-amber-800',   label: 'Pendiente' },
  en_preparacion: { border: 'border-l-campo-500',  bg: 'bg-campo-50',   badge: 'bg-campo-100 text-campo-800',   label: 'En preparación' },
  despachado:     { border: 'border-l-slate-300',  bg: 'bg-white',      badge: 'bg-slate-100 text-slate-600',   label: 'Despachado' },
  rechazado:      { border: 'border-l-red-400',    bg: 'bg-red-50',     badge: 'bg-red-100 text-red-700',       label: 'Rechazado' },
  cancelado:      { border: 'border-l-slate-300',  bg: 'bg-white',      badge: 'bg-slate-100 text-slate-500',   label: 'Cancelada por el cliente' },
}

export default function ClientRequestsAdmin() {
  const { user } = useAuth()
  const location = useLocation()
  const pendingOnly = new URLSearchParams(location.search).get('pendientes') === '1'
  const [requests, setRequests] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    loadRequests()
    const channel = supabase
      .channel('client-dispatch-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_dispatch_requests' }, loadRequests)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [pendingOnly])

  async function loadRequests() {
    let query = supabase
      .from('client_dispatch_requests')
      .select('*, clients(name), lots(id, lot_code, client_id, product, current_quantity, package_size, package_unit, location, expiry_date, status), requested_by_profile:profiles!client_dispatch_requests_requested_by_fkey(full_name)')
      .order('created_at', { ascending: false })
    if (pendingOnly) query = query.in('status', ['pendiente', 'aprobado', 'en_preparacion'])
    const { data, error: requestError } = await query
    if (requestError) {
      setError('No se pudieron cargar las solicitudes. Ejecuta el SQL client_dispatch_requests.sql en Supabase.')
      setRequests([]); return
    }
    setError('')
    setRequests(await normalizeDispatchRequests(data || []))
  }

  async function reviewRequest(id, status) {
    const { error: updateError } = await supabase
      .from('client_dispatch_requests')
      .update({ status, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
      .eq('id', id)
    if (updateError) { setError(updateError.message); return }
    loadRequests()
  }

  return (
    <div>
      <PageHeader
        title={pendingOnly ? 'Despachos pendientes' : 'Solicitudes de despacho'}
        subtitle={pendingOnly ? 'Ordenes listas para preparar en almacen' : 'Pedidos enviados desde el portal cliente'}
      />
      {error ? <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

      <div className="space-y-2">
        {requests.length === 0 ? (
          <EmptyState title="Sin solicitudes" text="Cuando un cliente solicite despacho, aparecera aqui." />
        ) : requests.map((req) => {
          const st = STATUS_STYLES[req.status] || STATUS_STYLES.pendiente
          const isActive = req.status === 'pendiente' || req.status === 'aprobado' || req.status === 'en_preparacion'
          const items = Array.isArray(req.items) && req.items.length > 0 ? req.items : null
          const multiItem = items && items.length > 1

          return (
            <article key={req.id} className={`overflow-hidden rounded-xl border border-slate-200 border-l-4 ${st.border} ${st.bg} shadow-sm`}>
              {/* Header row */}
              <div className="flex items-start justify-between gap-3 px-3 pt-3 pb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-black text-slate-950">{req.clients?.name || 'Cliente'}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${st.badge}`}>{st.label}</span>
                  </div>
                  <p className="mt-0.5 text-[10px] font-semibold text-slate-400">
                    {req.requested_by_profile?.full_name || 'Usuario'} · {formatDate(req.created_at)}
                  </p>
                </div>
                <Truck size={16} className="mt-1 shrink-0 text-slate-400" />
              </div>

              {/* Products */}
              <div className="px-3 pb-2">
                {multiItem ? (
                  <div className="space-y-1">
                    {items.map(item => (
                      <div key={item.lot_id} className="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-2.5 py-1.5">
                        <div className="min-w-0">
                          <p className="text-xs font-black text-slate-900 [overflow-wrap:anywhere]">{cleanProductName(item.product)}</p>
                          <p className="text-[10px] font-semibold text-slate-400">{displayLotCode(item.lot_code)} · {packageLabel(item) || 'Sin presentación'}</p>
                          {item.note && <p className="text-[10px] font-semibold italic text-amber-700">Obs.: {item.note}</p>}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs font-black text-campo-700">{itemEqLabel(item)}</p>
                          {itemEnvLabel(item) ? <p className="text-[10px] font-semibold text-slate-400">{itemEnvLabel(item)}</p> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs font-semibold text-slate-700">
                    <span className="font-black">{cleanProductName(req.product || req.lots?.product)}</span>
                    {req.lots?.lot_code ? <span className="text-slate-400"> · {displayLotCode(req.lots.lot_code)}</span> : null}
                    <span className="ml-2 font-black text-campo-700">{itemEqLabel({ quantity: req.quantity, package_size: req.lots?.package_size, package_unit: req.lots?.package_unit })}</span>
                    {itemEnvLabel({ quantity: req.quantity, package_size: req.lots?.package_size, package_unit: req.lots?.package_unit }) ? (
                      <span className="ml-1 text-slate-400">({itemEnvLabel({ quantity: req.quantity, package_size: req.lots?.package_size, package_unit: req.lots?.package_unit })})</span>
                    ) : null}
                  </p>
                )}
              </div>

              {/* Transportista inline */}
              {(req.transporter_name || req.transporter_ci || req.transporter_plate) && (
                <div className="mx-3 mb-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-white/60 px-2.5 py-1.5 text-[11px]">
                  <span className="font-black uppercase tracking-wide text-slate-400">Transp.</span>
                  {req.transporter_name && <span className="font-semibold text-slate-700">{req.transporter_name}</span>}
                  {req.transporter_plate && <span className="font-bold text-slate-700">{req.transporter_plate}</span>}
                  {req.transporter_ci   && <span className="text-slate-500">Tel. {req.transporter_ci}</span>}
                  {req.attachment_url && (
                    <>
                      <a href={attachmentViewerUrl(req.attachment_url)} target="_blank" rel="noreferrer"
                        className="ml-auto flex items-center gap-1 font-bold text-campo-700 hover:underline">
                        <Paperclip size={11} /> Ver
                      </a>
                      <a href={attachmentViewerUrl(req.attachment_url)} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 font-bold text-slate-600 hover:underline">
                        <Printer size={11} /> Imprimir
                      </a>
                    </>
                  )}
                </div>
              )}

              {/* Notes */}
              {req.notes       && <p className="mx-3 mb-2 rounded-lg bg-white/60 px-2.5 py-1.5 text-xs font-semibold text-slate-600">{req.notes}</p>}
              {req.admin_notes && <p className="mx-3 mb-2 rounded-lg bg-campo-100/60 px-2.5 py-1.5 text-xs font-semibold text-campo-800">↳ {req.admin_notes}</p>}

              {/* Actions */}
              {isActive ? (
                <div className={`flex gap-2 border-t border-black/5 px-3 py-2.5 ${req.status === 'pendiente' ? '' : ''}`}>
                  {req.status === 'pendiente' && (
                    <button
                      className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                      type="button"
                      onClick={() => reviewRequest(req.id, 'rechazado')}
                    >
                      <X size={14} /> Rechazar
                    </button>
                  )}
                  <Link
                    className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-campo-700 px-3 text-xs font-bold text-white transition hover:bg-campo-800"
                    to={`/operacion/despacho-lista?request=${req.id}`}
                  >
                    <Truck size={14} />
                    {req.status === 'en_preparacion' ? 'Continuar preparación' : 'Iniciar despacho'}
                  </Link>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 border-t border-black/5 px-3 py-2 text-[10px] font-semibold text-slate-400">
                  <Clock3 size={12} />
                  {req.status === 'despachado' ? 'Despachado' : 'Rechazado'} · {req.reviewed_at ? formatDate(req.reviewed_at) : '-'}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
