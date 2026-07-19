import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Search } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { supabase } from '../lib/supabase'
import { cleanProductName, displayLotCode, packageLabel } from '../lib/display'
import { desgloseEnvases } from '../lib/envases'
import { formatDate, formatNumber } from '../lib/format'

function daysUntil(dateValue) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expiry = new Date(`${dateValue}T00:00:00`)
  return Math.ceil((expiry - today) / 86400000)
}

// Equivalente del lote (uds × presentación) normalizado a lts/kgs; sin dato → uds
function lotEquivalentLabel(lot) {
  const size = Number(lot.package_size) || 0
  const qty = Number(lot.current_quantity) || 0
  if (size <= 0 || !lot.package_unit) return `${formatNumber(qty)} uds`
  let u = String(lot.package_unit).toLowerCase().trim()
  let v = qty * size
  if (u === 'ml') { u = 'lts'; v /= 1000 }
  else if (u === 'gr' || u === 'grs') { u = 'kgs'; v /= 1000 }
  else if (/^l/.test(u)) u = 'lts'
  else if (/^k/.test(u)) u = 'kgs'
  else return `${formatNumber(qty)} uds`
  return `${formatNumber(v)} ${u}`
}

// Unidades con su tipo de envase ("30 bolsas", "53 bidones + 15 lt")
function lotDesgloseLabel(lot) {
  const size = Number(lot.package_size) || 0
  if (size <= 0) return ''
  const eqRaw = Number(lot.current_quantity) || 0
  return desgloseEnvases(eqRaw, size, lot.package_unit, 0).unidadesLabel || ''
}

export default function ExpiringLots() {
  const [lots, setLots] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    loadLots()
  }, [])

  async function loadLots() {
    const { data } = await supabase
      .from('lots')
      .select('*, clients(name)')
      .eq('inventory_source', 'stock_independiente')
      .gt('current_quantity', 0)
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

  const filteredLots = useMemo(() => {
    const term = search.toLowerCase().trim()
    return expiringLots.filter((lot) => {
      if (statusFilter === 'vencidos' && lot.daysLeft >= 0) return false
      if (statusFilter === 'porvencer' && lot.daysLeft < 0) return false
      if (!term) return true
      return [
        cleanProductName(lot.product),
        lot.lot_code,
        displayLotCode(lot.lot_code),
        lot.clients?.name,
        lot.location,
      ].filter(Boolean).some((v) => String(v).toLowerCase().includes(term))
    })
  }, [expiringLots, search, statusFilter])

  return (
    <div>
      <PageHeader title="Productos proximos a vencer" subtitle="Lotes vencidos o dentro de 90 dias" />

      <section className="panel mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase text-amber-700">Control FEFO</p>
          <p className="text-sm font-bold text-slate-700">Revisa primero los vencidos y los que vencen antes.</p>
        </div>
        <span className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-black text-amber-800">
          {filteredLots.length} lote{filteredLots.length === 1 ? '' : 's'}
        </span>
      </section>

      <section className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input w-full pl-9"
            placeholder="Buscar producto, lote, empresa, ubicación..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="input sm:w-44" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Todos</option>
          <option value="vencidos">Vencidos</option>
          <option value="porvencer">Por vencer (90 días)</option>
        </select>
      </section>

      <section className="grid gap-2">
        {filteredLots.length === 0 ? (
          <div className="panel text-sm font-bold text-campo-700">
            {expiringLots.length === 0 ? 'No hay productos con vencimiento cercano.' : 'Sin resultados para la búsqueda.'}
          </div>
        ) : (
          filteredLots.map((lot) => (
            <Link
              key={lot.id}
              className={`block rounded-lg border p-3 shadow-soft transition ${
                lot.daysLeft < 0
                  ? 'border-red-100 bg-red-50/95 hover:bg-red-50'
                  : 'border-amber-100 bg-amber-50/95 hover:bg-amber-50'
              }`}
              to={`/lotes/${lot.id}`}
              state={{ backTo: '/vencimientos' }}
            >
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0">
                  <div className="flex items-start gap-2">
                    <CalendarClock size={16} className={`mt-0.5 shrink-0 ${lot.daysLeft < 0 ? 'text-red-700' : 'text-amber-700'}`} />
                    <p className="text-sm font-black leading-snug text-slate-950 [overflow-wrap:anywhere] sm:text-base">{cleanProductName(lot.product)}</p>
                  </div>
                  <p className="mt-1 text-xs font-semibold leading-snug text-slate-600 [overflow-wrap:anywhere] sm:text-sm">
                    {displayLotCode(lot.lot_code)} - {lot.clients?.name || 'Sin cliente'}
                  </p>
                  <p className="mt-1 text-xs font-semibold leading-snug text-slate-500 [overflow-wrap:anywhere] sm:text-sm">
                    {lot.location} {packageLabel(lot) ? `- ${packageLabel(lot)}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 sm:grid sm:justify-items-end sm:text-right">
                  <p className={`rounded-lg bg-white/80 px-2.5 py-1 text-sm font-black sm:text-base ${lot.daysLeft < 0 ? 'text-red-700' : 'text-amber-700'}`}>
                    {lot.daysLeft < 0 ? 'Vencido' : `${lot.daysLeft} d`}
                  </p>
                  <p className="rounded-lg bg-white/80 px-2.5 py-1 text-xs font-bold text-slate-600">{formatDate(lot.expiry_date)}</p>
                  <div className="rounded-lg bg-campo-50 px-2.5 py-1 text-right">
                    <p className="text-xs font-black text-campo-700 sm:text-sm">{lotEquivalentLabel(lot)}</p>
                    {lotDesgloseLabel(lot) ? (
                      <p className="text-[10px] font-semibold text-slate-500">{lotDesgloseLabel(lot)}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            </Link>
          ))
        )}
      </section>
    </div>
  )
}
