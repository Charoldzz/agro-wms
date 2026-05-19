import { useEffect, useMemo, useState } from 'react'
import { Boxes, CalendarClock, Clock3, MapPinned, Users } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, movementLabel } from '../lib/format'
import { cleanProductName, displayLotCode } from '../lib/display'

export default function Dashboard() {
  const [lots, setLots] = useState([])
  const [movements, setMovements] = useState([])

  useEffect(() => {
    loadData()

    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lots' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movements' }, loadData)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  async function loadData() {
    const [{ data: lotsData }, { data: movementsData }] = await Promise.all([
      supabase.from('lots').select('*, clients(name)').order('created_at', { ascending: false }),
      supabase
        .from('movements')
        .select('*, lots(product, lot_code), profiles(full_name)')
        .order('created_at', { ascending: false })
        .limit(8),
    ])
    setLots(lotsData || [])
    setMovements(movementsData || [])
  }

  const stats = useMemo(() => {
    const totalStock = lots.reduce((sum, lot) => sum + Number(lot.current_quantity || 0), 0)
    const locations = new Set(lots.map((lot) => lot.location).filter(Boolean))
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const limit = new Date(today)
    limit.setDate(limit.getDate() + 90)
    const expiringLots = lots
      .filter((lot) => lot.expiry_date)
      .map((lot) => {
        const expiry = new Date(`${lot.expiry_date}T00:00:00`)
        const daysLeft = Math.ceil((expiry - today) / 86400000)
        return { ...lot, daysLeft }
      })
      .filter((lot) => lot.daysLeft <= 90)
      .sort((a, b) => a.daysLeft - b.daysLeft)
    const byClient = lots.reduce((acc, lot) => {
      const name = lot.clients?.name || 'Sin cliente'
      acc[name] = (acc[name] || 0) + Number(lot.current_quantity || 0)
      return acc
    }, {})
    return { totalStock, expiringLots, locationCount: locations.size, byClient }
  }, [lots])

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Estado actual del almacen" />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Boxes} label="Productos almacenados" value={formatNumber(stats.totalStock)} />
        <StatCard icon={MapPinned} label="Ocupacion almacen" value={`${lots.length} lotes`} />
        <StatCard icon={CalendarClock} label="Proximos a vencer" value={stats.expiringLots.length} />
        <StatCard icon={Users} label="Ubicaciones activas" value={stats.locationCount} />
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="panel">
          <div className="mb-3 flex items-center gap-2">
            <Clock3 size={20} className="text-campo-700" />
            <h3 className="font-bold text-slate-900">Movimientos recientes</h3>
          </div>
          <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {movements.map((movement) => (
              <div key={movement.id} className="rounded-lg bg-slate-50 p-3">
                <div className="flex justify-between gap-3">
                  <p className="font-semibold text-slate-900">{movementLabel(movement.type)}</p>
                  <p className="text-sm font-bold text-campo-700">{formatNumber(movement.quantity)}</p>
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
          <div className="mb-3 flex items-center gap-2">
            <CalendarClock size={20} className="text-maiz" />
            <h3 className="font-bold text-slate-900">Productos proximos a vencer</h3>
          </div>
          <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {stats.expiringLots.length === 0 ? (
              <div className="rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">
                No hay productos con vencimiento cercano.
              </div>
            ) : (
              stats.expiringLots.map((lot) => (
                <div key={lot.id} className="rounded-lg bg-amber-50 p-3">
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
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <div className="mb-3 flex items-center gap-2">
            <Users size={20} className="text-campo-700" />
            <h3 className="font-bold text-slate-900">Cantidad por cliente</h3>
          </div>
          <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {Object.entries(stats.byClient).map(([client, quantity]) => (
              <div key={client}>
                <div className="flex justify-between gap-3 text-sm">
                  <span className="font-semibold text-slate-700">{client}</span>
                  <span className="font-bold text-slate-900">{formatNumber(quantity)}</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-gradient-to-r from-campo-500/55 via-maiz/45 to-campo-500/25" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="panel">
      <Icon className="text-campo-700" size={24} />
      <p className="mt-3 text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-950">{value}</p>
    </div>
  )
}
