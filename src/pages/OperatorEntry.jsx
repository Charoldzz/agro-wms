import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { CheckCircle2, PackagePlus, Plus, Trash2 } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'
import { formatNumber } from '../lib/format'
import { vibrateSuccess } from '../lib/haptics'
import { desgloseEnvases } from '../lib/envases'
import { catalogClientIds } from '../lib/catalogo'
import NewProductModal from '../components/NewProductModal'

const today = new Date().toISOString().slice(0, 10)
const DRAFT_KEY = 'draft_ingreso'

// Detecta si el nombre ya tiene unidad explícita (ej: "X 5 LTS.")
const SIZE_WITH_UNIT_RE = /[^a-zA-Z](\d+(?:[.,]\d+)?)\s*(ltrs?|lts?|kgs?|gr|gm|ml|cc|l(?:[^a-zA-Z]|$))/i
// Detecta si el nombre tiene "x N" sin unidad (ej: "PRUEBA FC x 5")
const BARE_X_N_RE = /\s[xX×]\s*\d+/i

function productDisplayName(p) {
  if (!p.name) return ''
  if (SIZE_WITH_UNIT_RE.test(p.name)) return p.name              // ya tiene unidad → tal cual
  if (p.package_size && p.package_unit) {
    if (BARE_X_N_RE.test(p.name)) return `${p.name} ${p.package_unit}` // x N sin unidad → agregar solo unidad
    return `${p.name} X ${p.package_size} ${p.package_unit}`    // sin medida → agregar todo
  }
  return p.name
}

function emptyRow() {
  return { id: crypto.randomUUID(), product: '', lot_code: '', expiry_date: '', cantidad: '', uds: '', uds_rem: '', cajas: '', cajas_rem: '', galones: '', bidones: '', tambores: '', pallets: '' }
}

function createLotCode(index = 0) {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  return index ? `ING-${stamp}-${index + 1}` : `ING-${stamp}`
}

function displayClientName(name) {
  return String(name || '').replaceAll('"', '').replace(/\s+/g, ' ').trim()
}

// Convierte YYYY-MM-DD → DD/MM/YYYY para mostrar
function isoToDisplay(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// Input de fecha enmascarado DD/MM/AAAA — almacena YYYY-MM-DD
// Acepta 6 dígitos (DD/MM/AA → año 20AA) o 8 dígitos (DD/MM/AAAA)
function DateInput({ value, onChange, onFocus, className }) {
  const [display, setDisplay] = useState(() => isoToDisplay(value))
  const isTypingRef = useRef(false)

  // Sincroniza el display cuando el valor cambia externamente (restaurar borrador, limpiar fila)
  useEffect(() => {
    if (isTypingRef.current) { isTypingRef.current = false; return }
    setDisplay(value ? isoToDisplay(value) : '')
  }, [value])

  function handleChange(e) {
    isTypingRef.current = true
    const digits = e.target.value.replace(/\D/g, '').slice(0, 8)
    let fmt = digits
    if (digits.length > 4) fmt = `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4)}`
    else if (digits.length > 2) fmt = `${digits.slice(0,2)}/${digits.slice(2)}`
    setDisplay(fmt)
    if (digits.length === 8) {
      const d = digits.slice(0,2), m = digits.slice(2,4), y = digits.slice(4,8)
      onChange(`${y}-${m}-${d}`)
    } else if (digits.length === 6) {
      // Año abreviado: DD/MM/AA → 20AA (ej: "28" → "2028")
      const d = digits.slice(0,2), m = digits.slice(2,4), yy = digits.slice(4,6)
      onChange(`20${yy}-${m}-${d}`)
    } else {
      onChange('')
    }
  }

  return (
    <input
      className={className}
      value={display}
      placeholder="DD/MM/AAAA"
      onChange={handleChange}
      onFocus={onFocus}
      maxLength={10}
      inputMode="numeric"
    />
  )
}


export default function OperatorEntry() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, isAdmin } = useAuth()
  const tableRef = useRef(null)

  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [guiaPreview, setGuiaPreview] = useState('')
  const [contacto, setContacto] = useState('')
  const [transportista, setTransportista] = useState('')
  const [placa, setPlaca] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [rows, setRows] = useState([emptyRow()])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [products, setProducts] = useState([])
  const [catalogMap, setCatalogMap] = useState(new Map()) // label → units_per_box
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [newProductRowId, setNewProductRowId] = useState(null)
  const restoringRef = useRef(false)

  // Cargar preview del número de guía automático
  useEffect(() => {
    supabase.rpc('preview_next_warehouse_guide', { p_type: 'ing' })
      .then(({ data }) => { if (data) setGuiaPreview(data) })
  }, [])

  // Restaurar borrador solo en F5 o navegación "atrás"; limpiar en navegación fresca
  useEffect(() => {
    const navType = performance.getEntriesByType?.('navigation')?.[0]?.type
    const prevKey = sessionStorage.getItem('ingreso_loc_key')
    const isReload = navType === 'reload'
    const isBackNav = prevKey !== null && prevKey === location.key
    sessionStorage.setItem('ingreso_loc_key', location.key)

    if (isReload || isBackNav) {
      try {
        const saved = localStorage.getItem(DRAFT_KEY)
        if (saved) {
          const d = JSON.parse(saved)
          if (d.clientId) { restoringRef.current = true; setClientId(d.clientId) }
          if (d.contacto) setContacto(d.contacto)
          if (d.transportista) setTransportista(d.transportista)
          if (d.placa) setPlaca(d.placa)
          if (d.observaciones) setObservaciones(d.observaciones)
          if (d.rows?.length) setRows(d.rows)
        }
      } catch {}
    } else {
      localStorage.removeItem(DRAFT_KEY)
    }
  }, [])

  // Guardar borrador en cada cambio
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ clientId, contacto, transportista, placa, observaciones, rows }))
  }, [clientId, contacto, transportista, placa, observaciones, rows])

  useEffect(() => { loadClients() }, [])

  useEffect(() => {
    if (clientId) loadClientProducts(clientId)
    else setProducts([])
  }, [clientId])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'F12') { e.preventDefault(); addRow() }
      if (e.key === 'F10') { e.preventDefault(); removeSelectedRow() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function loadClients() {
    const { data } = await supabase
      .from('clients')
      .select('id, name, product_code_prefix')
      .eq('inventory_source', 'stock_independiente')
      .order('name')
    const seen = new Set()
    setClients((data || []).filter((c) => {
      const key = displayClientName(c.name).toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }))
  }

  async function loadClientProducts(cid) {
    const catalogIds = await catalogClientIds(cid)
    const { data } = await supabase
      .from('product_catalog')
      .select('code, name, package_size, package_unit, units_per_box')
      .in('client_id', catalogIds)
      .order('name')
    const map = new Map()
    const items = (data || []).map((p) => {
      const label = productDisplayName(p)
      map.set(label, {
        upb: Number(p.units_per_box) || 0,
        size: Number(p.package_size) || 0,
        unit: p.package_unit || '',
        code: p.code || '',
      })
      return label
    })
    setCatalogMap(map)
    setProducts([...new Set(items)].sort())
    // Al cambiar de empresa se vacía el carrito (los productos son de la empresa anterior)
    if (!restoringRef.current) {
      setRows([emptyRow()])
      setSelectedIdx(0)
    }
    restoringRef.current = false
  }

  function addRow() {
    setRows((r) => {
      const next = [...r, emptyRow()]
      setSelectedIdx(next.length - 1)
      return next
    })
  }

  function removeSelectedRow() {
    if (rows.length <= 1) return
    setRows((r) => {
      const next = r.filter((_, i) => i !== selectedIdx)
      setSelectedIdx(Math.max(0, selectedIdx - 1))
      return next
    })
  }

  function removeRow(id) {
    if (rows.length <= 1) return
    const index = rows.findIndex((r) => r.id === id)
    setRows((r) => r.filter((row) => row.id !== id))
    setSelectedIdx((prev) => Math.max(0, index <= prev ? prev - 1 : prev))
  }

  function clearDraft() { localStorage.removeItem(DRAFT_KEY) }

  function updateRow(id, field, value) {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, [field]: value } : row)))
  }

  // Presentación del producto: SOLO del catálogo (dato cargado y verificado).
  // Sin dato no se adivina: la fila avisa y el guardado se bloquea.
  function productInfo(name) {
    const cat = catalogMap.get(name)
    if (cat && cat.size > 0) return { size: cat.size, unit: cat.unit, upb: cat.upb, code: cat.code }
    return { size: 0, unit: '', upb: cat?.upb || 0, code: cat?.code || '' }
  }

  function updateCantidad(id, value) {
    const v = value.replace(',', '.')
    if (!/^\d*\.?\d*$/.test(v)) return
    const qty = Number(v || 0)
    setRows((r) => r.map((row) => {
      if (row.id !== id) return row
      const { size, upb } = productInfo(row.product)
      const uds = size > 0 && qty > 0 ? Math.floor(qty / size) : (qty > 0 ? qty : 0)
      const uds_rem = size > 0 && qty > 0 && uds > 0 ? Math.round((qty - uds * size) * 1000) / 1000 : 0
      const cajas = upb > 0 && uds > 0 ? Math.floor(uds / upb) : 0
      return {
        ...row,
        cantidad: v,
        uds: uds > 0 ? String(uds) : '',
        uds_rem: uds_rem > 0 ? String(uds_rem) : '',
        cajas: upb > 0 && uds > 0 ? String(cajas) : row.cajas,
        cajas_rem: upb > 0 && uds > 0 ? String(uds % upb) : '',
      }
    }))
  }

  function updateProduct(id, value) {
    setRows((r) => r.map((row) => {
      if (row.id !== id) return row
      const qty = Number(row.cantidad || 0)
      const { size, upb } = productInfo(value)
      const uds = size > 0 && qty > 0 ? Math.floor(qty / size) : (qty > 0 ? qty : 0)
      const uds_rem = size > 0 && qty > 0 && uds > 0 ? Math.round((qty - uds * size) * 1000) / 1000 : 0
      const cajas = upb > 0 && uds > 0 ? Math.floor(uds / upb) : 0
      return {
        ...row,
        product: value,
        uds: uds > 0 ? String(uds) : row.uds,
        uds_rem: uds_rem > 0 ? String(uds_rem) : '',
        cajas: upb > 0 && uds > 0 ? String(cajas) : row.cajas,
        cajas_rem: upb > 0 && uds > 0 ? String(uds % upb) : '',
      }
    }))
  }

  const unitTotals = useMemo(() => {
    const totals = {}
    rows.forEach((r) => {
      const qty = Number(r.cantidad || 0)
      const { unit } = productInfo(r.product)
      // CANTIDAD ya es el equivalente total (lts/kgs), no multiplicar
      if (unit && qty > 0) totals[unit] = (totals[unit] || 0) + qty
    })
    return totals
  }, [rows])

  async function save() {
    setError('')
    if (!clientId) { setError('Selecciona la empresa.'); return }
    if (!contacto.trim()) { setError('El contacto es obligatorio.'); return }
    if (!transportista.trim()) { setError('El transportista es obligatorio.'); return }
    if (!placa.trim()) { setError('La placa es obligatoria.'); return }
    const validRows = rows.filter((r) => r.product?.trim() && Number(r.cantidad || 0) > 0)
    if (validRows.length === 0) { setError('Agrega al menos un item con producto y cantidad.'); return }


    setSaving(true)
    try {
      const items = validRows.map((r, i) => {
        const { size, unit, upb, code } = productInfo(r.product)
        const totalEq = Number(r.cantidad || 0)
        // CANTIDAD es el total en lts/kgs; las unidades exactas conservan el equivalente
        const unidadesExactas = size > 0 ? totalEq / size : totalEq
        const cajas = upb > 0 ? Math.floor(Math.floor(unidadesExactas) / upb) : 0
        const sueltas = Math.round((unidadesExactas - cajas * upb) * 1000) / 1000
        return {
          lot_code: r.lot_code?.trim() || createLotCode(i),
          product: r.product.trim(),
          product_code: code || null,
          box_count: cajas,
          units_per_box: cajas > 0 ? upb : 0,
          loose_units: sueltas,
          package_size: size || null,
          package_unit: unit || null,
          // Ubicación única por ahora; las ubicaciones internas (H1, H2...) quedan
          // para más adelante — decisión Harold 2026-07-13
          location: 'Deposito Warnes',
          expiry_date: r.expiry_date || null,
        }
      })

      const notasFinal = observaciones.trim() || null
      const { error: rpcError } = await supabase.rpc('create_entry_operation', {
        p_client_id: clientId,
        p_driver_name: transportista.trim() || null,
        p_driver_document: contacto.trim() || null,
        p_vehicle_plate: placa.trim() || null,
        p_entry_date: today,
        p_photo_url: null,
        p_notes: notasFinal,
        p_items: items,
        p_user_id: user.id,
      })

      if (rpcError) throw rpcError

      clearDraft()
      vibrateSuccess()
      setSuccess(true)
      setTimeout(() => navigate(-1), 2200)
    } catch (err) {
      setError(err.message?.includes('duplicate') ? 'Uno de los lotes ya existe. Revisa los codigos de lote.' : (err.message || 'Error al guardar.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader title="Ingreso" subtitle="Nota de ingreso de mercadería" />

      <section className="panel mb-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Empresa</span>
          <select className="input mt-1" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
            <option value="">Seleccionar empresa</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{displayClientName(c.name)}</option>
            ))}
          </select>
        </label>
        <div>
          <span className="label">Fecha</span>
          <div className="input mt-1 cursor-not-allowed select-none bg-slate-100 font-semibold text-slate-600">{today}</div>
        </div>
        <div>
          <span className="label">N° Guía</span>
          <div className="input mt-1 cursor-not-allowed select-none bg-slate-100 font-mono font-bold text-campo-700">{guiaPreview || '...'}</div>
        </div>
        <label className="block">
          <span className="label">Contacto</span>
          <input className="input mt-1" value={contacto} onChange={(e) => setContacto(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Transportista</span>
          <input className="input mt-1" value={transportista} onChange={(e) => setTransportista(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Placa</span>
          <input className="input mt-1 uppercase" value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Observaciones</span>
          <input className="input mt-1" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
        </label>
      </section>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className="btn-primary !min-h-10 !px-4 !py-2 text-sm" type="button" onClick={addRow}>
          <Plus size={17} /> Agregar item <span className="hidden sm:inline">(F12)</span>
        </button>
        <button
          className="btn-secondary hidden !min-h-10 !px-4 !py-2 text-sm sm:flex"
          type="button"
          onClick={removeSelectedRow}
          disabled={rows.length <= 1}
        >
          <Trash2 size={17} /> Quitar seleccionado (F10)
        </button>
      </div>

      {/* ── Tabla desktop ── */}
      <div className="mb-4 hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm sm:block" ref={tableRef}>
        <table className="w-full border-collapse" style={{ minWidth: '900px', tableLayout: 'fixed' }}>
          <thead>
            <tr className="bg-campo-700 text-white">
              <th className="border-b border-campo-600 px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wide" style={{width:'36px'}}>N°</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-left text-xs font-bold uppercase tracking-wide">PRODUCTO</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wide" style={{width:'100px'}}>LOTE</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wide" style={{width:'120px'}}>VENC</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'80px'}}>CANTIDAD</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'150px'}}>UNIDADES</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'120px'}}>CAJAS</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'68px'}}>PALLETS</th>
              <th className="border-b border-campo-600 px-1 py-2.5" style={{width:'32px'}}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.id}
                className={`cursor-pointer border-b border-slate-100 transition-colors ${selectedIdx === i ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : 'hover:bg-slate-50'}`}
                onClick={() => setSelectedIdx(i)}
              >
                <td className="px-2 py-1 text-center text-sm font-bold text-slate-500">{i + 1}</td>
                <td className="px-2 py-1">
                  <div className="relative">
                    <div className={`w-full truncate rounded border border-transparent py-1 pl-1.5 pr-5 text-sm ${row.product ? 'text-slate-800' : 'text-slate-400'} ${!clientId ? 'opacity-40' : ''}`}>
                      {row.product || '—'}
                    </div>
                    <select
                      className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                      value={row.product}
                      onChange={(e) => {
                        if (e.target.value === '__nuevo__') { setNewProductRowId(row.id); return }
                        updateProduct(row.id, e.target.value)
                      }}
                      onFocus={() => setSelectedIdx(i)}
                      disabled={!clientId}
                      title={row.product}
                    >
                      <option value="">—</option>
                      {products.map((p) => <option key={p} value={p}>{p}</option>)}
                      <option value="__nuevo__">＋ Producto nuevo...</option>
                    </select>
                    <span className="pointer-events-none absolute inset-y-0 right-1 flex items-center text-slate-400">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
                    </span>
                  </div>
                </td>
                <td className="px-2 py-1">
                  <input
                    className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-center text-sm focus:border-campo-400 focus:bg-white focus:outline-none"
                    value={row.lot_code}
                    onChange={(e) => updateRow(row.id, 'lot_code', e.target.value)}
                    onFocus={() => setSelectedIdx(i)}
                  />
                </td>
                <td className="px-2 py-1">
                  <DateInput
                    className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-xs focus:border-campo-400 focus:bg-white focus:outline-none"
                    value={row.expiry_date || ''}
                    onChange={(v) => updateRow(row.id, 'expiry_date', v)}
                    onFocus={() => setSelectedIdx(i)}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-right text-sm font-bold focus:border-campo-400 focus:bg-white focus:outline-none"
                    inputMode="decimal"
                    value={row.cantidad}
                    onChange={(e) => updateCantidad(row.id, e.target.value)}
                    onFocus={() => setSelectedIdx(i)}
                    placeholder="0"
                  />
                </td>
                {(() => {
                  const { size, unit, upb } = productInfo(row.product)
                  const d = desgloseEnvases(row.cantidad, size, unit, upb)
                  return (
                    <>
                      <td className="px-2 py-1.5 text-right">
                        {d.unidadesLabel
                          ? <span className="text-sm font-bold leading-snug text-campo-700">{d.unidadesLabel}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {d.cajasLabel
                          ? <span className="text-sm font-bold leading-snug text-slate-700">{d.cajasLabel}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                    </>
                  )
                })()}
                <td className="px-2 py-1">
                  <input
                    className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-right text-sm focus:border-campo-400 focus:bg-white focus:outline-none"
                    inputMode="decimal"
                    value={row.pallets}
                    onChange={(e) => {
                      const v = e.target.value.replace(',', '.')
                      if (/^\d*\.?\d*$/.test(v)) updateRow(row.id, 'pallets', v)
                    }}
                    onFocus={() => setSelectedIdx(i)}
                    placeholder="0"
                  />
                </td>
                <td className="px-1 py-1 text-center">
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded text-slate-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-30"
                    onClick={(e) => { e.stopPropagation(); removeRow(row.id) }}
                    disabled={rows.length <= 1}
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Tarjetas mobile ── */}
      <div className="mb-4 space-y-3 sm:hidden">
        {rows.map((row, i) => (
          <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-black text-slate-400">ITEM #{i + 1}</span>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded text-slate-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-30"
                onClick={() => removeRow(row.id)}
                disabled={rows.length <= 1}
              >
                <Trash2 size={14} />
              </button>
            </div>

            <select
              className="input mb-3 w-full text-sm disabled:opacity-40"
              value={row.product}
              onChange={(e) => {
                if (e.target.value === '__nuevo__') { setNewProductRowId(row.id); return }
                updateProduct(row.id, e.target.value)
              }}
              disabled={!clientId}
            >
              <option value="">—</option>
              {products.map((p) => <option key={p} value={p}>{p}</option>)}
              <option value="__nuevo__">＋ Producto nuevo...</option>
            </select>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs font-bold text-slate-500">LOTE</span>
                <input
                  className="input mt-1 w-full text-sm"
                  value={row.lot_code}
                  onChange={(e) => updateRow(row.id, 'lot_code', e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-slate-500">VENCIMIENTO</span>
                <DateInput
                  className="input mt-1 w-full text-sm"
                  value={row.expiry_date || ''}
                  onChange={(v) => updateRow(row.id, 'expiry_date', v)}
                />
              </label>
            </div>

            <label className="mb-3 block">
              <span className="text-xs font-bold uppercase text-slate-500">
                {(() => { const { size, unit } = productInfo(row.product); return unit ? `CANTIDAD (× ${size} ${unit})` : 'CANTIDAD' })()}
              </span>
              <input
                className="input mt-1 w-full text-right font-bold text-sm"
                inputMode="decimal"
                value={row.cantidad}
                onChange={(e) => updateCantidad(row.id, e.target.value)}
                placeholder="0"
              />
            </label>

            {(() => {
              const { size, unit, upb } = productInfo(row.product)
              const d = desgloseEnvases(row.cantidad, size, unit, upb)
              return (d.unidadesLabel || d.cajasLabel) ? (
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-campo-50 px-3 py-2">
                    <p className="text-[10px] font-black uppercase text-campo-600">Unidades</p>
                    <p className="text-sm font-bold text-campo-800">{d.unidadesLabel || '—'}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-black uppercase text-slate-500">Cajas</p>
                    <p className="text-sm font-bold text-slate-700">{d.cajasLabel || '—'}</p>
                  </div>
                </div>
              ) : null
            })()}
            <label className="block">
              <span className="text-xs font-bold uppercase text-slate-400">Pallets</span>
              <input
                className="input mt-1 w-full text-right text-sm"
                inputMode="decimal"
                value={row.pallets}
                onChange={(e) => {
                  const v = e.target.value.replace(',', '.')
                  if (/^\d*\.?\d*$/.test(v)) updateRow(row.id, 'pallets', v)
                }}
                placeholder="0"
              />
            </label>
          </div>
        ))}

        <div className="rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3">
          <p className="mb-2 text-xs font-black uppercase text-slate-500">Totales por unidad</p>
          {Object.keys(unitTotals).length > 0
            ? <div className="flex flex-wrap gap-4 mb-2">
                {Object.entries(unitTotals).map(([u, v]) => (
                  <div key={u} className="text-center">
                    <p className="text-lg font-black text-campo-700">{formatNumber(v)}</p>
                    <p className="text-xs font-bold uppercase text-campo-500">{u}</p>
                  </div>
                ))}
              </div>
            : <p className="text-sm text-slate-400 mb-2">Sin cantidades ingresadas</p>}
        </div>
      </div>

      {error ? <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

      {success ? (
        <div className="mb-4 rounded-xl border border-campo-200 bg-campo-50 p-5 text-center">
          <CheckCircle2 className="mx-auto mb-2 text-campo-700" size={38} />
          <p className="text-base font-black text-campo-800">Ingreso guardado correctamente.</p>
          <p className="mt-1 text-sm font-semibold text-campo-600">Redirigiendo...</p>
        </div>
      ) : (
        <div className="flex gap-3">
          <button className="btn-primary flex-1" type="button" onClick={save} disabled={saving}>
            <PackagePlus size={20} /> {saving ? 'Guardando...' : 'Guardar'}
          </button>
          <button className="btn-secondary flex-1" type="button" onClick={() => { clearDraft(); navigate(-1) }} disabled={saving}>
            Cancelar
          </button>
        </div>
      )}

      {newProductRowId && (
        <NewProductModal
          clients={clients}
          fixedClientId={clientId}
          pendingReview={!isAdmin}
          onClose={() => setNewProductRowId(null)}
          onSaved={async (created) => {
            const rowId = newProductRowId
            restoringRef.current = true
            await loadClientProducts(clientId)
            if (created) updateProduct(rowId, productDisplayName(created))
          }}
        />
      )}
    </div>
  )
}
