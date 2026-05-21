import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, CalendarClock, LogOut, PackagePlus, ScanLine, Search, WifiOff, Wrench } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { cleanProductName, displayLotCode, packageLabel } from '../lib/display'
import { formatDate, formatNumber, movementLabel } from '../lib/format'
import { getQueuedMovementCount } from '../lib/offlineQueue'
import { supabase } from '../lib/supabase'

const searchOptions = [
  { value: 'producto', label: 'Producto', placeholder: 'Buscar producto...' },
  { value: 'empresa', label: 'Empresa', placeholder: 'Buscar empresa o cliente...' },
  { value: 'ubicacion', label: 'Ubicacion', placeholder: 'Buscar ubicacion...' },
  { value: 'lote', label: 'Lote', placeholder: 'Buscar lote...' },
  { value: 'codigo', label: 'Codigo', placeholder: 'Buscar codigo...' },
]

export default function Operation() {
  const [lots, setLots] = useState([])
  const [approvedRequests, setApprovedRequests] = useState([])
  const [pendingMovements, setPendingMovements] = useState([])
  const [query, setQuery] = useState('')
  const [searchBy, setSearchBy] = useState('producto')
  const [online, setOnline] = useState(navigator.onLine)
  const [queuedCount, setQueuedCount] = useState(getQueuedMovementCount())

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
        .limit(80),
      supabase
        .from('client_dispatch_requests')
        .select('*, clients(name), lots(lot_code, product, current_quantity, package_size, package_unit, location, expiry_date)')
        .eq('status', 'aprobado')
        .order('reviewed_at', { ascending: false })
        .limit(10),
      supabase
        .from('movements')
        .select('*, lots(lot_code, product, location, clients(name))')
        .in('type', ['ajuste', 'traslado', 'salida'])
        .eq('approval_status', 'pendiente')
        .order('created_at', { ascending: false })
        .limit(8),
    ])

    setLots(lotData || [])
    setApprovedRequests(requestData || [])
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
      .slice(0, 4)
  }, [lots])

  const quickResults = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return []
    return lots
      .filter((lot) => {
        const values = {
          producto: [cleanProductName(lot.product)],
          empresa: [lot.clients?.name],
          ubicacion: [lot.location],
          lote: [lot.lot_code, displayLotCode(lot.lot_code)],
          codigo: [lot.product],
        }[searchBy] || [cleanProductName(lot.product)]

        return values
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(term))
      })
      .slice(0, 8)
  }, [lots, query, searchBy])
  const selectedSearchOption = searchOptions.find((option) => option.value === searchBy) || searchOptions[0]

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

      <section className="mt-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold uppercase text-slate-500">Trabajo del dia</h3>
          <span className="rounded-full bg-campo-50 px-3 py-1 text-xs font-bold text-campo-700">
            {approvedRequests.length + pendingMovements.length + expiringLots.length} avisos
          </span>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <WorkPanel title="Despachos aprobados">
            {approvedRequests.length === 0 ? (
              <p className="rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-500">Sin despachos aprobados.</p>
            ) : (
              approvedRequests.map((request) => (
                <article key={request.id} className="rounded-lg bg-amber-50 p-3">
                  <p className="font-bold text-slate-950">{request.clients?.name || 'Cliente'}</p>
                  {Array.isArray(request.items) && request.items.length > 1 ? (
                    <div className="mt-2 space-y-2">
                      {request.items.slice(0, 3).map((item) => (
                        <div key={item.lot_id} className="rounded-lg bg-white/80 p-2">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <p className="min-w-0 flex-1 text-sm font-black text-slate-950 [overflow-wrap:anywhere]">
                              {cleanProductName(item.product)}
                            </p>
                            <span className="rounded-lg bg-campo-50 px-2 py-1 text-xs font-black text-campo-800">
                              {formatNumber(item.quantity)} env.
                            </span>
                          </div>
                          <p className="text-xs font-semibold text-slate-500">
                            {displayLotCode(item.lot_code)} - Presentacion: {packageLabel(item) || 'Sin dato'}
                          </p>
                        </div>
                      ))}
                      {request.items.length > 3 ? (
                        <p className="text-xs font-bold text-slate-600">+ {request.items.length - 3} producto{request.items.length - 3 === 1 ? '' : 's'} mas</p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-2 rounded-lg bg-white/80 p-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 text-sm font-black text-slate-950 [overflow-wrap:anywhere]">
                          {cleanProductName(request.product || request.lots?.product)}
                        </p>
                        <span className="rounded-lg bg-campo-50 px-2 py-1 text-xs font-black text-campo-800">
                          {formatNumber(request.quantity)} env.
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-slate-500">
                        {displayLotCode(request.lots?.lot_code)} - Presentacion: {packageLabel(request.lots) || 'Sin dato'} - {request.lots?.location || '-'} - disponible {formatNumber(request.lots?.current_quantity)} env.
                      </p>
                    </div>
                  )}
                  <Link className="btn-primary mt-3 w-full !min-h-11 !py-2" to={`/operacion/despacho-lista?request=${request.id}`}>
                    Iniciar despacho
                  </Link>
                </article>
              ))
            )}
          </WorkPanel>

          <WorkPanel title="Revisiones pendientes">
            {pendingMovements.length === 0 ? (
              <p className="rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-500">Sin reparaciones, traslados o salidas pendientes.</p>
            ) : (
              pendingMovements.map((movement) => (
                <article key={movement.id} className="rounded-lg bg-orange-50 p-3">
                  <p className="font-bold text-slate-950">{movementLabel(movement.type)} - {displayLotCode(movement.lots?.lot_code)}</p>
                  <p className="text-sm font-semibold text-slate-700">{cleanProductName(movement.lots?.product)}</p>
                  <p className="text-xs font-semibold text-slate-500">{movement.lots?.clients?.name || '-'} - {movement.lots?.location || '-'}</p>
                </article>
              ))
            )}
          </WorkPanel>

          <WorkPanel title="Alertas de vencimiento">
            {expiringLots.length === 0 ? (
              <p className="rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">Sin vencimientos cercanos.</p>
            ) : (
              expiringLots.map((lot) => (
                <Link key={lot.id} className="block rounded-lg bg-amber-50 p-3" to={`/lotes/${lot.id}`}>
                  <p className="font-bold text-slate-950">{cleanProductName(lot.product)}</p>
                  <p className="text-sm font-semibold text-slate-600">{displayLotCode(lot.lot_code)} - {formatNumber(lot.current_quantity)} env.</p>
                  <p className="text-xs font-bold text-amber-700">{lot.daysLeft < 0 ? 'Vencido' : `Vence en ${lot.daysLeft} dias`}</p>
                </Link>
              ))
            )}
          </WorkPanel>
        </div>
      </section>

      <section className="mt-5">
        <h3 className="mb-2 text-sm font-bold uppercase text-slate-500">Busqueda rapida en almacen</h3>
        <div className="grid gap-2 sm:grid-cols-[170px_1fr]">
          <label className="block">
            <span className="sr-only">Buscar por</span>
            <select className="input min-h-14" value={searchBy} onChange={(event) => setSearchBy(event.target.value)}>
              {searchOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="flex items-center rounded-lg border border-slate-200 bg-white px-3">
            <Search size={22} className="text-slate-400" />
            <input
              className="min-h-14 flex-1 bg-transparent px-2 text-lg font-semibold outline-none"
              placeholder={selectedSearchOption.placeholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        {query ? (
          <div className="mt-3 space-y-2">
            {quickResults.length === 0 ? (
              <EmptyState title="Sin resultados" text="Revisa producto, lote, cliente o ubicacion." />
            ) : (
              quickResults.map((lot) => (
                <Link key={lot.id} className="panel block" to={`/lotes/${lot.id}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-lg font-black text-slate-950">{cleanProductName(lot.product)}</p>
                      <p className="text-sm font-bold text-slate-500">
                        {displayLotCode(lot.lot_code)} - <strong className="font-black text-slate-700">{lot.clients?.name || '-'}</strong> - {lot.location || '-'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-black text-campo-700">{formatNumber(lot.current_quantity)}</p>
                      <p className="text-xs font-bold text-slate-500">env.</p>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        ) : null}
      </section>

      <section className="mt-5">
        <h3 className="mb-2 text-sm font-bold uppercase text-slate-500">Consulta rapida</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link className="btn-secondary min-h-14 !justify-start !px-4 text-left" to="/lotes">
            <Boxes size={22} /> Stock por producto
          </Link>
          <Link className="btn-secondary min-h-14 !justify-start !px-4 text-left" to="/vencimientos">
            <CalendarClock size={22} /> Vencimientos
          </Link>
        </div>
      </section>

    </div>
  )
}

function WorkPanel({ title, children }) {
  return (
    <section className="panel">
      <h4 className="mb-3 font-bold text-slate-950">{title}</h4>
      <div className="max-h-80 space-y-2 overflow-y-auto pr-1">{children}</div>
    </section>
  )
}
