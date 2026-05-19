import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'
import { formatNumber } from '../lib/format'
import { cleanProductName, productTotalKey } from '../lib/display'

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
  const [lots, setLots] = useState([])
  const [movements, setMovements] = useState([])
  const [clients, setClients] = useState([])
  const [form, setForm] = useState(initialForm)
  const [showForm, setShowForm] = useState(false)
  const [showAllTotals, setShowAllTotals] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadData()
  }, [])

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

  const visibleProductTotals = showAllTotals ? sortedProductTotals : sortedProductTotals.slice(0, 10)
  const filteredProducts = visibleProductTotals.filter((item) => {
    const term = search.toLowerCase()
    if (!term) return true
    return item.product.toLowerCase().includes(term)
  })

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
          <Field label="Cantidad actual">
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

      <section className="panel">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-bold text-slate-900">Productos</h3>
          {sortedProductTotals.length > 10 ? (
            <button className="text-sm font-bold text-campo-700" type="button" onClick={() => setShowAllTotals((value) => !value)}>
              {showAllTotals ? 'Ver menos' : 'Ver todos'}
            </button>
          ) : null}
        </div>
        <div className="grid gap-2">
          {filteredProducts.map((item) => (
            <button
              key={item.product}
              className="rounded-lg bg-slate-50 p-3 text-left transition hover:bg-campo-50"
              type="button"
              onClick={() => navigate(`/productos/${encodeURIComponent(item.product)}`)}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">{item.product}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.lots} lotes{item.movementCount ? ` · ${item.movementCount} mov.` : ''}
                  </p>
                </div>
                <p className="whitespace-nowrap text-base font-bold text-campo-700">{formatNumber(item.quantity)}</p>
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
