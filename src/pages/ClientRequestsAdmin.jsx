import { useEffect, useState } from 'react'
import { Check, Clock3, Truck, X } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useAuth } from '../hooks/useAuth.jsx'
import { cleanProductName, displayLotCode } from '../lib/display'
import { formatDate, formatNumber } from '../lib/format'
import { supabase } from '../lib/supabase'

export default function ClientRequestsAdmin() {
  const { user } = useAuth()
  const [requests, setRequests] = useState([])
  const [error, setError] = useState('')
  const [adminNotes, setAdminNotes] = useState({})

  useEffect(() => {
    loadRequests()

    const channel = supabase
      .channel('client-dispatch-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_dispatch_requests' }, loadRequests)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  async function loadRequests() {
    const { data, error: requestError } = await supabase
      .from('client_dispatch_requests')
      .select('*, clients(name), lots(lot_code, product, current_quantity, location), requested_by_profile:profiles!client_dispatch_requests_requested_by_fkey(full_name)')
      .order('created_at', { ascending: false })

    if (requestError) {
      setError('No se pudieron cargar las solicitudes. Ejecuta el SQL client_dispatch_requests.sql en Supabase.')
      setRequests([])
      return
    }

    setError('')
    setRequests(data || [])
  }

  async function reviewRequest(id, status) {
    const { error: updateError } = await supabase
      .from('client_dispatch_requests')
      .update({
        status,
        admin_notes: adminNotes[id] || null,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setAdminNotes((current) => ({ ...current, [id]: '' }))
    loadRequests()
  }

  return (
    <div>
      <PageHeader title="Solicitudes de despacho" subtitle="Pedidos enviados desde el portal cliente" />

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
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${request.status === 'aprobado' ? 'bg-campo-50 text-campo-700' : request.status === 'rechazado' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>
                  {request.status}
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
                    <div key={item.lot_id} className="flex justify-between gap-3 text-sm font-semibold text-slate-700">
                      <span>{displayLotCode(item.lot_code)} - {cleanProductName(item.product)}</span>
                      <span>{formatNumber(item.quantity)} env.</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {request.notes ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-600">{request.notes}</p> : null}
              {request.admin_notes ? <p className="mt-3 rounded-lg bg-campo-50 p-3 text-sm font-semibold text-campo-700">Respuesta: {request.admin_notes}</p> : null}

              {request.status === 'pendiente' ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_140px_140px]">
                  <input
                    className="input"
                    placeholder="Nota para el cliente (opcional)"
                    value={adminNotes[request.id] || ''}
                    onChange={(event) => setAdminNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                  />
                  <button className="btn-secondary !min-h-11" type="button" onClick={() => reviewRequest(request.id, 'rechazado')}>
                    <X size={18} /> Rechazar
                  </button>
                  <button className="btn-primary !min-h-11" type="button" onClick={() => reviewRequest(request.id, 'aprobado')}>
                    <Check size={18} /> Aprobar
                  </button>
                </div>
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
