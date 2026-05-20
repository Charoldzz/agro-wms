import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, CalendarClock, Check, Clock3, Download, LogOut, PackagePlus, Wrench, X } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, movementLabel } from '../lib/format'
import { cleanProductName, displayLotCode } from '../lib/display'

export default function Dashboard() {
  const { user } = useAuth()
  const [lots, setLots] = useState([])
  const [movements, setMovements] = useState([])
  const [pendingMovements, setPendingMovements] = useState([])
  const [dispatchRequests, setDispatchRequests] = useState([])
  const [dashboardError, setDashboardError] = useState('')

  useEffect(() => {
    loadData()

    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lots' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movements' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_dispatch_requests' }, loadData)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  async function loadData() {
    setDashboardError('')

    const [{ data: lotsData, error: lotsError }, movementsResult, pendingResult, requestsResult] = await Promise.all([
      supabase.from('lots').select('*, clients(name)').order('created_at', { ascending: false }),
      supabase
        .from('movements')
        .select('*, lots(product, lot_code), profiles(full_name)')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('movements')
        .select('*, lots(product, lot_code, current_quantity, clients(name)), profiles(full_name)')
        .in('type', ['ajuste', 'traslado', 'salida'])
        .eq('approval_status', 'pendiente')
        .order('created_at', { ascending: false }),
      supabase
        .from('client_dispatch_requests')
        .select('*, clients(name), lots(lot_code, product, current_quantity, location)')
        .eq('status', 'pendiente')
        .order('created_at', { ascending: false }),
    ])

    let movementsData = movementsResult.data || []
    let pendingData = pendingResult.data || []

    if (movementsResult.error) {
      const fallback = await supabase
        .from('movements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (fallback.error) {
        setDashboardError('No se pudieron cargar los movimientos. Revisa que el SQL de permisos este actualizado.')
      } else {
        movementsData = await enrichMovements(fallback.data || [])
      }
    }

    if (pendingResult.error) {
      const fallbackPending = await supabase
        .from('movements')
        .select('*')
        .in('type', ['ajuste', 'traslado', 'salida'])
        .order('created_at', { ascending: false })

      if (fallbackPending.error) {
        setDashboardError('No se pudieron cargar las aprobaciones pendientes. Revisa que el SQL de permisos este actualizado.')
        pendingData = []
      } else {
        pendingData = await enrichMovements((fallbackPending.data || []).filter((item) => item.approval_status === 'pendiente'))
      }
    }

    if (lotsError) {
      setDashboardError('No se pudieron cargar los lotes. Revisa que el SQL de permisos este actualizado.')
    }

    setLots(lotsData || [])
    setMovements(movementsData || [])
    setPendingMovements(pendingData || [])
    setDispatchRequests(requestsResult.error ? [] : requestsResult.data || [])
  }

  async function enrichMovements(rawMovements) {
    const lotIds = [...new Set(rawMovements.map((movement) => movement.lot_id).filter(Boolean))]
    const userIds = [...new Set(rawMovements.map((movement) => movement.user_id).filter(Boolean))]

    const [{ data: lotRows }, { data: profileRows }] = await Promise.all([
      lotIds.length
        ? supabase.from('lots').select('id, product, lot_code, current_quantity, location, clients(name)').in('id', lotIds)
        : Promise.resolve({ data: [] }),
      userIds.length
        ? supabase.from('profiles').select('id, full_name').in('id', userIds)
        : Promise.resolve({ data: [] }),
    ])

    const lotMap = new Map((lotRows || []).map((lot) => [lot.id, lot]))
    const profileMap = new Map((profileRows || []).map((profile) => [profile.id, profile]))

    return rawMovements.map((movement) => ({
      ...movement,
      lots: movement.lots || lotMap.get(movement.lot_id) || null,
      profiles: movement.profiles || profileMap.get(movement.user_id) || null,
    }))
  }

  const stats = useMemo(() => {
    const totalStock = lots.reduce((sum, lot) => sum + Number(lot.current_quantity || 0), 0)
    const locations = new Set(lots.map((lot) => lot.location).filter(Boolean))
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const todaysMovements = movements.filter((movement) => {
      const createdAt = new Date(movement.created_at)
      return createdAt >= today && createdAt < tomorrow
    })
    const entriesToday = todaysMovements.filter((movement) => movement.type === 'entrada').length
    const exitsToday = todaysMovements.filter((movement) => movement.type === 'salida').length
    const expiredLots = lots.filter((lot) => lot.expiry_date && new Date(`${lot.expiry_date}T00:00:00`) < today)
    const expiringLots = lots
      .filter((lot) => lot.expiry_date)
      .map((lot) => {
        const expiry = new Date(`${lot.expiry_date}T00:00:00`)
        const daysLeft = Math.ceil((expiry - today) / 86400000)
        return { ...lot, daysLeft }
      })
      .filter((lot) => lot.daysLeft <= 90)
      .sort((a, b) => a.daysLeft - b.daysLeft)
    return { totalStock, expiringLots, expiredLots, entriesToday, exitsToday, locationCount: locations.size }
  }, [lots, movements])

  const recentMovements = movements.slice(0, 8)

  function exportInventoryExcel() {
    const headers = ['Cliente', 'Lote', 'Producto', 'Envases', 'Presentacion', 'Equivalente', 'Ubicacion', 'Ingreso', 'Vencimiento', 'Estado']
    const rows = lots.map((lot) => [
      lot.clients?.name || '',
      displayLotCode(lot.lot_code),
      cleanProductName(lot.product),
      formatNumber(lot.current_quantity),
      lot.package_size ? `${formatNumber(lot.package_size)} ${lot.package_unit || ''}` : '',
      lot.package_size ? `${formatNumber(Number(lot.current_quantity || 0) * Number(lot.package_size || 0))} ${lot.package_unit || ''}` : '',
      lot.location || '',
      lot.entry_date ? formatDate(lot.entry_date) : '',
      lot.expiry_date ? formatDate(lot.expiry_date) : '',
      lot.status || '',
    ])
    const tableRows = [headers, ...rows]
      .map((row) => `<tr>${row.map((cell) => `<td>${String(cell).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</td>`).join('')}</tr>`)
      .join('')
    const html = `<html><head><meta charset="utf-8" /></head><body><table>${tableRows}</table></body></html>`
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `inventario-todo-agricola-${new Date().toISOString().slice(0, 10)}.xls`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function reviewAdjustment(id, action) {
    const fn = action === 'approve' ? 'approve_adjustment' : 'reject_adjustment'
    await supabase.rpc(fn, {
      p_movement_id: id,
      p_user_id: user.id,
    })
    loadData()
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
    loadData()
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Estado actual del almacen"
        action={
          <button className="btn-secondary !min-h-11 !px-3" type="button" onClick={exportInventoryExcel}>
            <Download size={20} /> Excel
          </button>
        }
      />

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatCard icon={Boxes} label="Productos almacenados" value={formatNumber(stats.totalStock)} />
        <StatCard icon={PackagePlus} label="Ingresos hoy" value={stats.entriesToday} />
        <StatCard icon={LogOut} label="Salidas hoy" value={stats.exitsToday} />
        <StatCard icon={Wrench} label="Pendientes" value={pendingMovements.length + dispatchRequests.length} />
      </section>

      <section className="mt-5 grid gap-3 md:grid-cols-3">
        <Link className="btn-primary min-h-20 !justify-start !px-5 text-left text-lg" to="/operacion/nuevo-ingreso">
          <PackagePlus size={28} /> Nuevo ingreso
        </Link>
        <Link className="min-h-20 !justify-start !px-5 text-left text-lg inline-flex items-center gap-2 rounded-lg bg-maiz px-4 py-3 font-semibold text-slate-950 shadow-soft transition active:scale-[0.99]" to="/operacion/despacho-lista?nuevo=1">
          <LogOut size={24} /> Despacho
        </Link>
        <Link className="min-h-20 !justify-start !px-5 text-left text-lg inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-3 font-semibold text-white shadow-soft transition active:scale-[0.99]" to="/operacion/reparacion-traslado">
          <Wrench size={24} /> Reparacion / Traslado
        </Link>
      </section>

      {dashboardError ? (
        <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">
          {dashboardError}
        </div>
      ) : null}

      <section className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="panel">
          <div className="mb-3 flex items-center gap-2">
            <Wrench size={20} className="text-orange-500" />
            <h3 className="font-bold text-slate-900">Pendientes</h3>
            <Link className="ml-auto text-sm font-bold text-campo-700" to="/pendientes">
              Ver todos
            </Link>
          </div>
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {pendingMovements.length === 0 && dispatchRequests.length === 0 ? (
              <div className="rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">No hay solicitudes, salidas offline, reparaciones ni traslados pendientes.</div>
            ) : (
              <>
              {dispatchRequests.map((request) => (
                <div key={request.id} className="rounded-lg bg-amber-50 p-3">
                  <p className="font-bold text-slate-900">Solicitud despacho - {request.clients?.name || 'Cliente'}</p>
                  <p className="text-sm font-semibold text-slate-700">{cleanProductName(request.product || request.lots?.product)}</p>
                  <p className="text-sm font-semibold text-slate-600">
                    {Array.isArray(request.items) && request.items.length > 1
                      ? `${request.items.length} productos - ${formatNumber(request.quantity)} env. solicitados`
                      : `${displayLotCode(request.lots?.lot_code)} - ${formatNumber(request.quantity)} env. solicitados`}
                  </p>
                  {Array.isArray(request.items) && request.items.length > 1 ? (
                    <div className="mt-2 space-y-1">
                      {request.items.slice(0, 3).map((item) => (
                        <p key={item.lot_id} className="text-xs font-semibold text-slate-600">
                          {displayLotCode(item.lot_code)} - {cleanProductName(item.product)} - {formatNumber(item.quantity)} env.
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Disponible: {formatNumber(request.lots?.current_quantity)} env. - {request.lots?.location || '-'}
                    </p>
                  )}
                  {request.notes ? <p className="mt-1 text-xs text-slate-600">{request.notes}</p> : null}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button className="btn-secondary !min-h-10 !py-2" type="button" onClick={() => reviewDispatchRequest(request.id, 'rechazado')}>
                      <X size={16} /> Rechazar
                    </button>
                    <button className="btn-primary !min-h-10 !py-2" type="button" onClick={() => reviewDispatchRequest(request.id, 'aprobado')}>
                      <Check size={16} /> Aprobar
                    </button>
                  </div>
                </div>
              ))}
              {pendingMovements.map((movement) => (
                <div key={movement.id} className="rounded-lg bg-orange-50 p-3">
                  <p className="font-bold text-slate-900">{movementLabel(movement.type)} - {displayLotCode(movement.lots?.lot_code)}</p>
                  <p className="text-sm font-semibold text-slate-700">{cleanProductName(movement.lots?.product)}</p>
                  <p className="text-sm font-semibold text-slate-600">
                    {movement.type === 'traslado'
                      ? `De ${movement.from_location || '-'} a ${movement.to_location || '-'}`
                      : movement.type === 'salida'
                        ? `Salida offline: ${formatNumber(movement.quantity)} env. - Stock actual: ${formatNumber(movement.lots?.current_quantity)} env.`
                      : `Actual: ${formatNumber(movement.previous_quantity)} env. - Solicitado: ${formatNumber(movement.quantity)} env.`}
                  </p>
                  <p className="text-xs text-slate-500">{movement.profiles?.full_name || 'Usuario'} - {movement.lots?.clients?.name || '-'}</p>
                  {movement.notes ? <p className="mt-1 text-xs text-slate-600">{movement.notes}</p> : null}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button className="btn-secondary !min-h-10 !py-2" type="button" onClick={() => reviewAdjustment(movement.id, 'reject')}>
                      <X size={16} /> Rechazar
                    </button>
                    <button className="btn-primary !min-h-10 !py-2" type="button" onClick={() => reviewAdjustment(movement.id, 'approve')}>
                      <Check size={16} /> Aprobar
                    </button>
                  </div>
                </div>
              ))}
              </>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="mb-3 flex items-center gap-2">
            <Clock3 size={20} className="text-campo-700" />
            <h3 className="font-bold text-slate-900">Movimientos recientes</h3>
          </div>
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {recentMovements.length === 0 ? (
              <div className="rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-600">Todavia no hay movimientos registrados.</div>
            ) : recentMovements.map((movement) => (
              <div key={movement.id} className="rounded-lg bg-slate-50 p-3">
                <div className="flex justify-between gap-3">
                  <p className="font-semibold text-slate-900">{movementLabel(movement.type)}</p>
                  {movement.type !== 'traslado' ? (
                    <p className="text-sm font-bold text-campo-700">{formatNumber(movement.quantity)}</p>
                  ) : null}
                </div>
                <p className="text-sm text-slate-500">
                  {displayLotCode(movement.lots?.lot_code)} - {cleanProductName(movement.lots?.product)}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {formatDate(movement.created_at)} - {movement.profiles?.full_name || 'Usuario'}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CalendarClock size={20} className="text-maiz" />
              <h3 className="font-bold text-slate-900">Productos proximos a vencer</h3>
            </div>
            <Link className="text-sm font-bold text-campo-700" to="/vencimientos">
              Ver
            </Link>
          </div>
          <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {stats.expiringLots.length === 0 ? (
              <div className="rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">
                No hay productos con vencimiento cercano.
              </div>
            ) : (
              stats.expiringLots.slice(0, 8).map((lot) => (
                <Link key={lot.id} className="block rounded-lg bg-amber-50 p-3 transition hover:bg-amber-100" to={`/lotes/${lot.id}`}>
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">{cleanProductName(lot.product)}</p>
                      <p className="text-xs font-semibold text-slate-500">
                        {displayLotCode(lot.lot_code)} - vence {formatDate(lot.expiry_date)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-amber-700">{lot.daysLeft < 0 ? 'Vencido' : `${lot.daysLeft} d`}</p>
                      <p className="text-xs font-semibold text-slate-500">{formatNumber(lot.current_quantity)} env.</p>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white/90 p-3 shadow-soft sm:p-4">
      <Icon className="text-campo-700" size={20} />
      <p className="mt-2 text-xs font-bold text-slate-500 sm:text-sm">{label}</p>
      <p className="mt-1 text-xl font-black text-slate-950 sm:text-2xl">{value}</p>
    </div>
  )
}
