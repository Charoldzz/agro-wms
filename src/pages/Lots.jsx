import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CalendarClock, Search } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber } from '../lib/format'
import { cleanProductName, displayLotCode, packageLabel, productTotalKey } from '../lib/display'
import { internalLocations } from '../lib/locations'

const searchOptions = [
  { value: 'producto', label: 'Producto', placeholder: 'Buscar producto...' },
  { value: 'empresa', label: 'Empresa', placeholder: 'Buscar empresa o cliente...' },
  { value: 'ubicacion', label: 'Ubicacion', placeholder: 'Buscar ubicacion...' },
  { value: 'lote', label: 'Lote', placeholder: 'Buscar lote...' },
  { value: 'codigo', label: 'Codigo', placeholder: 'Buscar codigo de producto...' },
]
const LOTS_CACHE_KEY = 'todo-agricola-lots-cache'
const CLIENTS_CACHE_KEY = 'todo-agricola-clients-cache'

const initialForm = {
  lot_code: '',
  client_id: '',
  product: '',
  entry_boxes: '',
  entry_units_per_box: '',
  entry_loose_units: '',
  package_size: '',
  package_unit: 'lt',
  location: '',
  entry_date: new Date().toISOString().slice(0, 10),
  expiry_date: '',
  status: 'activo',
  photo_url: '',
  low_stock_threshold: 5,
}

function createManualLotCode() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  return `MANUAL-${stamp}`
}

function lotEquivalent(lot) {
  const packageSize = Number(lot?.package_size || 0)
  if (packageSize <= 0 || !lot?.package_unit) return null
  return {
    quantity: Number(lot.current_quantity || 0) * packageSize,
    unit: lot.package_unit,
  }
}

function equivalentTotalsLabel(equivalents = {}) {
  const totals = Object.entries(equivalents)
    .filter(([, quantity]) => Number(quantity || 0) > 0)
    .sort(([a], [b]) => a.localeCompare(b, 'es'))

  if (totals.length === 0) return 'Equivalente sin dato'
  return totals.map(([unit, quantity]) => `${formatNumber(quantity)} ${unit}`).join(' / ')
}

function manualEntryQuantity(form) {
  return Number(form.entry_boxes || 0) * Number(form.entry_units_per_box || 0) + Number(form.entry_loose_units || 0)
}

export default function Lots() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [lots, setLots] = useState([])
  const [movements, setMovements] = useState([])
  const [clients, setClients] = useState([])
  const [form, setForm] = useState(initialForm)
  const [showForm, setShowForm] = useState(false)
  const [showAllTotals, setShowAllTotals] = useState(false)
  const [search, setSearch] = useState(() => location.state?.restoreSearch || '')
  const [searchBy, setSearchBy] = useState(() => location.state?.restoreSearchBy || 'producto')
  const [cacheNotice, setCacheNotice] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (location.state?.restoreSearch) setSearch(location.state.restoreSearch)
    if (location.state?.restoreSearchBy) setSearchBy(location.state.restoreSearchBy)
  }, [location.state])

  async function loadData() {
    const [{ data: lotsData, error: lotsError }, { data: clientsData, error: clientsError }, { data: movementsData }] = await Promise.all([
      supabase
        .from('lots')
        .select('*, clients(name)')
        .eq('inventory_source', 'stock_independiente')
        .eq('status', 'activo')
        .gt('current_quantity', 0)
        .order('created_at', { ascending: false }),
      supabase.from('clients').select('*').eq('inventory_source', 'stock_independiente').order('name'),
      supabase
        .from('movements')
        .select('created_at, lots(product)')
        .order('created_at', { ascending: false })
        .limit(500),
    ])
    if (lotsData && !lotsError) {
      setLots(lotsData)
      localStorage.setItem(LOTS_CACHE_KEY, JSON.stringify(lotsData))
      setCacheNotice('')
    } else {
      const cachedLots = JSON.parse(localStorage.getItem(LOTS_CACHE_KEY) || '[]')
      setLots(cachedLots)
      if (cachedLots.length > 0) setCacheNotice('Sin senal: mostrando inventario guardado en este equipo.')
    }
    if (clientsData && !clientsError) {
      setClients(clientsData)
      localStorage.setItem(CLIENTS_CACHE_KEY, JSON.stringify(clientsData))
    } else {
      setClients(JSON.parse(localStorage.getItem(CLIENTS_CACHE_KEY) || '[]'))
    }
    setMovements(movementsData || [])
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const lotCode = form.lot_code.trim() || createManualLotCode()
    await supabase.from('lots').insert({
      ...form,
      lot_code: lotCode,
      entry_boxes: Number(form.entry_boxes),
      current_quantity: manualEntryQuantity(form),
      package_size: form.package_size ? Number(form.package_size) : null,
      package_unit: form.package_size ? form.package_unit : null,
      expiry_date: form.expiry_date || null,
      low_stock_threshold: Number(form.low_stock_threshold || 5),
    })
    setForm(initialForm)
    setShowForm(false)
    loadData()
  }

  const productTotals = useMemo(() => {
    return lots.reduce((acc, lot) => {
      const key = productTotalKey(lot)
      if (!acc[key]) acc[key] = { product: key, quantity: 0, equivalents: {}, lots: 0, lastMovementAt: null, movementCount: 0 }
      acc[key].quantity += Number(lot.current_quantity || 0)
      const equivalent = lotEquivalent(lot)
      if (equivalent) {
        acc[key].equivalents[equivalent.unit] = Number(acc[key].equivalents[equivalent.unit] || 0) + equivalent.quantity
      }
      acc[key].lots += 1
      return acc
    }, {})
  }, [lots])

  const sortedProductTotals = useMemo(() => {
    const totals = { ...productTotals }
    movements.forEach((movement) => {
      const key = cleanProductName(movement.lots?.product)
      if (!totals[key]) return
      totals[key].movementCount += 1
      if (!totals[key].lastMovementAt || new Date(movement.created_at) > new Date(totals[key].lastMovementAt)) {
        totals[key].lastMovementAt = movement.created_at
      }
    })

    return Object.values(totals).sort((a, b) => {
      const aTime = a.lastMovementAt ? new Date(a.lastMovementAt).getTime() : 0
      const bTime = b.lastMovementAt ? new Date(b.lastMovementAt).getTime() : 0
      if (bTime !== aTime) return bTime - aTime
      return a.product.localeCompare(b.product, 'es')
    })
  }, [productTotals, movements])

  const searchTerm = search.trim().toLowerCase()
  const visibleProductTotals = showAllTotals ? sortedProductTotals : sortedProductTotals.slice(0, 10)
  const filteredProducts = (searchTerm && searchBy === 'producto' ? sortedProductTotals : visibleProductTotals).filter((item) => {
    const term = searchTerm
    if (!term || searchBy !== 'producto') return true
    return item.product.toLowerCase().includes(term)
  })
  const filteredLots = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return []
    return lots
      .filter((lot) => {
        const values = {
          producto: [cleanProductName(lot.product)],
          empresa: [lot.clients?.name],
          ubicacion: [lot.location],
          lote: [lot.lot_code, displayLotCode(lot.lot_code)],
          codigo: [lot.product],
        }[searchBy] || [cleanProductName(lot.product)]

        return values
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(term))
      })
      .sort((a, b) => {
        const productOrder = cleanProductName(a.product).localeCompare(cleanProductName(b.product), 'es', { numeric: true })
        if (productOrder !== 0) return productOrder
        const clientOrder = (a.clients?.name || '').localeCompare(b.clients?.name || '', 'es', { numeric: true })
        if (clientOrder !== 0) return clientOrder
        return displayLotCode(a.lot_code).localeCompare(displayLotCode(b.lot_code), 'es', { numeric: true })
      })
      .slice(0, 30)
  }, [lots, search, searchBy])
  const selectedSearchOption = searchOptions.find((option) => option.value === searchBy) || searchOptions[0]
  const manualQuantity = manualEntryQuantity(form)

  return (
    <div>
      <PageHeader
        title="Lotes"
        subtitle="Inventario por producto"
      />

      {location.state?.qrFallback ? (
        <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-bold text-orange-900">
          Si el QR no se lee, busca el lote por producto, empresa, ubicacion, lote o codigo y reporta el problema desde la ficha.
        </div>
      ) : null}

      {cacheNotice ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">
          {cacheNotice}
        </div>
      ) : null}

      {showForm && isAdmin ? (
        <form className="panel mb-4 grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit}>
          <Field label="ID lote">
            <input
              className="input"
              value={form.lot_code}
              onChange={(event) => setForm({ ...form, lot_code: event.target.value })}
              placeholder="Opcional"
            />
          </Field>
          <Field label="Cliente">
            <select className="input" value={form.client_id} onChange={(event) => setForm({ ...form, client_id: event.target.value })} required>
              <option value="">Seleccionar</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </Field>
          <Field label="Producto">
            <input className="input" value={form.product} onChange={(event) => setForm({ ...form, product: event.target.value })} required />
          </Field>
          <Field label="Cantidad de cajas">
            <input className="input" type="number" min="0" step="0.01" value={form.entry_boxes} onChange={(event) => setForm({ ...form, entry_boxes: event.target.value })} />
          </Field>
          <Field label="Envases por caja">
            <input className="input" type="number" min="0" step="0.01" value={form.entry_units_per_box} onChange={(event) => setForm({ ...form, entry_units_per_box: event.target.value })} />
          </Field>
          <Field label="Envases sueltos">
            <input className="input" type="number" min="0" step="0.01" value={form.entry_loose_units} onChange={(event) => setForm({ ...form, entry_loose_units: event.target.value })} placeholder="Opcional" />
          </Field>
          <div className="rounded-lg bg-campo-50 p-3">
            <p className="text-xs font-semibold uppercase text-campo-700">Envases totales</p>
            <p className="mt-1 text-2xl font-black text-campo-800">{formatNumber(manualQuantity)}</p>
          </div>
          <Field label="Tamaño presentación">
            <input className="input" type="number" min="0" step="0.01" value={form.package_size} onChange={(event) => setForm({ ...form, package_size: event.target.value })} placeholder="Ej. 5, 20" />
          </Field>
          <Field label="Unidad presentación">
            <select className="input" value={form.package_unit} onChange={(event) => setForm({ ...form, package_unit: event.target.value })}>
              <option value="gr">Gramos</option>
              <option value="kg">Kilos</option>
              <option value="ml">Mililitros</option>
              <option value="lt">Litros</option>
              <option value="un">Unidades</option>
            </select>
          </Field>
          <Field label="Ubicación">
            <select className="input" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} required>
              <option value="">Seleccionar ubicación</option>
              {internalLocations.map((location) => <option key={location} value={location}>{location}</option>)}
            </select>
          </Field>
          <Field label="Fecha ingreso">
            <input className="input" type="date" value={form.entry_date} onChange={(event) => setForm({ ...form, entry_date: event.target.value })} required />
          </Field>
          <Field label="Fecha vencimiento">
            <input className="input" type="date" value={form.expiry_date} onChange={(event) => setForm({ ...form, expiry_date: event.target.value })} />
          </Field>
          <Field label="Estado">
            <select className="input" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="activo">Disponible</option>
              <option value="retenido">Retenido</option>
              <option value="cerrado">Cerrado</option>
            </select>
          </Field>
          <Field label="Foto URL opcional">
            <input className="input" value={form.photo_url} onChange={(event) => setForm({ ...form, photo_url: event.target.value })} />
          </Field>
          <button className="btn-primary sm:col-span-2">Crear lote y QR</button>
        </form>
      ) : null}

      <button
        className="panel mb-4 flex w-full items-center justify-between gap-3 text-left transition hover:bg-amber-50"
        type="button"
        onClick={() => navigate('/vencimientos')}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
            <CalendarClock size={22} />
          </span>
          <span className="min-w-0">
            <strong className="block text-sm font-black text-slate-950">Vencimientos</strong>
            <span className="block text-xs font-semibold text-slate-500">Ver lotes vencidos o proximos a vencer</span>
          </span>
        </span>
        <span className="rounded-lg bg-white px-2 py-1 text-xs font-black text-amber-700">Abrir</span>
      </button>

      <section className="mb-4 grid gap-2 sm:grid-cols-[170px_1fr]">
        <label className="block">
          <span className="sr-only">Buscar por</span>
          <select className="input" value={searchBy} onChange={(event) => setSearchBy(event.target.value)}>
            {searchOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <div className="flex items-center rounded-lg border border-slate-200 bg-white px-3">
          <Search size={20} className="text-slate-400" />
          <input
            className="min-h-12 flex-1 bg-transparent px-2 outline-none"
            placeholder={selectedSearchOption.placeholder}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </section>

      {search.trim() ? (
        <section className="panel mb-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="font-bold text-slate-900">Lotes encontrados</h3>
            <span className="text-xs font-bold text-slate-500">{filteredLots.length} resultado{filteredLots.length === 1 ? '' : 's'}</span>
          </div>
          <div className="grid gap-2">
            {filteredLots.length === 0 ? (
              <p className="rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-500">No hay lotes con esa busqueda.</p>
            ) : (
              filteredLots.map((lot) => (
                <button
                  key={lot.id}
                  className="w-full overflow-hidden rounded-lg bg-slate-50 p-3 text-left transition hover:bg-campo-50"
                  type="button"
                  onClick={() => navigate(`/lotes/${lot.id}`, { state: { fromLotsSearch: true, search, searchBy } })}
                >
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
                    <div className="min-w-0">
                      <p className="text-sm font-black leading-snug text-slate-950 [overflow-wrap:anywhere] sm:text-base">{cleanProductName(lot.product)}</p>
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
                      <p className="text-xs font-black text-campo-700">
                        {lotEquivalent(lot) ? `${formatNumber(lotEquivalent(lot).quantity)} ${lotEquivalent(lot).unit}` : 'Equiv. sin dato'}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>
      ) : null}

      {!searchTerm ? (
      <section className="panel">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900">Productos</h3>
            <p className="text-xs font-semibold text-slate-500">Ordenados por movimiento reciente</p>
          </div>
          {!searchTerm && sortedProductTotals.length > 10 ? (
            <button className="text-sm font-bold text-campo-700" type="button" onClick={() => setShowAllTotals((value) => !value)}>
              {showAllTotals ? 'Ver menos' : 'Ver todos'}
            </button>
          ) : null}
        </div>
        <div className="grid gap-2">
          {filteredProducts.map((item) => (
            <button
              key={item.product}
              className="w-full overflow-hidden rounded-lg bg-slate-50 p-3 text-left transition hover:bg-campo-50"
              type="button"
              onClick={() => navigate(`/productos/${encodeURIComponent(item.product)}`)}
            >
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
                <div className="min-w-0">
                  <p className="text-sm font-bold leading-snug text-slate-900 [overflow-wrap:anywhere]">{item.product}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.lots} lotes{item.movementCount ? ` · ${item.movementCount} mov.` : ''}
                  </p>
                </div>
                <div className="w-fit rounded-lg bg-campo-50 px-2.5 py-1 text-campo-700 sm:justify-self-end sm:text-right">
                  <p className="text-sm font-black">{formatNumber(item.quantity)} env.</p>
                  <p className="text-xs font-black">{equivalentTotalsLabel(item.equivalents)}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
      ) : null}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
