import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, CalendarClock, Check, DatabaseBackup, FileText, LogOut, Mail, PackagePlus, ScanLine, Wrench, X } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, movementLabel } from '../lib/format'
import { cleanProductName, displayLotCode } from '../lib/display'
import { normalizeDispatchRequests } from '../lib/dispatchRequests'

export default function Dashboard() {
  const { user } = useAuth()
  const [lots, setLots] = useState([])
  const [movements, setMovements] = useState([])
  const [pendingMovements, setPendingMovements] = useState([])
  const [dispatchRequests, setDispatchRequests] = useState([])
  const [dashboardError, setDashboardError] = useState('')
  const [testEmailStatus, setTestEmailStatus] = useState('')
  const [sendingTestEmail, setSendingTestEmail] = useState(false)

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
      supabase
        .from('lots')
        .select('*, clients(name)')
        .eq('inventory_source', 'stock_independiente')
        .eq('status', 'activo')
        .gt('current_quantity', 0)
        .order('created_at', { ascending: false }),
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
        .select('*, clients(name), lots(id, lot_code, client_id, product, current_quantity, package_size, package_unit, location, expiry_date, status)')
        .in('status', ['pendiente', 'aprobado'])
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
    setDispatchRequests(requestsResult.error ? [] : await normalizeDispatchRequests(requestsResult.data || []))
  }

  async function enrichMovements(rawMovements) {
    const lotIds = [...new Set(rawMovements.map((movement) => movement.lot_id).filter(Boolean))]
    const userIds = [...new Set(rawMovements.map((movement) => movement.user_id).filter(Boolean))]

    const [{ data: lotRows }, { data: profileRows }] = await Promise.all([
      lotIds.length
        ? supabase.from('lots').select('id, product, lot_code, current_quantity, location, clients(name)').eq('inventory_source', 'stock_independiente').in('id', lotIds)
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

  async function sendTestDispatchEmail() {
    setSendingTestEmail(true)
    setTestEmailStatus('')

    const { error } = await supabase.functions.invoke('send-movement-email', {
      body: {
        to: 'hgarayd@outlook.com',
        movement_type: 'salida_lista',
        client: 'ADILSON SABEC PERES',
        receiver_name: 'Correo de prueba',
        receiver_document: '000000',
        vehicle_plate: 'PRUEBA',
        notes: 'Correo de prueba. No registra movimiento.',
        user_email: user.email,
        items: [
          {
            lot_code: 'Lote 20251212',
            product: 'KOSAKO (Cletodim 240EC) 5L',
            quantity: 24,
            previous_quantity: 124,
            new_quantity: 100,
            location: 'Deposito Warnes Tagribol',
            package_size: 5,
            package_unit: 'lt',
          },
          {
            lot_code: 'Lote 4971024',
            product: 'K-FOL X 10 Kgs',
            quantity: 25,
            previous_quantity: 50,
            new_quantity: 25,
            location: 'Deposito Warnes Tagribol',
            package_size: 10,
            package_unit: 'kg',
          },
        ],
      },
    })

    setTestEmailStatus(error ? 'No se pudo enviar el correo de prueba.' : 'Correo de prueba enviado.')
    setSendingTestEmail(false)
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Estado actual del almacen"
        action={
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
            <Link className="btn-secondary !min-h-11 !px-3" to="/exportes">
              <FileText size={20} /> Exportes
            </Link>
            <Link className="btn-secondary !min-h-11 !px-3" to="/backups">
              <DatabaseBackup size={20} /> Backups
            </Link>
          </div>
        }
      />

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatCard icon={Boxes} label="Productos almacenados" value={formatNumber(stats.totalStock)} />
        <StatCard icon={PackagePlus} label="Ingresos hoy" value={stats.entriesToday} />
        <StatCard icon={LogOut} label="Salidas hoy" value={stats.exitsToday} />
        <StatCard icon={Wrench} label="Pendientes" value={pendingMovements.length + dispatchRequests.length} />
      </section>

      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link className="btn-primary aspect-square min-h-36 !flex-col !items-start !justify-between !px-4 !py-4 text-left text-base leading-tight sm:min-h-40 sm:!px-5 sm:!py-5 sm:text-lg" to="/operacion/nuevo-ingreso">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/15">
            <PackagePlus size={30} />
          </span>
          <span>Nuevo ingreso</span>
        </Link>
        <Link className="inline-flex aspect-square min-h-36 flex-col items-start justify-between gap-3 rounded-lg bg-maiz px-4 py-4 text-left text-base font-semibold leading-tight text-slate-950 shadow-soft transition active:scale-[0.99] sm:min-h-40 sm:px-5 sm:py-5 sm:text-lg" to="/operacion/despacho-lista?nuevo=1">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/35">
            <LogOut size={28} />
          </span>
          <span>Despacho</span>
        </Link>
        <Link className="inline-flex aspect-square min-h-36 flex-col items-start justify-between gap-3 rounded-lg bg-orange-500 px-4 py-4 text-left text-base font-semibold leading-tight text-white shadow-soft transition active:scale-[0.99] sm:min-h-40 sm:px-5 sm:py-5 sm:text-lg" to="/operacion/reparacion-traslado">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/15">
            <Wrench size={28} />
          </span>
          <span>Reparacion / Traslado</span>
        </Link>
        <Link className="btn-secondary aspect-square min-h-36 !flex-col !items-start !justify-between !px-4 !py-4 text-left text-base leading-tight sm:min-h-40 sm:!px-5 sm:!py-5 sm:text-lg" to="/scanner">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-campo-50 text-campo-700">
            <ScanLine size={28} />
          </span>
          <span>Consultar QR</span>
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
            <LogOut size={20} className="text-maiz" />
            <h3 className="font-bold text-slate-900">Despachos pendientes</h3>
            <Link className="ml-auto text-sm font-bold text-campo-700" to="/solicitudes?pendientes=1">
              Ver todos
            </Link>
          </div>
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {dispatchRequests.length === 0 ? (
              <div className="rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">No hay despachos pendientes.</div>
            ) : (
              dispatchRequests.slice(0, 5).map((request) => (
                <div key={request.id} className="rounded-lg bg-amber-50 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-950 [overflow-wrap:anywhere]">{request.clients?.name || 'Cliente'}</p>
                      <p className="text-xs font-bold text-amber-700">{request.status === 'aprobado' ? 'En almacen' : 'Solicitado'}</p>
                    </div>
                    <span className="rounded-full bg-white px-2 py-1 text-xs font-black text-amber-800">
                      {Array.isArray(request.items) && request.items.length > 1 ? `${request.items.length} items` : `${formatNumber(request.quantity)} env.`}
                    </span>
                  </div>
                  {Array.isArray(request.items) && request.items.length > 1 ? (
                    <div className="mt-2 space-y-1">
                      {request.items.slice(0, 2).map((item) => (
                        <p key={item.lot_id} className="rounded-lg bg-white/80 px-2 py-1 text-xs font-bold text-slate-600 [overflow-wrap:anywhere]">
                          {cleanProductName(item.product)} - {formatNumber(item.quantity)} env.
                        </p>
                      ))}
                      {request.items.length > 2 ? <p className="text-xs font-bold text-slate-600">+ {request.items.length - 2} producto{request.items.length - 2 === 1 ? '' : 's'} mas</p> : null}
                    </div>
                  ) : (
                    <p className="mt-2 rounded-lg bg-white/80 px-2 py-1 text-xs font-bold text-slate-600 [overflow-wrap:anywhere]">
                      {cleanProductName(request.product || request.lots?.product)} - {displayLotCode(request.lots?.lot_code)}
                    </p>
                  )}
                  <Link className="btn-primary mt-3 w-full !min-h-10 !py-2" to={`/operacion/despacho-lista?request=${request.id}`}>
                    <LogOut size={16} /> Iniciar despacho
                  </Link>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <div className="mb-3 flex items-center gap-2">
            <Wrench size={20} className="text-orange-500" />
            <h3 className="font-bold text-slate-900">Revisiones pendientes</h3>
            <Link className="ml-auto text-sm font-bold text-campo-700" to="/pendientes">
              Ver todos
            </Link>
          </div>
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {pendingMovements.length === 0 ? (
              <div className="rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">No hay salidas offline, reparaciones ni traslados pendientes.</div>
            ) : (
              <>
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

      <section className="panel mt-4 flex flex-wrap items-center justify-between gap-3 border-dashed">
        <div>
          <p className="text-sm font-black text-slate-900">Prueba temporal de correo</p>
          <p className="text-xs font-semibold text-slate-500">Quitar antes del piloto en planta. No modifica inventario.</p>
          {testEmailStatus ? <p className="mt-1 text-xs font-bold text-campo-700">{testEmailStatus}</p> : null}
        </div>
        <button className="btn-secondary !min-h-10 !py-2" type="button" onClick={sendTestDispatchEmail} disabled={sendingTestEmail}>
          <Mail size={18} /> {sendingTestEmail ? 'Enviando...' : 'Enviar prueba'}
        </button>
      </section>
    </div>
  )
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white/80 px-2.5 py-2 shadow-soft sm:px-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-campo-50 text-campo-700">
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-bold text-slate-500 sm:text-xs">{label}</p>
        <p className="text-base font-black leading-tight text-slate-950 sm:text-lg">{value}</p>
      </div>
    </div>
  )
}
