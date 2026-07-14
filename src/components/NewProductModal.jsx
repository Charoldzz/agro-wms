import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { unitsPerBoxFromName } from '../lib/display'
import { supabase } from '../lib/supabase'

const UNITS = ['lt', 'ml', 'kg', 'gr']

const SIZE_IN_NAME_RE = /[^a-zA-Z](\d+(?:[.,]\d+)?)\s*(ltrs?|lts?|kgs?|gr|gm|ml|cc|l(?:[^a-zA-Z]|$))|\s[xX×]\s*\d+/i

function cleanPrefix(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

function parseCatalogCode(code) {
  const match = String(code || '').trim().toUpperCase().match(/^([A-Z0-9]+)-(\d+)$/)
  if (!match) return null
  return { prefix: match[1], number: parseInt(match[2], 10), width: match[2].length }
}

// Sufijo de presentación para sugerir en el nombre: "4x5 LT" o "X 20 LT"
function buildNameSuffix(upb, size, unit) {
  const s = String(size || '').trim()
  if (!s || !(Number(s.replace(',', '.')) > 0)) return ''
  const u = String(unit || '').toUpperCase()
  const n = Number(upb)
  return n > 0 ? `${n}x${s} ${u}` : `X ${s} ${u}`
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

export default function NewProductModal({ clients, onClose, onSaved, fixedClientId = '', pendingReview = false }) {
  const [clientId, setClientId] = useState(fixedClientId)
  const [nextCode, setNextCode] = useState('')
  const [name, setName] = useState('')
  const [packageSize, setPackageSize] = useState('')
  const [packageUnit, setPackageUnit] = useState('lt')
  const [unitsPerBox, setUnitsPerBox] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loadingCode, setLoadingCode] = useState(false)

  const selectedClient = clients.find((c) => c.id === clientId)
  // Lo que se muestra acá es EXACTAMENTE lo que se guarda (el nombre completo)
  const productLabel = name.trim().toUpperCase()

  // Opción C (decisión Harold): al llenar presentación/uds por caja, el nombre se
  // autocompleta con el sufijo ("PRUEBA2 4x5 LT") pero queda editable — la última
  // palabra la tiene el humano. Si el usuario escribió su propia presentación en
  // el nombre, no se toca.
  const suffixRef = useRef('')
  useEffect(() => {
    const suffix = buildNameSuffix(unitsPerBox, packageSize, packageUnit)
    if (suffix === suffixRef.current) return
    setName((prev) => {
      const prevTrim = prev.trimEnd()
      let base = prevTrim
      if (suffixRef.current && prevTrim.toUpperCase().endsWith(suffixRef.current.toUpperCase())) {
        base = prevTrim.slice(0, prevTrim.length - suffixRef.current.length).trimEnd()
      } else if (SIZE_IN_NAME_RE.test(prevTrim)) {
        // El usuario ya puso su propia presentación en el nombre: respetarla
        suffixRef.current = suffix
        return prev
      }
      suffixRef.current = suffix
      if (!base.trim()) return prev
      return suffix ? `${base} ${suffix}` : base
    })
  }, [packageSize, packageUnit, unitsPerBox])

  // Si el nombre se escribió DESPUÉS de la presentación, sugerir el sufijo al salir del campo
  function applyNameSuggestion() {
    const suffix = buildNameSuffix(unitsPerBox, packageSize, packageUnit)
    if (!suffix) return
    setName((prev) => {
      const t = prev.trim()
      if (!t || SIZE_IN_NAME_RE.test(t)) return prev
      suffixRef.current = suffix
      return `${t} ${suffix}`
    })
  }

  useEffect(() => {
    if (!clientId) { setNextCode(''); return }
    loadNextCode(clientId, selectedClient?.product_code_prefix)
  }, [clientId, selectedClient?.product_code_prefix])

  // Auto-detectar unidades por caja desde el nombre si el campo está vacío
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

    const { data: created, error: err } = await supabase.from('product_catalog').insert({
      client_id: clientId,
      code: nextCode,
      name: name.trim().toUpperCase(),
      package_size: packageSize ? Number(packageSize) : null,
      package_unit: packageSize ? packageUnit : null,
      units_per_box: unitsPerBox ? Number(unitsPerBox) : null,
      pending_review: Boolean(pendingReview),
    }).select().single()
    setSaving(false)
    if (err) return setError(err.message)
    onSaved?.(created)
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
            {fixedClientId ? (
              <div className="input mt-1 w-full cursor-not-allowed select-none bg-slate-50 font-semibold text-slate-600">
                {clients.find((c) => c.id === fixedClientId)?.name || 'Empresa'}
              </div>
            ) : (
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
            )}
          </div>

          {pendingReview && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
              La ficha quedará pendiente de revisión del administrador.
            </p>
          )}

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
              onBlur={applyNameSuggestion}
              placeholder="Ej: BONDER"
            />
            <p className="mt-1 text-xs font-semibold text-slate-400">
              Al llenar la presentación, el nombre se completa solo — podés corregirlo antes de guardar.
            </p>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700">Tamaño de presentación</label>
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
            <label className="block text-sm font-bold text-slate-700">Unidades por caja</label>
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
