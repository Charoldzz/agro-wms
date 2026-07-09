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

const PACKAGE_FIELDS = [
  ['package_boxes', 'cajas'],
  ['package_units', 'uds'],
  ['package_gallons', 'galones'],
  ['package_bidones', 'bidones'],
  ['package_drums', 'tambores'],
  ['package_pallets', 'pallets'],
]

function packageChips(row) {
  return PACKAGE_FIELDS
    .map(([field, label]) => ({ label, value: Number(row[field]) }))
    .filter((p) => p.value > 0)
}

function PackageChips({ chips }) {
  if (!chips || chips.length === 0) return null
  return (
    <span className="mt-0.5 flex flex-wrap justify-end gap-1">
      {chips.map((p) => (
        <span key={p.label} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
          {formatNumber(p.value)} {p.label}
        </span>
      ))}
    </span>
  )
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
        items: group.map((r) => ({ product: r.product_name, lot: r.lot, quantity: r.quantity, chips: packageChips(r) })),
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
      .select('*, lots(lot_code, product, solucion_product_code, location, clients(name)), profiles(full_name), warehouse_operations(guide_number)')
      .order('created_at', { ascending: false })
      .limit(1000)

    if (!error) {
      setMovements(groupWebOperations(data || []))
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

    setMovements(groupWebOperations(await enrichMovements(fallback.data || [])))
  }

  // Une en un solo movimiento las líneas web que comparten operación (misma guía)
  function groupWebOperations(rawMovements) {
    const byOperation = new Map()
    const result = []
    for (const m of rawMovements) {
      if (m.operation_id && (m.type === 'entrada' || m.type === 'salida')) {
        if (!byOperation.has(m.operation_id)) byOperation.set(m.operation_id, [])
        byOperation.get(m.operation_id).push(m)
      } else {
        result.push(m)
      }
    }
    for (const group of byOperation.values()) {
      if (group.length === 1) {
        result.push(group[0])
        continue
      }
      const first = group[0]
      result.push({
        id: `op-${first.operation_id}`,
        source: 'web-group',
        type: first.type,
        created_at: group.reduce((max, m) => (m.created_at > max ? m.created_at : max), first.created_at),
        quantity: group.reduce((sum, m) => sum + Number(m.quantity || 0), 0),
        note_number: first.warehouse_operations?.guide_number || null,
        product: `${group.length} ITEMS`,
        lot_code: 'VARIOS',
        items: group.map((m) => ({ product: m.lots?.product, lot: displayLotCode(m.lots?.lot_code, m.lots), quantity: m.quantity })),
        empresa: first.lots?.clients?.name || '',
        usuario: first.profiles?.full_name || '',
        observations: '',
        transporter: '',
        plate: '',
        contact_person: '',
        concept: first.notes || '',
      })
    }
    return result
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
        movement.note_number,
        movement.product,
        movement.empresa,
        movement.usuario,
        movement.lots?.lot_code,
        displayLotCode(movement.lots?.lot_code, movement.lots),
        productCodeLabel(movement.lots),
        cleanProductName(movement.lots?.product),
        movement.lots?.location,
        movement.lots?.clients?.name,
        movement.profiles?.full_name,
        ...(movement.items ? movement.items.map((item) => item.product) : []),
        ...(movement.items ? movement.items.map((item) => item.lot) : []),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))

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

            if (movement.source === 'desktop' || movement.source === 'web-group') {
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
                              <div className="shrink-0 text-right">
                                <p className="text-sm font-black text-campo-700">{formatNumber(item.quantity)}</p>
                                <PackageChips chips={item.chips} />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <>
                          <p className="mt-2 font-semibold text-slate-800">{cleanProductName(movement.product)}</p>
                          {movement.lot_code ? <p className="text-sm font-bold text-slate-500">Lote: {movement.lot_code}</p> : null}
                          {movement.items?.[0]?.chips?.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {movement.items[0].chips.map((p) => (
                                <span key={p.label} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                                  {formatNumber(p.value)} {p.label}
                                </span>
                              ))}
                            </div>
                          )}
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
                      {movement.usuario ? <p className="mt-1 text-sm text-slate-600">Usuario: {movement.usuario}</p> : null}
                      {movement.source === 'desktop' ? (
                        <p className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">Registrado en el programa</p>
                      ) : null}
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
