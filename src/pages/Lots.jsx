import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CalendarClock, ClipboardList, Menu, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber } from '../lib/format'
import { cleanProductName, displayLotCode, lotLabel, packageLabel, productCodeLabel } from '../lib/display'
import { internalLocations } from '../lib/locations'

const LOTS_CACHE_KEY = 'todo-agricola-lots-cache'
const CLIENTS_CACHE_KEY = 'todo-agricola-clients-cache'
const PAGE_SIZE = 50

const initialForm = {
  lot_code: '', client_id: '', product: '',
  entry_boxes: '', entry_units_per_box: '', entry_loose_units: '',
  package_size: '', package_unit: 'lt', location: '',
  entry_date: new Date().toISOString().slice(0, 10),
  expiry_date: '', status: 'activo', photo_url: '', low_stock_threshold: 5,
}

function createManualLotCode() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  return `MANUAL-${stamp}`
}

function lotEquivalent(lot) {
  const size = Number(lot?.package_size || 0)
  if (size <= 0 || !lot?.package_unit) return null
  return { quantity: Number(lot.current_quantity || 0) * size, unit: lot.package_unit }
}

function manualEntryQuantity(form) {
  return Number(form.entry_boxes || 0) * Number(form.entry_units_per_box || 0) + Number(form.entry_loose_units || 0)
}

function expiryClass(dateStr) {
  if (!dateStr) return 'text-slate-400'
  const days = Math.ceil((new Date(dateStr) - new Date()) / 86400000)
  if (days < 0) return 'text-red-600 font-black'
  if (days <= 30) return 'text-amber-600 font-bold'
  return 'text-slate-600'
}

export default function Lots() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [lots, setLots] = useState([])
  const [clients, setClients] = useState([])
  const [cacheNotice, setCacheNotice] = useState('')
  const [loading, setLoading] = useState(true)

  // Filters & view
  const [search, setSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState('')
  const [clientSearch, setClientSearch] = useState('')
  const [groupByProduct, setGroupByProduct] = useState(false)
  const [showZeroStock, setShowZeroStock] = useState(false)
  const [page, setPage] = useState(1)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Admin form
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(initialForm)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [{ data: lotsData, error: lotsError }, { data: clientsData, error: clientsError }] = await Promise.all([
      supabase
        .from('lots')
        .select('*, clients(name)')
        .eq('inventory_source', 'stock_independiente')
        .eq('status', 'activo')
        .order('product', { ascending: true }),
      supabase.from('clients').select('*').eq('inventory_source', 'stock_independiente').order('name'),
    ])

    if (lotsData && !lotsError) {
      setLots(lotsData)
      localStorage.setItem(LOTS_CACHE_KEY, JSON.stringify(lotsData))
      setCacheNotice('')
    } else {
      const cached = JSON.parse(localStorage.getItem(LOTS_CACHE_KEY) || '[]')
      setLots(cached)
      if (cached.length > 0) setCacheNotice('Sin señal: mostrando inventario guardado.')
    }
    if (clientsData && !clientsError) {
      setClients(clientsData)
      localStorage.setItem(CLIENTS_CACHE_KEY, JSON.stringify(clientsData))
    } else {
      setClients(JSON.parse(localStorage.getItem(CLIENTS_CACHE_KEY) || '[]'))
    }
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const lotCode = form.lot_code.trim() || createManualLotCode()
    await supabase.from('lots').insert({
      ...form, lot_code: lotCode,
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

  // Filtered lots
  const filteredLots = useMemo(() => {
    const term = search.trim().toLowerCase()
    return lots.filter((lot) => {
      if (!showZeroStock && Number(lot.current_quantity || 0) <= 0) return false
      if (selectedClient && lot.client_id !== selectedClient) return false
      if (!term) return true
      return (
        cleanProductName(lot.product).toLowerCase().includes(term) ||
        (lot.clients?.name || '').toLowerCase().includes(term) ||
        displayLotCode(lot.lot_code, lot).toLowerCase().includes(term) ||
        productCodeLabel(lot).toLowerCase().includes(term) ||
        (lot.location || '').toLowerCase().includes(term)
      )
    })
  }, [lots, search, selectedClient, showZeroStock])

  // Grouped by product
  const groupedRows = useMemo(() => {
    if (!groupByProduct) return null
    const map = {}
    filteredLots.forEach((lot) => {
      const key = cleanProductName(lot.product)
      if (!map[key]) map[key] = { product: key, quantity: 0, lots: 0, equivalents: {} }
      map[key].quantity += Number(lot.current_quantity || 0)
      map[key].lots += 1
      const eq = lotEquivalent(lot)
      if (eq) map[key].equivalents[eq.unit] = (map[key].equivalents[eq.unit] || 0) + eq.quantity
    })
    return Object.values(map).sort((a, b) => a.product.localeCompare(b.product, 'es'))
  }, [filteredLots, groupByProduct])

  // Pagination
  const rows = groupByProduct ? (groupedRows || []) : filteredLots
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function handleSearch(v) { setSearch(v); setPage(1) }
  function handleClientSelect(id) { setSelectedClient(id); setPage(1); setSidebarOpen(false) }

  // Totals
  const totalItems = filteredLots.length
  const totalMercaderia = filteredLots.reduce((sum, lot) => {
    const size = Number(lot.package_size || 0)
    return sum + (size > 0 ? Number(lot.current_quantity || 0) * size : 0)
  }, 0)
  const totalEnvases = filteredLots.reduce((sum, lot) => sum + Number(lot.current_quantity || 0), 0)

  const visibleClients = clients.filter((c) =>
    !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase())
  )

  const manualQuantity = manualEntryQuantity(form)

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">

      {location.state?.qrFallback && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-bold text-orange-900">
          Si el QR no se lee, busca el lote por producto, empresa o lote y reporta el problema desde la ficha.
        </div>
      )}
      {cacheNotice && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">
          {cacheNotice}
        </div>
      )}

      {/* Layout principal */}
      <div className="flex min-h-0 gap-3">

        {/* Sidebar móvil backdrop */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Sidebar empresas */}
        <aside className={`
          fixed inset-y-0 left-0 z-40 w-56 overflow-y-auto border-r border-slate-200 bg-white p-3 transition-transform
          lg:static lg:z-auto lg:block lg:translate-x-0 lg:rounded-xl lg:border lg:shadow-sm
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}>
          <div className="mb-2 flex items-center justify-between lg:block">
            <p className="text-xs font-black uppercase tracking-wide text-slate-500">Buscar empresa</p>
            <button className="lg:hidden" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
          </div>
          <input
            className="input mb-2 w-full text-sm"
            placeholder="Escribe para filtrar..."
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
          />
          <ul className="space-y-0.5">
            <li>
              <button
                className={`w-full rounded-lg px-2 py-1.5 text-left text-sm font-bold transition ${!selectedClient ? 'bg-campo-700 text-white' : 'hover:bg-slate-100 text-slate-700'}`}
                onClick={() => handleClientSelect('')}
              >
                Todos
              </button>
            </li>
            {visibleClients.map((c) => (
              <li key={c.id}>
                <button
                  className={`w-full rounded-lg px-2 py-1.5 text-left text-xs font-semibold transition ${selectedClient === c.id ? 'bg-campo-700 text-white' : 'hover:bg-slate-100 text-slate-600'}`}
                  onClick={() => handleClientSelect(c.id)}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Contenido principal */}
        <div className="min-w-0 flex-1 space-y-3">

          {/* Barra de controles */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
            <button
              className="btn-secondary !min-h-9 !px-3 !py-2 lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={18} />
            </button>
            <input
              className="input min-w-0 flex-1 text-sm"
              placeholder="Producto, lote, vencimiento o cantidad..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-600 select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded accent-campo-700"
                checked={groupByProduct}
                onChange={(e) => { setGroupByProduct(e.target.checked); setPage(1) }}
              />
              Total por producto
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-600 select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded accent-campo-700"
                checked={showZeroStock}
                onChange={(e) => setShowZeroStock(e.target.checked)}
              />
              Mostrar stock 0
            </label>
            <button
              className="btn-secondary !min-h-9 !px-3 !py-2 text-xs font-bold"
              onClick={() => navigate('/vencimientos')}
            >
              <CalendarClock size={15} />
              <span className="hidden sm:inline">Próximos a vencer</span>
            </button>
            <button
              className="btn-secondary !min-h-9 !px-3 !py-2 text-xs font-bold"
              onClick={() => navigate('/movimientos')}
            >
              <ClipboardList size={15} />
              <span className="hidden sm:inline">Ver Kardex</span>
            </button>
          </div>

          {/* Admin: crear lote */}
          {isAdmin && (
            <div>
              <button
                className="btn-secondary text-xs !min-h-8 !px-3 !py-1.5"
                onClick={() => setShowForm((v) => !v)}
              >
                {showForm ? 'Cancelar' : '+ Crear lote manual'}
              </button>
              {showForm && (
                <form className="mt-2 rounded-xl border border-slate-200 bg-white p-4 grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit}>
                  <Field label="ID lote"><input className="input" value={form.lot_code} onChange={(e) => setForm({ ...form, lot_code: e.target.value })} placeholder="Opcional" /></Field>
                  <Field label="Cliente">
                    <select className="input" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} required>
                      <option value="">Seleccionar</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Producto"><input className="input" value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} required /></Field>
                  <Field label="Cajas"><input className="input" type="number" min="0" step="0.01" value={form.entry_boxes} onChange={(e) => setForm({ ...form, entry_boxes: e.target.value })} /></Field>
                  <Field label="Env/caja"><input className="input" type="number" min="0" step="0.01" value={form.entry_units_per_box} onChange={(e) => setForm({ ...form, entry_units_per_box: e.target.value })} /></Field>
                  <Field label="Env sueltos"><input className="input" type="number" min="0" step="0.01" value={form.entry_loose_units} onChange={(e) => setForm({ ...form, entry_loose_units: e.target.value })} placeholder="Opcional" /></Field>
                  <div className="rounded-lg bg-campo-50 p-3"><p className="text-xs font-semibold uppercase text-campo-700">Total envases</p><p className="mt-1 text-2xl font-black text-campo-800">{formatNumber(manualQuantity)}</p></div>
                  <Field label="Tamaño pres."><input className="input" type="number" min="0" step="0.01" value={form.package_size} onChange={(e) => setForm({ ...form, package_size: e.target.value })} placeholder="Ej. 20" /></Field>
                  <Field label="Unidad">
                    <select className="input" value={form.package_unit} onChange={(e) => setForm({ ...form, package_unit: e.target.value })}>
                      {['gr','kg','ml','lt','un'].map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </Field>
                  <Field label="Ubicación">
                    <select className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} required>
                      <option value="">Seleccionar</option>
                      {internalLocations.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
                    </select>
                  </Field>
                  <Field label="Fecha ingreso"><input className="input" type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} required /></Field>
                  <Field label="Vencimiento"><input className="input" type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} /></Field>
                  <button className="btn-primary sm:col-span-2">Crear lote</button>
                </form>
              )}
            </div>
          )}

          {/* Tabla */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {/* Encabezado tabla */}
            <div className="grid bg-campo-700 text-xs font-black uppercase tracking-wide text-white"
              style={{ gridTemplateColumns: groupByProduct ? '1fr auto auto' : '1fr auto auto auto auto' }}>
              <div className="px-4 py-2.5">PRODUCTO</div>
              {!groupByProduct && <div className="px-3 py-2.5 hidden sm:block">ALMACEN</div>}
              {!groupByProduct && <div className="px-3 py-2.5 text-center">LOTE</div>}
              {!groupByProduct && <div className="px-3 py-2.5 text-center">VENC</div>}
              <div className="px-4 py-2.5 text-right">{groupByProduct ? 'LOTES' : 'CANTIDAD'}</div>
              {groupByProduct && <div className="px-4 py-2.5 text-right">TOTAL ENV</div>}
            </div>

            {loading ? (
              <p className="py-10 text-center text-sm font-bold text-slate-400">Cargando inventario...</p>
            ) : pageRows.length === 0 ? (
              <p className="py-10 text-center text-sm font-bold text-slate-400">Sin resultados.</p>
            ) : groupByProduct ? (
              pageRows.map((item, i) => (
                <button
                  key={item.product}
                  className={`grid w-full text-left transition hover:bg-campo-50 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}
                  style={{ gridTemplateColumns: '1fr auto auto' }}
                  onClick={() => navigate(`/productos/${encodeURIComponent(item.product)}`)}
                >
                  <div className="px-4 py-2.5">
                    <p className="text-sm font-bold text-slate-900 [overflow-wrap:anywhere]">{item.product}</p>
                    <p className="text-xs font-semibold text-slate-400">{item.lots} lotes</p>
                  </div>
                  <div className="px-4 py-2.5 text-right text-sm font-bold text-slate-700">{item.lots}</div>
                  <div className="px-4 py-2.5 text-right">
                    <span className="text-sm font-black text-campo-700">{formatNumber(item.quantity)}</span>
                    <span className="ml-1 text-xs font-bold text-campo-600">env</span>
                  </div>
                </button>
              ))
            ) : (
              pageRows.map((lot, i) => {
                const eq = lotEquivalent(lot)
                return (
                  <button
                    key={lot.id}
                    className={`grid w-full text-left transition hover:bg-campo-50 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}
                    style={{ gridTemplateColumns: '1fr auto auto auto auto' }}
                    onClick={() => navigate(`/lotes/${lot.id}`, { state: { fromLotsSearch: true, search } })}
                  >
                    <div className="min-w-0 px-4 py-2.5">
                      <p className="truncate text-sm font-bold text-slate-900">{cleanProductName(lot.product)}</p>
                      <p className="truncate text-xs font-semibold text-slate-400 sm:hidden">{lot.clients?.name || '-'}</p>
                    </div>
                    <div className="hidden px-3 py-2.5 sm:block">
                      <p className="truncate text-xs font-semibold text-slate-600 max-w-[140px]">{lot.clients?.name || '-'}</p>
                    </div>
                    <div className="px-3 py-2.5 text-center">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-700">
                        {lotLabel(lot.lot_code, lot)}
                      </span>
                    </div>
                    <div className={`px-3 py-2.5 text-center text-xs ${expiryClass(lot.expiry_date)}`}>
                      {lot.expiry_date ? formatDate(lot.expiry_date) : '-'}
                    </div>
                    <div className="px-4 py-2.5 text-right">
                      <span className="text-sm font-black text-campo-700">{formatNumber(lot.current_quantity)}</span>
                      {eq && <p className="text-xs font-semibold text-slate-400">{formatNumber(eq.quantity)} {eq.unit}</p>}
                    </div>
                  </button>
                )
              })
            )}

            {/* Paginación */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5">
                <p className="text-xs font-semibold text-slate-500">pág. {safePage} de {totalPages}</p>
                <div className="flex gap-1">
                  <button className="btn-secondary !min-h-7 !px-2 !py-1 text-xs disabled:opacity-40" disabled={safePage === 1} onClick={() => setPage((p) => p - 1)}>‹</button>
                  <button className="btn-secondary !min-h-7 !px-2 !py-1 text-xs disabled:opacity-40" disabled={safePage === totalPages} onClick={() => setPage((p) => p + 1)}>›</button>
                </div>
              </div>
            )}
          </div>

          {/* Barra de totales */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <Total label="TOTAL ITEM" value={formatNumber(totalItems)} />
            <Total label="TOTAL MERCADERÍA" value={`${formatNumber(totalMercaderia)}`} sub={totalMercaderia > 0 ? 'lt/kg' : ''} />
            <Total label="TOTAL ENVASES" value={formatNumber(totalEnvases)} />
          </div>

        </div>
      </div>
    </div>
  )
}

function Total({ label, value, sub }) {
  return (
    <div className="text-center sm:text-left">
      <p className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-base font-black text-slate-900">
        {value}
        {sub && <span className="ml-1 text-xs font-bold text-slate-400">{sub}</span>}
      </p>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-slate-600">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
