import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Edit2, Filter, Save, Search, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

const UNITS = ['lt', 'ml', 'kg', 'g', 'unid', 'caja', 'bolsa', 'saco']

function productDisplayName(p) {
  if (!p.name) return ''
  if (p.package_size && p.package_unit) return `${p.name} X ${p.package_size} ${p.package_unit}`
  return p.name
}

export default function CatalogoModal({ clients, onClose }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterClient, setFilterClient] = useState('')
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [mode, setMode] = useState(null) // null | 'edit'
  const [editForm, setEditForm] = useState({ code: '', name: '', package_size: '', package_unit: 'lt' })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('product_catalog')
      .select('*, clients(name)')
      .order('code')
    setProducts(data || [])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim()
    return products.filter((p) => {
      if (filterClient && p.client_id !== filterClient) return false
      if (!term) return true
      return (
        p.code?.toLowerCase().includes(term) ||
        productDisplayName(p).toLowerCase().includes(term) ||
        (p.clients?.name || '').toLowerCase().includes(term)
      )
    })
  }, [products, search, filterClient])

  function handleModificar() {
    if (!selectedId) {
      setError('Selecciona un producto de la lista para modificar.')
      return
    }
    const p = products.find((x) => x.id === selectedId)
    if (!p) return
    setEditForm({ code: p.code || '', name: p.name || '', package_size: p.package_size || '', package_unit: p.package_unit || 'lt' })
    setError('')
    setMode('edit')
  }

  async function handleEliminar() {
    if (!selectedId) {
      setError('Selecciona un producto de la lista para eliminar.')
      return
    }
    const p = products.find((x) => x.id === selectedId)
    if (!p) return
    const label = `${p.code || ''} - ${productDisplayName(p) || p.name || ''}`.trim()
    const ok = window.confirm(`Eliminar producto del catalogo?\n\n${label}\n\nEsta accion no elimina lotes ni movimientos existentes.`)
    if (!ok) return

    setDeleting(true)
    setError('')
    const { error: err } = await supabase.from('product_catalog').delete().eq('id', selectedId)
    setDeleting(false)
    if (err) return setError(err.message)
    setSelectedId(null)
    load()
  }

  async function saveEdit(e) {
    e.preventDefault()
    setError('')
    if (!editForm.name.trim()) return setError('El nombre es obligatorio.')
    if (!editForm.code.trim()) return setError('El código es obligatorio.')
    setSaving(true)
    const { error: err } = await supabase.from('product_catalog').update({
      code: editForm.code.trim().toUpperCase(),
      name: editForm.name.trim().toUpperCase(),
      package_size: editForm.package_size ? Number(editForm.package_size) : null,
      package_unit: editForm.package_size ? editForm.package_unit : null,
    }).eq('id', selectedId)
    setSaving(false)
    if (err) return setError(err.message)
    setMode(null)
    setSelectedId(null)
    load()
  }

  function cancel() { setMode(null); setError('') }

  const selectedProduct = products.find((p) => p.id === selectedId)
  const editLabel = editForm.name && editForm.package_size
    ? `${editForm.name.toUpperCase()} X ${editForm.package_size} ${editForm.package_unit}`
    : editForm.name ? editForm.name.toUpperCase() : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex h-[90dvh] max-h-[680px] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-black text-slate-950">
            {mode === 'edit' ? `Modificar: ${selectedProduct?.code || ''}` : 'Catálogo de productos'}
          </h2>
          <button className="btn-secondary !min-h-9 !p-2" type="button" onClick={mode ? cancel : onClose}>
            {mode ? <ArrowLeft size={18} /> : <X size={18} />}
          </button>
        </div>

        {/* === VISTA TABLA === */}
        {!mode && (
          <>
            {/* Toolbar */}
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
              <button
                className="btn-secondary !min-h-9 !px-3 !py-1.5 text-sm"
                type="button"
                onClick={handleModificar}
                disabled={deleting}
              >
                <Edit2 size={15} />
                Modificar
              </button>
              <button
                className="btn-secondary !min-h-9 !px-3 !py-1.5 text-sm text-red-700 hover:bg-red-50"
                type="button"
                onClick={handleEliminar}
                disabled={deleting}
              >
                <Trash2 size={15} />
                {deleting ? 'Eliminando...' : 'Eliminar'}
              </button>
              <div className="relative flex-1 min-w-0">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className="input w-full pl-8 text-sm"
                  placeholder="Buscar código o producto..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="relative">
                <button
                  className={`btn-secondary !min-h-9 !p-2 relative ${filterClient ? 'border-campo-400 bg-campo-50 text-campo-700' : ''}`}
                  type="button"
                  title={filterClient ? `Filtro: ${clients?.find((c) => c.id === filterClient)?.name || ''}` : 'Filtrar por empresa'}
                  onClick={() => setShowFilterMenu((v) => !v)}
                >
                  <Filter size={15} />
                  {filterClient && (
                    <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-campo-600" />
                  )}
                </button>
                {showFilterMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowFilterMenu(false)} />
                    <div className="absolute right-0 top-full z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                      <button
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${!filterClient ? 'font-black text-campo-700' : 'font-semibold text-slate-700'}`}
                        type="button"
                        onClick={() => { setFilterClient(''); setShowFilterMenu(false) }}
                      >
                        Todas las empresas
                      </button>
                      {(clients || []).map((c) => (
                        <button
                          key={c.id}
                          className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${filterClient === c.id ? 'bg-campo-50 font-black text-campo-700' : 'font-semibold text-slate-700'}`}
                          type="button"
                          onClick={() => { setFilterClient(c.id); setShowFilterMenu(false) }}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Error / hint */}
            {error && (
              <div className="mx-4 mt-2 shrink-0 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                {error}
              </div>
            )}

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <p className="py-8 text-center text-sm font-bold text-slate-400">Cargando...</p>
              ) : filtered.length === 0 ? (
                <p className="py-8 text-center text-sm font-bold text-slate-400">Sin productos.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  <div className="sticky top-0 flex items-center gap-3 bg-campo-700 px-4 py-2.5">
                    <span className="w-24 shrink-0 text-xs font-black uppercase tracking-wide text-white">Código</span>
                    <span className="min-w-0 flex-1 text-xs font-black uppercase tracking-wide text-white">Producto</span>
                  </div>
                  {filtered.map((p, i) => (
                    <div
                      key={p.id}
                      className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors ${
                        selectedId === p.id
                          ? 'bg-campo-100'
                          : i % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50 hover:bg-slate-100'
                      }`}
                      onClick={() => { setSelectedId((prev) => (prev === p.id ? null : p.id)); setError('') }}
                    >
                      <span className="w-24 shrink-0 font-mono text-xs font-bold text-campo-700">{p.code}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-slate-900">{productDisplayName(p)}</p>
                        <p className="truncate text-[10px] font-semibold text-slate-400">{p.clients?.name || ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-slate-100 px-4 py-2 text-xs font-semibold text-slate-400">
              {filtered.length} producto{filtered.length !== 1 ? 's' : ''}
              {selectedId && <span className="ml-3 font-bold text-campo-700">· {selectedProduct?.code} seleccionado</span>}
            </div>
          </>
        )}

        {/* === FORMULARIO MODIFICAR === */}
        {mode === 'edit' && selectedId && (
          <form onSubmit={saveEdit} className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
            <label className="block">
              <span className="text-sm font-bold text-slate-700">Código</span>
              <input
                className="input mt-1 w-full font-mono uppercase"
                value={editForm.code}
                onChange={(e) => setEditForm((f) => ({ ...f, code: e.target.value }))}
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-bold text-slate-700">Nombre</span>
              <input
                className="input mt-1 w-full uppercase"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Ej: BONDER"
                required
              />
            </label>
            <div>
              <span className="text-sm font-bold text-slate-700">Medida</span>
              <div className="mt-1 flex gap-2">
                <input
                  className="input w-28"
                  type="number"
                  min="0"
                  step="any"
                  value={editForm.package_size}
                  onChange={(e) => setEditForm((f) => ({ ...f, package_size: e.target.value }))}
                  placeholder="Ej: 20"
                />
                <select
                  className="input flex-1"
                  value={editForm.package_unit}
                  onChange={(e) => setEditForm((f) => ({ ...f, package_unit: e.target.value }))}
                >
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            {editLabel && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
                Se guardará como: <span className="font-black text-slate-900">{editLabel}</span>
              </p>
            )}
            {error && <p className="text-sm font-bold text-red-600">{error}</p>}
            <div className="mt-auto flex gap-3 pt-2">
              <button className="btn-primary flex-1" type="submit" disabled={saving}>
                <Save size={18} /> {saving ? 'Guardando...' : 'Guardar'}
              </button>
              <button className="btn-secondary flex-1" type="button" onClick={cancel}>Cancelar</button>
            </div>
          </form>
        )}

      </div>
    </div>
  )
}
