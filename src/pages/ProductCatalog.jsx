import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Edit2, Plus, Save, Search, Trash2, X } from 'lucide-react'

const PAGE_SIZE = 30
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import NewProductModal from '../components/NewProductModal'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'

const UNITS = ['lt', 'ml', 'kg', 'g', 'unid', 'caja', 'bolsa', 'saco']

const SIZE_IN_NAME_RE = /[^a-zA-Z](\d+(?:[.,]\d+)?)\s*(ltrs?|lts?|kgs?|gr|gm|ml|cc|l(?:[^a-zA-Z]|$))|\s[xX×]\s*\d+/i

function productDisplayName(p) {
  if (!p.name) return ''
  if (p.package_size && p.package_unit && !SIZE_IN_NAME_RE.test(p.name))
    return `${p.name} X ${p.package_size} ${p.package_unit}`
  return p.name
}

export default function ProductCatalog() {
  const { isAdmin } = useAuth()
  const [clients, setClients] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterClient, setFilterClient] = useState('')
  const [page, setPage] = useState(1)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: clientsData }, { data: productsData }] = await Promise.all([
      supabase.from('clients').select('id, name, product_code_prefix').eq('inventory_source', 'stock_independiente').order('name'),
      supabase.from('product_catalog').select('*, clients(name)').order('code'),
    ])
    setClients(clientsData || [])
    setProducts(productsData || [])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim()
    return products.filter((p) => {
      if (filterClient && p.client_id !== filterClient) return false
      if (!term) return true
      return (
        p.code?.toLowerCase().includes(term) ||
        p.name?.toLowerCase().includes(term) ||
        productDisplayName(p).toLowerCase().includes(term)
      )
    })
  }, [products, search, filterClient])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function handleSearch(val) { setSearch(val); setPage(1) }
  function handleFilterClient(val) { setFilterClient(val); setPage(1) }

  function startEdit(p) {
    setEditingId(p.id)
    setEditForm({ name: p.name, package_size: p.package_size || '', package_unit: p.package_unit || 'lt', units_per_box: p.units_per_box || '' })
    setError('')
  }

  function cancelEdit() { setEditingId(null); setEditForm({}); setError('') }

  async function saveEdit(id) {
    if (!editForm.name?.trim()) return setError('El nombre es obligatorio.')
    setSaving(true)
    const { error: err } = await supabase.from('product_catalog').update({
      name: editForm.name.trim().toUpperCase(),
      package_size: editForm.package_size ? Number(editForm.package_size) : null,
      package_unit: editForm.package_size ? editForm.package_unit : null,
      units_per_box: editForm.units_per_box ? Number(editForm.units_per_box) : null,
    }).eq('id', id)
    setSaving(false)
    if (err) return setError(err.message)
    setEditingId(null)
    load()
  }

  async function deleteProduct(product) {
    if (!product?.id) return
    const label = `${product.code || ''} - ${productDisplayName(product) || product.name || ''}`.trim()
    const ok = window.confirm(`Eliminar producto del catalogo?\n\n${label}\n\nEsta accion no elimina lotes ni movimientos existentes.`)
    if (!ok) return

    setDeletingId(product.id)
    setError('')
    const { error: err } = await supabase.from('product_catalog').delete().eq('id', product.id)
    setDeletingId(null)
    if (err) return setError(err.message)
    if (editingId === product.id) cancelEdit()
    load()
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Catalogo de productos">
        {isAdmin && (
          <button className="btn-primary !min-h-10 !px-3 !py-2 text-sm" type="button" onClick={() => setShowModal(true)}>
            <Plus size={16} />
            Nuevo producto
          </button>
        )}
      </PageHeader>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input w-full pl-9"
            type="text"
            placeholder="Buscar codigo o producto..."
            value={search}
            onChange={e => handleSearch(e.target.value)}
          />
        </div>
        <select className="input sm:w-56" value={filterClient} onChange={(e) => handleFilterClient(e.target.value)}>
          <option value="">Todas las empresas</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm font-bold text-slate-400">Cargando catalogo...</p>
      ) : filtered.length === 0 ? (
        <EmptyState title="Sin productos" description={search ? 'No hay coincidencias.' : 'Agrega el primer producto.'} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between bg-campo-700 px-4 py-2">
            <div className="grid w-full grid-cols-[auto_1fr_auto] text-xs font-black uppercase tracking-wide text-white">
              <span className="w-32">CODIGO</span>
              <span>PRODUCTO</span>
              {isAdmin && <span className="w-20 text-right">ACCION</span>}
            </div>
          </div>
          {paginated.map((p, i) => (
            <div
              key={p.id}
              className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50'} ${editingId === p.id ? 'border-l-4 border-campo-500' : ''}`}
            >
              <span className="w-32 font-mono text-sm font-bold text-campo-700">{p.code}</span>

              {editingId === p.id ? (
                <div className="flex min-w-0 flex-col gap-2">
                  <input
                    className="input w-full text-sm"
                    value={editForm.name}
                    onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Nombre"
                  />
                  <div className="flex gap-2">
                    <input
                      className="input w-24 text-sm"
                      type="text"
                      inputMode="decimal"
                      value={editForm.package_size}
                      onChange={(e) => setEditForm((f) => ({ ...f, package_size: e.target.value }))}
                      placeholder="Medida"
                    />
                    <select className="input flex-1 text-sm" value={editForm.package_unit} onChange={(e) => setEditForm((f) => ({ ...f, package_unit: e.target.value }))}>
                      {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <input
                      className="input w-20 text-sm"
                      type="text"
                      inputMode="numeric"
                      value={editForm.units_per_box}
                      onChange={(e) => setEditForm((f) => ({ ...f, units_per_box: e.target.value }))}
                      placeholder="Env/caja"
                      title="Envases por caja"
                    />
                  </div>
                  {error && <p className="text-xs font-bold text-red-600">{error}</p>}
                </div>
              ) : (
                <div className="min-w-0">
                  <p className="text-sm font-bold leading-snug text-slate-900 [overflow-wrap:anywhere]">{productDisplayName(p)}</p>
                  <p className="text-xs font-semibold text-slate-400 [overflow-wrap:anywhere]">{p.clients?.name || '-'}</p>
                </div>
              )}

              {isAdmin && (
                <div className="flex w-20 justify-end gap-1">
                  {editingId === p.id ? (
                    <>
                      <button className="btn-primary !min-h-8 !px-2 !py-1 text-xs" type="button" onClick={() => saveEdit(p.id)} disabled={saving}>
                        <Save size={14} />
                      </button>
                      <button className="btn-secondary !min-h-8 !px-2 !py-1 text-xs" type="button" onClick={cancelEdit}>
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="btn-secondary !min-h-8 !px-2 !py-1 text-xs" type="button" onClick={() => startEdit(p)} disabled={deletingId === p.id}>
                        <Edit2 size={14} />
                      </button>
                      <button className="btn-secondary !min-h-8 !px-2 !py-1 text-xs text-red-700 hover:bg-red-50" type="button" onClick={() => deleteProduct(p)} disabled={deletingId === p.id}>
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 bg-white px-4 py-3">
              <p className="text-xs font-semibold text-slate-500">
                {filtered.length} productos · pág. {safePage} de {totalPages}
              </p>
              <div className="flex items-center gap-1">
                <button
                  className="btn-secondary !min-h-8 !px-2 !py-1 text-xs disabled:opacity-40"
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                >
                  <ChevronLeft size={16} />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((n) => n === 1 || n === totalPages || Math.abs(n - safePage) <= 2)
                  .reduce((acc, n, idx, arr) => {
                    if (idx > 0 && n - arr[idx - 1] > 1) acc.push('...')
                    acc.push(n)
                    return acc
                  }, [])
                  .map((n, idx) =>
                    n === '...' ? (
                      <span key={`dots-${idx}`} className="px-1 text-xs text-slate-400">…</span>
                    ) : (
                      <button
                        key={n}
                        className={`!min-h-8 !min-w-8 rounded-lg px-2 py-1 text-xs font-bold transition ${safePage === n ? 'bg-campo-700 text-white' : 'btn-secondary'}`}
                        type="button"
                        onClick={() => setPage(n)}
                      >
                        {n}
                      </button>
                    )
                  )}
                <button
                  className="btn-secondary !min-h-8 !px-2 !py-1 text-xs disabled:opacity-40"
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <NewProductModal
          clients={clients}
          onClose={() => setShowModal(false)}
          onSaved={load}
        />
      )}
    </div>
  )
}
