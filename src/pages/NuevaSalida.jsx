import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { CheckCircle2, FileText, LogOut, Plus, Trash2, X } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'
import { formatNumber } from '../lib/format'
import { cleanProductName, displayLotCode } from '../lib/display'
import { vibrateSuccess } from '../lib/haptics'
import { openDispatchReceipt, totalEquivalente } from '../lib/comprobante'
import OperationSuccess from '../components/OperationSuccess'
import { desgloseEnvases } from '../lib/envases'
import { catalogClientIds } from '../lib/catalogo'

const today = new Date().toISOString().slice(0, 10)
const DRAFT_KEY = 'draft_salida'

function emptyRow() {
  return {
    id: crypto.randomUUID(),
    lot_id: '',
    product: '',
    lot_code: '',
    expiry_date: '',
    saldo: 0,
    solucion_code: '',
    package_size: 1,
    package_unit: '',
    cantidad: '',
    uds: '',
    uds_rem: '',
    cajas: '',
    cajas_rem: '',
    galones: '',
    bidones: '',
    tambores: '',
    pallets: '',
    confirmed: false,
  }
}

function InfoField({ label, value, className = '' }) {
  return (
    <div className={className}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="truncate text-sm font-semibold text-slate-900">{value || '—'}</p>
    </div>
  )
}

function displayClientName(name) {
  return String(name || '').replaceAll('"', '').replace(/\s+/g, ' ').trim()
}

function lotOptionLabel(lot) {
  const lote = displayLotCode(lot.lot_code)
  const pkgSize = Number(lot.package_size) || 1
  const total = lot.current_quantity * pkgSize
  const unit = lot.package_unit || ''
  const saldo = unit ? `${formatNumber(total)} ${unit}` : formatNumber(lot.current_quantity)
  return `${cleanProductName(lot.product)}   [Lote: ${lote}]   ${saldo}`
}

export default function NuevaSalida() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const restoringRef = useRef(false)
  const params = new URLSearchParams(location.search)
  const requestId = params.get('request')
  const isRequestMode = Boolean(requestId)

  const [clients, setClients] = useState([])
  const [solicitud, setSolicitud] = useState(null)
  const [clientId, setClientId] = useState('')
  const [guiaPreview, setGuiaPreview] = useState('')
  const [contacto, setContacto] = useState('')
  const [transportista, setTransportista] = useState('')
  const [placa, setPlaca] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [lots, setLots] = useState([])
  const [catalogMap, setCatalogMap] = useState(new Map())
  const [rows, setRows] = useState([emptyRow()])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [comprobante, setComprobante] = useState(null)
  const [missingItems, setMissingItems] = useState([])

  // Cargar preview del número de guía automático
  useEffect(() => {
    supabase.rpc('preview_next_warehouse_guide', { p_type: 'sal' })
      .then(({ data }) => { if (data) setGuiaPreview(data) })
  }, [])

  // Restaurar borrador solo en F5 o navegación "atrás"; limpiar en navegación fresca
  useEffect(() => {
    if (isRequestMode) return
    const navType = performance.getEntriesByType?.('navigation')?.[0]?.type
    const prevKey = sessionStorage.getItem('salida_loc_key')
    const isReload = navType === 'reload'
    const isBackNav = prevKey !== null && prevKey === location.key
    sessionStorage.setItem('salida_loc_key', location.key)

    if (isReload || isBackNav) {
      try {
        const saved = localStorage.getItem(DRAFT_KEY)
        if (saved) {
          const d = JSON.parse(saved)
          if (d.contacto) setContacto(d.contacto)
          if (d.transportista) setTransportista(d.transportista)
          if (d.placa) setPlaca(d.placa)
          if (d.observaciones) setObservaciones(d.observaciones)
          if (d.rows?.length) setRows(d.rows)
          if (d.clientId) {
            restoringRef.current = true
            setClientId(d.clientId)
          }
        }
      } catch {}
    } else {
      localStorage.removeItem(DRAFT_KEY)
    }
  }, [])

  // Guardar borrador en cada cambio
  useEffect(() => {
    if (isRequestMode) return
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ clientId, contacto, transportista, placa, observaciones, rows }))
  }, [clientId, contacto, transportista, placa, observaciones, rows])

  useEffect(() => { loadClients() }, [])

  useEffect(() => {
    if (clientId) loadClientLots(clientId)
    else setLots([])
  }, [clientId])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'F12') { e.preventDefault(); addRow() }
      if (e.key === 'F10') { e.preventDefault(); removeSelectedRow() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (!requestId) return
    supabase
      .from('client_dispatch_requests')
      .select('*, clients(name)')
      .eq('id', requestId)
      .single()
      .then(({ data }) => {
        if (!data) return
        setSolicitud(data)
        if (data.transporter_ci) setContacto(data.transporter_ci)
        if (data.transporter_name) setTransportista(data.transporter_name)
        if (data.transporter_plate) setPlaca(data.transporter_plate)
        if (data.notes) setObservaciones(data.notes)
        if (data.client_id) {
          restoringRef.current = true
          setClientId(data.client_id)
        }
      })
  }, [requestId])

  useEffect(() => {
    if (!solicitud || !Array.isArray(solicitud.items) || solicitud.items.length === 0 || lots.length === 0) return
    const missing = []
    const newRows = solicitud.items.map((item) => {
      const lot = lots.find((l) => l.id === item.lot_id)
      if (!lot) { missing.push(item); return null }
      const uds = Number(item.quantity) || 0
      const pkgSize = Number(lot.package_size) || 1
      const cantidad = uds * pkgSize
      const product = cleanProductName(lot.product)
      const upb = upbFor(lot.solucion_product_code)
      const cajas = upb > 0 && uds > 0 ? Math.floor(uds / upb) : 0
      const cajas_rem = upb > 0 && uds > 0 ? uds % upb : 0
      return {
        ...emptyRow(),
        lot_id: lot.id,
        product,
        solucion_code: lot.solucion_product_code || '',
        lot_code: displayLotCode(lot.lot_code),
        expiry_date: lot.expiry_date || '',
        saldo: lot.current_quantity,
        package_size: pkgSize,
        package_unit: lot.package_unit || '',
        cantidad: String(cantidad),
        uds: uds > 0 ? String(uds) : '',
        uds_rem: '',
        cajas: cajas > 0 ? String(cajas) : '',
        cajas_rem: cajas_rem > 0 ? String(cajas_rem) : '',
      }
    }).filter(Boolean)
    setMissingItems(missing)
    if (newRows.length > 0) setRows(newRows)
  }, [solicitud, lots, catalogMap])

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

  function clearDraft() { localStorage.removeItem(DRAFT_KEY) }

  async function loadClientLots(cid) {
    const catalogIds = await catalogClientIds(cid)
    const [{ data: lotsData }, { data: catalogData }] = await Promise.all([
      supabase
        .from('lots')
        .select('id, product, lot_code, expiry_date, current_quantity, location, package_size, package_unit, solucion_product_code')
        .eq('inventory_source', 'stock_independiente')
        .eq('client_id', cid)
        .gt('current_quantity', 0)
        .order('product')
        .order('expiry_date', { ascending: true, nullsFirst: false }),
      supabase
        .from('product_catalog')
        .select('code, name, package_size, package_unit, units_per_box')
        .in('client_id', catalogIds),
    ])
    // Relación por CÓDIGO: lots.solucion_product_code ↔ product_catalog.code
    // (verificado 2026-07-10: el 100% de los lotes activos tiene código)
    const map = new Map()
    ;(catalogData || []).forEach((p) => {
      if (p.units_per_box && p.code) map.set(p.code.toUpperCase(), p.units_per_box)
    })
    setCatalogMap(map)
    setLots(lotsData || [])
    if (!restoringRef.current) setRows([emptyRow()])
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

  // Unidades por caja: relación por CÓDIGO, sin excepciones
  function upbFor(code) {
    if (!code) return 0
    return catalogMap.get(String(code).toUpperCase()) || 0
  }

  // El código se toma del LOTE vivo (por id) — inmune a borradores viejos sin código
  function upbForRow(row) {
    const lot = lots.find((l) => l.id === row.lot_id)
    return upbFor(lot?.solucion_product_code || row.solucion_code)
  }

  function selectLot(rowId, lotId) {
    const lot = lots.find((l) => l.id === lotId)
    if (!lot) return
    setRows((r) =>
      r.map((row) => {
        if (row.id !== rowId) return row
        const product = cleanProductName(lot.product)
        const pkgSize = Number(lot.package_size) || 1
        const qty = Number(row.cantidad || 0)
        const uds = qty > 0 ? Math.floor(qty / pkgSize) : 0
        const uds_rem = qty > 0 && uds > 0 ? Math.round((qty - uds * pkgSize) * 1000) / 1000 : 0
        const upb = upbFor(lot.solucion_product_code)
        const cajas = upb > 0 && uds > 0 ? Math.floor(uds / upb) : 0
        return {
          ...row,
          lot_id: lot.id,
          product,
          solucion_code: lot.solucion_product_code || '',
          lot_code: displayLotCode(lot.lot_code),
          expiry_date: lot.expiry_date || '',
          saldo: lot.current_quantity,
          package_size: pkgSize,
          package_unit: lot.package_unit || '',
          uds: uds > 0 ? String(uds) : row.uds,
          uds_rem: uds_rem > 0 ? String(uds_rem) : '',
          cajas: upb > 0 && uds > 0 ? String(cajas) : row.cajas,
          cajas_rem: upb > 0 && uds > 0 ? String(uds % upb) : '',
        }
      }),
    )
  }

  function clearLot(rowId) {
    setRows((r) => r.map((row) => row.id === rowId ? { ...emptyRow(), id: rowId } : row))
  }

  function updateRow(id, field, value) {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, [field]: value } : row)))
  }

  function updateCantidad(rowId, value) {
    const v = value.replace(',', '.')
    if (!/^\d*\.?\d*$/.test(v)) return
    const qty = Number(v || 0)
    setRows((r) => r.map((row) => {
      if (row.id !== rowId) return row
      const pkgSize = Number(row.package_size) || 1
      const uds = pkgSize > 0 && qty > 0 ? Math.floor(qty / pkgSize) : (qty > 0 ? qty : 0)
      const uds_rem = pkgSize > 0 && qty > 0 && uds > 0 ? Math.round((qty - uds * pkgSize) * 1000) / 1000 : 0
      const upb = upbForRow(row)
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

  const rowInsufficient = (row) => isRequestMode && row.lot_id && Number(row.uds || 0) > Number(row.saldo || 0)
  const insufficientRows = isRequestMode ? rows.filter(rowInsufficient) : []
  const allConfirmed = !isRequestMode || rows.every((r) => r.confirmed)

  async function save() {
    setError('')
    if (!clientId) { setError('Selecciona la empresa.'); return }
    if (!transportista.trim()) { setError('El transportista es obligatorio.'); return }
    if (!contacto.trim()) { setError('El contacto es obligatorio.'); return }
    if (!placa.trim()) { setError('La placa es obligatoria.'); return }
    const validRows = rows.filter((r) => r.lot_id && Number(r.uds || 0) > 0)
    if (validRows.length === 0) { setError('Agrega al menos un item con lote y cantidad.'); return }

    const overStock = validRows.find((r) => Number(r.uds) > Number(r.saldo))
    if (overStock) {
      setError(`Cantidad excede el saldo disponible para: ${overStock.product} (saldo: ${formatNumber(overStock.saldo)} uds).`)
      return
    }

    setSaving(true)
    try {
      const operationItems = validRows.map((r) => ({
        lot_id: r.lot_id,
        quantity: Number(r.uds),
      }))

      const { data: rpcData, error: rpcError } = await supabase.rpc('create_dispatch_operation', {
        p_client_id: clientId,
        p_receiver_name: transportista.trim(),
        p_receiver_document: contacto.trim(),
        p_vehicle_plate: placa.trim() || null,
        p_notes: observaciones.trim() || null,
        p_items: operationItems,
        p_request_id: requestId || null,
        p_user_id: user.id,
      })

      if (rpcError) {
        if (rpcError.message?.includes('inventario') || rpcError.message?.includes('stock'))
          throw new Error('No hay inventario suficiente para completar esta salida.')
        throw rpcError
      }

      if (requestId) {
        await supabase.rpc('complete_client_dispatch_request', { p_request_id: requestId, p_user_id: user.id })
      }

      const empresaNombre = isRequestMode
        ? solicitud?.clients?.name || ''
        : displayClientName(clients.find((c) => c.id === clientId)?.name)
      setComprobante({
        guide: rpcData?.guide_number || guiaPreview,
        empresa: empresaNombre,
        contacto: contacto.trim(),
        transportista: transportista.trim(),
        placa: placa.trim(),
        observaciones: observaciones.trim(),
        rows: validRows.map((r) => {
          const d = desgloseEnvases(r.cantidad, r.package_size, r.package_unit, upbForRow(r))
          return { ...r, unidades_label: d.unidadesLabel, cajas_label: d.cajasLabel }
        }),
      })

      clearDraft()
      vibrateSuccess()
      setSuccess(true)
    } catch (err) {
      setError(err.message || 'Error al guardar la salida.')
    } finally {
      setSaving(false)
    }
  }

  // Empezar otra salida desde cero, sin salir de la pantalla
  function resetSalida() {
    clearDraft()
    setSuccess(false)
    setComprobante(null)
    setError('')
    setClientId('')
    setContacto('')
    setTransportista('')
    setPlaca('')
    setObservaciones('')
    setRows([emptyRow()])
    setSelectedIdx(0)
    setMissingItems([])
    supabase.rpc('preview_next_warehouse_guide', { p_type: 'sal' })
      .then(({ data }) => { if (data) setGuiaPreview(data) })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (success && comprobante) {
    return (
      <OperationSuccess
        titulo="Salida guardada correctamente"
        guide={comprobante.guide}
        empresa={comprobante.empresa}
        itemsCount={comprobante.rows.length}
        totalLabel={totalEquivalente(comprobante.rows)}
        onViewReceipt={() => openDispatchReceipt(comprobante)}
        onNew={isRequestMode ? null : resetSalida}
        newLabel="Nueva salida"
        onBack={() => navigate(-1)}
      />
    )
  }

  return (
    <div>
      <PageHeader title="Salida" subtitle="Nota de salida de mercadería" />

      {isRequestMode && solicitud ? (
        <div className="panel mb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-base font-black text-slate-950">{solicitud.clients?.name || '—'}</p>
              <p className="mt-0.5 text-xs font-semibold text-slate-500">Solicitud de cliente · {today} · <span className="font-mono font-bold text-campo-700">{guiaPreview || '...'}</span></p>
            </div>
            <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">Datos fijos del cliente</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-slate-100 pt-3 sm:grid-cols-3">
            <InfoField label="Contacto" value={contacto} />
            <InfoField label="Transportista" value={transportista} />
            <InfoField label="Placa" value={placa} />
            {observaciones && <InfoField label="Observaciones" value={observaciones} className="col-span-2 sm:col-span-3" />}
          </div>
        </div>
      ) : (
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
      )}

      {!isRequestMode && (
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
      )}

      {clientId && lots.length === 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-700">
          Esta empresa no tiene stock disponible.
        </div>
      )}

      {isRequestMode && missingItems.length > 0 && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-black text-red-800">
            {missingItems.length === 1 ? 'Un producto de la solicitud ya no tiene stock:' : `${missingItems.length} productos de la solicitud ya no tienen stock:`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {missingItems.map((item, idx) => (
              <li key={idx} className="text-sm font-semibold text-red-700">
                • {cleanProductName(item.product) || 'Producto'} — pedía {formatNumber(item.quantity)} uds
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs font-semibold text-red-600">No se puede despachar esta solicitud completa. Podés rechazarla con motivo desde la pantalla de Salidas.</p>
        </div>
      )}

      {insufficientRows.length > 0 && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-black text-red-800">Saldo insuficiente para {insufficientRows.length === 1 ? 'un producto' : `${insufficientRows.length} productos`} (marcados en rojo):</p>
          <ul className="mt-1 space-y-0.5">
            {insufficientRows.map((row) => (
              <li key={row.id} className="text-sm font-semibold text-red-700">
                • {row.product} — pide {formatNumber(row.uds)} uds y hay {formatNumber(row.saldo)} uds
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs font-semibold text-red-600">El stock cambió desde que el cliente hizo la solicitud. Podés rechazarla con motivo desde la pantalla de Salidas.</p>
        </div>
      )}

      <div className="mb-4 hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm sm:block">
        <table className="w-full border-collapse" style={{ minWidth: '880px', tableLayout: 'fixed' }}>
          <thead>
            <tr className="bg-campo-700 text-white">
              <th className="border-b border-campo-600 px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wide" style={{width:'40px'}}>{isRequestMode ? '✓' : 'N°'}</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-left text-xs font-bold uppercase tracking-wide">PRODUCTO</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wide" style={{width:'100px'}}>LOTE</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wide" style={{width:'110px'}}>VENC</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'80px'}}>CANTIDAD</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'150px'}}>UNIDADES</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'120px'}}>CAJAS</th>
              <th className="border-b border-campo-600 px-2 py-2.5 text-right text-xs font-bold uppercase tracking-wide" style={{width:'68px'}}>PALLETS</th>
              {!isRequestMode && <th className="border-b border-campo-600 px-1 py-2.5" style={{width:'32px'}}></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.id}
                className={`cursor-pointer border-b border-slate-100 transition-colors ${
                  rowInsufficient(row)
                    ? 'bg-red-50 ring-1 ring-inset ring-red-200'
                    : isRequestMode && row.confirmed
                      ? 'bg-campo-50'
                      : selectedIdx === i
                        ? 'bg-blue-50 ring-1 ring-inset ring-blue-200'
                        : 'hover:bg-slate-50'
                }`}
                onClick={() => setSelectedIdx(i)}
              >
                <td className="px-1 py-1 text-center">
                  {isRequestMode ? (
                    <button
                      type="button"
                      className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full transition-all ${
                        rowInsufficient(row)
                          ? 'cursor-not-allowed border-2 border-red-200 text-red-300'
                          : row.confirmed
                            ? 'bg-campo-600 text-white shadow-sm'
                            : 'border-2 border-slate-300 text-slate-300 hover:border-campo-500 hover:text-campo-500'
                      }`}
                      onClick={(e) => { e.stopPropagation(); if (!rowInsufficient(row)) updateRow(row.id, 'confirmed', !row.confirmed) }}
                      title={rowInsufficient(row) ? 'Saldo insuficiente — no se puede confirmar' : row.confirmed ? 'Quitar confirmación' : 'Confirmar producto'}
                    >
                      <CheckCircle2 size={16} />
                    </button>
                  ) : (
                    <span className="text-sm font-bold text-slate-500">{i + 1}</span>
                  )}
                </td>
                <td className="px-2 py-1">
                  {row.lot_id ? (
                    <div className="flex min-w-0 items-center gap-1">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-900" title={row.product}>{row.product}</div>
                        {rowInsufficient(row) ? (
                          <div className="text-[10px] font-black text-red-600">
                            Saldo insuficiente: hay {formatNumber(row.saldo)} uds y pide {formatNumber(row.uds)}
                          </div>
                        ) : row.package_unit ? (
                          <div className="text-[10px] font-semibold text-slate-400">
                            {formatNumber(row.saldo * (Number(row.package_size) || 1))} {row.package_unit} disponibles
                          </div>
                        ) : null}
                      </div>
                      {!isRequestMode && (
                        <button
                          type="button"
                          className="shrink-0 rounded p-0.5 text-slate-400 hover:text-red-500"
                          onClick={(e) => { e.stopPropagation(); setSelectedIdx(i); clearLot(row.id) }}
                          title="Cambiar lote"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ) : (
                    <select
                      className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-sm focus:border-campo-400 focus:bg-white focus:outline-none"
                      value=""
                      onChange={(e) => { setSelectedIdx(i); selectLot(row.id, e.target.value) }}
                      onFocus={() => setSelectedIdx(i)}
                      disabled={!clientId || lots.length === 0 || isRequestMode}
                    >
                      <option value="">— Seleccionar lote —</option>
                      {lots.map((lot) => (
                        <option key={lot.id} value={lot.id}>{lotOptionLabel(lot)}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-2 py-1.5 text-center text-sm font-semibold text-slate-700">
                  {row.lot_code || <span className="text-slate-300">—</span>}
                </td>
                <td className="px-2 py-1.5 text-center text-sm font-semibold text-slate-700">
                  {row.expiry_date
                    ? new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${row.expiry_date}T00:00:00`))
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-2 py-1">
                  <input
                    className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-right text-sm font-bold focus:border-campo-400 focus:bg-white focus:outline-none disabled:opacity-30"
                    inputMode="decimal"
                    value={row.cantidad}
                    onChange={(e) => updateCantidad(row.id, e.target.value)}
                    onFocus={() => setSelectedIdx(i)}
                    placeholder="0"
                    disabled={!row.lot_id || isRequestMode}
                  />
                  {row.package_unit && Number(row.cantidad) > 0 && (
                    <div className="text-right text-[10px] font-bold text-slate-400">{row.package_unit}</div>
                  )}
                </td>
                {(() => {
                  const upb = upbForRow(row)
                  const d = desgloseEnvases(row.cantidad, row.package_size, row.package_unit, upb)
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
                    className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-right text-sm focus:border-campo-400 focus:bg-white focus:outline-none disabled:opacity-30"
                    inputMode="decimal"
                    value={row.pallets}
                    onChange={(e) => {
                      const v = e.target.value.replace(',', '.')
                      if (/^\d*\.?\d*$/.test(v)) updateRow(row.id, 'pallets', v)
                    }}
                    onFocus={() => setSelectedIdx(i)}
                    placeholder="0"
                    disabled={!row.lot_id || isRequestMode}
                  />
                </td>
                {!isRequestMode && (
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
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Carrito móvil: tarjetas apiladas (la tabla es solo para pantallas sm+) */}
      <div className="mb-4 space-y-3 sm:hidden">
        {rows.map((row, i) => {
          const upb = upbForRow(row)
          const d = desgloseEnvases(row.cantidad, row.package_size, row.package_unit, upb)
          return (
            <div
              key={row.id}
              className={`rounded-xl border p-3 shadow-sm ${
                rowInsufficient(row)
                  ? 'border-red-200 bg-red-50'
                  : isRequestMode && row.confirmed
                    ? 'border-campo-200 bg-campo-50'
                    : 'border-slate-200 bg-white'
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-black text-slate-400">ITEM #{i + 1}</span>
                {isRequestMode ? (
                  <button
                    type="button"
                    className={`flex h-9 w-9 items-center justify-center rounded-full transition-all ${
                      rowInsufficient(row)
                        ? 'cursor-not-allowed border-2 border-red-200 text-red-300'
                        : row.confirmed
                          ? 'bg-campo-600 text-white shadow-sm'
                          : 'border-2 border-slate-300 text-slate-300'
                    }`}
                    onClick={() => { if (!rowInsufficient(row)) updateRow(row.id, 'confirmed', !row.confirmed) }}
                    title={rowInsufficient(row) ? 'Saldo insuficiente — no se puede confirmar' : row.confirmed ? 'Quitar confirmación' : 'Confirmar producto'}
                  >
                    <CheckCircle2 size={18} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded text-slate-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-30"
                    onClick={() => removeRow(row.id)}
                    disabled={rows.length <= 1}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {row.lot_id ? (
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 [overflow-wrap:anywhere]">{row.product}</p>
                    {rowInsufficient(row) ? (
                      <p className="text-[10px] font-black text-red-600">
                        Saldo insuficiente: hay {formatNumber(row.saldo)} uds y pide {formatNumber(row.uds)}
                      </p>
                    ) : row.package_unit ? (
                      <p className="text-[10px] font-semibold text-slate-400">
                        {formatNumber(row.saldo * (Number(row.package_size) || 1))} {row.package_unit} disponibles
                      </p>
                    ) : null}
                  </div>
                  {!isRequestMode && (
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 text-slate-400 hover:text-red-500"
                      onClick={() => clearLot(row.id)}
                      title="Cambiar lote"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              ) : (
                <select
                  className="input mb-3 w-full text-sm disabled:opacity-40"
                  value=""
                  onChange={(e) => selectLot(row.id, e.target.value)}
                  disabled={!clientId || lots.length === 0 || isRequestMode}
                >
                  <option value="">— Seleccionar lote —</option>
                  {lots.map((lot) => (
                    <option key={lot.id} value={lot.id}>{lotOptionLabel(lot)}</option>
                  ))}
                </select>
              )}

              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-black uppercase text-slate-500">Lote</p>
                  <p className="text-sm font-bold text-slate-700">{row.lot_code || '—'}</p>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-black uppercase text-slate-500">Venc.</p>
                  <p className="text-sm font-bold text-slate-700">
                    {row.expiry_date
                      ? new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${row.expiry_date}T00:00:00`))
                      : '—'}
                  </p>
                </div>
              </div>

              <label className="mb-3 block">
                <span className="text-xs font-bold uppercase text-slate-500">
                  {row.package_unit ? `Cantidad (${row.package_unit})` : 'Cantidad'}
                </span>
                <input
                  className="input mt-1 w-full text-right text-sm font-bold disabled:opacity-30"
                  inputMode="decimal"
                  value={row.cantidad}
                  onChange={(e) => updateCantidad(row.id, e.target.value)}
                  placeholder="0"
                  disabled={!row.lot_id || isRequestMode}
                />
              </label>

              {(d.unidadesLabel || d.cajasLabel) ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-campo-50 px-3 py-2">
                    <p className="text-[10px] font-black uppercase text-campo-600">Unidades</p>
                    <p className="text-sm font-bold text-campo-800">{d.unidadesLabel || '—'}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-black uppercase text-slate-500">Cajas</p>
                    <p className="text-sm font-bold text-slate-700">{d.cajasLabel || '—'}</p>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {isRequestMode && !allConfirmed && (
        <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-700">
          Confirmá cada producto en el carrito antes de guardar.
        </div>
      )}

      {error ? <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

      <div className="flex gap-3">
        <button className="btn-primary flex-1" type="button" onClick={save} disabled={saving || !clientId || !allConfirmed}>
          <LogOut size={20} /> {saving ? 'Guardando...' : 'Guardar'}
        </button>
        <button className="btn-secondary flex-1" type="button" onClick={() => { clearDraft(); navigate(-1) }} disabled={saving}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
