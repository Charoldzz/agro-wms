import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../lib/supabase'

const UNITS = ['lt', 'ml', 'kg', 'g', 'unid', 'caja', 'bolsa', 'saco']
const PREFIX_STOP_WORDS = new Set(['S', 'SA', 'SAS', 'SRL', 'LTDA', 'BOLIVIA', 'TOTAL', 'AGRO'])

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function cleanPrefix(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

function suggestPrefix(name) {
  const words = String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !PREFIX_STOP_WORDS.has(word))

  const firstLong = words.find((word) => word.length >= 4)
  if (firstLong) return cleanPrefix(firstLong.slice(0, 4))

  return cleanPrefix(words.map((word) => word[0]).join('').slice(0, 4))
}

function nextCodeForPrefix(existingCodes, prefix) {
  const escaped = escapeRegExp(prefix)
  const nums = existingCodes
    .map((c) => {
      const match = String(c).match(new RegExp(`^${escaped}-(\\d+)$`, 'i'))
      return match ? parseInt(match[1], 10) : 0
    })
    .filter((n) => n > 0)
  const last = nums.length ? Math.max(...nums) : 0
  return `${prefix}-${String(last + 1).padStart(5, '0')}`
}

export default function NewProductModal({ clients, onClose, onSaved }) {
  const [clientId, setClientId] = useState('')
  const [prefix, setPrefix] = useState('')
  const [nextCode, setNextCode] = useState('')
  const [name, setName] = useState('')
  const [packageSize, setPackageSize] = useState('')
  const [packageUnit, setPackageUnit] = useState('lt')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loadingCode, setLoadingCode] = useState(false)

  const selectedClient = clients.find((c) => c.id === clientId)
  const productLabel = name && packageSize
    ? `${name.toUpperCase()} X ${packageSize} ${packageUnit}`
    : name
      ? name.toUpperCase()
      : ''

  useEffect(() => {
    if (!clientId) {
      setNextCode('')
      setPrefix('')
      return
    }

    const p = cleanPrefix(selectedClient?.product_code_prefix || suggestPrefix(selectedClient?.name))
    setPrefix(p)
    if (!p) {
      setNextCode('')
      return
    }
    loadNextCode(p)
  }, [clientId, selectedClient?.product_code_prefix, selectedClient?.name])

  async function loadNextCode(p) {
    setLoadingCode(true)
    const { data } = await supabase
      .from('product_catalog')
      .select('code')
      .ilike('code', `${p}-%`)
    const codes = (data || []).map((r) => r.code)
    setNextCode(nextCodeForPrefix(codes, p))
    setLoadingCode(false)
  }

  function handlePrefixChange(value) {
    const p = cleanPrefix(value)
    setPrefix(p)
    setNextCode('')
    if (p) loadNextCode(p)
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    if (!clientId) return setError('Selecciona una empresa.')
    const finalPrefix = cleanPrefix(prefix)
    if (!finalPrefix) return setError('Define un prefijo de codigo para esta empresa.')
    if (!name.trim()) return setError('Escribe el nombre del producto.')
    if (loadingCode) return setError('Espera a que se genere el codigo.')
    if (!nextCode) return setError('No se pudo generar el codigo.')
    if (!nextCode.startsWith(`${finalPrefix}-`)) return setError('El codigo no coincide con el prefijo elegido.')

    setSaving(true)

    if (cleanPrefix(selectedClient?.product_code_prefix) !== finalPrefix) {
      const { error: prefixError } = await supabase
        .from('clients')
        .update({ product_code_prefix: finalPrefix })
        .eq('id', clientId)

      if (prefixError) {
        setSaving(false)
        return setError(prefixError.message)
      }
    }

    const { error: err } = await supabase.from('product_catalog').insert({
      client_id: clientId,
      code: nextCode,
      name: name.trim().toUpperCase(),
      package_size: packageSize ? Number(packageSize) : null,
      package_unit: packageSize ? packageUnit : null,
    })
    setSaving(false)
    if (err) return setError(err.message)
    onSaved?.()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-black text-slate-950">Nuevo producto</h2>
          <button className="btn-secondary !min-h-9 !p-2" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4 p-5">
          <div>
            <label className="block text-sm font-bold text-slate-700">Empresa</label>
            <select
              className="input mt-1 w-full"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">Seleccionar empresa...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700">Codigo</label>
            <div className="mt-1 grid grid-cols-[minmax(0,0.45fr)_minmax(0,0.55fr)] gap-2">
              <input
                className="input w-full font-mono uppercase"
                type="text"
                value={prefix}
                onChange={(e) => handlePrefixChange(e.target.value)}
                placeholder="Prefijo"
                disabled={!clientId}
                maxLength={8}
              />
              <input
                className="input w-full bg-slate-50 font-mono text-slate-500"
                type="text"
                value={loadingCode ? 'Cargando...' : nextCode}
                readOnly
                placeholder="Codigo"
              />
            </div>
            {clientId && !selectedClient?.product_code_prefix && prefix && (
              <p className="mt-1 text-xs font-semibold text-amber-600">
                Este prefijo se guardara en la empresa para los proximos productos.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700">Nombre</label>
            <input
              className="input mt-1 w-full"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: BONDER"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700">Medida</label>
            <div className="mt-1 flex gap-2">
              <input
                className="input w-32"
                type="number"
                min="0"
                step="any"
                value={packageSize}
                onChange={(e) => setPackageSize(e.target.value)}
                placeholder="Ej: 20"
              />
              <select
                className="input flex-1"
                value={packageUnit}
                onChange={(e) => setPackageUnit(e.target.value)}
              >
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          {productLabel && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
              Se guardara como: <span className="font-black text-slate-900">{productLabel}</span>
            </p>
          )}

          {error && <p className="text-sm font-bold text-red-600">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button className="btn-primary flex-1" type="submit" disabled={saving || loadingCode}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button className="btn-secondary flex-1" type="button" onClick={onClose}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
