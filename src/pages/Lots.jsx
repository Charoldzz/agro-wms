import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber } from '../lib/format'
import { cleanProductName, displayLotCode, packageLabel, productTotalKey } from '../lib/display'

const internalLocations = ['Nave 1', 'Nave 2', 'Nave 3', 'Playa']

const initialForm = {
  lot_code: '',
  client_id: '',
  product: '',
  current_quantity: '',
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

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (location.state?.restoreSearch) setSearch(location.state.restoreSearch)
  }, [location.state])

  async function loadData() {
    const [{ data: lotsData }, { data: clientsData }, { data: movementsData }] = await Promise.all([
      supabase.from('lots').select('*, clients(name)').order('created_at', { ascending: false }),
      supabase.from('clients').select('*').order('name'),
      supabase
        .from('movements')
        .select('created_at, lots(product)')
        .order('created_at', { ascending: false })
        .limit(500),
    ])
    setLots(lotsData || [])
    setClients(clientsData || [])
    setMovements(movementsData || [])
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const lotCode = form.lot_code.trim() || createManualLotCode()
    await supabase.from('lots').insert({
      ...form,
      lot_code: lotCode,
      current_quantity: Number(form.current_quantity),
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
      if (!acc[key]) acc[key] = { product: key, quantity: 0, lots: 0, lastMovementAt: null, movementCount: 0 }
      acc[key].quantity += Number(lot.current_quantity || 0)
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
  const filteredProducts = (searchTerm ? sortedProductTotals : visibleProductTotals).filter((item) => {
    const term = searchTerm
    if (!term) return true
    return item.product.toLowerCase().includes(term)
  })
  const filteredLots = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return []
    return lots
      .filter((lot) =>
        [lot.product, cleanProductName(lot.product), lot.lot_code, displayLotCode(lot.lot_code), lot.location, lot.clients?.name]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(term)),
      )
      .slice(0, 30)
  }, [lots, search])

  return (
    <div>
      <PageHeader
        title="Lotes"
        subtitle="Inventario por producto"
        action={
          isAdmin ? (
            <button className="btn-primary !min-h-11 !px-3" onClick={() => setShowForm((value) => !value)}>
              <Plus size={20} />
            </button>
          ) : null
        }
      />

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
          <Field label="Cantidad actual (envases)">
            <input className="input" type="number" min="0" step="0.01" value={form.current_quantity} onChange={(event) => setForm({ ...form, current_quantity: event.target.value })} required />
          </Field>
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

      <section className="mb-4">
        <div className="flex items-center rounded-lg border border-slate-200 bg-white px-3">
          <Search size={20} className="text-slate-400" />
          <input
            className="min-h-12 flex-1 bg-transparent px-2 outline-none"
            placeholder="Buscar producto..."
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
                  onClick={() => navigate(`/lotes/${lot.id}`, { state: { fromLotsSearch: true, search } })}
                >
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
                    <div className="min-w-0">
                      <p className="text-sm font-black leading-snug text-slate-950 [overflow-wrap:anywhere] sm:text-base">{cleanProductName(lot.product)}</p>
                      <p className="mt-1 text-xs font-semibold leading-snug text-slate-500 [overflow-wrap:anywhere] sm:text-sm">
                        {displayLotCode(lot.lot_code)} - {lot.clients?.name || '-'} - {lot.location || '-'}
                        {packageLabel(lot) ? ` - ${packageLabel(lot)}` : ''}
                      </p>
                      <p className="mt-1 text-xs font-bold text-amber-700">
                        Vence: {lot.expiry_date ? formatDate(lot.expiry_date) : 'Sin dato'}
                      </p>
                    </div>
                    <div className="inline-flex w-fit items-baseline gap-1 rounded-lg bg-campo-50 px-2.5 py-1 text-campo-800 sm:justify-self-end">
                      <span className="text-base font-black sm:text-xl">{formatNumber(lot.current_quantity)}</span>
                      <span className="text-xs font-bold text-campo-700">env.</span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-bold text-slate-900">Productos</h3>
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
                <p className="w-fit rounded-lg bg-campo-50 px-2.5 py-1 text-sm font-black text-campo-700 sm:justify-self-end">{formatNumber(item.quantity)} env.</p>
              </div>
            </button>
          ))}
        </div>
      </section>
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
