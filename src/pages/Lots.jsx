import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Building2, CalendarClock, ChevronLeft, ChevronRight, ClipboardList, History, LayoutList, LogOut, Menu, PackagePlus, Plus, Wrench, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, normalizeEquivalent, pluralUnit, equivalentLabel } from '../lib/format'
import { cleanProductName, displayLotCode, lotLabel, lotSizeAndUnit, productCodeLabel } from '../lib/display'
import { sumBillingPallets } from '../lib/pallets'
import { desgloseEnvases } from '../lib/envases'
import NewProductModal from '../components/NewProductModal'
import EmpresasModal from '../components/EmpresasModal'
import CatalogoModal from '../components/CatalogoModal'
import MovimientosModal from '../components/MovimientosModal'

const LOTS_CACHE_KEY = 'todo-agricola-lots-cache'
const CLIENTS_CACHE_KEY = 'todo-agricola-clients-cache'
const LOTS_FILTERS_KEY = 'todo-agricola-lots-filters'
const PAGE_SIZE = 50

// Filtros recordados durante la sesión: al volver de una ficha, la lista
// queda en la misma empresa/búsqueda/página en vez de resetearse a Todos
function readLotsFilters() {
  try { return JSON.parse(sessionStorage.getItem(LOTS_FILTERS_KEY) || 'null') || {} } catch { return {} }
}

function expiryClass(dateStr) {
  if (!dateStr) return 'text-slate-400'
  const days = Math.ceil((new Date(dateStr) - new Date()) / 86400000)
  if (days < 0) return 'text-red-600 font-semibold'
  if (days <= 30) return 'text-amber-600 font-semibold'
  return 'text-slate-500'
}

export default function Lots() {
  const { isAdmin, profile } = useAuth()
  const canOperate = isAdmin || profile?.role === 'operador'
  const navigate = useNavigate()
  const location = useLocation()

  const [lots, setLots] = useState([])
  const [clients, setClients] = useState([])
  const [cacheNotice, setCacheNotice] = useState('')
  const [loading, setLoading] = useState(true)

  const savedFilters = useMemo(readLotsFilters, [])
  const [search, setSearch] = useState(savedFilters.search || '')
  const [selectedClient, setSelectedClient] = useState(savedFilters.selectedClient || '')
  const [clientSearch, setClientSearch] = useState('')
  const [groupByProduct, setGroupByProduct] = useState(false)
  const [showZeroStock, setShowZeroStock] = useState(false)
  const [page, setPage] = useState(savedFilters.page || 1)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    sessionStorage.setItem(LOTS_FILTERS_KEY, JSON.stringify({ search, selectedClient, page }))
  }, [search, selectedClient, page])

  const [showProductModal, setShowProductModal] = useState(false)
  const [showEmpresasModal, setShowEmpresasModal] = useState(false)
  const [showCatalogoModal, setShowCatalogoModal] = useState(false)
  const [showMovimientosModal, setShowMovimientosModal] = useState(false)
  const [pendingDispatch, setPendingDispatch] = useState(0)

  useEffect(() => {
    if (!canOperate) return
    async function loadPending() {
      const { count } = await supabase
        .from('client_dispatch_requests')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pendiente', 'aprobado', 'en_preparacion'])
      setPendingDispatch(count || 0)
    }
    loadPending()
    const ch = supabase
      .channel('lots-dispatch-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_dispatch_requests' }, loadPending)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [canOperate])

  // Contador de reparaciones/ajustes/traslados/reportes por aprobar (solo admin)
  const [pendingRepairs, setPendingRepairs] = useState(0)

  useEffect(() => {
    if (!isAdmin) return
    async function loadRepairs() {
      const [m, c, i] = await Promise.all([
        supabase.from('movements').select('id', { count: 'exact', head: true }).in('type', ['ajuste', 'traslado', 'salida']).eq('approval_status', 'pendiente'),
        supabase.from('movement_correction_requests').select('id', { count: 'exact', head: true }).eq('status', 'pendiente'),
        supabase.from('operational_issue_reports').select('id', { count: 'exact', head: true }).eq('status', 'pendiente'),
      ])
      setPendingRepairs((m.count || 0) + (c.count || 0) + (i.count || 0))
    }
    loadRepairs()
    const ch = supabase
      .channel('lots-repairs-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movements' }, loadRepairs)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movement_correction_requests' }, loadRepairs)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operational_issue_reports' }, loadRepairs)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [isAdmin])

  useEffect(() => { loadData(false) }, [])

  async function loadData(includeZero) {
    setLoading(true)
    // includeZero=false → only status='activo' (normal view, fast)
    // includeZero=true  → all statuses (shows lots with any status including zero-stock)
    let lotsQuery = supabase
      .from('lots')
      .select('*, clients(name)')
      .eq('inventory_source', 'stock_independiente')
      .order('product', { ascending: true })

    if (!includeZero) lotsQuery = lotsQuery.eq('status', 'activo')

    const [{ data: lotsData, error: lotsError }, { data: clientsData, error: clientsError }] = await Promise.all([
      lotsQuery,
      supabase.from('clients').select('*').eq('inventory_source', 'stock_independiente').order('name'),
    ])

    if (lotsData && !lotsError) {
      setLots(lotsData)
      if (!includeZero) localStorage.setItem(LOTS_CACHE_KEY, JSON.stringify(lotsData))
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

  const filteredLots = useMemo(() => {
    const term = search.trim().toLowerCase()
    return lots.filter((lot) => {
      if (!showZeroStock && Number(lot.current_quantity || 0) < 1) return false
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

  const groupedRows = useMemo(() => {
    if (!groupByProduct) return null
    const map = {}
    filteredLots.forEach((lot) => {
      const key = cleanProductName(lot.product)
      if (!map[key]) map[key] = { product: key, quantity: 0, lots: 0, eqLts: 0, eqKgs: 0 }
      const qty = Number(lot.current_quantity || 0)
      map[key].quantity += qty
      map[key].lots += 1
      if (qty > 0) {
        const { size, unit } = lotSizeAndUnit(lot)
        if (size > 0) {
          const total = qty * size
          if (unit === 'ml') map[key].eqLts += total / 1000
          else if (unit === 'gr') map[key].eqKgs += total / 1000
          else if (/^l/.test(unit)) map[key].eqLts += total
          else if (/^k/.test(unit)) map[key].eqKgs += total
        }
      }
    })
    return Object.values(map).sort((a, b) => a.product.localeCompare(b.product, 'es'))
  }, [filteredLots, groupByProduct])

  const rows = groupByProduct ? (groupedRows || []) : filteredLots
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function handleSearch(v) { setSearch(v); setPage(1) }
  function handleClientSelect(id) { setSelectedClient(id); setPage(1); setSidebarOpen(false) }

  const totalItems = filteredLots.length
  // Total equivalente separado por unidad (lts · kgs), normalizando ml→lt y gr→kg
  const totalMercaderia = useMemo(() => {
    const totals = new Map()
    for (const lot of filteredLots) {
      const qty = Number(lot.current_quantity || 0)
      if (qty <= 0) continue
      const { size, unit } = lotSizeAndUnit(lot)
      // Sin presentación no se inventa equivalente, y las uds no van al total
      // (mezclar uds con lts/kgs confunde — decisión Harold)
      if (!(size > 0) || !unit) continue
      const eq = normalizeEquivalent(qty * size, unit)
      if (eq.unit === 'uds') continue
      totals.set(eq.unit, (totals.get(eq.unit) || 0) + eq.value)
    }
    return [...totals.entries()].map(([unit, value]) => `${formatNumber(value)} ${pluralUnit(unit, value)}`).join(' · ') || '0'
  }, [filteredLots])
  const totalPallets = sumBillingPallets(filteredLots)

  const selectedClientName = selectedClient ? clients.find((c) => c.id === selectedClient)?.name : ''
  const visibleClients = clients.filter((c) =>
    !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase())
  )
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">

      {canOperate && (
        <div className="grid grid-cols-2 gap-3">
          <Link
            className="btn-primary min-h-20 !flex-col !items-start !justify-between !px-5 !py-4 text-left text-lg sm:min-h-24"
            to="/operacion/nuevo-ingreso"
          >
            <PackagePlus size={26} className="opacity-80" />
            <span>Ingreso</span>
          </Link>
          <Link
            className="relative inline-flex min-h-20 flex-col items-start justify-between gap-2 rounded-lg bg-maiz px-5 py-4 text-left text-lg font-semibold text-slate-950 shadow-soft transition active:scale-[0.99] sm:min-h-24"
            to="/operacion/salidas"
          >
            {pendingDispatch > 0 && (
              <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-black text-white">
                {pendingDispatch > 99 ? '99+' : pendingDispatch}
              </span>
            )}
            <LogOut size={26} className="opacity-70" />
            <span>Salida</span>
          </Link>
        </div>
      )}

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

      <div className="flex min-h-0 gap-3">

        {/* Backdrop móvil */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar empresas */}
        <aside className={`
          fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white shadow-xl transition-transform duration-200
          lg:static lg:z-auto lg:w-52 lg:translate-x-0 lg:rounded-xl lg:border lg:shadow-sm lg:flex
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 lg:px-3">
            <p className="text-xs font-black uppercase tracking-wide text-slate-500">Empresas</p>
            <button
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="px-3 pt-2 pb-1">
            <input
              className="input w-full text-sm"
              placeholder="Buscar empresa..."
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
            />
          </div>
          <ul className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
            <li>
              <button
                className={`w-full rounded-lg px-3 py-2 text-left text-sm font-bold transition ${!selectedClient ? 'bg-campo-700 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                onClick={() => handleClientSelect('')}
              >
                Todos
              </button>
            </li>
            {visibleClients.map((c) => (
              <li key={c.id}>
                <button
                  className={`w-full rounded-lg px-3 py-2 text-left text-xs font-semibold leading-snug transition ${selectedClient === c.id ? 'bg-campo-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
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
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            {/* Fila 1: menú + buscador */}
            <div className="flex items-center gap-2">
              <button
                className="btn-secondary shrink-0 !min-h-9 !px-3 !py-2 lg:hidden"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu size={18} />
              </button>
              <input
                className="input min-w-0 flex-1 text-sm"
                placeholder="Buscar producto, item, vencimiento..."
                value={search}
                onChange={e => handleSearch(e.target.value)}
              />
            </div>
            {/* Fila 2: opciones + acciones */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex cursor-pointer items-center gap-1.5 select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded accent-campo-700"
                  checked={groupByProduct}
                  onChange={(e) => { setGroupByProduct(e.target.checked); setPage(1) }}
                />
                <span className="text-xs font-semibold text-slate-600">Total por producto</span>
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded accent-campo-700"
                  checked={showZeroStock}
                  onChange={(e) => {
                    const v = e.target.checked
                    setShowZeroStock(v)
                    setPage(1)
                    loadData(v)
                  }}
                />
                <span className="text-xs font-semibold text-slate-600">Mostrar stock 0</span>
              </label>
              <div className="ml-auto flex gap-1.5">
                <button
                  className="btn-secondary !min-h-8 !px-2.5 !py-1.5 text-xs font-bold"
                  onClick={() => navigate('/vencimientos')}
                  title="Próximos a vencer"
                >
                  <CalendarClock size={14} />
                  <span className="hidden sm:inline">Próx. a vencer</span>
                </button>
                <button
                  className="btn-secondary !min-h-8 !px-2.5 !py-1.5 text-xs font-bold"
                  onClick={() => navigate('/kardex')}
                  title="Ver Kardex"
                >
                  <ClipboardList size={14} />
                  <span className="hidden sm:inline">Ver Kardex</span>
                </button>
                {canOperate && (
                  <button
                    className="btn-secondary !min-h-8 !px-2.5 !py-1.5 text-xs font-bold"
                    onClick={() => setShowMovimientosModal(true)}
                    title="Historial de movimientos"
                  >
                    <History size={14} />
                    <span className="hidden sm:inline">Movimientos</span>
                  </button>
                )}
                {isAdmin && (
                  <button
                    className="btn-secondary relative !min-h-8 !px-2.5 !py-1.5 text-xs font-bold"
                    onClick={() => navigate('/pendientes')}
                    title="Reparaciones y ajustes por aprobar"
                  >
                    {pendingRepairs > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">
                        {pendingRepairs > 99 ? '99+' : pendingRepairs}
                      </span>
                    )}
                    <Wrench size={14} />
                    <span className="hidden sm:inline">Reparaciones</span>
                  </button>
                )}
              </div>
            </div>
            {/* Empresa activa en móvil */}
            {selectedClientName && (
              <div className="flex items-center gap-1.5 lg:hidden">
                <span className="rounded-full bg-campo-100 px-2.5 py-0.5 text-xs font-bold text-campo-800">
                  {selectedClientName}
                </span>
                <button
                  className="text-xs font-semibold text-slate-400 hover:text-slate-600"
                  onClick={() => handleClientSelect('')}
                >
                  ✕ Todos
                </button>
              </div>
            )}
          </div>

          {/* Botones de admin */}
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex items-center gap-1.5 rounded-lg border border-campo-200 bg-campo-100 px-3 py-1.5 text-xs font-bold text-campo-800 shadow-sm transition hover:bg-campo-200 active:scale-[0.98]"
                onClick={() => setShowProductModal(true)}
              >
                <Plus size={14} />
                Producto
              </button>
              <button
                className="btn-secondary !min-h-8 !px-3 !py-1.5 text-xs"
                onClick={() => setShowCatalogoModal(true)}
              >
                <LayoutList size={14} />
                Catálogo
              </button>
              <button
                className="btn-secondary !min-h-8 !px-3 !py-1.5 text-xs"
                onClick={() => setShowEmpresasModal(true)}
              >
                <Building2 size={14} />
                Empresas
              </button>
            </div>
          )}

          {/* Tabla */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              {loading ? (
                <p className="py-12 text-center text-sm font-bold text-slate-400">Cargando inventario...</p>
              ) : pageRows.length === 0 ? (
                <p className="py-12 text-center text-sm font-bold text-slate-400">Sin resultados.</p>
              ) : groupByProduct ? (
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-campo-700 text-xs font-black uppercase tracking-wide text-white">
                      <th className="px-4 py-2.5 text-left font-black">PRODUCTO</th>
                      <th className="w-16 px-3 py-2.5 text-center font-black">ITEMS</th>
                      <th className="w-32 px-4 py-2.5 text-right font-black">TOTAL ENV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((item, i) => (
                      <tr
                        key={item.product}
                        className={`cursor-pointer transition hover:bg-campo-50 active:bg-campo-50 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}
                        onClick={() => navigate(`/productos/${encodeURIComponent(item.product)}`)}
                      >
                        <td className="px-4 py-2.5">
                          <p className="text-sm font-bold text-slate-900 [overflow-wrap:anywhere]">{item.product}</p>
                        </td>
                        <td className="w-16 px-3 py-2.5 text-center text-sm font-bold text-slate-600">
                          {item.lots}
                        </td>
                        <td className="w-32 px-4 py-2.5 text-right">
                          {item.eqLts > 0 ? (
                            <>
                              <span className="text-sm font-black text-campo-700">{formatNumber(item.eqLts)}</span>
                              <span className="ml-1 text-xs font-semibold text-campo-500">lts</span>
                            </>
                          ) : item.eqKgs > 0 ? (
                            <>
                              <span className="text-sm font-black text-campo-700">{formatNumber(item.eqKgs)}</span>
                              <span className="ml-1 text-xs font-semibold text-campo-500">kgs</span>
                            </>
                          ) : (
                            <>
                              <span className="text-sm font-black text-campo-700">{formatNumber(item.quantity)}</span>
                              <span className="ml-1 text-xs font-semibold text-campo-500">env</span>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full border-collapse" style={{ minWidth: '420px' }}>
                  <colgroup>
                    <col />
                    <col style={{ width: '120px' }} />
                    <col style={{ width: '105px' }} />
                    <col style={{ width: '95px' }} />
                  </colgroup>
                  <thead>
                    <tr className="bg-campo-700 text-xs font-black uppercase tracking-wide text-white">
                      <th className="px-4 py-2.5 text-left font-black">PRODUCTO / ALMACEN</th>
                      <th className="px-3 py-2.5 text-center font-black">LOTE</th>
                      <th className="px-3 py-2.5 text-center font-black">VENC</th>
                      <th className="px-4 py-2.5 text-right font-black">CANTIDAD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((lot, i) => {
                      const isZero = Number(lot.current_quantity || 0) < 1
                      const { size, unit } = lotSizeAndUnit(lot)
                      const eqTotal = size > 0 ? Number(lot.current_quantity || 0) * size : 0
                      const eqN = eqTotal > 0 && unit ? normalizeEquivalent(eqTotal, unit) : null
                      const eqNorm = eqN ? eqN.value : eqTotal
                      const eqUnit = eqN && eqN.unit !== 'uds' ? pluralUnit(eqN.unit, eqN.value) : ''
                      // Unidades con su tipo de envase ("400 bidones"); sin presentación → uds
                      const eqEnv = eqTotal > 0 ? desgloseEnvases(eqTotal, size, unit, 0).unidadesLabel : ''
                      return (
                        <tr
                          key={lot.id}
                          className={`cursor-pointer transition hover:bg-campo-50 active:bg-campo-50 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50'} ${isZero ? 'opacity-50' : ''}`}
                          onClick={() => navigate(`/lotes/${lot.id}`, { state: { fromLotsSearch: true, search } })}
                        >
                          <td className="px-4 py-2.5">
                            <p className="text-sm font-bold text-slate-900 leading-snug [overflow-wrap:anywhere]">
                              {cleanProductName(lot.product)}
                            </p>
                            <p className="mt-0.5 text-xs font-semibold text-slate-400 truncate">
                              {lot.clients?.name || '-'}
                            </p>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-700 whitespace-nowrap">
                              {lotLabel(lot.lot_code, lot)}
                            </span>
                          </td>
                          <td className={`px-3 py-2.5 text-center text-xs whitespace-nowrap ${expiryClass(lot.expiry_date)}`}>
                            {lot.expiry_date ? formatDate(lot.expiry_date) : '-'}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {eqTotal > 0 ? (
                              <>
                                <p className="text-sm font-black text-campo-700 whitespace-nowrap">
                                  {formatNumber(eqNorm)} <span className="text-xs font-semibold text-campo-500">{eqUnit}</span>
                                </p>
                                <p className="text-[10px] font-semibold text-slate-400">{eqEnv || `${formatNumber(lot.current_quantity)} uds`}</p>
                              </>
                            ) : (
                              <p className="text-sm font-black text-campo-700 whitespace-nowrap">
                                {formatNumber(lot.current_quantity)} <span className="text-xs font-semibold text-campo-500">uds</span>
                              </p>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Paginación */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                <p className="text-xs font-semibold text-slate-500">
                  {rows.length} {groupByProduct ? 'productos' : 'items'} · pág. {safePage}/{totalPages}
                </p>
                <div className="flex gap-1">
                  <button
                    className="btn-secondary !min-h-8 !px-2 !py-1 text-xs disabled:opacity-40"
                    disabled={safePage === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    className="btn-secondary !min-h-8 !px-2 !py-1 text-xs disabled:opacity-40"
                    disabled={safePage === totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Barra de totales */}
          <div className="grid grid-cols-3 divide-x divide-slate-200 rounded-xl border border-slate-200 bg-white">
            <Total label="TOTAL ITEM" value={formatNumber(totalItems)} />
            <Total label="TOTAL MERCADERÍA" value={totalMercaderia} />
            <Total
              label="TOTAL PALLETS"
              value={totalPallets.value > 0 ? formatNumber(totalPallets.value) : '—'}
            />
          </div>

        </div>
      </div>

      {showProductModal && (
        <NewProductModal
          clients={clients}
          onClose={() => setShowProductModal(false)}
          onSaved={loadData}
        />
      )}

      {showEmpresasModal && (
        <EmpresasModal
          onClose={() => setShowEmpresasModal(false)}
          onSaved={loadData}
        />
      )}

      {showCatalogoModal && (
        <CatalogoModal
          clients={clients}
          onClose={() => setShowCatalogoModal(false)}
        />
      )}

      {showMovimientosModal && (
        <MovimientosModal
          canEdit={isAdmin}
          onClose={() => setShowMovimientosModal(false)}
        />
      )}
    </div>
  )
}

function Total({ label, value, sub }) {
  return (
    <div className="px-3 py-3 text-center sm:px-4">
      <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-base font-black text-slate-900 leading-none">
        {value}
        {sub && <span className="ml-1 text-[10px] font-bold text-slate-400">{sub}</span>}
      </p>
    </div>
  )
}
