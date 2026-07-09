import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowLeftRight, ArrowUp, RotateCcw, Search } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, movementLabel } from '../lib/format'
import { cleanProductName, displayLotCode, lotLabel, productCodeLabel } from '../lib/display'

const movementIcons = {
  entrada: ArrowDown,
  salida: ArrowUp,
  traslado: ArrowLeftRight,
  ajuste: RotateCcw,
}

export default function Movements() {
  const [movements, setMovements] = useState([])
  const [desktopMovements, setDesktopMovements] = useState([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [loadNotice, setLoadNotice] = useState('')

  useEffect(() => {
    loadMovements()
    loadDesktopMovements()

    const channel = supabase
      .channel('movements-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movements' }, loadMovements)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  async function loadDesktopMovements() {
    const [{ data: rows, error }, { data: clientRows }] = await Promise.all([
      supabase
        .from('desktop_movements')
        .select('*')
        .order('date', { ascending: false })
        .limit(5000),
      supabase
        .from('clients')
        .select('name, product_code_prefix')
        .eq('inventory_source', 'stock_independiente'),
    ])
    if (error) return
    const prefixMap = new Map(
      (clientRows || [])
        .filter((c) => c.product_code_prefix)
        .map((c) => [c.product_code_prefix.toUpperCase(), c.name]),
    )
    const groupedByNote = new Map()
    for (const row of rows || []) {
      const key = row.note_number || `sin-nota-${row.id}`
      if (!groupedByNote.has(key)) groupedByNote.set(key, [])
      groupedByNote.get(key).push(row)
    }
    setDesktopMovements([...groupedByNote.values()].map((group) => {
      const first = group[0]
      return {
        id: `desktop-${first.note_number || first.id}`,
        source: 'desktop',
        type: first.type === 'INGRESO' ? 'entrada' : 'salida',
        created_at: group.reduce((max, r) => (r.date > max ? r.date : max), first.date),
        quantity: group.reduce((sum, r) => sum + Number(r.quantity || 0), 0),
        note_number: first.note_number,
        product: group.length > 1 ? `${group.length} ITEMS` : first.product_name,
        lot_code: group.length > 1 ? 'VARIOS' : first.lot,
        items: group.map((r) => ({ product: r.product_name, lot: r.lot, quantity: r.quantity })),
        empresa: group.find((r) => r.dispatch_company)?.dispatch_company
          || prefixMap.get((first.client_prefix || '').toUpperCase())
          || '',
        transporter: group.find((r) => r.transporter)?.transporter || '',
        plate: group.find((r) => r.plate)?.plate || '',
        contact_person: group.find((r) => r.contact_person)?.contact_person || '',
        observations: group.find((r) => r.observations)?.observations || '',
        concept: first.concept,
      }
    }))
  }

  async function loadMovements() {
    setLoadNotice('')

    const { data, error } = await supabase
      .from('movements')
      .select('*, lots(lot_code, product, solucion_product_code, location, clients(name)), profiles(full_name)')
      .order('created_at', { ascending: false })
      .limit(1000)

    if (!error) {
      setMovements(data || [])
      return
    }

    const fallback = await supabase
      .from('movements')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000)

    if (fallback.error) {
      setLoadNotice('No se pudieron cargar los movimientos. Revisa que el SQL de permisos este actualizado.')
      setMovements([])
      return
    }

    setMovements(await enrichMovements(fallback.data || []))
  }

  async function enrichMovements(rawMovements) {
    const lotIds = [...new Set(rawMovements.map((movement) => movement.lot_id).filter(Boolean))]
    const userIds = [...new Set(rawMovements.map((movement) => movement.user_id).filter(Boolean))]

    const [{ data: lots }, { data: profiles }] = await Promise.all([
      lotIds.length
        ? supabase.from('lots').select('id, lot_code, product, solucion_product_code, location, clients(name)').in('id', lotIds)
        : Promise.resolve({ data: [] }),
      userIds.length
        ? supabase.from('profiles').select('id, full_name').in('id', userIds)
        : Promise.resolve({ data: [] }),
    ])

    const lotMap = new Map((lots || []).map((lot) => [lot.id, lot]))
    const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]))

    return rawMovements.map((movement) => ({
      ...movement,
      lots: lotMap.get(movement.lot_id) || null,
      profiles: profileMap.get(movement.user_id) || null,
    }))
  }

  const filteredMovements = useMemo(() => {
    const term = search.toLowerCase()
    const webFiltered = movements.filter((movement) => {
      const matchesType = !typeFilter || movement.type === typeFilter
      const matchesSearch = [
        movement.type,
        movement.notes,
        movement.lots?.lot_code,
        displayLotCode(movement.lots?.lot_code, movement.lots),
        productCodeLabel(movement.lots),
        cleanProductName(movement.lots?.product),
        movement.lots?.location,
        movement.lots?.clients?.name,
        movement.profiles?.full_name,
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(term))

      return matchesType && matchesSearch
    })

    const desktopFiltered = desktopMovements.filter((movement) => {
      const matchesType = !typeFilter || movement.type === typeFilter
      const matchesSearch = [
        movement.type,
        movement.note_number,
        movement.product,
        movement.lot_code,
        movement.empresa,
        movement.transporter,
        movement.plate,
        movement.observations,
        movement.concept,
        ...(movement.items ? movement.items.map((item) => item.product) : []),
        ...(movement.items ? movement.items.map((item) => item.lot) : []),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))

      return matchesType && matchesSearch
    })

    return [...webFiltered, ...desktopFiltered].sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0),
    )
  }, [movements, desktopMovements, search, typeFilter])

  return (
    <div>
      <PageHeader title="Movimientos" subtitle="Historial general del inventario" />

      {loadNotice ? (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">
          {loadNotice}
        </div>
      ) : null}

      <section className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px]">
        <div className="flex items-center rounded-lg border border-slate-200 bg-white px-3">
          <Search size={20} className="text-slate-400" />
          <input
            className="min-h-12 flex-1 bg-transparent px-2 outline-none"
            placeholder="Buscar lote, producto, cliente, usuario..."
            value={search}
            onChange={e => setSearch(e.target.value)}
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

            if (movement.source === 'desktop') {
              return (
                <article key={movement.id} className="panel">
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                      <Icon size={22} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-bold text-slate-950">
                            {movementLabel(movement.type)}
                            {movement.note_number ? <span className="ml-2 font-mono text-sm font-bold text-campo-700">{movement.note_number}</span> : null}
                          </p>
                          <p className="text-sm text-slate-500">{formatDate(movement.created_at)}</p>
                        </div>
                        <p className="text-xl font-bold text-campo-700">{formatNumber(movement.quantity)}</p>
                      </div>
                      {movement.items && movement.items.length > 1 ? (
                        <div className="mt-2 space-y-1">
                          {movement.items.map((item, idx) => (
                            <div key={idx} className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-800 [overflow-wrap:anywhere]">{cleanProductName(item.product)}</p>
                                {item.lot ? <p className="text-xs font-semibold text-slate-400">Lote: {item.lot}</p> : null}
                              </div>
                              <p className="shrink-0 text-sm font-black text-campo-700">{formatNumber(item.quantity)}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <>
                          <p className="mt-2 font-semibold text-slate-800">{cleanProductName(movement.product)}</p>
                          {movement.lot_code ? <p className="text-sm font-bold text-slate-500">Lote: {movement.lot_code}</p> : null}
                        </>
                      )}
                      <p className="text-sm text-slate-500">Empresa: {movement.empresa || '-'}</p>
                      {(movement.transporter || movement.plate || movement.contact_person) ? (
                        <p className="mt-1 text-sm text-slate-600">
                          {movement.transporter ? `Transportista: ${movement.transporter}` : ''}
                          {movement.plate ? ` - Placa: ${movement.plate}` : ''}
                          {movement.contact_person ? ` - Contacto: ${movement.contact_person}` : ''}
                        </p>
                      ) : null}
                      {movement.observations ? <p className="mt-1 text-sm text-slate-600">{movement.observations}</p> : null}
                      <p className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">Registrado en el programa</p>
                    </div>
                  </div>
                </article>
              )
            }

            const lot = movement.lots || {}
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
                      {movement.type !== 'traslado' ? (
                        <p className="text-xl font-bold text-campo-700">{formatNumber(movement.quantity)}</p>
                      ) : null}
                    </div>

                    <p className="mt-2 font-semibold text-slate-800">{cleanProductName(lot.product)}</p>
                    <p className="text-sm font-bold text-slate-500">
                      {lotLabel(lot.lot_code, lot)}
                    </p>
                    <p className="text-sm text-slate-500">
                      Cliente: {lot.clients?.name || '-'} - Ubicacion: {lot.location || '-'}
                    </p>
                    {movement.type === 'traslado' ? (
                      <p className="mt-2 text-sm text-slate-600">
                        Usuario: {movement.profiles?.full_name || 'Usuario'} - De {movement.from_location || '-'} a{' '}
                        {movement.to_location || '-'}
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-slate-600">
                        Usuario: {movement.profiles?.full_name || 'Usuario'} - Stock anterior:{' '}
                        {formatNumber(movement.previous_quantity)} - Stock nuevo:{' '}
                        {formatNumber(movement.new_quantity)}
                      </p>
                    )}
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
