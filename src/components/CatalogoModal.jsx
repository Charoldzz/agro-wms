import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, Edit2, Filter, Save, Search, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { catalogClientIds } from '../lib/catalogo'

const UNITS = ['lt', 'ml', 'kg', 'gr']

const SIZE_IN_NAME_RE = /[^a-zA-Z](\d+(?:[.,]\d+)?)\s*(ltrs?|lts?|kgs?|gr|gm|ml|cc|l(?:[^a-zA-Z]|$))|\s[xX×]\s*\d+/i

// Presentación al final del nombre ("40X500 ML", "X 20 LTS", "500 ML"): para reemplazarla al reeditar
const TRAILING_PRES_RE = /\s+(?:\d+(?:[.,]\d+)?\s*[xX×]\s*|[xX×]\s*)?\d+(?:[.,]\d+)?\s*(?:ltrs?|lts?|kgs?|grs?|gr|gm|ml|cc)\.?$/i

// Sufijo de presentación para el nombre: "20x500 ML" (con uds/caja) o "X 500 ML" (sin)
// Plural LTS/KGS si el tamaño es mayor a 1; LT/KG en singular; ml/gr en mayúscula.
function buildNameSuffix(upb, size, unit) {
  const s = String(size || '').trim()
  const value = Number(s.replace(',', '.'))
  if (!s || !(value > 0)) return ''
  let u = String(unit || '').toLowerCase()
  if (u === 'lt') u = value === 1 ? 'LT' : 'LTS'
  else if (u === 'kg') u = value === 1 ? 'KG' : 'KGS'
  else u = u.toUpperCase()
  const per = Number(upb)
  return per > 0 ? `${per}x${s} ${u}` : `X ${s} ${u}`
}

function productDisplayName(p) {
  if (!p.name) return ''
  if (p.package_size && p.package_unit && !SIZE_IN_NAME_RE.test(p.name))
    return `${p.name} X ${p.package_size} ${p.package_unit}`
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
  const [editForm, setEditForm] = useState({ code: '', name: '', package_size: '', package_unit: 'lt', units_per_box: '' })
  const editReady = useRef(false) // evita reescribir el nombre en la primera pasada al abrir Modificar
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [showPendingOnly, setShowPendingOnly] = useState(false)

  const pendingCount = useMemo(() => products.filter((p) => p.pending_review).length, [products])

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
      if (showPendingOnly && !p.pending_review) return false
      if (filterClient && p.client_id !== filterClient) return false
      if (!term) return true
      return (
        p.code?.toLowerCase().includes(term) ||
        productDisplayName(p).toLowerCase().includes(term) ||
        (p.clients?.name || '').toLowerCase().includes(term)
      )
    })
  }, [products, search, filterClient, showPendingOnly])

  // Al cambiar tamaño de presentación o uds por caja en Modificar, reconstruye el
  // nombre con esos valores ("PRUEBA6 20x500 ML"): saca la presentación vieja del
  // final y agrega el sufijo nuevo. La primera pasada (al abrir) se salta.
  useEffect(() => {
    if (mode !== 'edit') { editReady.current = false; return }
    if (!editReady.current) { editReady.current = true; return }
    const suffix = buildNameSuffix(editForm.units_per_box, editForm.package_size, editForm.package_unit)
    setEditForm((f) => {
      const base = String(f.name || '').replace(TRAILING_PRES_RE, '').trimEnd()
      if (!base) return f
      const next = suffix ? `${base} ${suffix}` : base
      return next === f.name ? f : { ...f, name: next }
    })
  }, [editForm.package_size, editForm.package_unit, editForm.units_per_box, mode])

  async function marcarRevisada() {
    if (!selectedId) return
    const { error: err } = await supabase
      .from('product_catalog')
      .update({ pending_review: false })
      .eq('id', selectedId)
    if (err) { setError(err.message); return }
    setMode(null)
    setSelectedId(null)
    load()
  }

  function handleModificar() {
    if (!selectedId) {
      setError('Selecciona un producto de la lista para modificar.')
      return
    }
    const p = products.find((x) => x.id === selectedId)
    if (!p) return
    setEditForm({ code: p.code || '', name: p.name || '', package_size: p.package_size || '', package_unit: p.package_unit || 'lt', units_per_box: p.units_per_box || '' })
    editReady.current = false
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
    setMode(null)
    setSelectedId(null)
    load()
  }

  async function saveEdit(e) {
    e.preventDefault()
    setError('')
    if (!editForm.name.trim()) return setError('El nombre es obligatorio.')
    if (!editForm.code.trim()) return setError('El código es obligatorio.')
    setSaving(true)

    const before = products.find((x) => x.id === selectedId)
    const updated = {
      code: editForm.code.trim().toUpperCase(),
      name: editForm.name.trim().toUpperCase(),
      package_size: editForm.package_size ? Number(editForm.package_size) : null,
      package_unit: editForm.package_size ? editForm.package_unit : null,
      units_per_box: editForm.units_per_box ? Number(editForm.units_per_box) : null,
      pending_review: false,
    }
    const { error: err } = await supabase.from('product_catalog').update(updated).eq('id', selectedId)

    // Si cambió el nombre visible, propagar la corrección a los lotes existentes
    if (!err && before) {
      const oldLabel = productDisplayName(before)
      const newLabel = productDisplayName({ ...before, ...updated })
      if (oldLabel && newLabel && oldLabel !== newLabel) {
        const ids = await catalogClientIds(before.client_id)
        const escaped = oldLabel.replace(/[\\%_]/g, (m) => `\\${m}`)
        await supabase.from('lots').update({ product: newLabel }).in('client_id', ids).ilike('product', escaped)
      }
    }

    setSaving(false)
    if (err) return setError(err.message)
    setMode(null)
    setSelectedId(null)
    load()
  }

  function cancel() { setMode('detail'); setError('') }

  function goBack() {
    setError('')
    if (mode === 'edit') { setMode('detail'); return }
    setMode(null)
    setSelectedId(null)
  }

  const selectedProduct = products.find((p) => p.id === selectedId)
  // El nombre ya lleva su presentación al día (efecto de arriba), así que la vista
  // previa = exactamente lo que se guarda.
  const editLabel = editForm.name.trim().toUpperCase()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex h-[90dvh] max-h-[680px] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-black text-slate-950">
            {mode === 'edit' ? `Modificar: ${selectedProduct?.code || ''}` : mode === 'detail' ? 'Ficha del producto' : 'Catálogo de productos'}
          </h2>
          <button className="btn-secondary !min-h-9 !p-2" type="button" onClick={mode ? goBack : onClose}>
            {mode ? <ArrowLeft size={18} /> : <X size={18} />}
          </button>
        </div>

        {/* === VISTA TABLA === */}
        {!mode && (
          <>
            {/* Toolbar */}
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
              {pendingCount > 0 && (
                <button
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-bold transition ${
                    showPendingOnly ? 'border-amber-400 bg-amber-100 text-amber-800' : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                  }`}
                  type="button"
                  onClick={() => setShowPendingOnly((v) => !v)}
                  title="Ver solo fichas pendientes de revisión"
                >
                  {pendingCount} pendiente{pendingCount !== 1 ? 's' : ''}
                </button>
              )}
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
                      onClick={() => { setSelectedId(p.id); setMode('detail'); setError('') }}
                    >
                      <span className="w-24 shrink-0 font-mono text-xs font-bold text-campo-700">{p.code}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold leading-snug text-slate-900 [overflow-wrap:anywhere]">{productDisplayName(p)}</p>
                        <p className="text-[10px] font-semibold text-slate-400 [overflow-wrap:anywhere]">{p.clients?.name || ''}</p>
                      </div>
                      {p.pending_review && (
                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">Pendiente</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-slate-100 px-4 py-2 text-xs font-semibold text-slate-400">
              {filtered.length} producto{filtered.length !== 1 ? 's' : ''} · tocá una ficha para ver su detalle
            </div>
          </>
        )}

        {/* === VISTA DETALLE === */}
        {mode === 'detail' && selectedProduct && (
          <div className="flex flex-1 flex-col overflow-y-auto">
            <div className="flex-1 p-5">
              <div className="mb-4">
                {selectedProduct.pending_review ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Pendiente de revisión
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-campo-100 px-3 py-1 text-xs font-black text-campo-800">
                    <CheckCircle2 size={13} /> Revisada
                  </span>
                )}
              </div>
              <dl className="overflow-hidden rounded-xl border border-slate-200">
                <DetailField label="Código" value={selectedProduct.code} mono />
                <DetailField label="Producto" value={productDisplayName(selectedProduct)} strong />
                <DetailField label="Empresa" value={selectedProduct.clients?.name || '—'} />
                <DetailField
                  label="Presentación"
                  value={selectedProduct.package_size && selectedProduct.package_unit ? `${selectedProduct.package_size} ${selectedProduct.package_unit}` : 'Sin presentación'}
                />
                <DetailField label="Unidades por caja" value={selectedProduct.units_per_box ? String(selectedProduct.units_per_box) : '—'} />
              </dl>
              {error && <p className="mt-3 text-sm font-bold text-red-600">{error}</p>}
            </div>
            <div className="shrink-0 border-t border-slate-100 p-4">
              {selectedProduct.pending_review && (
                <button className="btn-primary mb-2 w-full" type="button" onClick={marcarRevisada}>
                  <CheckCircle2 size={18} /> Marcar como revisada
                </button>
              )}
              <div className="flex gap-2">
                <button className="btn-secondary flex-1" type="button" onClick={handleModificar}>
                  <Edit2 size={16} /> Modificar
                </button>
                <button className="btn-secondary flex-1 text-red-700 hover:bg-red-50" type="button" onClick={handleEliminar} disabled={deleting}>
                  <Trash2 size={16} /> {deleting ? 'Eliminando...' : 'Eliminar'}
                </button>
              </div>
            </div>
          </div>
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
              <span className="text-sm font-bold text-slate-700">Tamaño de presentación</span>
              <div className="mt-1 flex gap-2">
                <input
                  className="input w-28"
                  type="text"
                  inputMode="decimal"
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
            <div>
              <span className="text-sm font-bold text-slate-700">Unidades por caja</span>
              <input
                className="input mt-1 w-28"
                type="text"
                inputMode="numeric"
                value={editForm.units_per_box}
                onChange={(e) => setEditForm((f) => ({ ...f, units_per_box: e.target.value }))}
                placeholder="Ej: 5"
              />
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

function DetailField({ label, value, mono, strong }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0">
      <dt className="shrink-0 text-xs font-bold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`min-w-0 text-right text-sm [overflow-wrap:anywhere] ${mono ? 'font-mono font-bold text-campo-700' : strong ? 'font-black text-slate-900' : 'font-semibold text-slate-700'}`}>{value}</dd>
    </div>
  )
}
