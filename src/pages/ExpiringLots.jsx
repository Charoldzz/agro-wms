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

      <section className="panel mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase text-amber-700">Control FEFO</p>
          <p className="text-sm font-bold text-slate-700">Revisa primero los vencidos y los que vencen antes.</p>
        </div>
        <span className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-black text-amber-800">
          {expiringLots.length} lote{expiringLots.length === 1 ? '' : 's'}
        </span>
      </section>

      <section className="grid gap-3">
        {expiringLots.length === 0 ? (
          <div className="panel text-sm font-bold text-campo-700">No hay productos con vencimiento cercano.</div>
        ) : (
          expiringLots.map((lot) => (
            <Link key={lot.id} className="panel block transition hover:bg-amber-50" to={`/lotes/${lot.id}`}>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0">
                  <div className="flex items-start gap-2">
                    <CalendarClock size={18} className="mt-0.5 shrink-0 text-maiz" />
                    <p className="font-black leading-snug text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(lot.product)}</p>
                  </div>
                  <p className="mt-1 text-sm font-semibold leading-snug text-slate-500 [overflow-wrap:anywhere]">
                    {displayLotCode(lot.lot_code)} - {lot.clients?.name || 'Sin cliente'}
                  </p>
                  <p className="mt-1 text-sm font-semibold leading-snug text-slate-500 [overflow-wrap:anywhere]">
                    {lot.location} {packageLabel(lot) ? `- ${packageLabel(lot)}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 sm:grid sm:justify-items-end sm:text-right">
                  <p className="rounded-lg bg-amber-50 px-2.5 py-1 text-lg font-black text-amber-700">
                    {lot.daysLeft < 0 ? 'Vencido' : `${lot.daysLeft} d`}
                  </p>
                  <p className="rounded-lg bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-600">{formatDate(lot.expiry_date)}</p>
                  <p className="rounded-lg bg-campo-50 px-2.5 py-1 text-xs font-black text-campo-700">{formatNumber(lot.current_quantity)} env.</p>
                </div>
              </div>
            </Link>
          ))
        )}
      </section>
    </div>
  )
}
