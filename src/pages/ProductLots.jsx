import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { supabase } from '../lib/supabase'
import { formatNumber } from '../lib/format'
import { cleanProductName, displayLotCode, packageLabel } from '../lib/display'

export default function ProductLots() {
  const { name } = useParams()
  const productName = decodeURIComponent(name || '')
  const [lots, setLots] = useState([])

  useEffect(() => {
    loadLots()
  }, [])

  async function loadLots() {
    const { data } = await supabase
      .from('lots')
      .select('*, clients(name)')
      .order('created_at', { ascending: false })

    setLots(data || [])
  }

  const productLots = useMemo(
    () => lots.filter((lot) => cleanProductName(lot.product) === productName),
    [lots, productName],
  )

  const total = useMemo(
    () => productLots.reduce((sum, lot) => sum + Number(lot.current_quantity || 0), 0),
    [productLots],
  )

  return (
    <div>
      <PageHeader title={productName || 'Producto'} subtitle={`${productLots.length} lotes · Total ${formatNumber(total)}`} />

      <div className="grid gap-2">
        {productLots.length === 0 ? (
          <EmptyState title="Sin lotes" text="No hay lotes disponibles para este producto." />
        ) : (
          productLots.map((lot) => (
            <Link key={lot.id} to={`/lotes/${lot.id}`} className="panel block transition hover:border-campo-500">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-950">{displayLotCode(lot.lot_code)}</p>
                  <p className="text-sm text-slate-500">
                    {lot.clients?.name} · {lot.location}
                    {packageLabel(lot) ? ` · ${packageLabel(lot)}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-slate-950">{formatNumber(lot.current_quantity)}</p>
                  <p className="text-[11px] font-semibold uppercase text-slate-400">
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
