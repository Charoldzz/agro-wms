import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Clock3, Paperclip, Printer, Truck, X } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useAuth } from '../hooks/useAuth.jsx'
import { cleanProductName, displayLotCode, packageLabel } from '../lib/display'
import { normalizeDispatchRequests } from '../lib/dispatchRequests'
import { formatDate, formatNumber } from '../lib/format'
import { supabase } from '../lib/supabase'

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
      setRequests([])
      return
    }

    setError('')
    setRequests(await normalizeDispatchRequests(data || []))
  }

  async function reviewRequest(id, status) {
    const { error: updateError } = await supabase
      .from('client_dispatch_requests')
      .update({
        status,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (updateError) {
      setError(updateError.message)
      return
    }

    loadRequests()
  }

  return (
    <div>
      <PageHeader
        title={pendingOnly ? 'Despachos pendientes' : 'Solicitudes de despacho'}
        subtitle={pendingOnly ? 'Ordenes listas para preparar en almacen' : 'Pedidos enviados desde el portal cliente'}
      />

      {error ? <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

      <div className="space-y-3">
        {requests.length === 0 ? (
          <EmptyState title="Sin solicitudes" text="Cuando un cliente solicite despacho, aparecera aqui." />
        ) : (
          requests.map((request) => (
            <article key={request.id} className="panel">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <Truck size={20} className="text-campo-700" />
                    <p className="font-bold text-slate-950">{request.clients?.name || 'Cliente'}</p>
                  </div>
                  <p className="text-sm font-semibold text-slate-600">
                    {Array.isArray(request.items) && request.items.length > 1
                      ? `${cleanProductName(request.product)}`
                      : `${cleanProductName(request.product || request.lots?.product)} - ${displayLotCode(request.lots?.lot_code)}`}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-slate-400">
                    Solicitado por {request.requested_by_profile?.full_name || 'Usuario'} - {formatDate(request.created_at)}
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${request.status === 'en_preparacion' ? 'bg-campo-50 text-campo-700' : request.status === 'rechazado' ? 'bg-red-50 text-red-700' : request.status === 'despachado' ? 'bg-slate-100 text-slate-700' : 'bg-amber-50 text-amber-800'}`}>
                  {requestStatusLabel(request.status)}
                </span>
              </div>

              <div className="mt-3 grid gap-2 text-sm font-bold text-slate-600 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-3">Solicitado: {formatNumber(request.quantity)} envases</div>
                <div className="rounded-lg bg-slate-50 p-3">Productos: {Array.isArray(request.items) && request.items.length > 0 ? request.items.length : 1}</div>
                <div className="rounded-lg bg-slate-50 p-3">Ubicacion: {request.lots?.location || 'Varias'}</div>
              </div>

              {Array.isArray(request.items) && request.items.length > 1 ? (
                <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3">
                  {request.items.map((item) => (
                    <div key={item.lot_id} className="rounded-lg bg-white p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(item.product)}</p>
                        <span className="rounded-lg bg-campo-50 px-2 py-1 text-sm font-black text-campo-800">{formatNumber(item.quantity)} env.</span>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-slate-500">
                        {displayLotCode(item.lot_code)} - Presentacion: {packageLabel(item) || 'Sin dato'}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}

              {(request.transporter_name || request.transporter_ci || request.transporter_plate) && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                  <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">Transportista</p>
                  <div className="grid gap-1 sm:grid-cols-3">
                    {request.transporter_name && (
                      <div>
                        <p className="text-[10px] font-bold uppercase text-slate-400">Nombre</p>
                        <p className="font-semibold text-slate-800">{request.transporter_name}</p>
                      </div>
                    )}
                    {request.transporter_ci && (
                      <div>
                        <p className="text-[10px] font-bold uppercase text-slate-400">CI</p>
                        <p className="font-semibold text-slate-800">{request.transporter_ci}</p>
                      </div>
                    )}
                    {request.transporter_plate && (
                      <div>
                        <p className="text-[10px] font-bold uppercase text-slate-400">Placa</p>
                        <p className="font-semibold text-slate-800">{request.transporter_plate}</p>
                      </div>
                    )}
                  </div>
                  {request.attachment_url && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <a href={request.attachment_url} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1.5 text-xs font-bold text-campo-700 hover:underline">
                        <Paperclip size={13} /> Ver nota adjunta
                      </a>
                      <a href={request.attachment_url} target="_blank" rel="noreferrer"
                        onClick={e => { e.preventDefault(); window.open(request.attachment_url, '_blank') }}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50">
                        <Printer size={13} /> Imprimir nota adjunta
                      </a>
                    </div>
                  )}
                </div>
              )}
              {request.notes ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-600">{request.notes}</p> : null}
              {request.admin_notes ? <p className="mt-3 rounded-lg bg-campo-50 p-3 text-sm font-semibold text-campo-700">Respuesta: {request.admin_notes}</p> : null}

              {request.status === 'pendiente' ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button className="btn-secondary !min-h-11" type="button" onClick={() => reviewRequest(request.id, 'rechazado')}>
                    <X size={18} /> Rechazar
                  </button>
                  <Link className="btn-primary !min-h-11" to={`/operacion/despacho-lista?request=${request.id}`}>
                    <Truck size={18} /> Iniciar despacho
                  </Link>
                </div>
              ) : request.status === 'aprobado' || request.status === 'en_preparacion' ? (
                <Link className="btn-primary mt-3 w-full" to={`/operacion/despacho-lista?request=${request.id}`}>
                  <Truck size={18} /> Continuar preparación
                </Link>
              ) : (
                <div className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-500">
                  <Clock3 size={16} /> Revisado {request.reviewed_at ? formatDate(request.reviewed_at) : '-'}
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </div>
  )
}

function requestStatusLabel(status) {
  if (status === 'pendiente') return 'Despacho pendiente'
  if (status === 'aprobado') return 'Despacho pendiente'
  if (status === 'en_preparacion') return 'En preparación'
  if (status === 'despachado') return 'Despachado'
  if (status === 'rechazado') return 'Rechazado'
  return status || 'Recibido'
}
