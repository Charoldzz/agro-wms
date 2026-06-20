import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber } from '../lib/format'
import { cleanProductName, displayLotCode, packageLabel } from '../lib/display'

function safeProductParam(value) {
  try {
    return decodeURIComponent(value || '')
  } catch {
    return value || ''
  }
}

export default function ProductLots() {
  const { name } = useParams()
  const productName = cleanProductName(safeProductParam(name))
  const [lots, setLots] = useState([])

  useEffect(() => {
    loadLots()
  }, [])

  async function loadLots() {
    const { data } = await supabase
      .from('lots')
      .select('*, clients(name)')
      .eq('inventory_source', 'stock_independiente')
      .eq('status', 'activo')
      .gt('current_quantity', 0)
      .order('created_at', { ascending: false })

    setLots(data || [])
  }

  const productLots = useMemo(
    () => lots
      .filter((lot) => cleanProductName(lot.product) === productName)
      .sort((a, b) => {
        const clientOrder = (a.clients?.name || '').localeCompare(b.clients?.name || '', 'es', { numeric: true })
        if (clientOrder !== 0) return clientOrder
        return displayLotCode(a.lot_code).localeCompare(displayLotCode(b.lot_code), 'es', { numeric: true })
      }),
    [lots, productName],
  )

  const total = useMemo(
    () => productLots.reduce((sum, lot) => sum + Number(lot.current_quantity || 0), 0),
    [productLots],
  )

  return (
    <div>
      <PageHeader
        title={productName || 'Producto'}
        subtitle={`${productLots.length} lotes - Total ${formatNumber(total)} envases`}
      />

      <div className="grid gap-2">
        {productLots.length === 0 ? (
          <EmptyState title="Sin lotes" text="No hay lotes disponibles para este producto." />
        ) : (
          productLots.map((lot) => (
            <Link key={lot.id} to={`/lotes/${lot.id}`} state={{ backTo: `/productos/${encodeURIComponent(productName)}` }} className="block w-full overflow-hidden rounded-lg bg-slate-50 p-3 text-left shadow-soft transition hover:bg-campo-50">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
                <div className="min-w-0">
                  <p className="text-sm font-black leading-snug text-slate-950 [overflow-wrap:anywhere] sm:text-base">
                    {cleanProductName(lot.product)}
                  </p>
                  <p className="mt-1 text-xs font-semibold leading-snug text-slate-500 [overflow-wrap:anywhere] sm:text-sm">
                    <span>{displayLotCode(lot.lot_code)}</span>
                    <span> - </span>
                    <strong className="font-black text-slate-700">{lot.clients?.name || '-'}</strong>
                    <span> - {lot.location || '-'}</span>
                    {packageLabel(lot) ? <span> - {packageLabel(lot)}</span> : null}
                  </p>
                  <p className="mt-1 text-xs font-bold text-amber-700">
                    Vence: {lot.expiry_date ? formatDate(lot.expiry_date) : 'Sin dato'}
                  </p>
                </div>
                <div className="w-fit rounded-lg bg-campo-50 px-2.5 py-1 text-campo-800 sm:justify-self-end sm:text-right">
                  <div className="inline-flex items-baseline gap-1">
                    <span className="text-base font-black sm:text-xl">{formatNumber(lot.current_quantity)}</span>
                    <span className="text-xs font-bold text-campo-700">env.</span>
                  </div>
                  <p className="text-[10px] font-bold uppercase text-slate-500">
                    {lot.status === 'activo' ? 'Disponible' : lot.status}
                  </p>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
