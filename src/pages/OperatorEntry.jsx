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

function emptyRow() {
  return { id: crypto.randomUUID(), product: '', lot_code: '', expiry_date: '', cajas: '', uds: '', galones: '', bidones: '', tambores: '', pallets: '' }
}

function rowTotal(row) {
  return ['cajas', 'uds', 'galones', 'bidones', 'tambores', 'pallets']
    .reduce((sum, f) => sum + Number(row[f] || 0), 0)
}

function createLotCode(index = 0) {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  return index ? `ING-${stamp}-${index + 1}` : `ING-${stamp}`
}

function displayClientName(name) {
  return String(name || '').replaceAll('"', '').replace(/\s+/g, ' ').trim()
}

const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'))
const YEARS = Array.from({ length: 12 }, (_, i) => String(new Date().getFullYear() + i))

function CellDate({ value, onChange, onFocus }) {
  const [y, m, d] = value ? value.split('-') : ['', '', '']
  function update(ny, nm, nd) {
    if (ny && nm && nd) onChange(`${ny}-${nm}-${nd}`)
    else onChange('')
  }
  return (
    <div className="flex gap-0.5" onFocus={onFocus}>
      <select
        className="w-10 rounded border border-transparent bg-transparent px-0.5 py-1 text-center text-xs focus:border-campo-400 focus:bg-white focus:outline-none"
        value={d || ''}
        onChange={(e) => update(y, m, e.target.value)}
      >
        <option value="">Día</option>
        {DAYS.map((v) => <option key={v} value={v}>{Number(v)}</option>)}
      </select>
      <select
        className="w-12 rounded border border-transparent bg-transparent px-0.5 py-1 text-center text-xs focus:border-campo-400 focus:bg-white focus:outline-none"
        value={m || ''}
        onChange={(e) => update(y, e.target.value, d)}
      >
        <option value="">Mes</option>
        {MONTHS.map((name, idx) => <option key={idx} value={String(idx + 1).padStart(2, '0')}>{name}</option>)}
      </select>
      <select
        className="w-14 rounded border border-transparent bg-transparent px-0.5 py-1 text-center text-xs focus:border-campo-400 focus:bg-white focus:outline-none"
        value={y || ''}
        onChange={(e) => update(e.target.value, m, d)}
      >
        <option value="">Año</option>
        {YEARS.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </div>
  )
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
    const items = (data || []).map((p) =>
      p.package_size && p.package_unit ? `${p.name} X ${p.package_size} ${p.package_unit}` : p.name
    )
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

  const totalQuantity = useMemo(() => rows.reduce((sum, r) => sum + rowTotal(r), 0), [rows])

  async function save() {
    setError('')
    if (!clientId) { setError('Selecciona la empresa.'); return }
    if (!contacto.trim()) { setError('El contacto es obligatorio.'); return }
    if (!transportista.trim()) { setError('El transportista es obligatorio.'); return }
    if (!placa.trim()) { setError('La placa es obligatoria.'); return }
    const validRows = rows.filter((r) => r.product?.trim() && rowTotal(r) > 0)
    if (validRows.length === 0) { setError('Agrega al menos un item con producto y cantidad.'); return }

    setSaving(true)
    try {
      const items = validRows.map((r, i) => ({
        lot_code: r.lot_code?.trim() || createLotCode(i),
        product: r.product.trim(),
        box_count: Number(r.cajas || 0),
        units_per_box: 0,
        loose_units: ['uds', 'galones', 'bidones', 'tambores', 'pallets'].reduce((s, f) => s + Number(r[f] || 0), 0),
        package_size: null,
        package_unit: null,
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
          <Plus size={17} /> Agregar item (F12)
        </button>
        <button
          className="btn-secondary !min-h-10 !px-4 !py-2 text-sm"
          type="button"
          onClick={removeSelectedRow}
          disabled={rows.length <= 1}
        >
          <Trash2 size={17} /> Quitar seleccionado (F10)
        </button>
      </div>

      <div className="mb-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm" ref={tableRef}>
        <table className="w-full border-collapse" style={{ minWidth: '960px' }}>
          <thead>
            <tr className="bg-campo-700 text-white">
              <th className="border-b border-campo-600 px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wide" style={{width:'36px'}}>N°</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-left text-xs font-bold uppercase tracking-wide">PRODUCTO</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wide" style={{width:'100px'}}>LOTE</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wide" style={{width:'160px'}}>VENC</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'64px'}}>CAJAS</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'64px'}}>UDS</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'72px'}}>GALONES</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'72px'}}>BIDONES</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'78px'}}>TAMBORES</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'68px'}}>PALLETS</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'80px'}}>CANTIDAD</th>
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
                  <select
                    className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm focus:border-campo-400 focus:bg-white focus:outline-none disabled:opacity-40"
                    value={row.product}
                    onChange={(e) => updateRow(row.id, 'product', e.target.value)}
                    onFocus={() => setSelectedIdx(i)}
                    disabled={!clientId}
                  >
                    <option value="">—</option>
                    {products.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
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
                  <CellDate
                    value={row.expiry_date}
                    onChange={(v) => updateRow(row.id, 'expiry_date', v)}
                    onFocus={() => setSelectedIdx(i)}
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
                <td className="px-2 py-1 text-right text-sm font-bold text-slate-700">
                  {rowTotal(row) > 0 ? formatNumber(rowTotal(row)) : <span className="text-slate-300">0</span>}
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
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50">
              <td colSpan={10} className="px-3 py-2.5 text-sm font-black uppercase text-slate-600">Total cantidad:</td>
              <td className="px-2 py-2.5 text-right text-sm font-black text-slate-950">{formatNumber(totalQuantity)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
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
