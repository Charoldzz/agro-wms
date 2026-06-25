import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { unitsPerBoxFromName } from '../lib/display'
import { supabase } from '../lib/supabase'

const UNITS = ['lt', 'ml', 'kg', 'g', 'unid', 'caja', 'bolsa', 'saco']

const SIZE_IN_NAME_RE = /[^a-zA-Z](\d+(?:[.,]\d+)?)\s*(ltrs?|lts?|kgs?|gr|gm|ml|cc|l(?:[^a-zA-Z]|$))|\s[xX×]\s*\d+/i

function cleanPrefix(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

function parseCatalogCode(code) {
  const match = String(code || '').trim().toUpperCase().match(/^([A-Z0-9]+)-(\d+)$/)
  if (!match) return null
  return { prefix: match[1], number: parseInt(match[2], 10), width: match[2].length }
}

function nextCodeForClient(existingCodes, fallbackPrefix = '') {
  const parsed = existingCodes
    .map(parseCatalogCode)
    .filter(Boolean)
    .sort((a, b) => b.number - a.number)

  const base = parsed[0]
  const prefix = base?.prefix || cleanPrefix(fallbackPrefix)
  if (!prefix) return ''

  const last = base?.number || 0
  const width = Math.max(base?.width || 5, 5)
  return `${prefix}-${String(last + 1).padStart(width, '0')}`
}

export default function NewProductModal({ clients, onClose, onSaved }) {
  const [clientId, setClientId] = useState('')
  const [nextCode, setNextCode] = useState('')
  const [name, setName] = useState('')
  const [packageSize, setPackageSize] = useState('')
  const [packageUnit, setPackageUnit] = useState('lt')
  const [unitsPerBox, setUnitsPerBox] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loadingCode, setLoadingCode] = useState(false)

  const selectedClient = clients.find((c) => c.id === clientId)
  const productLabel = name
    ? SIZE_IN_NAME_RE.test(name)
      ? name.toUpperCase()
      : packageSize
        ? `${name.toUpperCase()} X ${packageSize} ${packageUnit}`
        : name.toUpperCase()
    : ''

  useEffect(() => {
    if (!clientId) { setNextCode(''); return }
    loadNextCode(clientId, selectedClient?.product_code_prefix)
  }, [clientId, selectedClient?.product_code_prefix])

  // Auto-detectar envases por caja desde el nombre si el campo está vacío
  useEffect(() => {
    const detected = unitsPerBoxFromName(name)
    if (detected > 0 && !unitsPerBox) setUnitsPerBox(String(detected))
  }, [name])

  async function loadNextCode(cid, fallbackPrefix) {
    setLoadingCode(true)
    const prefix = cleanPrefix(fallbackPrefix)
    const query = prefix
      ? supabase.from('product_catalog').select('code').ilike('code', `${prefix}-%`)
      : supabase.from('product_catalog').select('code').eq('client_id', cid)
    const { data } = await query
    const codes = (data || []).map((r) => r.code)
    setNextCode(nextCodeForClient(codes, fallbackPrefix))
    setLoadingCode(false)
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    if (!clientId) return setError('Selecciona una empresa.')
    if (!name.trim()) return setError('Escribe el nombre del producto.')
    if (loadingCode) return setError('Espera a que se genere el codigo.')
    if (!nextCode) return setError('No se pudo generar el codigo.')

    setSaving(true)

    const { error: err } = await supabase.from('product_catalog').insert({
      client_id: clientId,
      code: nextCode,
      name: name.trim().toUpperCase(),
      package_size: packageSize ? Number(packageSize) : null,
      package_unit: packageSize ? packageUnit : null,
      units_per_box: unitsPerBox ? Number(unitsPerBox) : null,
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
            <input
              className="input mt-1 w-full bg-slate-50 font-mono text-slate-500"
              type="text"
              value={loadingCode ? 'Cargando...' : nextCode}
              readOnly
              placeholder="Se genera automaticamente"
            />
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
            <label className="block text-sm font-bold text-slate-700">Medida por envase</label>
            <div className="mt-1 flex gap-2">
              <input
                className="input w-32"
                type="text"
                inputMode="decimal"
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

          <div>
            <label className="block text-sm font-bold text-slate-700">Envases por caja</label>
            <input
              className="input mt-1 w-32"
              type="text"
              inputMode="numeric"
              value={unitsPerBox}
              onChange={(e) => setUnitsPerBox(e.target.value)}
              placeholder="Ej: 5"
            />
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
