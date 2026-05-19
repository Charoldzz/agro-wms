import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { supabase } from '../lib/supabase'
import { cleanProductName, displayLotCode, packageLabel } from '../lib/display'
import { formatDate, formatNumber } from '../lib/format'

function daysUntil(dateValue) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expiry = new Date(`${dateValue}T00:00:00`)
  return Math.ceil((expiry - today) / 86400000)
}

export default function ExpiringLots() {
  const [lots, setLots] = useState([])

  useEffect(() => {
    loadLots()
  }, [])

  async function loadLots() {
    const { data } = await supabase
      .from('lots')
      .select('*, clients(name)')
      .not('expiry_date', 'is', null)
      .order('expiry_date', { ascending: true })
    setLots(data || [])
  }

  const expiringLots = useMemo(() => {
    return lots
      .map((lot) => ({ ...lot, daysLeft: daysUntil(lot.expiry_date) }))
      .filter((lot) => lot.daysLeft <= 90)
      .sort((a, b) => a.daysLeft - b.daysLeft)
  }, [lots])

  return (
    <div>
      <PageHeader title="Productos proximos a vencer" subtitle="Lotes vencidos o dentro de 90 dias" />

      <section className="grid gap-3">
        {expiringLots.length === 0 ? (
          <div className="panel text-sm font-bold text-campo-700">No hay productos con vencimiento cercano.</div>
        ) : (
          expiringLots.map((lot) => (
            <Link key={lot.id} className="panel block transition hover:bg-amber-50" to={`/lotes/${lot.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <CalendarClock size={18} className="text-maiz" />
                    <p className="truncate font-bold text-slate-950">{cleanProductName(lot.product)}</p>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    {displayLotCode(lot.lot_code)} - {lot.clients?.name || 'Sin cliente'}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {lot.location} {packageLabel(lot) ? `- ${packageLabel(lot)}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-amber-700">
                    {lot.daysLeft < 0 ? 'Vencido' : `${lot.daysLeft} d`}
                  </p>
                  <p className="text-xs font-semibold text-slate-500">{formatDate(lot.expiry_date)}</p>
                  <p className="mt-1 text-xs font-bold text-campo-700">{formatNumber(lot.current_quantity)} env.</p>
                </div>
              </div>
            </Link>
          ))
        )}
      </section>
    </div>
  )
}
