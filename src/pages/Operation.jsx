import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardPenLine, LogOut, PackagePlus, ScanLine, WifiOff, Wrench } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { cleanProductName, displayLotCode, packageLabel } from '../lib/display'
import { formatDate, formatNumber, movementLabel } from '../lib/format'
import { getQueuedMovementCount } from '../lib/offlineQueue'
import { supabase } from '../lib/supabase'

export default function Operation() {
  const [lots, setLots] = useState([])
  const [dispatchRequests, setDispatchRequests] = useState([])
  const [pendingMovements, setPendingMovements] = useState([])
  const [online, setOnline] = useState(navigator.onLine)
  const [queuedCount, setQueuedCount] = useState(getQueuedMovementCount())
  const [workModal, setWorkModal] = useState('')

  useEffect(() => {
    loadWork()

    const refreshOnline = () => setOnline(navigator.onLine)
    const queueListener = (event) => setQueuedCount(event.detail || getQueuedMovementCount())
    window.addEventListener('online', refreshOnline)
    window.addEventListener('offline', refreshOnline)
    window.addEventListener('offline-movement-queue', queueListener)

    const channel = supabase
      .channel('operator-work')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lots' }, loadWork)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movements' }, loadWork)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_dispatch_requests' }, loadWork)
      .subscribe()

    return () => {
      window.removeEventListener('online', refreshOnline)
      window.removeEventListener('offline', refreshOnline)
      window.removeEventListener('offline-movement-queue', queueListener)
      supabase.removeChannel(channel)
    }
  }, [])

  async function loadWork() {
    const [{ data: lotData }, { data: requestData }, { data: movementData }] = await Promise.all([
      supabase
        .from('lots')
        .select('id, lot_code, product, current_quantity, location, expiry_date, status, clients(name)')
        .order('updated_at', { ascending: false })
        .limit(200),
      supabase
        .from('client_dispatch_requests')
        .select('*, clients(name), lots(lot_code, product, current_quantity, package_size, package_unit, location, expiry_date)')
        .eq('status', 'aprobado')
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
    setDispatchRequests(requestData || [])
    setPendingMovements(movementData || [])
  }

  const expiringLots = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return lots
      .filter((lot) => lot.expiry_date)
      .map((lot) => {
        const daysLeft = Math.ceil((new Date(`${lot.expiry_date}T00:00:00`) - today) / 86400000)
        return { ...lot, daysLeft }
      })
      .filter((lot) => lot.daysLeft <= 90)
      .sort((a, b) => a.daysLeft - b.daysLeft)
  }, [lots])

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
                  <span className="rounded-lg bg-campo-50 px-2 py-1 text-xs font-black text-campo-800">{formatNumber(item.quantity)} env.</span>
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
              <span className="rounded-lg bg-campo-50 px-2 py-1 text-xs font-black text-campo-800">{formatNumber(request.quantity)} env.</span>
            </div>
            <p className="text-xs font-semibold text-slate-500">
              {displayLotCode(request.lots?.lot_code)} - Presentacion: {packageLabel(request.lots) || 'Sin dato'} - {request.lots?.location || '-'} - disponible {formatNumber(request.lots?.current_quantity)} env.
            </p>
          </div>
        )}
        <Link className="btn-primary mt-3 w-full !min-h-11 !py-2" to={`/operacion/despacho-lista?request=${request.id}`}>Iniciar despacho</Link>
      </article>
    ))
  }

  function renderPendingMovements(movements) {
    if (movements.length === 0) return <p className="rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-500">Sin reparaciones, traslados o salidas pendientes.</p>
    return movements.map((movement) => (
      <article key={movement.id} className="rounded-lg bg-orange-50 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="font-bold text-slate-950">{movementLabel(movement.type)} - {displayLotCode(movement.lots?.lot_code)}</p>
          <span className="rounded-lg bg-white px-2 py-1 text-xs font-black text-orange-800">{formatNumber(movement.quantity)} env.</span>
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
      <Link key={lot.id} className="block rounded-lg bg-amber-50 p-3" to={`/lotes/${lot.id}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="min-w-0 flex-1 font-bold text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(lot.product)}</p>
          <span className="rounded-lg bg-white px-2 py-1 text-xs font-black text-amber-800">{formatNumber(lot.current_quantity)} env.</span>
        </div>
        <p className="text-sm font-semibold text-slate-600 [overflow-wrap:anywhere]">{displayLotCode(lot.lot_code)} - {lot.clients?.name || '-'}</p>
        <p className="text-xs font-semibold text-slate-500 [overflow-wrap:anywhere]">{lot.location || '-'} - {lot.expiry_date ? formatDate(lot.expiry_date) : 'Sin fecha'}</p>
        <p className="mt-1 text-xs font-bold text-amber-700">{lot.daysLeft < 0 ? 'Vencido' : `Vence en ${lot.daysLeft} dias`}</p>
      </Link>
    ))
  }

  return (
    <div>
      <PageHeader title="Modo operario" subtitle="Ingresos, despachos y control de almacen" />

      {!online || queuedCount > 0 ? (
        <section className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <div className="flex items-start gap-3">
            <WifiOff className="mt-0.5 shrink-0" size={24} />
            <div>
              <p className="text-lg font-black">{online ? 'Movimientos pendientes por sincronizar' : 'Sin internet'}</p>
              <p className="mt-1 text-sm font-bold">
                {queuedCount} movimiento{queuedCount === 1 ? '' : 's'} pendiente{queuedCount === 1 ? '' : 's'}. No hacer salidas criticas sin revision.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2">
        <Link className="btn-primary min-h-32 !items-start !justify-between !px-5 !py-5 text-left text-xl sm:min-h-40" to="/operacion/nuevo-ingreso">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/15">
            <PackagePlus size={30} />
          </span>
          <span>Nuevo ingreso</span>
        </Link>
        <Link className="inline-flex min-h-32 flex-col items-start justify-between gap-3 rounded-lg bg-maiz px-5 py-5 text-left text-xl font-semibold text-slate-950 shadow-soft transition active:scale-[0.99] sm:min-h-40" to="/operacion/despacho-lista?nuevo=1">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/35">
            <LogOut size={28} />
          </span>
          <span>Despacho</span>
        </Link>
        <Link className="inline-flex min-h-32 flex-col items-start justify-between gap-3 rounded-lg bg-orange-500 px-5 py-5 text-left text-xl font-semibold text-white shadow-soft transition active:scale-[0.99] sm:min-h-40" to="/operacion/reparacion-traslado">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/15">
            <Wrench size={28} />
          </span>
          <span>Reparacion / Traslado</span>
        </Link>
        <Link className="btn-secondary min-h-32 !items-start !justify-between !px-5 !py-5 text-left text-xl sm:min-h-40" to="/scanner">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-campo-50 text-campo-700">
            <ScanLine size={28} />
          </span>
          <span>Consultar QR</span>
        </Link>
      </section>

      <Link className="btn-secondary mt-3 w-full justify-between" to="/operacion/correcciones">
        <span className="inline-flex items-center gap-2"><ClipboardPenLine size={20} /> Solicitar correccion operativa</span>
        <span className="text-xs font-black text-slate-500">Sin borrar auditoria</span>
      </Link>

      <section className="mt-5">
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
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/45 p-4 sm:items-center sm:justify-center" onClick={onClose}>
      <section className="w-full max-w-2xl rounded-xl bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase text-campo-700">Trabajo del dia</p>
            <h3 className="text-xl font-black text-slate-950">{title}</h3>
          </div>
          <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={onClose}>Cerrar</button>
        </div>
        <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">{children}</div>
      </section>
    </div>
  )
}
