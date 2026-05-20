import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, CalendarClock, PackageCheck, Search, ShieldCheck } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { cleanProductName, displayLotCode } from '../lib/display'
import { formatDate, formatNumber } from '../lib/format'
import { supabase } from '../lib/supabase'

export default function ClientPortal() {
  const [lots, setLots] = useState([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadLots()
  }, [])

  async function loadLots() {
    const { data } = await supabase
      .from('lots')
      .select('id, lot_code, product, current_quantity, package_size, package_unit, location, expiry_date, status, clients(name)')
      .order('product')

    setLots(data || [])
  }

  const filteredLots = useMemo(() => {
    const term = search.toLowerCase()
    return lots.filter((lot) =>
      [lot.product, lot.lot_code, displayLotCode(lot.lot_code), lot.location]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(term)),
    )
  }, [lots, search])

  const totalStock = lots.reduce((sum, lot) => sum + Number(lot.current_quantity || 0), 0)
  const expiring = lots.filter((lot) => lot.expiry_date && new Date(`${lot.expiry_date}T00:00:00`) <= new Date(Date.now() + 90 * 86400000))
  const productCount = new Set(lots.map((lot) => lot.product).filter(Boolean)).size

  return (
    <div>
      <PageHeader title="Mi inventario" subtitle="Consulta de stock autorizado en Todo Agricola" />

      <section className="panel mb-4 border-campo-100 bg-white/95">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-campo-50 text-campo-700">
            <ShieldCheck size={26} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-950">Inventario disponible para tu empresa</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              La informacion visible corresponde solo a los lotes autorizados para tu usuario.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="panel">
          <Boxes className="text-campo-700" size={24} />
          <p className="mt-3 text-sm font-medium text-slate-500">Envases disponibles</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{formatNumber(totalStock)}</p>
        </div>
        <div className="panel">
          <PackageCheck className="text-campo-700" size={24} />
          <p className="mt-3 text-sm font-medium text-slate-500">Productos</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{productCount}</p>
        </div>
        <div className="panel">
          <CalendarClock className="text-maiz" size={24} />
          <p className="mt-3 text-sm font-medium text-slate-500">Lotes por vencer</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{expiring.length}</p>
        </div>
      </section>

      <section className="my-4 flex items-center rounded-lg border border-slate-200 bg-white px-3">
        <Search size={20} className="text-slate-400" />
        <input
          className="min-h-12 flex-1 bg-transparent px-2 outline-none"
          placeholder="Buscar producto o lote..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </section>

      {expiring.length > 0 ? (
        <section className="mb-4 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-800">
          Tienes {expiring.length} lote{expiring.length === 1 ? '' : 's'} con vencimiento cercano. Coordina con administracion si necesitas priorizar salida.
        </section>
      ) : null}

      <div className="space-y-3">
        {filteredLots.length === 0 ? (
          <EmptyState title="Sin lotes visibles" text="No hay inventario autorizado para este usuario." />
        ) : (
          filteredLots.map((lot) => {
            const equivalent = Number(lot.current_quantity || 0) * Number(lot.package_size || 0)
            return (
              <Link key={lot.id} className="panel block" to={`/lotes/${lot.id}`}>
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-950">{cleanProductName(lot.product)}</p>
                    <p className="text-sm font-semibold text-slate-500">{displayLotCode(lot.lot_code)} · {lot.location || '-'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-black text-campo-700">{formatNumber(lot.current_quantity)}</p>
                    <p className="text-xs font-bold text-slate-500">envases</p>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs font-bold text-slate-600 sm:grid-cols-2">
                  <span className="rounded-lg bg-slate-50 p-2">
                    Equivalente: {Number(lot.package_size) > 0 ? `${formatNumber(equivalent)} ${lot.package_unit || ''}` : 'Sin dato'}
                  </span>
                  <span className="rounded-lg bg-slate-50 p-2">
                    Vence: {lot.expiry_date ? formatDate(lot.expiry_date) : 'Sin dato'}
                  </span>
                </div>
              </Link>
            )
          })
        )}
      </div>
    </div>
  )
}
