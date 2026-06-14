import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import NewProductModal from './NewProductModal'

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
  const [showNew, setShowNew] = useState(false)

  const clientsWithPrefix = (clients || []).filter((c) => c.product_code_prefix)

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

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="flex h-[90dvh] max-h-[680px] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">

          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-black text-slate-950">Catálogo de productos</h2>
            <button className="btn-secondary !min-h-9 !p-2" type="button" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          {/* Toolbar */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-campo-200 bg-campo-100 px-3 py-1.5 text-xs font-bold text-campo-800 shadow-sm transition hover:bg-campo-200 active:scale-[0.98]"
              type="button"
              onClick={() => setShowNew(true)}
            >
              <Plus size={14} />
              Producto
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
            <select
              className="input text-sm sm:w-40"
              value={filterClient}
              onChange={(e) => setFilterClient(e.target.value)}
            >
              <option value="">Todas</option>
              {(clients || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <p className="py-8 text-center text-sm font-bold text-slate-400">Cargando...</p>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-sm font-bold text-slate-400">Sin productos.</p>
            ) : (
              <table className="w-full border-collapse">
                <thead className="sticky top-0">
                  <tr className="bg-campo-700 text-white">
                    <th className="w-28 px-4 py-2.5 text-left text-xs font-black uppercase tracking-wide">CÓDIGO</th>
                    <th className="px-4 py-2.5 text-left text-xs font-black uppercase tracking-wide">PRODUCTO</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p, i) => (
                    <tr key={p.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="px-4 py-2.5 font-mono text-sm font-bold text-campo-700 whitespace-nowrap">{p.code}</td>
                      <td className="px-4 py-2.5">
                        <p className="text-sm font-bold text-slate-900">{productDisplayName(p)}</p>
                        <p className="text-xs font-semibold text-slate-400">{p.clients?.name || ''}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-slate-100 px-4 py-2 text-xs font-semibold text-slate-400">
            {filtered.length} producto{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {showNew && (
        <NewProductModal
          clients={clientsWithPrefix}
          onClose={() => setShowNew(false)}
          onSaved={load}
        />
      )}
    </>
  )
}
