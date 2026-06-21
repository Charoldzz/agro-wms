import { useEffect, useState } from 'react'
import { ArrowLeft, Edit2, Plus, Save, Search, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

const initialNew = { name: '', product_code_prefix: '', contact: '' }
const initialEdit = { name: '', product_code_prefix: '', contact: '' }

function displayName(name) {
  return String(name || '').replaceAll('"', '').replace(/\s+/g, ' ').trim()
}

export default function EmpresasModal({ onClose, onSaved }) {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [mode, setMode] = useState(null) // null | 'new' | 'edit'
  const [newForm, setNewForm] = useState(initialNew)
  const [editForm, setEditForm] = useState(initialEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('clients')
      .select('*')
      .eq('inventory_source', 'stock_independiente')
      .order('name')
    const seen = new Set()
    setClients((data || []).filter((c) => {
      const key = displayName(c.name).toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }))
    setLoading(false)
  }

  const filtered = clients.filter((c) => {
    if (!search) return true
    const s = search.toLowerCase()
    const idx = clients.indexOf(c) + 1
    return String(idx).includes(s) || displayName(c.name).toLowerCase().includes(s)
  })

  function handleModificar() {
    if (!selectedId) {
      setError('Selecciona una empresa de la lista para modificar.')
      return
    }
    const c = clients.find((x) => x.id === selectedId)
    if (!c) return
    setEditForm({ name: c.name || '', product_code_prefix: c.product_code_prefix || '', contact: c.contact || '' })
    setError('')
    setMode('edit')
  }

  async function saveNew(e) {
    e.preventDefault()
    setError('')
    if (!newForm.name.trim()) return setError('El nombre es obligatorio.')
    setSaving(true)
    const prefix = newForm.product_code_prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    const { error: err } = await supabase.from('clients').insert({
      name: newForm.name.trim(),
      inventory_source: 'stock_independiente',
      product_code_prefix: prefix || null,
      contact: newForm.contact.trim() || null,
    })
    setSaving(false)
    if (err) return setError(err.message)
    setMode(null)
    setNewForm(initialNew)
    load()
    onSaved?.()
  }

  async function saveEdit(e) {
    e.preventDefault()
    setError('')
    if (!selectedId) return
    setSaving(true)
    const prefix = editForm.product_code_prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!editForm.name.trim()) return setError('El nombre es obligatorio.')
    const { error: err } = await supabase.from('clients').update({
      name: editForm.name.trim(),
      product_code_prefix: prefix || null,
      contact: editForm.contact.trim() || null,
    }).eq('id', selectedId)
    setSaving(false)
    if (err) return setError(err.message)
    setMode(null)
    setEditForm(initialEdit)
    setSelectedId(null)
    load()
    onSaved?.()
  }

  function cancel() {
    setMode(null)
    setNewForm(initialNew)
    setEditForm(initialEdit)
    setError('')
  }

  const selectedClient = clients.find((c) => c.id === selectedId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex h-[90dvh] max-h-[680px] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-black text-slate-950">
            {mode === 'new' ? 'Nueva empresa' : mode === 'edit' ? `Modificar: ${displayName(selectedClient?.name || '')}` : 'Empresas'}
          </h2>
          <button className="btn-secondary !min-h-9 !p-2" type="button" onClick={mode ? cancel : onClose}>
            {mode ? <ArrowLeft size={18} /> : <X size={18} />}
          </button>
        </div>

        {/* === VISTA TABLA === */}
        {!mode && (
          <>
            {/* Toolbar */}
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-4 py-2.5">
              <button
                className="btn-primary !min-h-9 !px-3 !py-1.5 text-sm"
                type="button"
                onClick={() => { setError(''); setMode('new') }}
              >
                <Plus size={15} /> Nueva
              </button>
              <button
                className="btn-secondary !min-h-9 !px-3 !py-1.5 text-sm"
                type="button"
                onClick={handleModificar}
              >
                <Edit2 size={15} /> Modificar
              </button>
              <div className="relative flex-1">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className="input w-full pl-8 text-sm"
                  placeholder="Buscar codigo o empresa..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Error / hint */}
            {error && (
              <div className="mx-4 mt-2 shrink-0 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                {error}
              </div>
            )}

            {/* Table */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <p className="py-8 text-center text-sm font-bold text-slate-400">Cargando...</p>
              ) : filtered.length === 0 ? (
                <p className="py-8 text-center text-sm font-bold text-slate-400">Sin resultados.</p>
              ) : (
                <table className="w-full border-collapse">
                  <thead className="sticky top-0">
                    <tr className="bg-campo-700 text-white">
                      <th className="w-16 px-4 py-2.5 text-left text-xs font-black uppercase tracking-wide">CÓDIGO</th>
                      <th className="px-4 py-2.5 text-left text-xs font-black uppercase tracking-wide">EMPRESA</th>
                      <th className="w-20 px-3 py-2.5 text-left text-xs font-black uppercase tracking-wide">PREFIJO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c, i) => (
                      <tr
                        key={c.id}
                        className={`cursor-pointer border-b border-slate-100 transition-colors ${
                          selectedId === c.id
                            ? 'bg-campo-100 font-bold'
                            : i % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50 hover:bg-slate-100'
                        }`}
                        onClick={() => { setSelectedId((p) => (p === c.id ? null : c.id)); setError('') }}
                      >
                        <td className="px-4 py-2.5 text-sm font-bold text-slate-400">{i + 1}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-900 [overflow-wrap:anywhere]">{displayName(c.name)}</td>
                        <td className="px-3 py-2.5">
                          {c.product_code_prefix
                            ? <span className="rounded bg-campo-100 px-1.5 py-0.5 font-mono text-xs font-bold text-campo-700">{c.product_code_prefix}</span>
                            : <span className="text-xs text-slate-300">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-slate-100 px-4 py-2 text-xs font-semibold text-slate-400">
              {filtered.length} empresa{filtered.length !== 1 ? 's' : ''}
              {selectedId && <span className="ml-3 font-bold text-campo-700">· {displayName(selectedClient?.name || '')} seleccionada</span>}
            </div>
          </>
        )}

        {/* === FORMULARIO NUEVA === */}
        {mode === 'new' && (
          <form onSubmit={saveNew} className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
            <label className="block">
              <span className="text-sm font-bold text-slate-700">Nombre *</span>
              <input
                className="input mt-1 w-full"
                value={newForm.name}
                onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Nombre de la empresa"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-bold text-slate-700">Prefijo de código</span>
              <input
                className="input mt-1 w-full font-mono uppercase"
                maxLength={8}
                placeholder="Ej: GATB"
                value={newForm.product_code_prefix}
                onChange={(e) => setNewForm((f) => ({ ...f, product_code_prefix: e.target.value }))}
              />
              <p className="mt-1 text-xs text-slate-400">Letras y números. Se usa para generar códigos como GATB-00001.</p>
            </label>
            <label className="block">
              <span className="text-sm font-bold text-slate-700">Contacto</span>
              <input
                className="input mt-1 w-full"
                value={newForm.contact}
                onChange={(e) => setNewForm((f) => ({ ...f, contact: e.target.value }))}
                placeholder="Opcional"
              />
            </label>
            {error && <p className="text-sm font-bold text-red-600">{error}</p>}
            <div className="mt-auto flex gap-3 pt-2">
              <button className="btn-primary flex-1" type="submit" disabled={saving}>
                <Save size={18} /> {saving ? 'Guardando...' : 'Guardar'}
              </button>
              <button className="btn-secondary flex-1" type="button" onClick={cancel}>Cancelar</button>
            </div>
          </form>
        )}

        {/* === FORMULARIO MODIFICAR === */}
        {mode === 'edit' && selectedId && (
          <form onSubmit={saveEdit} className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
            <label className="block">
              <span className="text-sm font-bold text-slate-700">Nombre *</span>
              <input
                className="input mt-1 w-full"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-bold text-slate-700">Prefijo de código</span>
              <input
                className="input mt-1 w-full font-mono uppercase"
                maxLength={8}
                placeholder="Ej: GATB"
                value={editForm.product_code_prefix}
                onChange={(e) => setEditForm((f) => ({ ...f, product_code_prefix: e.target.value }))}
              />
              <p className="mt-1 text-xs text-slate-400">Letras y números. Se usa para generar códigos como GATB-00001.</p>
            </label>
            <label className="block">
              <span className="text-sm font-bold text-slate-700">Contacto</span>
              <input
                className="input mt-1 w-full"
                value={editForm.contact}
                onChange={(e) => setEditForm((f) => ({ ...f, contact: e.target.value }))}
                placeholder="Opcional"
              />
            </label>
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
