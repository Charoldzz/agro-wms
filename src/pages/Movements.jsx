import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowLeftRight, ArrowUp, RotateCcw, Search } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, movementLabel } from '../lib/format'
import { cleanProductName, displayLotCode } from '../lib/display'

const movementIcons = {
  entrada: ArrowDown,
  salida: ArrowUp,
  traslado: ArrowLeftRight,
  ajuste: RotateCcw,
}

export default function Movements() {
  const [movements, setMovements] = useState([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  useEffect(() => {
    loadMovements()

    const channel = supabase
      .channel('movements-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movements' }, loadMovements)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  async function loadMovements() {
    const { data } = await supabase
      .from('movements')
      .select('*, lots(lot_code, product, location, clients(name)), profiles(full_name)')
      .order('created_at', { ascending: false })
      .limit(200)

    setMovements(data || [])
  }

  const filteredMovements = useMemo(() => {
    const term = search.toLowerCase()
    return movements.filter((movement) => {
      const matchesType = !typeFilter || movement.type === typeFilter
      const matchesSearch = [
        movement.type,
        movement.notes,
        movement.lots?.lot_code,
        displayLotCode(movement.lots?.lot_code),
        cleanProductName(movement.lots?.product),
        movement.lots?.location,
        movement.lots?.clients?.name,
        movement.profiles?.full_name,
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(term))

      return matchesType && matchesSearch
    })
  }, [movements, search, typeFilter])

  return (
    <div>
      <PageHeader title="Movimientos" subtitle="Historial general del inventario" />

      <section className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px]">
        <div className="flex items-center rounded-lg border border-slate-200 bg-white px-3">
          <Search size={20} className="text-slate-400" />
          <input
            className="min-h-12 flex-1 bg-transparent px-2 outline-none"
            placeholder="Buscar lote, producto, cliente, usuario..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select className="input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="">Todos los tipos</option>
          <option value="entrada">Entrada</option>
          <option value="salida">Salida</option>
          <option value="traslado">Traslado interno</option>
          <option value="ajuste">Reparo</option>
        </select>
      </section>

      <div className="space-y-3">
        {filteredMovements.length === 0 ? (
          <EmptyState title="Sin movimientos" text="Cuando se registre una entrada, salida o ajuste aparecerá aquí." />
        ) : (
          filteredMovements.map((movement) => {
            const Icon = movementIcons[movement.type] || RotateCcw
            return (
              <article key={movement.id} className="panel">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-campo-50 text-campo-700">
                    <Icon size={22} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-slate-950">{movementLabel(movement.type)}</p>
                        <p className="text-sm text-slate-500">{formatDate(movement.created_at)}</p>
                        {movement.approval_status === 'pendiente' ? (
                          <p className="mt-1 inline-flex rounded-full bg-orange-50 px-2 py-1 text-xs font-bold text-orange-700">Pendiente de aprobacion</p>
                        ) : null}
                        {movement.approval_status === 'rechazado' ? (
                          <p className="mt-1 inline-flex rounded-full bg-red-50 px-2 py-1 text-xs font-bold text-red-700">Rechazado</p>
                        ) : null}
                      </div>
                      <p className="text-xl font-bold text-campo-700">{formatNumber(movement.quantity)}</p>
                    </div>

                    <p className="mt-2 font-semibold text-slate-800">
                      {displayLotCode(movement.lots?.lot_code)} · {cleanProductName(movement.lots?.product)}
                    </p>
                    <p className="text-sm text-slate-500">
                      Cliente: {movement.lots?.clients?.name || '-'} · Ubicación: {movement.lots?.location || '-'}
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      Usuario: {movement.profiles?.full_name || 'Usuario'} · Stock anterior:{' '}
                      {formatNumber(movement.previous_quantity)} · Stock nuevo:{' '}
                      {formatNumber(movement.new_quantity)}
                    </p>
                    {movement.notes ? <p className="mt-1 text-sm text-slate-600">{movement.notes}</p> : null}
                  </div>
                </div>
              </article>
            )
          })
        )}
      </div>
    </div>
  )
}
