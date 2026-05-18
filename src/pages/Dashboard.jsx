import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Boxes, Clock3, MapPinned, Users } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, movementLabel } from '../lib/format'

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
    const lowStock = lots.filter((lot) => Number(lot.current_quantity) <= Number(lot.low_stock_threshold || 5))
    const locations = new Set(lots.map((lot) => lot.location).filter(Boolean))
    const byClient = lots.reduce((acc, lot) => {
      const name = lot.clients?.name || 'Sin cliente'
      acc[name] = (acc[name] || 0) + Number(lot.current_quantity || 0)
      return acc
    }, {})
    return { totalStock, lowStock, locationCount: locations.size, byClient }
  }, [lots])

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Estado actual del almacén" />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Boxes} label="Productos almacenados" value={formatNumber(stats.totalStock)} />
        <StatCard icon={MapPinned} label="Ocupación almacén" value={`${lots.length} lotes`} />
        <StatCard icon={AlertTriangle} label="Stock bajo" value={stats.lowStock.length} />
        <StatCard icon={Users} label="Ubicaciones activas" value={stats.locationCount} />
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="panel">
          <div className="mb-3 flex items-center gap-2">
            <Clock3 size={20} className="text-campo-700" />
            <h3 className="font-bold text-slate-900">Movimientos recientes</h3>
          </div>
          <div className="space-y-3">
            {movements.map((movement) => (
              <div key={movement.id} className="rounded-lg bg-slate-50 p-3">
                <div className="flex justify-between gap-3">
                  <p className="font-semibold text-slate-900">{movementLabel(movement.type)}</p>
                  <p className="text-sm font-bold text-campo-700">{formatNumber(movement.quantity)}</p>
                </div>
                <p className="text-sm text-slate-500">
                  {movement.lots?.lot_code} · {movement.lots?.product}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {formatDate(movement.created_at)} · {movement.profiles?.full_name || 'Usuario'}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h3 className="mb-3 font-bold text-slate-900">Cantidad por cliente</h3>
          <div className="space-y-3">
            {Object.entries(stats.byClient).map(([client, quantity]) => (
              <div key={client}>
                <div className="flex justify-between text-sm">
                  <span className="font-semibold text-slate-700">{client}</span>
                  <span className="font-bold text-slate-900">{formatNumber(quantity)}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-campo-600"
                    style={{ width: `${Math.min(100, (quantity / Math.max(stats.totalStock, 1)) * 100)}%` }}
                  />
                </div>
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
