import { useEffect, useState } from 'react'
import { Check, ClipboardList, X } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useAuth } from '../hooks/useAuth.jsx'
import { cleanProductName, displayLotCode } from '../lib/display'
import { formatDate, formatNumber, movementLabel } from '../lib/format'
import { supabase } from '../lib/supabase'

export default function AdminPending() {
  const { user } = useAuth()
  const [requests, setRequests] = useState([])
  const [movements, setMovements] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    loadPending()

    const channel = supabase
      .channel('admin-pending')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_dispatch_requests' }, loadPending)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movements' }, loadPending)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  async function loadPending() {
    const [requestResult, movementResult] = await Promise.all([
      supabase
        .from('client_dispatch_requests')
        .select('*, clients(name), lots(lot_code, product, current_quantity, location)')
        .eq('status', 'pendiente')
        .order('created_at', { ascending: false }),
      supabase
        .from('movements')
        .select('*, lots(product, lot_code, current_quantity, location, clients(name)), profiles(full_name)')
        .in('type', ['ajuste', 'traslado', 'salida'])
        .eq('approval_status', 'pendiente')
        .order('created_at', { ascending: false }),
    ])

    if (requestResult.error || movementResult.error) {
      setError('No se pudieron cargar todos los pendientes. Revisa que el SQL este actualizado.')
    } else {
      setError('')
    }

    setRequests(requestResult.data || [])
    setMovements(movementResult.data || [])
  }

  async function reviewDispatchRequest(id, status) {
    await supabase
      .from('client_dispatch_requests')
      .update({
        status,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)
    loadPending()
  }

  async function reviewMovement(id, action) {
    await supabase.rpc(action === 'approve' ? 'approve_adjustment' : 'reject_adjustment', {
      p_movement_id: id,
      p_user_id: user.id,
    })
    loadPending()
  }

  const total = requests.length + movements.length

  return (
    <div>
      <PageHeader title="Pendientes" subtitle={`${total} pendiente${total === 1 ? '' : 's'} por revisar`} />

      {error ? <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

      {total === 0 ? (
        <EmptyState title="Sin pendientes" text="No hay solicitudes, reparaciones, traslados ni salidas offline por revisar." />
      ) : (
        <div className="space-y-4">
          {requests.map((request) => (
            <article key={request.id} className="panel border-amber-200 bg-amber-50">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <ClipboardList size={20} className="text-amber-700" />
                    <p className="font-black text-slate-950">Solicitud despacho - {request.clients?.name || 'Cliente'}</p>
                  </div>
                  <p className="mt-1 text-sm font-bold text-slate-700">
                    {Array.isArray(request.items) && request.items.length > 1
                      ? `${request.items.length} productos - ${formatNumber(request.quantity)} envases`
                      : `${cleanProductName(request.product || request.lots?.product)} - ${displayLotCode(request.lots?.lot_code)} - ${formatNumber(request.quantity)} envases`}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">{formatDate(request.created_at)}</p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-amber-700">Solicitud cliente</span>
              </div>

              {Array.isArray(request.items) && request.items.length > 1 ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {request.items.map((item) => (
                    <div key={item.lot_id} className="rounded-lg bg-white p-3">
                      <p className="font-bold text-slate-950">{cleanProductName(item.product)}</p>
                      <p className="text-xs font-semibold text-slate-500">{displayLotCode(item.lot_code)} - {item.location || '-'}</p>
                      <div className="mt-2 flex gap-2">
                        <span className="rounded-lg bg-campo-50 px-2 py-1 text-sm font-black text-campo-800">{formatNumber(item.quantity)} env.</span>
                        <span className="rounded-lg bg-amber-100 px-2 py-1 text-sm font-black text-amber-800">
                          {formatNumber(Number(item.quantity || 0) * Number(item.package_size || 0))} lt
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-lg bg-white p-3 text-sm font-bold text-slate-600">
                  Disponible: {formatNumber(request.lots?.current_quantity)} env. - Ubicacion: {request.lots?.location || '-'}
                </div>
              )}

              {request.notes ? <p className="mt-3 rounded-lg bg-white p-3 text-sm font-semibold text-slate-600">{request.notes}</p> : null}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button className="btn-secondary w-full" type="button" onClick={() => reviewDispatchRequest(request.id, 'rechazado')}>
                  <X size={18} /> Rechazar
                </button>
                <button className="btn-primary w-full" type="button" onClick={() => reviewDispatchRequest(request.id, 'aprobado')}>
                  <Check size={18} /> Aprobar
                </button>
              </div>
            </article>
          ))}

          {movements.map((movement) => (
            <article key={movement.id} className="panel border-orange-200 bg-orange-50">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-black text-slate-950">{movementLabel(movement.type)} - {displayLotCode(movement.lots?.lot_code)}</p>
                  <p className="mt-1 text-sm font-bold text-slate-700">{cleanProductName(movement.lots?.product)}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {movement.profiles?.full_name || 'Usuario'} - {movement.lots?.clients?.name || '-'} - {formatDate(movement.created_at)}
                  </p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-orange-700">{movementLabel(movement.type)}</span>
              </div>

              <div className="mt-3 grid gap-2 text-sm font-bold text-slate-600 sm:grid-cols-3">
                <div className="rounded-lg bg-white p-3">Cantidad: {formatNumber(movement.quantity)} env.</div>
                <div className="rounded-lg bg-white p-3">Stock actual: {formatNumber(movement.lots?.current_quantity)} env.</div>
                <div className="rounded-lg bg-white p-3">Ubicacion: {movement.lots?.location || '-'}</div>
              </div>
              {movement.notes ? <p className="mt-3 rounded-lg bg-white p-3 text-sm font-semibold text-slate-600">{movement.notes}</p> : null}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button className="btn-secondary w-full" type="button" onClick={() => reviewMovement(movement.id, 'reject')}>
                  <X size={18} /> Rechazar
                </button>
                <button className="btn-primary w-full" type="button" onClick={() => reviewMovement(movement.id, 'approve')}>
                  <Check size={18} /> Aprobar
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
