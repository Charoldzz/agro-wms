import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { X } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { cleanProductName, displayLotCode, packageLabel } from '../lib/display'
import { normalizeDispatchRequests } from '../lib/dispatchRequests'
import { formatDate, formatNumber, movementLabel } from '../lib/format'
import { supabase } from '../lib/supabase'

export default function Operation() {
  const location = useLocation()
  const [lots, setLots] = useState([])
  const [expiryAlerts, setExpiryAlerts] = useState([])
  const [dispatchRequests, setDispatchRequests] = useState([])
  const [pendingMovements, setPendingMovements] = useState([])
  const [workModal, setWorkModal] = useState('')

  useEffect(() => {
    loadWork()

    const channel = supabase
      .channel('operator-work')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lots' }, loadWork)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movements' }, loadWork)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_dispatch_requests' }, loadWork)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    setWorkModal('')
  }, [location.pathname, location.search])

  useEffect(() => {
    const closeTemporaryWindows = () => setWorkModal('')
    const closeOnVisible = () => {
      if (document.visibilityState === 'visible') closeTemporaryWindows()
    }

    window.addEventListener('focus', closeTemporaryWindows)
    window.addEventListener('pageshow', closeTemporaryWindows)
    window.addEventListener('todo-close-temporary-overlays', closeTemporaryWindows)
    document.addEventListener('visibilitychange', closeOnVisible)

    return () => {
      window.removeEventListener('focus', closeTemporaryWindows)
      window.removeEventListener('pageshow', closeTemporaryWindows)
      window.removeEventListener('todo-close-temporary-overlays', closeTemporaryWindows)
      document.removeEventListener('visibilitychange', closeOnVisible)
    }
  }, [])

  async function loadWork() {
    const [{ data: lotData }, { data: expiryData }, { data: requestData }, { data: movementData }] = await Promise.all([
      supabase
        .from('lots')
        .select('id, lot_code, product, current_quantity, location, expiry_date, status, clients(name)')
        .eq('inventory_source', 'stock_independiente')
        .eq('status', 'activo')
        .gt('current_quantity', 0)
        .order('updated_at', { ascending: false })
        .limit(200),
      supabase
        .from('lots')
        .select('id, lot_code, product, current_quantity, location, expiry_date, status, clients(name)')
        .eq('inventory_source', 'stock_independiente')
        .gt('current_quantity', 0)
        .not('expiry_date', 'is', null)
        .order('expiry_date', { ascending: true })
        .limit(100),
      supabase
        .from('client_dispatch_requests')
        .select('*, clients(name), lots(id, lot_code, client_id, product, current_quantity, package_size, package_unit, location, expiry_date, status)')
        .in('status', ['pendiente', 'aprobado', 'en_preparacion'])
        .order('created_at', { ascending: false })
        .limit(40),
      supabase
        .from('movements')
        .select('*, lots(lot_code, product, location, clients(name))')
        .in('type', ['ajuste', 'traslado', 'salida'])
        .eq('approval_status', 'pendiente')
        .order('created_at', { ascending: false })
        .limit(40),
    ])

    setLots(lotData || [])
    setExpiryAlerts(expiryData || [])
    setDispatchRequests(await normalizeDispatchRequests(requestData || []))
    setPendingMovements(movementData || [])
  }

  const expiringLots = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return expiryAlerts
      .filter((lot) => lot.expiry_date)
      .map((lot) => {
        const daysLeft = Math.ceil((new Date(`${lot.expiry_date}T00:00:00`) - today) / 86400000)
        return { ...lot, daysLeft }
      })
      .filter((lot) => lot.daysLeft <= 90)
      .sort((a, b) => a.daysLeft - b.daysLeft)
  }, [expiryAlerts])

  function renderDispatchRequests(requests, fullDetails = false) {
    if (requests.length === 0) return <p className="rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-500">Sin despachos solicitados.</p>
    return requests.map((request) => (
      <article key={request.id} className="rounded-lg bg-amber-50 p-3">
        <p className="font-bold text-slate-950">{request.clients?.name || 'Cliente'}</p>
        {Array.isArray(request.items) && request.items.length > 1 ? (
          <div className="mt-2 space-y-2">
            {(fullDetails ? request.items : request.items.slice(0, 3)).map((item) => (
              <div key={item.lot_id} className="rounded-lg bg-white/80 p-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 text-sm font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(item.product)}</p>
                  <span className="rounded-lg bg-campo-50 px-2 py-1 text-xs font-black text-campo-800">{formatNumber(item.quantity)} uds</span>
                </div>
                <p className="text-xs font-semibold text-slate-500">{displayLotCode(item.lot_code)} - Presentacion: {packageLabel(item) || 'Sin dato'}</p>
              </div>
            ))}
            {!fullDetails && request.items.length > 3 ? <p className="text-xs font-bold text-slate-600">+ {request.items.length - 3} producto{request.items.length - 3 === 1 ? '' : 's'} mas</p> : null}
          </div>
        ) : (
          <div className="mt-2 rounded-lg bg-white/80 p-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-sm font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(request.product || request.lots?.product)}</p>
              <span className="rounded-lg bg-campo-50 px-2 py-1 text-xs font-black text-campo-800">{formatNumber(request.quantity)} uds</span>
            </div>
            <p className="text-xs font-semibold text-slate-500">
              {displayLotCode(request.lots?.lot_code)} - Presentacion: {packageLabel(request.lots) || 'Sin dato'} - {request.lots?.location || '-'} - disponible {formatNumber(request.lots?.current_quantity)} uds
            </p>
          </div>
        )}
        <Link className="btn-primary mt-3 w-full !min-h-11 !py-2" to={`/nueva-salida?request=${request.id}`}>Iniciar despacho</Link>
      </article>
    ))
  }

  function renderPendingMovements(movements) {
    if (movements.length === 0) return <p className="rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-500">Sin reparaciones, traslados o salidas pendientes.</p>
    return movements.map((movement) => (
      <article key={movement.id} className="rounded-lg bg-orange-50 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="font-bold text-slate-950">{movementLabel(movement.type)} - {displayLotCode(movement.lots?.lot_code)}</p>
          <span className="rounded-lg bg-white px-2 py-1 text-xs font-black text-orange-800">{formatNumber(movement.quantity)} uds</span>
        </div>
        <p className="text-sm font-semibold text-slate-700 [overflow-wrap:anywhere]">{cleanProductName(movement.lots?.product)}</p>
        <p className="text-xs font-semibold text-slate-500 [overflow-wrap:anywhere]">{movement.lots?.clients?.name || '-'} - {movement.lots?.location || '-'}</p>
        <p className="mt-1 text-xs font-bold text-orange-700">{movement.created_at ? formatDate(movement.created_at) : 'Pendiente de revision'}</p>
      </article>
    ))
  }

  function renderExpiringLots(alerts) {
    if (alerts.length === 0) return <p className="rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">Sin vencimientos cercanos.</p>
    return alerts.map((lot) => (
      <Link
        key={lot.id}
        className={`block rounded-lg p-3 ${lot.daysLeft < 0 ? 'bg-red-50' : 'bg-amber-50'}`}
        to={`/lotes/${lot.id}`}
        state={{ backTo: '/operacion' }}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="min-w-0 flex-1 font-bold text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(lot.product)}</p>
          <span className={`rounded-lg bg-white px-2 py-1 text-xs font-black ${lot.daysLeft < 0 ? 'text-red-700' : 'text-amber-800'}`}>{formatNumber(lot.current_quantity)} uds</span>
        </div>
        <p className="text-sm font-semibold text-slate-600 [overflow-wrap:anywhere]">{displayLotCode(lot.lot_code)} - {lot.clients?.name || '-'}</p>
        <p className="text-xs font-semibold text-slate-500 [overflow-wrap:anywhere]">{lot.location || '-'} - {lot.expiry_date ? formatDate(lot.expiry_date) : 'Sin fecha'}</p>
        <p className={`mt-1 text-xs font-bold ${lot.daysLeft < 0 ? 'text-red-700' : 'text-amber-700'}`}>{lot.daysLeft < 0 ? 'Vencido' : `Vence en ${lot.daysLeft} dias`}</p>
      </Link>
    ))
  }

  return (
    <div>
      <PageHeader title="Pendientes" subtitle="Despachos, revisiones y alertas de vencimiento" />

      <section className="mt-0">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold uppercase text-slate-500">Trabajo del dia</h3>
          <span className="rounded-full bg-campo-50 px-3 py-1 text-xs font-bold text-campo-700">
            {dispatchRequests.length + pendingMovements.length + expiringLots.length} avisos
          </span>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <WorkPanel title="Despachos pendientes" count={dispatchRequests.length} onViewAll={() => setWorkModal('despachos')}>
            {renderDispatchRequests(dispatchRequests.slice(0, 3))}
          </WorkPanel>

          <WorkPanel title="Revisiones pendientes" count={pendingMovements.length} onViewAll={() => setWorkModal('revisiones')}>
            {renderPendingMovements(pendingMovements.slice(0, 3))}
          </WorkPanel>

          <WorkPanel title="Alertas de vencimiento" count={expiringLots.length} onViewAll={() => setWorkModal('vencimientos')}>
            {renderExpiringLots(expiringLots.slice(0, 3))}
          </WorkPanel>
        </div>
      </section>

      {workModal ? (
        <WorkModal title={workModal === 'despachos' ? 'Despachos pendientes' : workModal === 'revisiones' ? 'Revisiones pendientes' : 'Alertas de vencimiento'} onClose={() => setWorkModal('')}>
          {workModal === 'despachos' ? renderDispatchRequests(dispatchRequests, true) : null}
          {workModal === 'revisiones' ? renderPendingMovements(pendingMovements) : null}
          {workModal === 'vencimientos' ? renderExpiringLots(expiringLots) : null}
        </WorkModal>
      ) : null}

    </div>
  )
}

function WorkPanel({ title, count, onViewAll, children }) {
  const hiddenCount = Math.max(count - 3, 0)

  return (
    <section className="panel">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="font-bold text-slate-950">{title}</h4>
        {hiddenCount > 0 ? (
          <button className="rounded-lg bg-campo-50 px-2.5 py-1.5 text-xs font-black text-campo-700 transition hover:bg-campo-100" type="button" onClick={onViewAll}>
            Ver mas
          </button>
        ) : null}
      </div>
      <div className="max-h-80 space-y-2 overflow-y-auto pr-1">{children}</div>
    </section>
  )
}

function WorkModal({ title, onClose, children }) {
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div data-modal-backdrop="true" data-operator-overlay="true" className="fixed inset-0 z-[70] grid place-items-start overflow-y-auto bg-slate-950/35 p-3 sm:place-items-center" onClick={onClose}>
      <button className="fixed right-4 top-4 z-[72] inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-900 shadow-lg" type="button" onClick={onClose} title="Cerrar">
        <X size={20} />
      </button>
      <section
        data-overlay-panel="true"
        className="relative z-[71] my-3 flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-100 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase text-campo-700">Trabajo del dia</p>
              <h3 className="text-xl font-black text-slate-950">{title}</h3>
            </div>
            <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={onClose} title="Cerrar">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">{children}</div>
      </section>
    </div>
  )
}
