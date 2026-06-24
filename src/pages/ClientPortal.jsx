import { useEffect, useMemo, useState } from 'react'
import ExcelJS from 'exceljs'
import { Link, useNavigate } from 'react-router-dom'
import {
  Boxes, CalendarClock, CheckCircle2, ChevronDown,
  ClipboardList, Download, FileText, History, LogOut, Minus, Package,
  PackageCheck, Plus, Printer, Search, Send,
  Truck, X,
} from 'lucide-react'
import EmptyState from '../components/EmptyState'
import ListProductCard from '../components/ListProductCard'
import { useAuth } from '../hooks/useAuth.jsx'
import { cleanProductName, displayLotCode, lotLabel, packageLabel, productCode, productCodeLabel } from '../lib/display'
import { normalizeDispatchRequests } from '../lib/dispatchRequests'
import { formatDate, formatNumber, movementLabel } from '../lib/format'
import { supabase } from '../lib/supabase'

/* ─── helpers ─────────────────────────────────────────────────────── */

function escapeHtml(v) {
  return String(v || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
}

function daysUntil(expiryDate) {
  if (!expiryDate) return null
  const today = new Date(); today.setHours(0,0,0,0)
  return Math.ceil((new Date(`${expiryDate}T00:00:00`) - today) / 86400000)
}

function lotStatus(lot) {
  const days = daysUntil(lot.expiry_date)
  if (days !== null && days < 0) return { label: 'Vencido',   cls: 'bg-red-50 text-red-700' }
  if (lot.status === 'retenido')  return { label: 'Retenido',  cls: 'bg-orange-50 text-orange-700' }
  if (lot.status === 'cerrado')   return { label: 'Cerrado',   cls: 'bg-slate-100 text-slate-600' }
  if (days !== null && days <= 90) return { label: 'Por vencer', cls: 'bg-amber-50 text-amber-800' }
  return { label: 'Disponible', cls: 'bg-campo-50 text-campo-700' }
}

// Extracts {size, unit} from product name. Matches "x 20 Lts", "X 10 Kgs",
// "20L_BO_TP", "10X1 KG_BO", "20 L", etc. Uses (?![a-zA-Z]) not \b because
// _ is a word char so \b fails on "20L_BO".
function parseUnitFromName(name) {
  const match = String(name || '').match(/(?:[xX×]\s*)?(\d+(?:[.,]\d+)?)\)?\s*(ltrs?|lts?|kgs?|l)(?![a-zA-Z])/i)
  if (!match) return null
  const size = parseFloat(match[1].replace(',', '.'))
  const raw = match[2].toLowerCase()
  const unit = /^l(trs?|ts?)?$/.test(raw) ? 'lts' : /^kgs?$/.test(raw) ? 'kgs' : ''
  if (!unit || isNaN(size) || size <= 0) return null
  return { size, unit }
}

function normalizeEquivalent({ quantity, unit }) {
  const u = String(unit || '').toLowerCase().trim()
  if (/^gr?s?$/.test(u)) return { quantity: quantity / 1000, unit: 'kgs' }
  return { quantity, unit }
}

function lotEquivalent(lot) {
  const s = Number(lot?.package_size || 0)
  if (s > 0 && lot?.package_unit) return normalizeEquivalent({ quantity: Number(lot.current_quantity || 0) * s, unit: lot.package_unit })
  const parsed = parseUnitFromName(lot?.product)
  if (!parsed) return null
  return normalizeEquivalent({ quantity: Number(lot.current_quantity || 0) * parsed.size, unit: parsed.unit })
}

function itemEquivalent(item) {
  const s = Number(item?.package_size || 0)
  if (s > 0 && item?.package_unit) return normalizeEquivalent({ quantity: Number(item.quantity || 0) * s, unit: item.package_unit })
  const parsed = parseUnitFromName(item?.product)
  if (!parsed) return null
  return normalizeEquivalent({ quantity: Number(item.quantity || 0) * parsed.size, unit: parsed.unit })
}

function productIdentityKey(lot) {
  return [
    cleanProductName(lot?.product),
    productCode(lot) || lot?.solucion_product_code || '',
    Number(lot?.package_size || 0) || '',
    String(lot?.package_unit || '').trim().toUpperCase(),
  ].join('|')
}

function productIdentityLabel(lot) {
  const name = cleanProductName(lot?.product)
  const code = productCode(lot) || lot?.solucion_product_code || ''
  const pack = packageLabel(lot)
  return [name, code ? `Cod. ${code}` : '', pack].filter(Boolean).join(' · ')
}

function equivalentTotalsLabel(equivalents = {}) {
  const totals = Object.entries(equivalents)
    .filter(([, q]) => Number(q || 0) > 0)
    .sort(([a],[b]) => a.localeCompare(b,'es'))
  if (totals.length === 0) return null
  return totals.map(([unit, qty]) => `${formatNumber(qty)} ${unit}`).join(' / ')
}

const STATUS_MAP = {
  pendiente:       { label: 'Despacho pendiente', cls: 'bg-amber-50 text-amber-800',   accent: 'bg-amber-400' },
  aprobado:        { label: 'Despacho pendiente', cls: 'bg-amber-50 text-amber-800',   accent: 'bg-amber-400' },
  en_preparacion:  { label: 'En preparación',     cls: 'bg-campo-100 text-campo-800',  accent: 'bg-campo-500' },
  despachado:      { label: 'Despachado',          cls: 'bg-slate-100 text-slate-600',  accent: 'bg-slate-400' },
  rechazado:       { label: 'Rechazado',           cls: 'bg-red-50 text-red-700',       accent: 'bg-red-400' },
}
function requestStatus(s) { return STATUS_MAP[s] || { label: 'Recibido', cls: 'bg-amber-50 text-amber-800', accent: 'bg-amber-400' } }

const REQUEST_STEPS = [
  { key: 'pendiente',      label: 'Pendiente',       Icon: ClipboardList },
  { key: 'en_preparacion', label: 'En preparación',  Icon: Package },
  { key: 'despachado',     label: 'Despachado',       Icon: Truck },
]

function requestStepIndex(status) {
  if (status === 'despachado') return 2
  if (status === 'en_preparacion') return 1
  return 0
}

/* ─── draft ────────────────────────────────────────────────────────── */
const DRAFT_KEY = 'todo-agricola-client-dispatch-draft'
function readDraft() {
  try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); return d || { lotId:'', quantity:'', notes:'', items:[] } } catch { return { lotId:'', quantity:'', notes:'', items:[] } }
}
function writeDraft(d) { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)) }
function clearDraft()  { localStorage.removeItem(DRAFT_KEY) }

/* ═══════════════════════════════════════════════════════════════════ */
export default function ClientPortal({ view = 'inventory' }) {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const initialDraft = useMemo(readDraft, [])

  const [lots,       setLots]       = useState([])
  const [movements,  setMovements]  = useState([])
  const [requests,   setRequests]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [showExpiryModal, setShowExpiryModal] = useState(false)
  const [showProductsModal, setShowProductsModal] = useState(false)
  const [search,     setSearch]     = useState('')
  const [expandedProduct, setExpandedProduct] = useState('')
  const [showAllProducts, setShowAllProducts] = useState(false)
  const [inventoryFilter, setInventoryFilter] = useState('all')
  const [inventorySort,   setInventorySort]   = useState('name')
  const [selectedMovement, setSelectedMovement] = useState(null)

  // request form
  const [reqProductName, setReqProductName] = useState('')
  const [reqLotId,       setReqLotId]       = useState(initialDraft.lotId)
  const [reqQuantity,    setReqQuantity]     = useState(initialDraft.quantity)
  const [reqNotes,       setReqNotes]        = useState(initialDraft.notes)
  const [reqItems,       setReqItems]        = useState(initialDraft.items)
  const [editingLotId,   setEditingLotId]    = useState('')
  const [reqMessage,     setReqMessage]      = useState('')
  const [reqSuccess,     setReqSuccess]      = useState(null)

  useEffect(() => { if (user?.id && profile) loadData() }, [user?.id, profile?.client_id])
  useEffect(() => { writeDraft({ lotId: reqLotId, quantity: reqQuantity, notes: reqNotes, items: reqItems }) }, [reqLotId, reqQuantity, reqNotes, reqItems])

  async function loadData() {
    setLoading(true)
    const clientId = profile?.client_id
    if (!clientId) {
      setLots([])
      setMovements([])
      setRequests([])
      setLoading(false)
      return
    }

    const { data: lotsData } = await supabase
      .from('lots')
      .select('id,lot_code,client_id,product,solucion_product_code,current_quantity,package_size,package_unit,location,entry_date,expiry_date,status,clients(name,contact)')
      .eq('inventory_source','stock_independiente')
      .eq('client_id', clientId)
      .eq('status','activo')
      .gt('current_quantity', 0)
      .order('product')
    setLots(lotsData || [])

    const lotIds = (lotsData||[]).map(l => l.id)
    const { data: movData } = lotIds.length
      ? await supabase.from('movements')
          .select('id,type,quantity,previous_quantity,new_quantity,to_location,notes,created_at,lots(lot_code,product,solucion_product_code,package_size,package_unit,location)')
          .in('lot_id', lotIds).in('type',['entrada','salida'])
          .order('created_at',{ ascending:false }).limit(80)
      : { data: [] }
    setMovements(movData || [])

    const { data: reqData } = await supabase
      .from('client_dispatch_requests')
      .select('id,client_id,lot_id,product,quantity,items,notes,status,admin_notes,created_at,reviewed_at,clients(name),lots(id,lot_code,product,solucion_product_code,current_quantity,package_size,package_unit,location,expiry_date,status)')
      .eq('client_id', clientId)
      .order('created_at',{ ascending:false })
    setRequests(await normalizeDispatchRequests(reqData||[], lotsData||[]))
    setLoading(false)
  }

  /* ─── derived ─────────────────────────────────────────────────── */
  const filteredLots = useMemo(() => {
    const term = search.toLowerCase()
    return lots.filter(l =>
      [l.product, productCodeLabel(l), l.lot_code, displayLotCode(l.lot_code,l), l.location]
        .filter(Boolean).some(v => v.toLowerCase().includes(term))
    )
  }, [lots, search])

  const totalStock    = lots.reduce((s,l) => s + Number(l.current_quantity||0), 0)
  const productCount  = lots.length
  const expiring      = lots.filter(l => { const d = daysUntil(l.expiry_date); return d !== null && d <= 90 })
  const alerts        = lots.filter(l => lotStatus(l).label !== 'Disponible' && lotStatus(l).label !== 'Por vencer')
  const activeRequests = requests.filter(r => !['despachado','rechazado'].includes(r.status))
  const pendingDispatchRequests = requests.filter(r => ['pendiente', 'aprobado'].includes(r.status))
  const preparingDispatchRequests = requests.filter(r => r.status === 'en_preparacion')
  const dispatchedRequests = requests.filter(r => r.status === 'despachado')
  const clientName    = lots[0]?.clients?.name || profile?.full_name || 'Cliente'

  const inventoryProducts = useMemo(() => {
    const map = {}
    filteredLots.forEach(lot => {
      const key = productIdentityKey(lot)
      if (!map[key]) map[key] = { key, product: cleanProductName(lot.product), identity: productIdentityLabel(lot), quantity:0, equivalents:{}, lots:[], expiring:0, expired:0, retained:0 }
      map[key].quantity += Number(lot.current_quantity||0)
      map[key].lots.push(lot)
      const eq = lotEquivalent(lot)
      if (eq) map[key].equivalents[eq.unit] = Number(map[key].equivalents[eq.unit]||0) + eq.quantity
      const st = lotStatus(lot).label
      if (st === 'Por vencer') map[key].expiring++
      if (st === 'Vencido')    map[key].expired++
      if (st === 'Retenido')   map[key].retained++
    })
    return Object.values(map).map(g => ({
      ...g,
      lots: g.lots.sort((a,b) => (a.expiry_date||'9999-12-31').localeCompare(b.expiry_date||'9999-12-31')),
    })).sort((a,b) => a.identity.localeCompare(b.identity,'es',{numeric:true}))
  }, [filteredLots])

  const displayedProducts = useMemo(() => {
    let items = inventoryProducts
    if (inventoryFilter === 'expiring') items = items.filter(g => g.lots.some(l => lotStatus(l).label === 'Por vencer'))
    if (inventoryFilter === 'expired')  items = items.filter(g => g.lots.some(l => lotStatus(l).label === 'Vencido'))
    if (inventorySort === 'quantity-desc' || inventorySort === 'quantity-asc') {
      const dir = inventorySort === 'quantity-desc' ? -1 : 1
      return [...items].sort((a,b) => {
        const aEq = Object.values(a.equivalents).reduce((s,v) => s + v, 0) || a.quantity
        const bEq = Object.values(b.equivalents).reduce((s,v) => s + v, 0) || b.quantity
        return dir * (aEq - bEq)
      })
    }
    if (inventorySort === 'expiry')   return [...items].sort((a,b) => (a.lots[0]?.expiry_date||'9999-12-31').localeCompare(b.lots[0]?.expiry_date||'9999-12-31'))
    return items
  }, [inventoryProducts, inventoryFilter, inventorySort])

  const visibleProducts = (showAllProducts || search.trim() || inventoryFilter !== 'all') ? displayedProducts : displayedProducts.slice(0, 8)

  // request: unique product identities for step 1 select
  const reqProductOptions = useMemo(() => {
    const map = new Map()
    lots.forEach(lot => {
      const key = productIdentityKey(lot)
      if (!map.has(key)) map.set(key, productIdentityLabel(lot))
    })
    return [...map.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a,b) => a.label.localeCompare(b.label,'es',{numeric:true}))
  }, [lots])

  // request: lots for selected product
  const reqProductLots = useMemo(() => {
    if (!reqProductName) return []
    return lots.filter(l => productIdentityKey(l) === reqProductName)
  }, [lots, reqProductName])

  const selectedLot = lots.find(l => l.id === reqLotId)

  /* ─── request actions ─────────────────────────────────────────── */
  function addReqItem() {
    setReqMessage('')
    const qty = Number(reqQuantity||0)
    if (!selectedLot) { setReqMessage('Selecciona un lote.'); return }
    if (qty <= 0) { setReqMessage('Ingresa una cantidad mayor a 0.'); return }
    if (qty > Number(selectedLot.current_quantity||0)) { setReqMessage('La cantidad supera los envases disponibles.'); return }
    if (!['Disponible','Por vencer'].includes(lotStatus(selectedLot).label)) { setReqMessage('Este lote no está disponible.'); return }
    setReqItems(cur => {
      const existing = cur.find(i => i.lot_id === selectedLot.id)
      if (existing) {
        const next = editingLotId === selectedLot.id ? qty : Number(existing.quantity||0) + qty
        if (next > Number(selectedLot.current_quantity||0)) { setReqMessage('Cantidad supera stock disponible.'); return cur }
        return cur.map(i => i.lot_id === selectedLot.id ? { ...i, quantity: next, available: selectedLot.current_quantity } : i)
      }
      return [...cur, { lot_id: selectedLot.id, client_id: selectedLot.client_id, client_name: selectedLot.clients?.name||clientName, lot_code: selectedLot.lot_code, product: selectedLot.product, solucion_product_code: selectedLot.solucion_product_code, quantity: qty, package_size: selectedLot.package_size, package_unit: selectedLot.package_unit, location: selectedLot.location, available: selectedLot.current_quantity }]
    })
    setReqLotId(''); setReqQuantity(''); setEditingLotId(''); setReqProductName('')
  }

  function removeReqItem(lotId) {
    setReqItems(cur => cur.filter(i => i.lot_id !== lotId))
    if (editingLotId === lotId) { setEditingLotId(''); setReqLotId(''); setReqQuantity('') }
  }

  function editReqItem(item) {
    setEditingLotId(item.lot_id); setReqLotId(item.lot_id); setReqQuantity(String(item.quantity||''))
    const lot = lots.find(l => l.id === item.lot_id) || item
    setReqProductName(productIdentityKey(lot)); setReqMessage('Editando item de la lista.')
  }

  function clearCart() {
    setReqLotId(''); setReqQuantity(''); setReqItems([]); setReqNotes('')
    setEditingLotId(''); setReqMessage(''); setReqSuccess(null); setReqProductName(''); clearDraft()
  }

  async function submitRequest(e) {
    e.preventDefault(); setReqMessage('')
    if (reqItems.length === 0) { setReqMessage('Agrega al menos un producto.'); return }
    const profileClientId = profile?.client_id
    if (!profileClientId) { setReqMessage('Tu usuario no está vinculado a un cliente. Contacta a almacén.'); return }
    const norm = await normalizeDispatchRequests({ items: reqItems, client_id: profile?.client_id||null, client_name: clientName, clients:{ name: clientName } }, lots)
    const fresh = norm?.items || []
    const over  = fresh.find(i => Number(i.quantity||0) > Number(i.current_quantity ?? i.available ?? 0))
    const clientIds = [...new Set(fresh.map(i => i.client_id).filter(Boolean))]
    const clientId  = profileClientId
    if (!fresh[0] || !clientId) { setReqMessage('No se pudo validar el cliente. Recarga e intenta de nuevo.'); return }
    if (clientIds.some(id => id !== clientId)) { setReqMessage('La solicitud contiene productos de otro cliente. Recarga e intenta de nuevo.'); return }
    if (over) { setReqMessage(`${cleanProductName(over.product)} solo tiene ${formatNumber(over.current_quantity ?? over.available ?? 0)} env. disponibles.`); return }
    const { error } = await supabase.from('client_dispatch_requests').insert({
      client_id: clientId, lot_id: fresh[0].lot_id,
      product: fresh.length === 1 ? fresh[0].product : `Lista de despacho (${fresh.length} productos)`,
      quantity: fresh.reduce((s,i) => s + Number(i.quantity||0), 0),
      items: fresh.map(i => ({ ...i, client_id: i.client_id||clientId, client_name: i.client_name||clientName })),
      notes: reqNotes.trim()||null, status:'pendiente', requested_by: user.id,
    })
    if (error) { setReqMessage('No se pudo enviar la solicitud. Contacta a almacén.'); return }
    setReqLotId(''); setReqQuantity(''); setReqItems([]); setReqNotes(''); setEditingLotId(''); setReqProductName(''); clearDraft()
    setReqSuccess({ clientName, items: fresh, createdAt: new Date().toISOString() })
    if (navigator.vibrate) navigator.vibrate(80)
    loadData()
  }

  /* ─── exports ─────────────────────────────────────────────────── */
  async function exportExcel() {
    try {
      const date = new Date().toISOString().slice(0, 10)
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Inventario')

      // Column widths
      ws.columns = [
        { key: 'producto',     width: 40 },
        { key: 'lote',         width: 22 },
        { key: 'envases',      width: 11 },
        { key: 'presentacion', width: 15 },
        { key: 'equivalente',  width: 17 },
        { key: 'ubicacion',    width: 20 },
        { key: 'ingreso',      width: 14 },
        { key: 'vencimiento',  width: 14 },
        { key: 'estado',       width: 14 },
      ]

      // Row 1: client name — green header
      const titleRow = ws.addRow([clientName])
      ws.mergeCells('A1:I1')
      titleRow.height = 28
      titleRow.getCell(1).font  = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
      titleRow.getCell(1).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D593A' } }
      titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }

      // Row 2: subtitle
      const subRow = ws.addRow([`Inventario al ${date}`])
      ws.mergeCells('A2:I2')
      subRow.getCell(1).font      = { italic: true, size: 10, color: { argb: 'FF475569' } }
      subRow.getCell(1).alignment = { horizontal: 'left', indent: 1 }

      // Row 3: blank spacer
      ws.addRow([])

      // Row 4: column headers
      const headerLabels = ['Producto', 'Lote', 'Envases', 'Presentación', 'Equivalente', 'Ubicación', 'Ingreso', 'Vencimiento', 'Estado']
      const hdrRow = ws.addRow(headerLabels)
      hdrRow.height = 18
      hdrRow.eachCell(cell => {
        cell.font      = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6F45' } }
        cell.alignment = { vertical: 'middle', horizontal: 'right' }
        cell.border    = { bottom: { style: 'thin', color: { argb: 'FF1D593A' } } }
      })
      // Producto left-aligned in header
      hdrRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }

      // Data rows
      lots.forEach((l, i) => {
        let eqStr = ''
        try { const eq = lotEquivalent(l); if (eq) eqStr = `${formatNumber(eq.quantity)} ${eq.unit}` } catch (_) {}
        const row = ws.addRow([
          cleanProductName(l.product) || '',
          displayLotCode(l.lot_code, l) || '',
          Number(l.current_quantity || 0),
          l.package_size ? `${l.package_size} ${l.package_unit || ''}`.trim() : '',
          eqStr,
          l.location || '',
          l.entry_date ? formatDate(l.entry_date) : '',
          l.expiry_date ? formatDate(l.expiry_date) : '',
          lotStatus(l).label || '',
        ])
        row.eachCell((cell, colNum) => {
          cell.alignment = colNum === 1
            ? { vertical: 'middle', horizontal: 'left', wrapText: true }
            : { vertical: 'middle', horizontal: 'right' }
          cell.font   = { size: 10 }
          cell.border = { top: { style: 'thin', color: { argb: 'FFCBD5E1' } } }
        })
      })

      // Download
      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `inventario-${clientName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${date}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(`Error al generar Excel: ${err.message}`)
    }
  }

  function printPdf() {
    const date = formatDate(new Date().toISOString())
    const rows = lots.map(l => {
      let eqStr = '-'
      try { const eq = lotEquivalent(l); if (eq) eqStr = `${formatNumber(eq.quantity)} ${eq.unit}` } catch (_) {}
      const st = lotStatus(l)
      const stColor = st.label === 'Disponible' ? '#166534' : st.label === 'Por vencer' ? '#92400e' : st.label === 'Vencido' ? '#991b1b' : '#374151'
      return `<tr>
        <td>${escapeHtml(cleanProductName(l.product))}</td>
        <td>${escapeHtml(displayLotCode(l.lot_code, l))}</td>
        <td style="text-align:right">${escapeHtml(formatNumber(l.current_quantity))}</td>
        <td style="text-align:right">${escapeHtml(eqStr)}</td>
        <td>${escapeHtml(l.location || '-')}</td>
        <td style="text-align:right">${escapeHtml(l.expiry_date ? formatDate(l.expiry_date) : '-')}</td>
        <td style="color:${stColor};font-weight:600">${escapeHtml(st.label)}</td>
      </tr>`
    }).join('')

    const w = window.open('', '_blank'); if (!w) return
    w.document.write(`<!doctype html><html><head>
<title>Inventario ${escapeHtml(clientName)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { color: #0f172a; font-family: Arial, sans-serif }
  .header { background: #1d593a; color: #fff; padding: 18px 24px 14px }
  .header h1 { font-size: 20px; font-weight: 800; letter-spacing: .01em }
  .header p  { font-size: 11px; margin-top: 2px; opacity: .75 }
  .meta { padding: 10px 24px 0; display: flex; justify-content: space-between; align-items: baseline }
  .meta .client { font-size: 15px; font-weight: 700; color: #1d593a }
  .meta .date   { font-size: 10px; color: #64748b }
  .divider { border: none; border-top: 2px solid #1d593a; margin: 8px 24px 0 }
  table  { border-collapse: collapse; width: calc(100% - 48px); margin: 12px 24px 0; font-size: 11px }
  thead tr { background: #1f6f45; color: #fff }
  th { padding: 7px 8px; text-align: left; font-weight: 700; font-size: 10px; letter-spacing: .04em; text-transform: uppercase }
  th.r { text-align: right }
  td { padding: 6px 8px; border-top: 1px solid #e2e8f0; vertical-align: top }
  .terms { font-size: 9px; color: #94a3b8; margin: 14px 24px 0 }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact }
    @page { margin: 12mm }
    .header, thead tr { background: #1d593a !important; color: #fff !important }
  }
</style>
</head><body>
<div class="header">
  <h1>Todo Agricola Boliviana Ltda</h1>
  <p>Portal de almacén</p>
</div>
<div class="meta">
  <span class="client">${escapeHtml(clientName)}</span>
  <span class="date">Emitido: ${escapeHtml(date)}</span>
</div>
<hr class="divider"/>
<table>
  <thead><tr>
    <th>Producto</th><th>Lote</th>
    <th class="r">Envases</th><th class="r">Equivalente</th>
    <th>Ubicacion</th><th class="r">Vence</th><th>Estado</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<p class="terms">Informacion referencial sujeta a validacion operativa de Todo Agricola Boliviana Ltda.</p>
<script>window.addEventListener('load',()=>window.print())</script>
</body></html>`)
    w.document.close()
  }

  function printReceipt(movement) {
    const lot = movement.lots||{}; const eq = Number(movement.quantity||0)*Number(lot.package_size||0)
    const type = movement.type==='salida'?'despacho':movementLabel(movement.type).toLowerCase()
    const w = window.open('','_blank'); if(!w) return
    w.document.write(`<!doctype html><html><head><title>Comprobante</title><style>body{color:#0f172a;font-family:Arial,sans-serif;margin:24px}h1{margin:0 0 4px}.box{border:1px solid #cbd5e1;border-radius:8px;margin-top:14px;padding:12px}.grid{display:grid;gap:10px;grid-template-columns:repeat(2,1fr)}strong{display:block}@media print{body{margin:12mm}}</style></head><body><h1>Todo Agricola Boliviana Ltda</h1><p>Comprobante de ${escapeHtml(type)} para ${escapeHtml(clientName)}</p><div class="box grid"><div><strong>Fecha</strong>${escapeHtml(formatDate(movement.created_at))}</div><div><strong>Movimiento</strong>${escapeHtml(movementLabel(movement.type))}</div><div><strong>Codigo</strong>${escapeHtml(productCodeLabel(lot)||'-')}</div><div><strong>Lote</strong>${escapeHtml(displayLotCode(lot.lot_code,lot))}</div><div><strong>Producto</strong>${escapeHtml(cleanProductName(lot.product))}</div><div><strong>Cantidad</strong>${escapeHtml(formatNumber(movement.quantity))} envases</div><div><strong>Equivalente</strong>${escapeHtml(Number(lot.package_size)>0?`${formatNumber(eq)} ${lot.package_unit||''}`:'-')}</div><div><strong>Ubicacion</strong>${escapeHtml(lot.location||'-')}</div></div>${movement.notes?`<div class="box"><strong>Referencia</strong>${escapeHtml(movement.notes)}</div>`:''}<script>window.addEventListener('load',()=>window.print())</script></body></html>`)
    w.document.close()
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  /* ─── views ───────────────────────────────────────────────────── */
  const isInventory = view === 'inventory'
  const isRequests  = view === 'requests'
  const isMovements = view === 'movements'
  const hasClientProfile = Boolean(profile?.client_id)

  /* ═══════════════════ RENDER ════════════════════════════════════ */
  if (!loading && !hasClientProfile) {
    return (
      <div className="space-y-4 pb-2">
        <div className="rounded-2xl bg-campo-700 px-5 py-5 text-white shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-campo-200">Portal de cliente</p>
          <h1 className="mt-1 text-xl font-black">Cuenta sin cliente asignado</h1>
          <p className="mt-0.5 text-sm font-semibold text-campo-200">
            Tu usuario necesita estar vinculado a un cliente para ver inventario y solicitudes.
          </p>
        </div>
        <EmptyState
          title="No hay cliente vinculado"
          text="Contacta a almacén o administración para asignar este usuario a una cuenta de cliente."
        />
      </div>
    )
  }

  const headerTabs = [
    { to: '/',          label: 'Inventario',  Icon: Boxes,   active: isInventory, badge: 0 },
    { to: '/despachos', label: 'Solicitudes', Icon: Truck,   active: isRequests,  badge: preparingDispatchRequests.length },
    { to: '/historial', label: 'Movimientos', Icon: History, active: isMovements, badge: 0 },
  ]

  const actionBtns = (size = 15, cls = 'h-8 w-8') => (
    <div className="flex shrink-0 items-center gap-1.5">
      <button onClick={exportExcel} title="Descargar Excel" className={`flex ${cls} items-center justify-center rounded-lg border border-white/20 bg-white/10 transition hover:bg-white/25`}>
        <Download size={size} />
      </button>
      <button onClick={printPdf} title="Imprimir PDF" className={`flex ${cls} items-center justify-center rounded-lg border border-white/20 bg-white/10 transition hover:bg-white/25`}>
        <FileText size={size} />
      </button>
      <button onClick={handleSignOut} title="Cerrar sesión" className={`flex ${cls} items-center justify-center rounded-lg border border-white/20 bg-white/10 transition hover:bg-white/25`}>
        <LogOut size={size} />
      </button>
    </div>
  )

  return (
    <div className="min-h-screen">

      {/* ══ UNIFIED STICKY HEADER ════════════════════════════════════ */}
      <header className="sticky top-0 z-20 bg-campo-800 text-white shadow-md">

        {/* ── Desktop (sm+): 2 rows ── */}
        <div className="hidden sm:block">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1">
              <img src="/images/todo-logo.png" alt="Todo Agrícola" className="h-full w-full object-contain" />
            </div>
            <div className="shrink-0">
              <p className="text-xs font-black uppercase tracking-widest text-white/90">Todo Agrícola Boliviana</p>
              <p className="text-[10px] font-semibold text-campo-300">Portal de cliente</p>
            </div>
            <div className="min-w-0 flex-1 px-4">
              <p className="truncate text-base font-black text-white">{clientName}</p>
            </div>
            {actionBtns(15, 'h-8 w-8')}
          </div>
          <div className="mx-auto flex max-w-5xl border-t border-white/10 px-3">
            {headerTabs.map(({ to, label, Icon, active, badge }) => (
              <Link key={to} to={to} className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-black transition ${active ? 'border-campo-300 text-white' : 'border-transparent text-white/55 hover:text-white/80'}`}>
                <Icon size={16} aria-hidden="true" /> {label}
                {badge > 0 && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">{badge}</span>}
              </Link>
            ))}
          </div>
        </div>

        {/* ── Mobile: 3 rows ── */}
        <div className="sm:hidden">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-0.5">
              <img src="/images/todo-logo.png" alt="Todo Agrícola" className="h-full w-full object-contain" />
            </div>
            <p className="text-[11px] font-black uppercase tracking-widest text-white/80">Todo Agrícola Boliviana</p>
            <div className="flex-1" />
            {actionBtns(13, 'h-7 w-7')}
          </div>
          <div className="border-t border-white/10 px-4 py-2">
            <p className="text-base font-black leading-snug text-white [overflow-wrap:anywhere]">{clientName}</p>
          </div>
          <div className="flex border-t border-white/10">
            {headerTabs.map(({ to, label, Icon, active, badge }) => (
              <Link key={to} to={to} className={`relative flex flex-1 flex-col items-center gap-1 border-b-2 py-2.5 text-[10px] font-black transition ${active ? 'border-campo-300 text-white' : 'border-transparent text-white/45 hover:text-white/70'}`}>
                <span className="relative">
                  <Icon size={17} aria-hidden="true" />
                  {badge > 0 && <span className="absolute -right-2 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-0.5 text-[8px] font-black text-white">{badge}</span>}
                </span>
                {label}
              </Link>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-4 px-4 py-5 pb-8">

      {/* ── DASHBOARD (Inicio) ─────────────────────────────────── */}
      {isInventory && (
        <>
          {/* Metrics */}
          {(() => {
            const eqTotals = { lts: 0, kgs: 0 }
            lots.forEach(l => {
              const eq = lotEquivalent(l)
              if (!eq || eq.quantity <= 0) return
              const u = eq.unit.toLowerCase().trim()
              if (/^l/.test(u)) eqTotals.lts += eq.quantity
              else if (/^kg/.test(u)) eqTotals.kgs += eq.quantity
              else if (/^gr?$/.test(u)) eqTotals.kgs += eq.quantity / 1000
            })
            const eqLabel = [
              eqTotals.lts > 0 ? `${formatNumber(eqTotals.lts)} lts` : null,
              eqTotals.kgs > 0 ? `${formatNumber(eqTotals.kgs)} kgs` : null,
            ].filter(Boolean).join(' · ')
            return (
              <div className="grid grid-cols-3 gap-2">
                <MetricCard icon={Boxes} label="Envases en almacén" value={formatNumber(totalStock)} sub={eqLabel || null} color="campo" />
                <MetricCard icon={Package} label="Lotes en almacén" value={productCount} color="slate" onClick={() => setShowProductsModal(true)} />
                <MetricCard
                  icon={expiring.length > 0 ? CalendarClock : PackageCheck}
                  label={expiring.length > 0 ? 'Lotes por vencer' : 'Sin alertas'}
                  value={expiring.length > 0 ? expiring.length : '✓'}
                  color={expiring.length > 0 ? 'amber' : 'campo'}
                  onClick={expiring.length > 0 ? () => setShowExpiryModal(true) : undefined}
                />
              </div>
            )
          })()}

          {/* Active requests banner */}
          {activeRequests.length > 0 && (
            <Link
              to="/despachos"
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-campo-200 bg-campo-50 px-4 py-3 transition hover:bg-campo-100"
            >
              <div className="flex items-center gap-2">
                <ClipboardList size={18} className="text-campo-700" />
                <span className="text-sm font-black text-campo-800">
                  {activeRequests.length} solicitud{activeRequests.length > 1 ? 'es' : ''} pendiente{activeRequests.length > 1 ? 's' : ''} en almacén
                </span>
              </div>
              <span className="text-xs font-bold text-campo-600">Ver →</span>
            </Link>
          )}

          {/* Filter chips + Sort */}
          {(() => {
            const expiringCount = inventoryProducts.filter(g => g.lots.some(l => lotStatus(l).label === 'Por vencer')).length
            const expiredCount  = inventoryProducts.filter(g => g.lots.some(l => lotStatus(l).label === 'Vencido')).length
            return (
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { key: 'all',      label: 'Todo',       count: inventoryProducts.length, active: 'bg-campo-700 text-white' },
                    { key: 'expiring', label: 'Por vencer', count: expiringCount,             active: 'bg-amber-500 text-white' },
                    { key: 'expired',  label: 'Vencidos',   count: expiredCount,              active: 'bg-red-500 text-white'   },
                  ].map(({ key, label, count, active }) => (
                    <button
                      key={key}
                      onClick={() => setInventoryFilter(key)}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black transition ${inventoryFilter === key ? active : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                      {label}
                      {count > 0 && (
                        <span className={`rounded-full px-1.5 text-[10px] font-black ${inventoryFilter === key ? 'bg-white/25 text-white' : 'bg-white text-slate-500'}`}>{count}</span>
                      )}
                    </button>
                  ))}
                </div>
                <select
                  value={inventorySort}
                  onChange={e => setInventorySort(e.target.value)}
                  className="shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-slate-600 outline-none"
                >
                  <option value="name">A–Z</option>
                  <option value="quantity-desc">↓ Cantidad</option>
                  <option value="quantity-asc">↑ Cantidad</option>
                </select>
              </div>
            )
          })()}

          {/* Product list */}
          {loading ? (
            <p className="py-10 text-center text-sm font-bold text-slate-400">Cargando inventario...</p>
          ) : filteredLots.length === 0 ? (
            <EmptyState title="Sin productos" text="No hay inventario disponible en este momento." />
          ) : (
            <div className="space-y-2">
              {visibleProducts.map(group => {
                const isOpen = expandedProduct === group.key
                return (
                  <article key={group.key} className={`flex overflow-hidden rounded-xl border bg-white shadow-sm ${group.expired > 0 ? 'border-red-200' : group.expiring > 0 ? 'border-amber-200' : 'border-slate-200'}`}>
                    {(group.expired > 0 || group.expiring > 0) && (
                      <div className={`w-1 shrink-0 ${group.expired > 0 ? 'bg-red-400' : 'bg-amber-400'}`} />
                    )}
                    <div className="min-w-0 flex-1">
                    <button
                      className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition hover:bg-campo-50/60"
                      onClick={() => setExpandedProduct(isOpen ? '' : group.key)}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-black text-slate-950 [overflow-wrap:anywhere]">{group.product}</p>
                        {group.identity !== group.product ? (
                          <p className="mt-0.5 text-xs font-semibold text-slate-500 [overflow-wrap:anywhere]">{group.identity}</p>
                        ) : null}
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
                          <span>{group.lots.length} lote{group.lots.length > 1 ? 's' : ''}</span>
                          {group.expiring > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">{group.expiring} por vencer</span>}
                          {group.expired  > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-600">{group.expired} vencido{group.expired > 1 ? 's' : ''}</span>}
                          {group.retained > 0 && <span className="rounded-full bg-orange-50 px-2 py-0.5 text-orange-700">{group.retained} retenido</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <div className="text-right">
                          {Object.keys(group.equivalents).length > 0 ? (
                            <>
                              <p className="text-base font-black text-campo-700">{equivalentTotalsLabel(group.equivalents)}</p>
                              <p className="text-[10px] font-semibold text-slate-400">{formatNumber(group.quantity)} envases</p>
                            </>
                          ) : (
                            <p className="text-base font-black text-campo-700">{formatNumber(group.quantity)} <span className="text-xs font-bold text-campo-500">env.</span></p>
                          )}
                        </div>
                        <ChevronDown size={18} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </div>
                    </button>

                    {isOpen && (
                      <div className="divide-y divide-slate-100 border-t border-slate-100">
                        {group.lots.map(lot => {
                          const st  = lotStatus(lot)
                          const eq  = lotEquivalent(lot)
                          return (
                            <Link key={lot.id} to={`/lotes/${lot.id}`} className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-campo-50/40">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-black text-slate-900">{lotLabel(lot.lot_code, lot)}</p>
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                                </div>
                                <p className="mt-0.5 text-xs font-semibold text-slate-500">
                                  {lot.location || 'Sin ubicación'} · Vence: {lot.expiry_date ? formatDate(lot.expiry_date) : 'Sin dato'}
                                </p>
                              </div>
                              <div className="shrink-0 text-right">
                                {eq ? (
                                  <>
                                    <p className="text-sm font-black text-campo-700">{formatNumber(eq.quantity)} {eq.unit}</p>
                                    <p className="text-[10px] font-semibold text-slate-400">{formatNumber(lot.current_quantity)} envases</p>
                                  </>
                                ) : (
                                  <p className="text-sm font-black text-campo-700">{formatNumber(lot.current_quantity)} env.</p>
                                )}
                              </div>
                            </Link>
                          )
                        })}
                      </div>
                    )}
                    </div>{/* min-w-0 flex-1 */}
                  </article>
                )
              })}

              {!search.trim() && inventoryFilter === 'all' && !showAllProducts && displayedProducts.length > 8 && (
                <button
                  className="w-full rounded-xl border border-slate-200 bg-white py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
                  onClick={() => setShowAllProducts(true)}
                >
                  Ver todos los productos ({displayedProducts.length})
                </button>
              )}
            </div>
          )}

          {/* Search */}
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
            <Search size={17} className="shrink-0 text-slate-400" />
            <input
              className="min-h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
              placeholder="Buscar producto, lote, ubicación..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="text-slate-400 hover:text-slate-700" onClick={() => setSearch('')}>
                <X size={15} />
              </button>
            )}
          </div>

          {/* Recent movements */}
          {movements.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <History size={16} className="text-campo-700" />
                  <p className="text-sm font-black text-slate-950">Últimos movimientos</p>
                </div>
                <Link to="/historial" className="text-xs font-bold text-campo-700 hover:underline">Ver todos</Link>
              </div>
              <div className="divide-y divide-slate-100">
                {movements.slice(0,4).map(m => {
                  const lot = m.lots || {}
                  return (
                    <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                      <span className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-black uppercase ${m.type === 'entrada' ? 'bg-campo-100 text-campo-800' : 'bg-red-50 text-red-700'}`}>
                        {m.type === 'entrada' ? 'Ingreso' : 'Salida'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-900 truncate">{cleanProductName(lot.product)}</p>
                        <p className="text-xs font-semibold text-slate-400">{formatDate(m.created_at)}</p>
                      </div>
                      <p className="shrink-0 text-sm font-black text-campo-700">{formatNumber(m.quantity)} env.</p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── SOLICITUDES ───────────────────────────────────────────── */}
      {isRequests && (
        <div className="space-y-4">

          <div className="grid grid-cols-3 gap-2">
            <MetricCard icon={ClipboardList} label="Pendientes" value={pendingDispatchRequests.length} color="amber" />
            <MetricCard icon={PackageCheck} label="En preparación" value={preparingDispatchRequests.length} color="campo" />
            <MetricCard icon={Truck} label="Despachadas" value={dispatchedRequests.length} color="slate" />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">

            {/* Form */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="font-black text-slate-950">Nueva solicitud</p>
                <p className="text-xs font-semibold text-slate-500">Seleccioná producto, lote y cantidad.</p>
              </div>

              {reqSuccess ? (
                <div className="flex flex-col items-center p-6 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-campo-50 ring-8 ring-campo-100">
                    <CheckCircle2 size={34} className="text-campo-600" />
                  </div>
                  <h2 className="mt-4 text-xl font-black text-slate-950">¡Solicitud enviada!</h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    {reqSuccess.items.length === 1 ? '1 producto quedó' : `${reqSuccess.items.length} productos quedaron`} como despacho pendiente.
                  </p>
                  <div className="mt-5 w-full space-y-2 text-left">
                    {reqSuccess.items.map(item => {
                      const eq = itemEquivalent(item)
                      return (
                        <div key={item.lot_id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-campo-100">
                            <PackageCheck size={15} className="text-campo-700" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-black text-slate-900 [overflow-wrap:anywhere]">{cleanProductName(item.product)}</p>
                            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0">
                              {eq
                                ? <>
                                    <span className="text-sm font-black text-campo-700">{formatNumber(eq.quantity)} {eq.unit}</span>
                                    <span className="text-[10px] font-semibold text-slate-400">({formatNumber(item.quantity)} env.)</span>
                                  </>
                                : <span className="text-xs font-semibold text-slate-600">{formatNumber(item.quantity)} env.</span>
                              }
                              <span className="text-[10px] font-semibold text-slate-400">· {lotLabel(item.lot_code, item)}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-4 flex w-full items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-left">
                    <CalendarClock size={14} className="mt-0.5 shrink-0 text-amber-600" />
                    <p className="text-xs font-semibold text-amber-800">Almacén procesará tu solicitud y te avisará cuando esté lista para retirar.</p>
                  </div>
                  <button className="btn-primary mt-5 w-full" onClick={() => setReqSuccess(null)}>
                    <Plus size={16} /> Nueva solicitud
                  </button>
                </div>
              ) : (
                <form className="space-y-4 p-4" onSubmit={submitRequest} noValidate>

                  {/* Step 1: producto */}
                  <label className="block">
                    <span className="text-xs font-black uppercase tracking-wide text-slate-500">1 · Producto</span>
                    <select
                      className="input mt-1.5"
                      value={reqProductName}
                      onChange={e => { setReqProductName(e.target.value); setReqLotId('') }}
                    >
                      <option value="">Seleccionar producto...</option>
                      {reqProductOptions.map(option => (
                        <option key={option.key} value={option.key}>{option.label}</option>
                      ))}
                    </select>
                  </label>

                  {/* Step 2: lote */}
                  {reqProductName && (
                    <label className="block">
                      <span className="text-xs font-black uppercase tracking-wide text-slate-500">2 · Lote</span>
                      <select className="input mt-1.5" value={reqLotId} onChange={e => setReqLotId(e.target.value)}>
                        <option value="">Seleccionar lote...</option>
                        {reqProductLots.map(l => (
                          <option key={l.id} value={l.id}>
                            {lotLabel(l.lot_code, l)} · {formatNumber(l.current_quantity)} env. {l.expiry_date ? `· Vence ${formatDate(l.expiry_date)}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {/* Selected lot info */}
                  {selectedLot && (
                    <div className="rounded-xl border border-campo-100 bg-campo-50 px-3 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-black text-slate-900 [overflow-wrap:anywhere]">{cleanProductName(selectedLot.product)}</p>
                          <p className="mt-0.5 text-xs font-semibold text-slate-500">
                            {lotLabel(selectedLot.lot_code, selectedLot)} · {selectedLot.location || 'Sin ubicación'}
                          </p>
                          {selectedLot.expiry_date && (
                            <p className="text-xs font-semibold text-slate-500">Vence: {formatDate(selectedLot.expiry_date)}</p>
                          )}
                        </div>
                        <div className="shrink-0 rounded-lg bg-white px-3 py-2 text-right shadow-sm">
                          {(() => {
                            const eq = lotEquivalent(selectedLot)
                            return eq ? (
                              <>
                                <p className="text-lg font-black text-campo-700">{formatNumber(eq.quantity)} <span className="text-sm font-bold text-campo-500">{eq.unit}</span></p>
                                <p className="text-[10px] font-semibold text-slate-400">{formatNumber(selectedLot.current_quantity)} env. disp.</p>
                              </>
                            ) : (
                              <>
                                <p className="text-lg font-black text-campo-700">{formatNumber(selectedLot.current_quantity)}</p>
                                <p className="text-[10px] font-bold text-slate-500">env. disp.</p>
                              </>
                            )
                          })()}
                        </div>
                      </div>
                      {packageLabel(selectedLot) && (
                        <p className="mt-2 text-xs font-semibold text-campo-700">Presentación: {packageLabel(selectedLot)}</p>
                      )}
                    </div>
                  )}

                  {/* Step 3: cantidad */}
                  {reqLotId && (
                    <label className="block">
                      <span className="text-xs font-black uppercase tracking-wide text-slate-500">3 · Cantidad de envases</span>
                      <div className="flex items-center gap-2 mt-1.5">
                        <input
                          className="input flex-1"
                          inputMode="decimal"
                          type="text"
                          placeholder="Ej: 50"
                          value={reqQuantity}
                          onChange={e => { const v = e.target.value.replace(',','.'); if(/^\d*\.?\d*$/.test(v)) setReqQuantity(v) }}
                        />
                        {Number(reqQuantity) > 0 && Number(selectedLot?.package_size) > 0 && selectedLot?.package_unit && (
                          <span className="shrink-0 rounded-lg bg-campo-50 px-3 py-2 text-sm font-black text-campo-700">
                            {formatNumber(Number(reqQuantity) * Number(selectedLot.package_size))} {selectedLot.package_unit}
                          </span>
                        )}
                      </div>
                    </label>
                  )}

                  {/* Add button */}
                  {reqLotId && (
                    <button className="btn-secondary w-full" type="button" onClick={addReqItem}>
                      <Plus size={18} />
                      Agregar producto
                    </button>
                  )}

                  {/* Cart */}
                  {reqItems.length > 0 && (
                    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-black uppercase text-slate-500">Lista de despacho · {reqItems.length} item{reqItems.length > 1 ? 's' : ''}</p>
                        <button className="text-xs font-bold text-red-500 hover:underline" type="button" onClick={clearCart}>Vaciar</button>
                      </div>
                      {reqItems.map(item => {
                        const eq = itemEquivalent(item)
                        return (
                        <div key={item.lot_id} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2.5 shadow-sm">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-black text-slate-900 [overflow-wrap:anywhere]">{cleanProductName(item.product)}</p>
                            <p className="text-xs font-semibold text-slate-500">{lotLabel(item.lot_code, item)}</p>
                            <div className="mt-0.5 flex items-baseline gap-1.5">
                              {eq
                                ? <>
                                    <span className="text-sm font-black text-campo-700">{formatNumber(eq.quantity)} {eq.unit}</span>
                                    <span className="text-[10px] font-semibold text-slate-400">({formatNumber(item.quantity)} env.)</span>
                                  </>
                                : <span className="text-xs font-black text-slate-700">{formatNumber(item.quantity)} env.</span>
                              }
                            </div>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <button className="rounded-lg p-1.5 text-slate-400 hover:bg-campo-50 hover:text-campo-700" type="button" onClick={() => editReqItem(item)} title="Editar">
                              <Minus size={14} />
                            </button>
                            <button className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" type="button" onClick={() => removeReqItem(item.lot_id)} title="Quitar">
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Notes */}
                  {reqItems.length > 0 && (
                    <label className="block">
                      <span className="text-xs font-black uppercase tracking-wide text-slate-500">Observación (opcional)</span>
                      <textarea className="input mt-1.5" rows={2} placeholder="Instrucciones especiales para almacén..." value={reqNotes} onChange={e => setReqNotes(e.target.value)} />
                    </label>
                  )}

                  {reqMessage && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm font-bold text-amber-800">{reqMessage}</p>
                  )}

                  {reqItems.length > 0 && (
                    <button className="btn-primary w-full" type="submit">
                      <Send size={18} /> Enviar solicitud a almacén
                    </button>
                  )}
                </form>
              )}
            </div>

            {/* Request history */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="font-black text-slate-950">Mis solicitudes</p>
                <p className="text-xs font-semibold text-slate-500">{requests.length} solicitud{requests.length !== 1 ? 'es' : ''} en total</p>
              </div>
              <div className="space-y-2 overflow-y-auto p-3" style={{maxHeight:'520px'}}>
                {requests.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm font-bold text-slate-400">Todavía no hay solicitudes.</p>
                ) : (
                  requests.map(req => {
                    const st = requestStatus(req.status)
                    const items = Array.isArray(req.items) && req.items.length > 0 ? req.items : null
                    return (
                      <div key={req.id} className="flex overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
                        <div className={`w-1.5 shrink-0 ${st.accent}`} />
                        <div className="min-w-0 flex-1 px-3 py-3">
                          <div className="flex items-start justify-between gap-2">
                            <p className="min-w-0 text-sm font-black text-slate-900 [overflow-wrap:anywhere]">
                              {items ? `${items.length} producto${items.length > 1 ? 's' : ''}` : cleanProductName(req.product || req.lots?.product)}
                            </p>
                            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${st.cls}`}>{st.label}</span>
                          </div>
                          {items && (
                            <div className="mt-1.5 space-y-1">
                              {items.slice(0,3).map(item => {
                                const eq = itemEquivalent(item)
                                return (
                                  <div key={item.lot_id} className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="text-xs font-semibold text-slate-600 [overflow-wrap:anywhere]">· {cleanProductName(item.product)}</p>
                                      {item.lot_code && (
                                        <p className="text-[10px] font-semibold text-slate-400 [overflow-wrap:anywhere]">Lote: {displayLotCode(item.lot_code, item)}</p>
                                      )}
                                    </div>
                                    <div className="shrink-0 text-right">
                                      {eq
                                        ? <>
                                            <span className="text-xs font-black text-campo-700">{formatNumber(eq.quantity)} {eq.unit}</span>
                                            <span className="ml-1 text-[10px] font-semibold text-slate-400">({formatNumber(item.quantity)} env.)</span>
                                          </>
                                        : <span className="text-xs font-black text-slate-700">{formatNumber(item.quantity)} env.</span>
                                      }
                                    </div>
                                  </div>
                                )
                              })}
                              {items.length > 3 && <p className="text-xs font-semibold text-slate-400">+ {items.length - 3} más</p>}
                            </div>
                          )}
                          {!items && (() => {
                            const eq = itemEquivalent({ product: req.product || req.lots?.product, quantity: req.quantity, package_size: req.lots?.package_size, package_unit: req.lots?.package_unit })
                            return (
                              <div className="mt-0.5 flex items-baseline justify-between gap-2">
                                <p className="text-xs font-semibold text-slate-500">{lotLabel(req.lots?.lot_code, req.lots)}</p>
                                <div className="shrink-0 text-right">
                                  {eq
                                    ? <>
                                        <span className="text-xs font-black text-campo-700">{formatNumber(eq.quantity)} {eq.unit}</span>
                                        <span className="ml-1 text-[10px] font-semibold text-slate-400">({formatNumber(req.quantity)} env.)</span>
                                      </>
                                    : <span className="text-xs font-black text-slate-700">{formatNumber(req.quantity)} env.</span>
                                  }
                                </div>
                              </div>
                            )
                          })()}
                          <RequestProgress status={req.status} />
                          <div className="mt-2 space-y-0.5">
                            <p className="text-[10px] font-semibold text-slate-400">{formatDate(req.created_at)}</p>
                            {req.admin_notes && (
                              <p className="text-xs font-semibold text-slate-600 italic [overflow-wrap:anywhere]">{req.admin_notes}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MOVIMIENTOS ───────────────────────────────────────────── */}
      {isMovements && (
        <div className="space-y-4">

          {loading ? (
            <p className="py-10 text-center text-sm font-bold text-slate-400">Cargando movimientos...</p>
          ) : movements.length === 0 ? (
            <EmptyState title="Sin movimientos" text="No hay movimientos registrados para tus productos." />
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="divide-y divide-slate-100">
                {movements.map(m => {
                  const lot = m.lots || {}
                  const eq  = Number(m.quantity||0) * Number(lot.package_size||0)
                  return (
                    <div key={m.id} className="flex items-center gap-3 px-4 py-3.5">
                      <span className={`shrink-0 rounded-lg px-2 py-1.5 text-[10px] font-black uppercase leading-none ${m.type === 'entrada' ? 'bg-campo-100 text-campo-800' : 'bg-red-50 text-red-700'}`}>
                        {m.type === 'entrada' ? 'Ingreso' : 'Salida'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-slate-900 [overflow-wrap:anywhere]">{cleanProductName(lot.product)}</p>
                        <p className="text-xs font-semibold text-slate-500">
                          {lotLabel(lot.lot_code, lot)} · {formatDate(m.created_at)}
                          {Number(lot.package_size) > 0 ? ` · ${formatNumber(eq)} ${lot.package_unit||''}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-sm font-black text-campo-700">{formatNumber(m.quantity)} env.</span>
                        <button
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:text-campo-700"
                          type="button"
                          title="Imprimir comprobante"
                          onClick={() => printReceipt(m)}
                        >
                          <Printer size={15} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Products modal */}
      {showProductsModal && (
        <ProductsModal
          lots={lots}
          onClose={() => setShowProductsModal(false)}
        />
      )}

      {/* Expiry modal */}
      {showExpiryModal && (
        <ExpiryModal
          lots={lots}
          onClose={() => setShowExpiryModal(false)}
        />
      )}

      {/* Movement detail modal */}
      {selectedMovement && (
        <MovementModal
          movement={selectedMovement}
          clientName={clientName}
          onClose={() => setSelectedMovement(null)}
          onPrint={() => { printReceipt(selectedMovement); setSelectedMovement(null) }}
        />
      )}

      </div>
    </div>
  )
}

/* ─── sub-components ─────────────────────────────────────────────── */

function MetricCard({ icon: Icon, label, value, sub, color = 'campo', onClick }) {
  const colors = {
    campo: 'bg-campo-50 text-campo-700',
    slate: 'bg-slate-50 text-slate-600',
    amber: 'bg-amber-50 text-amber-700',
  }
  const iconColors = {
    campo: 'bg-campo-100 text-campo-600',
    slate: 'bg-slate-200 text-slate-500',
    amber: 'bg-amber-100 text-amber-600',
  }
  const base = `flex flex-col gap-2 rounded-xl px-3.5 py-3.5 ${colors[color]}`
  const content = (
    <>
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconColors[color]}`}>
        <Icon size={16} />
      </div>
      <div>
        <p className="text-xl font-black leading-none tabular-nums sm:text-2xl">{value}</p>
        {sub && <p className="mt-0.5 text-[11px] font-bold opacity-70">{sub}</p>}
      </div>
      <p className="text-xs font-bold leading-snug opacity-75">{label}</p>
    </>
  )
  if (onClick) {
    return (
      <button type="button" className={`${base} w-full text-left transition active:scale-[0.97] hover:brightness-95`} onClick={onClick}>
        {content}
      </button>
    )
  }
  return <div className={base}>{content}</div>
}

function RequestProgress({ status }) {
  if (status === 'rechazado') {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2">
        <X size={13} className="shrink-0 text-red-600" />
        <span className="text-xs font-black text-red-700">Solicitud rechazada</span>
      </div>
    )
  }

  const currentStep = requestStepIndex(status)

  return (
    <div className="mt-3 px-1">
      <div className="flex items-start">
        {REQUEST_STEPS.map(({ key, label, Icon }, index) => {
          const done = index < currentStep
          const active = index === currentStep
          const isLast = index === REQUEST_STEPS.length - 1
          return (
            <div key={key} className="flex flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <div className={`h-0.5 flex-1 transition-colors ${index === 0 ? 'opacity-0' : done || active ? 'bg-campo-500' : 'bg-slate-200'}`} />
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all
                    ${done
                      ? 'bg-campo-600 text-white'
                      : active
                        ? 'bg-campo-600 text-white ring-2 ring-campo-300 ring-offset-1'
                        : 'bg-slate-100 text-slate-400'}`}
                >
                  {done ? <CheckCircle2 size={13} /> : <Icon size={13} />}
                </div>
                <div className={`h-0.5 flex-1 transition-colors ${isLast ? 'opacity-0' : done ? 'bg-campo-500' : 'bg-slate-200'}`} />
              </div>
              <p className={`mt-1.5 text-center text-[9px] font-black leading-tight
                ${done || active ? 'text-campo-700' : 'text-slate-400'}`}>
                {label}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ProductsModal({ lots, onClose }) {
  const [q, setQ] = useState('')
  const products = useMemo(() => {
    const map = new Map()
    lots.forEach(l => {
      const key = productIdentityKey(l)
      const name = cleanProductName(l.product)
      if (!name) return
      const entry = map.get(key) || { key, name, identity: productIdentityLabel(l), totalQty: 0, lotCount: 0 }
      entry.totalQty += Number(l.current_quantity || 0)
      entry.lotCount += 1
      map.set(key, entry)
    })
    return [...map.values()].sort((a, b) => a.identity.localeCompare(b.identity, 'es'))
  }, [lots])

  const filtered = q.trim()
    ? products.filter(p => [p.name, p.identity].some(value => value.toLowerCase().includes(q.trim().toLowerCase())))
    : products

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-4 sm:items-center sm:justify-center" onClick={onClose}>
      <section className="flex max-h-[80dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="font-black text-slate-950">Productos en almacén</h3>
            <p className="text-xs font-semibold text-slate-500">{products.length} producto{products.length !== 1 ? 's' : ''}</p>
          </div>
          <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="shrink-0 border-b border-slate-100 px-4 py-2.5">
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <Search size={14} className="shrink-0 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar producto..."
              value={q}
              onChange={e => setQ(e.target.value)}
              onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 300)}
              className="w-full bg-transparent text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none"
            />
            {q && <button onClick={() => setQ('')} className="text-slate-400"><X size={14} /></button>}
          </div>
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
          {filtered.length === 0 && (
            <li className="px-5 py-8 text-center text-sm font-semibold text-slate-400">Sin resultados</li>
          )}
          {filtered.map(p => (
            <li key={p.key} className="flex items-center justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 [overflow-wrap:anywhere]">{p.name}</p>
                {p.identity !== p.name ? (
                  <p className="mt-0.5 text-xs font-semibold text-slate-400 [overflow-wrap:anywhere]">{p.identity}</p>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-black text-campo-700">{formatNumber(p.totalQty)} env.</p>
                <p className="text-[10px] font-semibold text-slate-400">{p.lotCount} lote{p.lotCount !== 1 ? 's' : ''}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function ExpiryModal({ lots, onClose }) {
  const alertLots = lots
    .map(l => ({ ...l, days: daysUntil(l.expiry_date) }))
    .filter(l => l.days !== null && l.days <= 90)
    .sort((a, b) => a.days - b.days)

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-4 sm:items-center sm:justify-center" onClick={onClose}>
      <section className="flex max-h-[80dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="font-black text-slate-950">Lotes próximos a vencer</h3>
            <p className="text-xs font-semibold text-slate-500">{alertLots.length} lote{alertLots.length !== 1 ? 's' : ''} en los próximos 90 días</p>
          </div>
          <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
          {alertLots.map(lot => {
            const expired = lot.days < 0
            return (
              <div key={lot.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-slate-900 [overflow-wrap:anywhere]">{cleanProductName(lot.product)}</p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-500">
                    {lotLabel(lot.lot_code, lot)} · {lot.location || 'Sin ubicación'}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-black text-campo-700">{formatNumber(lot.current_quantity)} env.</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${expired ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                    {expired ? `Vencido hace ${Math.abs(lot.days)}d` : `Vence en ${lot.days}d`}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
        <div className="border-t border-slate-100 px-5 py-3">
          <p className="text-[10px] font-semibold text-slate-400">Contacta a Todo Agrícola para coordinar el manejo de estos lotes.</p>
        </div>
      </section>
    </div>
  )
}

function MovementModal({ movement, clientName, onClose, onPrint }) {
  const lot = movement.lots || {}
  const eq  = Number(movement.quantity||0) * Number(lot.package_size||0)
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-4 sm:items-center sm:justify-center" onClick={onClose}>
      <section className="w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-campo-700">Movimiento · {movementLabel(movement.type)}</p>
            <h3 className="mt-1 text-lg font-black leading-snug text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(lot.product)}</h3>
          </div>
          <button className="btn-secondary !min-h-9 !px-2.5" onClick={onClose}><X size={16} /></button>
        </div>
        <dl className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-3 text-sm">
          {[
            ['Fecha',       formatDate(movement.created_at)],
            ['Lote',        displayLotCode(lot.lot_code, lot)],
            ['Envases',     `${formatNumber(movement.quantity)} env.`],
            ['Equivalente', Number(lot.package_size) > 0 ? `${formatNumber(eq)} ${lot.package_unit||''}` : 'Sin dato'],
            ['Ubicación',   lot.location || '-'],
          ].map(([label, val]) => (
            <div key={label} className="flex items-start justify-between gap-3">
              <dt className="font-semibold text-slate-500">{label}</dt>
              <dd className="font-black text-slate-900 text-right [overflow-wrap:anywhere]">{val}</dd>
            </div>
          ))}
        </dl>
        <button className="btn-primary mt-3 w-full" onClick={onPrint}><Printer size={16} /> Imprimir comprobante</button>
      </section>
    </div>
  )
}
