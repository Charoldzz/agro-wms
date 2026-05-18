import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'
import { formatNumber } from '../lib/format'
import { cleanProductName, displayLotCode, packageLabel, productTotalKey } from '../lib/display'

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

export default function Lots() {
  const { isAdmin } = useAuth()
  const [lots, setLots] = useState([])
  const [clients, setClients] = useState([])
  const [form, setForm] = useState(initialForm)
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [packageFilter, setPackageFilter] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const [{ data: lotsData }, { data: clientsData }] = await Promise.all([
      supabase.from('lots').select('*, clients(name)').order('created_at', { ascending: false }),
      supabase.from('clients').select('*').order('name'),
    ])
    setLots(lotsData || [])
    setClients(clientsData || [])
  }

  async function handleSubmit(event) {
    event.preventDefault()
    await supabase.from('lots').insert({
      ...form,
      current_quantity: Number(form.current_quantity),
      package_size: form.package_size ? Number(form.package_size) : null,
      package_unit: form.package_size ? form.package_unit : null,
      low_stock_threshold: Number(form.low_stock_threshold || 5),
    })
    setForm(initialForm)
    setShowForm(false)
    loadData()
  }

  const locations = useMemo(() => [...new Set(lots.map((lot) => lot.location).filter(Boolean))], [lots])
  const packages = useMemo(
    () =>
      [
        ...new Set(
          lots
            .filter((lot) => lot.package_size)
            .map((lot) => packageLabel(lot)),
        ),
      ].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })),
    [lots],
  )

  const productTotals = useMemo(() => {
    return lots.reduce((acc, lot) => {
      const key = productTotalKey(lot)
      if (!acc[key]) acc[key] = { product: key, quantity: 0, lots: 0 }
      acc[key].quantity += Number(lot.current_quantity || 0)
      acc[key].lots += 1
      return acc
    }, {})
  }, [lots])

  const topProductTotals = useMemo(
    () =>
      Object.values(productTotals)
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 8),
    [productTotals],
  )

  const filteredLots = lots.filter((lot) => {
    const term = search.toLowerCase()
    const currentPackageLabel = packageLabel(lot)
    const matchesSearch = [
      lot.lot_code,
      displayLotCode(lot.lot_code),
      cleanProductName(lot.product),
      lot.clients?.name,
      lot.location,
      currentPackageLabel,
    ]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(term))
    const matchesClient = !clientFilter || lot.client_id === clientFilter
    const matchesLocation = !locationFilter || lot.location === locationFilter
    const matchesPackage = !packageFilter || currentPackageLabel === packageFilter
    return matchesSearch && matchesClient && matchesLocation && matchesPackage
  })

  return (
    <div>
      <PageHeader
        title="Lotes"
        subtitle="Inventario por QR"
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
            <input className="input" value={form.lot_code} onChange={(event) => setForm({ ...form, lot_code: event.target.value })} required />
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
              <option value="lt">Litros</option>
              <option value="kg">Kilos</option>
              <option value="gr">Gramos</option>
              <option value="ml">Mililitros</option>
              <option value="un">Unidades</option>
            </select>
          </Field>
          <Field label="Ubicación">
            <input className="input" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} required />
          </Field>
          <Field label="Fecha ingreso">
            <input className="input" type="date" value={form.entry_date} onChange={(event) => setForm({ ...form, entry_date: event.target.value })} required />
          </Field>
          <Field label="Estado">
            <select className="input" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="activo">Activo</option>
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

      <section className="mb-4 grid gap-3 md:grid-cols-4">
        <div className="flex items-center rounded-lg border border-slate-200 bg-white px-3">
          <Search size={20} className="text-slate-400" />
          <input className="min-h-12 flex-1 bg-transparent px-2 outline-none" placeholder="Buscar lote, producto, tamaño..." value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <select className="input" value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}>
          <option value="">Todos los clientes</option>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>
        <select className="input" value={packageFilter} onChange={(event) => setPackageFilter(event.target.value)}>
          <option value="">Todos los tamaños</option>
          {packages.map((packageLabel) => <option key={packageLabel} value={packageLabel}>{packageLabel}</option>)}
        </select>
        <select className="input" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
          <option value="">Todas las ubicaciones</option>
          {locations.map((location) => <option key={location} value={location}>{location}</option>)}
        </select>
      </section>

      <section className="panel mb-4">
        <h3 className="mb-3 font-bold text-slate-900">Totales por producto</h3>
        <div className="grid gap-2 md:grid-cols-2">
          {topProductTotals.map((item) => (
            <div key={item.product} className="rounded-lg bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-slate-800">{item.product}</p>
                <p className="whitespace-nowrap text-sm font-bold text-campo-700">{formatNumber(item.quantity)}</p>
              </div>
              <p className="mt-1 text-xs text-slate-500">{item.lots} lotes</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        {filteredLots.length === 0 ? (
          <EmptyState title="Sin lotes" text="Crea o busca otro lote." />
        ) : (
          filteredLots.map((lot) => (
            <Link key={lot.id} to={`/lotes/${lot.id}`} className="panel block transition hover:border-campo-500">
              <div className="flex justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-campo-700">{displayLotCode(lot.lot_code)}</p>
                  <h3 className="text-lg font-bold text-slate-950">{cleanProductName(lot.product)}</h3>
                  <p className="text-sm text-slate-500">{lot.clients?.name} · {lot.location}</p>
                  {lot.package_size ? (
                    <p className="mt-1 text-xs font-semibold text-slate-400">
                      Presentacion: {formatNumber(lot.package_size)} {lot.package_unit}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    Total producto: {formatNumber(productTotals[productTotalKey(lot)]?.quantity || lot.current_quantity)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-slate-950">{formatNumber(lot.current_quantity)}</p>
                  <p className="text-xs font-semibold uppercase text-slate-400">
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

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
