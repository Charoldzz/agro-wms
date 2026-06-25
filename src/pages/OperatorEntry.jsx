import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, PackagePlus, Plus, Trash2 } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'
import { formatNumber } from '../lib/format'
import { internalLocations } from '../lib/locations'
import { vibrateSuccess } from '../lib/haptics'

const today = new Date().toISOString().slice(0, 10)

const SIZE_IN_NAME_RE = /[^a-zA-Z](\d+(?:[.,]\d+)?)\s*(ltrs?|lts?|kgs?|gr|gm|ml|cc|l(?:[^a-zA-Z]|$))|\s[xX×]\s*\d+/i

function productDisplayName(p) {
  if (!p.name) return ''
  if (p.package_size && p.package_unit && !SIZE_IN_NAME_RE.test(p.name))
    return `${p.name} X ${p.package_size} ${p.package_unit}`
  return p.name
}

function parseProductUnit(productName) {
  if (!productName) return { size: 1, unit: '' }
  // Match patterns like "X 10 Kgs", "x 5 Lts.", "X 20 L", "x 1 Lt."
  const match = productName.match(/[xX×]\s*([\d.,]+)\s*(lts?\.?|kgs?\.?|l\.?)\b/i)
  if (!match) return { size: 1, unit: '' }
  const size = parseFloat(match[1].replace(',', '.'))
  const raw = match[2].toLowerCase().replace('.', '')
  const unit = /^l(ts?)?$/.test(raw) ? 'lts' : /^kgs?$/.test(raw) ? 'kgs' : ''
  return { size: isNaN(size) ? 1 : size, unit }
}

function emptyRow() {
  return { id: crypto.randomUUID(), product: '', lot_code: '', expiry_date: '', cantidad: '', cajas: '', uds: '', galones: '', bidones: '', tambores: '', pallets: '' }
}

function createLotCode(index = 0) {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  return index ? `ING-${stamp}-${index + 1}` : `ING-${stamp}`
}

function displayClientName(name) {
  return String(name || '').replaceAll('"', '').replace(/\s+/g, ' ').trim()
}


export default function OperatorEntry() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const tableRef = useRef(null)

  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [contacto, setContacto] = useState('')
  const [transportista, setTransportista] = useState('')
  const [placa, setPlaca] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [rows, setRows] = useState([emptyRow()])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [products, setProducts] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

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
      .select('id, name')
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
    const { data } = await supabase
      .from('product_catalog')
      .select('name, package_size, package_unit')
      .eq('client_id', cid)
      .order('name')
    const items = (data || []).map((p) => productDisplayName(p))
    setProducts([...new Set(items)].sort())
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

  function updateRow(id, field, value) {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, [field]: value } : row)))
  }

  const unitTotals = useMemo(() => {
    const totals = {}
    rows.forEach((r) => {
      const qty = Number(r.cantidad || 0)
      const { size, unit } = parseProductUnit(r.product)
      if (unit && qty > 0) totals[unit] = (totals[unit] || 0) + qty * size
    })
    return totals
  }, [rows])
  const fieldTotals = useMemo(() => {
    const fields = ['cajas', 'uds', 'galones', 'bidones', 'tambores', 'pallets']
    return Object.fromEntries(fields.map((f) => [f, rows.reduce((sum, r) => sum + Number(r[f] || 0), 0)]))
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
      const items = validRows.map((r, i) => ({
        lot_code: r.lot_code?.trim() || createLotCode(i),
        product: r.product.trim(),
        box_count: Number(r.cajas || 0),
        units_per_box: 0,
        loose_units: Number(r.cantidad || 0) * (parseProductUnit(r.product).size || 1),
        package_size: parseProductUnit(r.product).size || null,
        package_unit: parseProductUnit(r.product).unit || null,
        location: internalLocations[0] || 'ALMACEN',
        expiry_date: r.expiry_date || null,
      }))

      const { error: rpcError } = await supabase.rpc('create_entry_operation', {
        p_client_id: clientId,
        p_driver_name: transportista.trim() || null,
        p_driver_document: contacto.trim() || null,
        p_vehicle_plate: placa.trim() || null,
        p_entry_date: today,
        p_photo_url: null,
        p_notes: observaciones.trim() || null,
        p_items: items,
        p_user_id: user.id,
      })

      if (rpcError) throw rpcError

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
        <label className="block">
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
        <table className="w-full border-collapse" style={{ minWidth: '1080px' }}>
          <thead>
            <tr className="bg-campo-700 text-white">
              <th className="border-b border-campo-600 px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wide" style={{width:'36px'}}>N°</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-left text-xs font-bold uppercase tracking-wide">PRODUCTO</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wide" style={{width:'100px'}}>LOTE</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wide" style={{width:'120px'}}>VENC</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'80px'}}>CANTIDAD</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'64px'}}>CAJAS</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'64px'}}>UDS</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'72px'}}>GALONES</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'72px'}}>BIDONES</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'78px'}}>TAMBORES</th>
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
                      onChange={(e) => updateRow(row.id, 'product', e.target.value)}
                      onFocus={() => setSelectedIdx(i)}
                      disabled={!clientId}
                      title={row.product}
                    >
                      <option value="">—</option>
                      {products.map((p) => <option key={p} value={p}>{p}</option>)}
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
                  <input
                    type="date"
                    className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-xs focus:border-campo-400 focus:bg-white focus:outline-none"
                    value={row.expiry_date || ''}
                    onChange={(e) => updateRow(row.id, 'expiry_date', e.target.value)}
                    onFocus={() => setSelectedIdx(i)}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-right text-sm font-bold focus:border-campo-400 focus:bg-white focus:outline-none"
                    inputMode="decimal"
                    value={row.cantidad}
                    onChange={(e) => {
                      const v = e.target.value.replace(',', '.')
                      if (/^\d*\.?\d*$/.test(v)) updateRow(row.id, 'cantidad', v)
                    }}
                    onFocus={() => setSelectedIdx(i)}
                    placeholder="0"
                  />
                </td>
                {['cajas', 'uds', 'galones', 'bidones', 'tambores', 'pallets'].map((field) => (
                  <td key={field} className="px-2 py-1">
                    <input
                      className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-right text-sm focus:border-campo-400 focus:bg-white focus:outline-none"
                      inputMode="decimal"
                      value={row[field]}
                      onChange={(e) => {
                        const v = e.target.value.replace(',', '.')
                        if (/^\d*\.?\d*$/.test(v)) updateRow(row.id, field, v)
                      }}
                      onFocus={() => setSelectedIdx(i)}
                      placeholder="0"
                    />
                  </td>
                ))}
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
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50">
              <td colSpan={4} className="px-3 py-2.5 text-xs font-black uppercase text-slate-500">Totales</td>
              <td className="px-3 py-2.5">
                {Object.keys(unitTotals).length > 0
                  ? <span className="flex flex-wrap gap-3">{Object.entries(unitTotals).map(([u, v]) => (
                      <span key={u} className="text-sm font-black text-campo-700">{formatNumber(v)} <span className="font-bold text-campo-500">{u}</span></span>
                    ))}</span>
                  : <span className="text-sm text-slate-300">—</span>}
              </td>
              {['cajas', 'uds', 'galones', 'bidones', 'tambores', 'pallets'].map((f) => (
                <td key={f} className="px-2 py-2.5 text-right text-sm font-black text-slate-950">
                  {fieldTotals[f] > 0 ? formatNumber(fieldTotals[f]) : <span className="text-slate-300">—</span>}
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
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
              onChange={(e) => updateRow(row.id, 'product', e.target.value)}
              disabled={!clientId}
            >
              <option value="">—</option>
              {products.map((p) => <option key={p} value={p}>{p}</option>)}
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
                <input
                  type="date"
                  className="input mt-1 w-full text-sm"
                  value={row.expiry_date || ''}
                  onChange={(e) => updateRow(row.id, 'expiry_date', e.target.value)}
                />
              </label>
            </div>

            <label className="mb-3 block">
              <span className="text-xs font-bold uppercase text-slate-500">
                {(() => { const { size, unit } = parseProductUnit(row.product); return unit ? `CANTIDAD (× ${size} ${unit})` : 'CANTIDAD' })()}
              </span>
              <input
                className="input mt-1 w-full text-right font-bold text-sm"
                inputMode="decimal"
                value={row.cantidad}
                onChange={(e) => {
                  const v = e.target.value.replace(',', '.')
                  if (/^\d*\.?\d*$/.test(v)) updateRow(row.id, 'cantidad', v)
                }}
                placeholder="0"
              />
            </label>

            <div className="grid grid-cols-3 gap-2">
              {['cajas', 'uds', 'galones', 'bidones', 'tambores', 'pallets'].map((field) => (
                <label key={field} className="block">
                  <span className="text-xs font-bold uppercase text-slate-400">{field}</span>
                  <input
                    className="input mt-1 w-full text-right text-sm"
                    inputMode="decimal"
                    value={row[field]}
                    onChange={(e) => {
                      const v = e.target.value.replace(',', '.')
                      if (/^\d*\.?\d*$/.test(v)) updateRow(row.id, field, v)
                    }}
                    placeholder="0"
                  />
                </label>
              ))}
            </div>
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
          {Object.keys(fieldTotals).some((f) => fieldTotals[f] > 0) && (
            <div className="border-t border-slate-200 pt-2 grid grid-cols-3 gap-x-4 gap-y-1">
              {['cajas', 'uds', 'galones', 'bidones', 'tambores', 'pallets'].filter((f) => fieldTotals[f] > 0).map((f) => (
                <div key={f} className="flex justify-between gap-1">
                  <span className="text-xs font-bold uppercase text-slate-400">{f}</span>
                  <span className="text-xs font-black text-slate-950">{formatNumber(fieldTotals[f])}</span>
                </div>
              ))}
            </div>
          )}
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
          <button className="btn-secondary flex-1" type="button" onClick={() => navigate(-1)} disabled={saving}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}
