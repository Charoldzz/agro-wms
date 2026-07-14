import { useEffect, useMemo, useRef, useState } from 'react'
import ExcelJS from 'exceljs'
import { Link, useNavigate } from 'react-router-dom'
import {
  Boxes, CalendarClock, CheckCircle2, ChevronDown,
  ClipboardList, Download, FileText, History, LogOut, Minus, Package,
  PackageCheck, Paperclip, Plus, Printer, Search, Send,
  Truck, X,
} from 'lucide-react'
import EmptyState from '../components/EmptyState'
import ListProductCard from '../components/ListProductCard'
import { useAuth } from '../hooks/useAuth.jsx'
import { cleanProductName, displayLotCode, lotLabel, packageLabel, productCode, productCodeLabel } from '../lib/display'
import { desgloseEnvases } from '../lib/envases'
import { normalizeDispatchRequests } from '../lib/dispatchRequests'
import { formatDate, formatDateOnly, formatNumber, movementLabel } from '../lib/format'
import { supabase } from '../lib/supabase'

/* ─── helpers ─────────────────────────────────────────────────────── */

function attachmentViewerUrl(url) {
  if (!url) return url
  const ext = url.split('?')[0].split('.').pop().toLowerCase()
  if (['xlsx', 'xls', 'docx', 'doc'].includes(ext))
    return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(url)}`
  return url
}

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

// Equivalente de un movimiento (uds × tamaño del lote), normalizado a lts/kgs;
// sin presentación conocida se queda en uds (nunca se inventa)
function movementEquivalent(m) {
  const lot = m.lots || {}
  const s = Number(lot.package_size || 0)
  if (s > 0 && lot.package_unit) {
    const norm = normalizeEquivalent({ quantity: Number(m.quantity || 0) * s, unit: lot.package_unit })
    let u = String(norm.unit || '').toLowerCase().trim()
    let q = norm.quantity
    if (u === 'ml') { u = 'lts'; q /= 1000 }
    else if (/^l/.test(u)) u = 'lts'
    else if (/^k/.test(u)) u = 'kgs'
    else u = 'uds'
    return { quantity: q, unit: u }
  }
  return { quantity: Number(m.quantity || 0), unit: 'uds' }
}

function movementEquivalentLabel(m) {
  const eq = movementEquivalent(m)
  return `${formatNumber(eq.quantity)} ${eq.unit}`
}

// Total de una nota separado por unidad: "315 lts · 5.038 kgs"
function noteEquivalentLabel(movs) {
  const totals = new Map()
  movs.forEach((m) => {
    const eq = movementEquivalent(m)
    totals.set(eq.unit, (totals.get(eq.unit) || 0) + eq.quantity)
  })
  return [...totals.entries()].map(([u, q]) => `${formatNumber(q)} ${u}`).join(' · ')
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
  cancelado:       { label: 'Cancelada',           cls: 'bg-slate-100 text-slate-500',  accent: 'bg-slate-300' },
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
  const [catalog,    setCatalog]    = useState([])
  const [movements,  setMovements]  = useState([])
  const [opsById,    setOpsById]    = useState({})
  const [requests,   setRequests]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const searchBarRef = useRef(null)
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
  const [reqTransporter, setReqTransporter]  = useState({ name: '', ci: '', plate: '' })
  const [reqAttachFile,  setReqAttachFile]   = useState(null)
  const [reqUploading,   setReqUploading]    = useState(false)
  const [editingRequestId, setEditingRequestId] = useState(null)
  const [existingAttachment, setExistingAttachment] = useState(null)
  const [cancelingId,    setCancelingId]     = useState(null)

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

    const [{ data: lotsData }, { data: catalogData }] = await Promise.all([
      supabase
        .from('lots')
        .select('id,lot_code,client_id,product,solucion_product_code,current_quantity,package_size,package_unit,location,entry_date,expiry_date,status,clients(name,contact)')
        .eq('inventory_source','stock_independiente')
        .eq('client_id', clientId)
        .eq('status','activo')
        .gt('current_quantity', 0)
        .order('product'),
      supabase
        .from('product_catalog')
        .select('code,name,units_per_box')
        .eq('client_id', clientId)
        .not('units_per_box', 'is', null),
    ])
    setLots(lotsData || [])
    setCatalog(catalogData || [])

    const lotIds = (lotsData||[]).map(l => l.id)
    const { data: movData } = lotIds.length
      ? await supabase.from('movements')
          .select('id,type,quantity,previous_quantity,new_quantity,to_location,notes,created_at,operation_id,lots(lot_code,product,solucion_product_code,package_size,package_unit,location)')
          .in('lot_id', lotIds).in('type',['entrada','salida'])
          .order('created_at',{ ascending:false }).limit(80)
      : { data: [] }
    setMovements(movData || [])

    // Notas de las operaciones (número de guía + transportista/placa)
    const opIds = [...new Set((movData || []).map(m => m.operation_id).filter(Boolean))]
    if (opIds.length) {
      const { data: opsData } = await supabase
        .from('warehouse_operations')
        .select('id,guide_number,type,receiver_name,driver_name,vehicle_plate,notes')
        .in('id', opIds)
      setOpsById(Object.fromEntries((opsData || []).map(o => [o.id, o])))
    } else {
      setOpsById({})
    }

    const { data: reqData } = await supabase
      .from('client_dispatch_requests')
      .select('id,client_id,lot_id,product,quantity,items,notes,status,admin_notes,created_at,reviewed_at,transporter_name,transporter_ci,transporter_plate,attachment_url,clients(name),lots(id,lot_code,product,solucion_product_code,current_quantity,package_size,package_unit,location,expiry_date,status)')
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

  // Movimientos agrupados por nota (misma operación = misma nota SAL/ING)
  const movementNotes = useMemo(() => {
    const groups = new Map()
    movements.forEach((m) => {
      const key = m.operation_id || `mov-${m.id}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(m)
    })
    return [...groups.values()].map((movs) => {
      const first = movs[0]
      const op = first.operation_id ? opsById[first.operation_id] : null
      return {
        id: first.operation_id || `mov-${first.id}`,
        type: first.type,
        noteNumber: op?.guide_number || null,
        createdAt: movs.reduce((max, m) => (m.created_at > max ? m.created_at : max), first.created_at),
        transporter: op ? (first.type === 'entrada' ? op.driver_name : op.receiver_name) : null,
        plate: op?.vehicle_plate || null,
        observations: op?.notes || null,
        movs,
        totalUds: movs.reduce((s, m) => s + Number(m.quantity || 0), 0),
        equivalentLabel: noteEquivalentLabel(movs),
      }
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  }, [movements, opsById])

  const totalStock    = lots.reduce((s,l) => s + Number(l.current_quantity||0), 0)
  const productCount  = lots.length
  const expiring      = lots.filter(l => { const d = daysUntil(l.expiry_date); return d !== null && d <= 90 })
  const alerts        = lots.filter(l => lotStatus(l).label !== 'Disponible' && lotStatus(l).label !== 'Por vencer')
  const activeRequests = requests.filter(r => !['despachado','rechazado','cancelado'].includes(r.status))
  const pendingDispatchRequests = requests.filter(r => ['pendiente', 'aprobado'].includes(r.status))
  const preparingDispatchRequests = requests.filter(r => r.status === 'en_preparacion')
  const dispatchedRequests = requests.filter(r => r.status === 'despachado')
  const clientName    = lots[0]?.clients?.name || profile?.full_name || 'Cliente'

  // Mapa nombre→units_per_box del catálogo para calcular cajas
  const catalogBoxMap = useMemo(() => {
    const m = new Map()
    catalog.forEach(p => {
      if (p.units_per_box > 0) m.set(p.name.toUpperCase(), p.units_per_box)
    })
    return m
  }, [catalog])

  function lotUnitsPerBox(lot) {
    const name = cleanProductName(lot.product).toUpperCase()
    // Solo del catálogo — REGLA: las cajas nunca se adivinan del nombre.
    // Sin dato → 0 cajas (se muestra en unidades), jamás un número inventado.
    return catalogBoxMap.get(name) || 0
  }

  function lotCajas(lot) {
    const upb = lotUnitsPerBox(lot)
    if (!upb) return 0
    return Math.floor(Number(lot.current_quantity || 0) / upb)
  }

  const eqTotals = useMemo(() => {
    const t = { lts: 0, kgs: 0 }
    lots.forEach(l => {
      const eq = lotEquivalent(l)
      if (!eq || eq.quantity <= 0) return
      const u = eq.unit.toLowerCase().trim()
      if (/^l/.test(u)) t.lts += eq.quantity
      else if (/^kg/.test(u)) t.kgs += eq.quantity
      else if (/^gr?$/.test(u)) t.kgs += eq.quantity / 1000
    })
    return t
  }, [lots])
  const eqTotalsLabel = [
    eqTotals.lts > 0 ? `${formatNumber(eqTotals.lts)} lts` : null,
    eqTotals.kgs > 0 ? `${formatNumber(eqTotals.kgs)} kgs` : null,
  ].filter(Boolean).join(' · ')

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
  const transporterComplete = Boolean(reqTransporter.name.trim() && reqTransporter.ci.trim() && reqTransporter.plate.trim())

  /* ─── request actions ─────────────────────────────────────────── */
  function addReqItem() {
    setReqMessage('')
    const qty = Number(reqQuantity||0)
    if (!selectedLot) { setReqMessage('Selecciona un lote.'); return }
    if (qty <= 0) { setReqMessage('Ingresa una cantidad mayor a 0.'); return }
    if (qty > Number(selectedLot.current_quantity||0)) { setReqMessage('La cantidad supera los unidades disponibles.'); return }
    if (['Retenido','Cerrado'].includes(lotStatus(selectedLot).label)) { setReqMessage('Este lote no está disponible para despacho.'); return }
    setReqItems(cur => {
      const existing = cur.find(i => i.lot_id === selectedLot.id)
      if (existing) {
        const next = editingLotId === selectedLot.id ? qty : Number(existing.quantity||0) + qty
        if (next > Number(selectedLot.current_quantity||0)) { setReqMessage('Cantidad supera stock disponible.'); return cur }
        return cur.map(i => i.lot_id === selectedLot.id ? { ...i, quantity: next, available: selectedLot.current_quantity } : i)
      }
      return [...cur, { lot_id: selectedLot.id, client_id: selectedLot.client_id, client_name: selectedLot.clients?.name||clientName, lot_code: selectedLot.lot_code, product: selectedLot.product, solucion_product_code: selectedLot.solucion_product_code, quantity: qty, package_size: selectedLot.package_size, package_unit: selectedLot.package_unit, location: selectedLot.location, available: selectedLot.current_quantity, expiry_date: selectedLot.expiry_date }]
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
    setEditingLotId(''); setReqMessage(''); setReqSuccess(null); setReqProductName('')
    setReqTransporter({ name: '', ci: '', plate: '' }); setReqAttachFile(null)
    clearDraft()
  }

  function startEditRequest(req) {
    if (!['pendiente', 'aprobado'].includes(req.status)) return
    setEditingRequestId(req.id)
    setReqItems(Array.isArray(req.items) ? req.items : [])
    setReqNotes(req.notes || '')
    setReqTransporter({ name: req.transporter_name || '', ci: req.transporter_ci || '', plate: req.transporter_plate || '' })
    setExistingAttachment(req.attachment_url || null)
    setReqAttachFile(null)
    setReqSuccess(null)
    setReqMessage('')
    setCancelingId(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function stopEditRequest() {
    setEditingRequestId(null)
    setExistingAttachment(null)
    setReqItems([]); setReqNotes(''); setReqTransporter({ name: '', ci: '', plate: '' })
    setReqAttachFile(null); setReqMessage(''); clearDraft()
  }

  async function cancelRequest(id) {
    const { error } = await supabase
      .from('client_dispatch_requests')
      .update({ status: 'cancelado' })
      .eq('id', id)
      .in('status', ['pendiente', 'aprobado'])
    setCancelingId(null)
    if (error) { setReqMessage('No se pudo cancelar la solicitud. Puede que ya esté en preparación.'); return }
    if (editingRequestId === id) stopEditRequest()
    loadData()
  }

  async function submitRequest(e) {
    e.preventDefault(); setReqMessage('')
    if (!reqTransporter.name.trim() || !reqTransporter.ci.trim() || !reqTransporter.plate.trim()) {
      setReqMessage('Completa los datos del transportista antes de enviar.'); return
    }
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
    if (over) { setReqMessage(`${cleanProductName(over.product)} solo tiene ${formatNumber(over.current_quantity ?? over.available ?? 0)} uds disponibles.`); return }
    let attachmentUrl = editingRequestId ? existingAttachment : null
    if (reqAttachFile) {
      setReqUploading(true)
      const ext = reqAttachFile.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
      const path = `${clientId}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('Dispatch_Attachments').upload(path, reqAttachFile)
      setReqUploading(false)
      if (upErr) { setReqMessage('No se pudo subir el archivo adjunto. Verifica tu conexión e intenta de nuevo.'); return }
      const { data: urlData } = supabase.storage.from('Dispatch_Attachments').getPublicUrl(path)
      attachmentUrl = urlData.publicUrl
    }
    const payload = {
      client_id: clientId, lot_id: fresh[0].lot_id,
      product: fresh.length === 1 ? fresh[0].product : `Lista de despacho (${fresh.length} productos)`,
      quantity: fresh.reduce((s,i) => s + Number(i.quantity||0), 0),
      items: fresh.map(i => ({ ...i, client_id: i.client_id||clientId, client_name: i.client_name||clientName })),
      notes: reqNotes.trim()||null, status:'pendiente',
      transporter_name: reqTransporter.name.trim(),
      transporter_ci: reqTransporter.ci.trim(),
      transporter_plate: reqTransporter.plate.trim().toUpperCase(),
      attachment_url: attachmentUrl,
    }
    const { error } = editingRequestId
      ? await supabase.from('client_dispatch_requests').update(payload).eq('id', editingRequestId).in('status', ['pendiente', 'aprobado'])
      : await supabase.from('client_dispatch_requests').insert({ ...payload, requested_by: user.id })
    if (error) {
      setReqMessage(editingRequestId
        ? 'No se pudo guardar el cambio. Puede que la solicitud ya esté en preparación.'
        : 'No se pudo enviar la solicitud. Contacta a almacén.')
      return
    }
    setReqLotId(''); setReqQuantity(''); setReqItems([]); setReqNotes(''); setEditingLotId(''); setReqProductName(''); clearDraft()
    setReqTransporter({ name: '', ci: '', plate: '' }); setReqAttachFile(null)
    setReqSuccess({ clientName, items: fresh, createdAt: new Date().toISOString(), edited: Boolean(editingRequestId) })
    setEditingRequestId(null); setExistingAttachment(null)
    if (navigator.vibrate) navigator.vibrate(80)
    loadData()
  }

  /* ─── exports ─────────────────────────────────────────────────── */
  async function exportExcel() {
    try {
      const now = new Date()
      const date = now.toISOString().slice(0, 10)
      const timestamp = formatDate(now.toISOString())
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Inventario')

      // Column widths — 6 columns
      ws.columns = [
        { key: 'producto',    width: 40 },
        { key: 'lote',        width: 22 },
        { key: 'vencimiento', width: 16 },
        { key: 'equivalente', width: 18 },
        { key: 'unidades',     width: 14 },
        { key: 'cajas',       width: 12 },
      ]

      // Row 1: client name — green header
      const titleRow = ws.addRow([clientName])
      ws.mergeCells('A1:F1')
      titleRow.height = 28
      titleRow.getCell(1).font  = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
      titleRow.getCell(1).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D593A' } }
      titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }

      // Row 2: timestamp
      const subRow = ws.addRow([`Inventario al ${timestamp}`])
      ws.mergeCells('A2:F2')
      subRow.getCell(1).font      = { italic: true, size: 10, color: { argb: 'FF475569' } }
      subRow.getCell(1).alignment = { horizontal: 'left', indent: 1 }

      // Row 3: blank spacer
      ws.addRow([])

      // Row 4: column headers
      const headerLabels = ['Producto', 'Lote', 'Vencimiento', 'Cantidad Lts/Kgs', 'Cantidad Unidades', 'Cajas']
      const hdrRow = ws.addRow(headerLabels)
      hdrRow.height = 18
      hdrRow.eachCell(cell => {
        cell.font      = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6F45' } }
        cell.alignment = { vertical: 'middle', horizontal: 'right' }
        cell.border    = { bottom: { style: 'thin', color: { argb: 'FF1D593A' } } }
      })
      hdrRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }

      // Data rows
      lots.forEach((l) => {
        let eqStr = ''
        try { const eq = lotEquivalent(l); if (eq) eqStr = `${formatNumber(eq.quantity)} ${eq.unit}` } catch (_) {}
        const cajas = lotCajas(l)
        const row = ws.addRow([
          cleanProductName(l.product) || '',
          displayLotCode(l.lot_code, l) || '',
          l.expiry_date ? formatDate(l.expiry_date) : '-',
          eqStr || '-',
          Number(l.current_quantity || 0),
          cajas > 0 ? cajas : '',
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

  // Abre el inventario como documento (misma estética que los comprobantes);
  // el cliente decide si imprime con el botón — sin impresión automática
  function printPdf() {
    const logoUrl = `${window.location.origin}/images/todo-logo.png`
    const rows = lots.map((l, i) => {
      let eqStr = ''
      try { const eq = lotEquivalent(l); if (eq) eqStr = `${formatNumber(eq.quantity)} ${eq.unit}` } catch (_) { /* sin dato */ }
      const size = Number(l.package_size) || 0
      const eqRaw = size > 0 ? Number(l.current_quantity || 0) * size : Number(l.current_quantity || 0)
      const desglose = desgloseEnvases(eqRaw, size, l.package_unit, 0)
      const unidadesLabel = desglose.unidadesLabel || `${formatNumber(l.current_quantity)} uds`
      const cajas = lotCajas(l)
      return `<tr>
        <td class="c">${i + 1}</td>
        <td class="c mono">${escapeHtml(productCode(l) || '-')}</td>
        <td>${escapeHtml(cleanProductName(l.product))}</td>
        <td class="c mono">${escapeHtml(displayLotCode(l.lot_code, l))}</td>
        <td class="c">${escapeHtml(l.expiry_date ? formatDate(l.expiry_date) : '-')}</td>
        <td class="r"><strong>${escapeHtml(eqStr || `${formatNumber(l.current_quantity)} uds`)}</strong></td>
        <td class="r">${escapeHtml(unidadesLabel)}</td>
        <td class="r">${cajas > 0 ? escapeHtml(formatNumber(cajas)) : '-'}</td>
      </tr>`
    }).join('')

    // Total solo en equivalente (lts · kgs) — nunca mezclar con uds
    const totals = new Map()
    lots.forEach((l) => {
      let eq = null
      try { eq = lotEquivalent(l) } catch (_) { /* sin dato */ }
      if (!eq) return
      let u = String(eq.unit || '').toLowerCase()
      let v = eq.quantity
      if (u === 'ml') { u = 'lts'; v /= 1000 }
      else if (/^l/.test(u)) u = 'lts'
      else if (/^k/.test(u)) u = 'kgs'
      else return
      totals.set(u, (totals.get(u) || 0) + v)
    })
    const totalLabel = [...totals.entries()].map(([u, v]) => `${formatNumber(v)} ${u}`).join(' · ')

    const w = window.open('', '_blank'); if (!w) return
    w.document.write(`<!doctype html><html><head><title>Inventario ${escapeHtml(clientName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet" />
<style>
  body { color: #0f172a; font-family: 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 26px 30px; }
  .top { align-items: center; border-bottom: 3px solid #15803d; display: flex; gap: 16px; justify-content: space-between; padding-bottom: 14px; }
  .brand { align-items: center; display: flex; gap: 14px; }
  .brand img { height: 54px; width: auto; }
  h1 { font-family: 'Bebas Neue', 'Segoe UI', Arial, sans-serif; font-size: 27px; font-weight: 400; letter-spacing: 1.5px; margin: 0; }
  .sub { color: #475569; font-family: 'Bebas Neue', 'Segoe UI', Arial, sans-serif; font-size: 13px; letter-spacing: 3px; margin: 2px 0 0; text-transform: uppercase; }
  .guide { border: 2px solid #15803d; border-radius: 10px; color: #15803d; font-family: 'Bebas Neue', 'Segoe UI', Arial, sans-serif; font-size: 20px; font-weight: 400; letter-spacing: 2px; padding: 7px 18px; text-align: center; white-space: nowrap; }
  .guide small { color: #64748b; display: block; font-family: 'Segoe UI', Arial, sans-serif; font-size: 9px; font-weight: 600; letter-spacing: 2px; }
  .datos { border: 1px solid #cbd5e1; border-radius: 10px; display: grid; gap: 12px 24px; grid-template-columns: repeat(3, 1fr); margin: 18px 0; padding: 14px 16px; }
  .datos p { margin: 0; }
  .datos .l { color: #64748b; font-size: 9px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; }
  .datos .v { font-size: 13px; font-weight: bold; margin-top: 2px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid #e2e8f0; font-size: 12px; font-variant-numeric: tabular-nums; padding: 8px 7px; text-align: left; vertical-align: top; }
  td { color: #0f172a; font-weight: 500; }
  th { background: #f1f5f9; color: #334155; font-size: 9.5px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; }
  td.c, th.c { text-align: center; }
  td.r, th.r { text-align: right; }
  .mono { letter-spacing: 0.3px; }
  tfoot td { background: #f0fdf4; border-bottom: none; border-top: 2px solid #15803d; color: #14532d; font-size: 12.5px; font-weight: bold; padding: 9px 7px; }
  .foot { color: #94a3b8; font-size: 9.5px; margin-top: 30px; text-align: center; }
  .print-btn { background: #15803d; border: none; border-radius: 8px; bottom: 20px; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.25); color: #fff; cursor: pointer; font-size: 13px; font-weight: bold; padding: 10px 18px; position: fixed; right: 20px; }
  @media print { body { margin: 10mm; } .print-btn { display: none; } }
</style></head><body>
<button class="print-btn" onclick="window.print()">Imprimir / Guardar PDF</button>
<div class="top">
  <div class="brand">
    <img src="${escapeHtml(logoUrl)}" alt="Todo Agricola" />
    <div>
      <h1>Todo Agr&iacute;cola Boliviana Ltda</h1>
      <p class="sub">Inventario de mercader&iacute;a</p>
    </div>
  </div>
  <div class="guide"><small>INVENTARIO AL</small>${escapeHtml(formatDateOnly(new Date().toISOString()))}</div>
</div>
<div class="datos">
  <div><p class="l">Empresa</p><p class="v">${escapeHtml(clientName)}</p></div>
  <div><p class="l">Productos</p><p class="v">${escapeHtml(String(new Set(lots.map(l => cleanProductName(l.product))).size))}</p></div>
  <div><p class="l">Lotes activos</p><p class="v">${escapeHtml(String(lots.length))}</p></div>
</div>
<table>
  <thead><tr>
    <th class="c">N&deg;</th><th class="c">C&oacute;digo</th><th>Producto</th><th class="c">Lote</th><th class="c">Venc.</th>
    <th class="r">Cantidad</th><th class="r">Unidades</th><th class="r">Cajas</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  ${totalLabel ? `<tfoot><tr><td colspan="5">TOTAL</td><td class="r">${escapeHtml(totalLabel)}</td><td></td><td></td></tr></tfoot>` : ''}
</table>
<p class="foot">Documento informativo generado desde el portal de clientes de Todo Agr&iacute;cola Boliviana Ltda &mdash; Emitido el ${escapeHtml(formatDateOnly(new Date().toISOString()))}. Informaci&oacute;n referencial sujeta a validaci&oacute;n operativa.</p>
</body></html>`)
    w.document.close()
  }

  // Abre la nota completa en pestaña nueva (con botón Imprimir / Guardar PDF adentro)
  function openNotePdf(note) {
    const type = note.type === 'salida' ? 'despacho' : 'ingreso'
    const logoUrl = `${window.location.origin}/images/todo-logo.png`
    const rows = note.movs.map((m, i) => {
      const lot = m.lots || {}
      // Unidades con su tipo de envase real ("53 bidones + 15 lt"); sin presentación → uds
      const size = Number(lot.package_size) || 0
      const eqRaw = size > 0 ? Number(m.quantity || 0) * size : Number(m.quantity || 0)
      const desglose = desgloseEnvases(eqRaw, size, lot.package_unit, 0)
      const unidadesLabel = desglose.unidadesLabel || `${formatNumber(m.quantity)} uds`
      return `<tr>
        <td class="c">${i + 1}</td>
        <td class="c mono">${escapeHtml(productCode(lot) || '-')}</td>
        <td>${escapeHtml(cleanProductName(lot.product))}</td>
        <td class="c mono">${escapeHtml(displayLotCode(lot.lot_code, lot))}</td>
        <td class="r"><strong>${escapeHtml(movementEquivalentLabel(m))}</strong></td>
        <td class="r muted">${escapeHtml(unidadesLabel)}</td>
      </tr>`
    }).join('')
    const w = window.open('','_blank'); if(!w) return
    w.document.write(`<!doctype html><html><head><title>Comprobante ${escapeHtml(note.noteNumber || '')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet" />
<style>
  body { color: #0f172a; font-family: 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 26px 30px; }
  .top { align-items: center; border-bottom: 3px solid #15803d; display: flex; gap: 16px; justify-content: space-between; padding-bottom: 14px; }
  .brand { align-items: center; display: flex; gap: 14px; }
  .brand img { height: 54px; width: auto; }
  h1 { font-family: 'Bebas Neue', 'Segoe UI', Arial, sans-serif; font-size: 27px; font-weight: 400; letter-spacing: 1.5px; margin: 0; }
  .sub { color: #475569; font-family: 'Bebas Neue', 'Segoe UI', Arial, sans-serif; font-size: 13px; letter-spacing: 3px; margin: 2px 0 0; text-transform: uppercase; }
  .guide { border: 2px solid #15803d; border-radius: 10px; color: #15803d; font-family: 'Bebas Neue', 'Segoe UI', Arial, sans-serif; font-size: 24px; font-weight: 400; letter-spacing: 2px; padding: 7px 18px; text-align: center; white-space: nowrap; }
  .guide small { color: #64748b; display: block; font-family: 'Segoe UI', Arial, sans-serif; font-size: 9px; font-weight: 600; letter-spacing: 2px; }
  .datos { border: 1px solid #cbd5e1; border-radius: 10px; display: grid; gap: 12px 24px; grid-template-columns: repeat(3, 1fr); margin: 18px 0; padding: 14px 16px; }
  .datos p { margin: 0; }
  .datos .l { color: #64748b; font-size: 9px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; }
  .datos .v { font-size: 13px; font-weight: bold; margin-top: 2px; }
  .obs { grid-column: 1 / -1; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid #e2e8f0; font-size: 12px; font-variant-numeric: tabular-nums; padding: 8px 7px; text-align: left; vertical-align: top; }
  td { color: #0f172a; font-weight: 500; }
  th { background: #f1f5f9; color: #334155; font-size: 9.5px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; }
  td.c, th.c { text-align: center; }
  td.r, th.r { text-align: right; }
  .mono { letter-spacing: 0.3px; }
  .muted { }
  tfoot td { background: #f0fdf4; border-bottom: none; border-top: 2px solid #15803d; color: #14532d; font-size: 12.5px; font-weight: bold; padding: 9px 7px; }
  .foot { color: #94a3b8; font-size: 9.5px; margin-top: 30px; text-align: center; }
  .print-btn { background: #15803d; border: none; border-radius: 8px; bottom: 20px; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.25); color: #fff; cursor: pointer; font-size: 13px; font-weight: bold; padding: 10px 18px; position: fixed; right: 20px; }
  @media print { body { margin: 10mm; } .print-btn { display: none; } }
</style></head><body>
<button class="print-btn" onclick="window.print()">Imprimir / Guardar PDF</button>
<div class="top">
  <div class="brand">
    <img src="${escapeHtml(logoUrl)}" alt="Todo Agricola" />
    <div>
      <h1>Todo Agr&iacute;cola Boliviana Ltda</h1>
      <p class="sub">Comprobante de ${escapeHtml(type)} de mercader&iacute;a</p>
    </div>
  </div>
  <div class="guide"><small>N&deg; NOTA</small>${escapeHtml(note.noteNumber || '-')}</div>
</div>
<div class="datos">
  <div><p class="l">Empresa</p><p class="v">${escapeHtml(clientName)}</p></div>
  <div><p class="l">Fecha</p><p class="v">${escapeHtml(formatDateOnly(note.createdAt))}</p></div>
  <div><p class="l">Movimiento</p><p class="v">${escapeHtml(movementLabel(note.type))}</p></div>
  <div><p class="l">Transportista</p><p class="v">${escapeHtml(note.transporter || '-')}</p></div>
  <div><p class="l">Placa</p><p class="v">${escapeHtml(note.plate || '-')}</p></div>
  <div><p class="l">Productos</p><p class="v">${escapeHtml(String(note.movs.length))}</p></div>
  ${note.observations ? `<div class="obs"><p class="l">Observaciones</p><p class="v">${escapeHtml(note.observations)}</p></div>` : ''}
</div>
<table>
  <thead><tr>
    <th class="c">N&deg;</th><th class="c">C&oacute;digo</th><th>Producto</th><th class="c">Lote</th>
    <th class="r">Cantidad</th><th class="r">Unidades</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td colspan="4">TOTAL</td><td class="r">${escapeHtml(note.equivalentLabel)}</td><td></td></tr></tfoot>
</table>
<p class="foot">Documento informativo generado desde el portal de clientes de Todo Agr&iacute;cola Boliviana Ltda &mdash; Emitido el ${escapeHtml(formatDateOnly(new Date().toISOString()))}. Informaci&oacute;n referencial sujeta a validaci&oacute;n operativa.</p>
</body></html>`)
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
      <button onClick={printPdf} title="Ver inventario (PDF)" className={`flex ${cls} items-center justify-center rounded-lg border border-white/20 bg-white/10 transition hover:bg-white/25`}>
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

          {/* Search */}
          <div ref={searchBarRef} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
            <Search size={17} className="shrink-0 text-slate-400" />
            <input
              className="min-h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
              placeholder="Buscar producto, lote, ubicación..."
              value={search}
              onFocus={() => {
                if (window.innerWidth < 640 && searchBarRef.current) {
                  setTimeout(() => {
                    if (searchBarRef.current) {
                      const top = searchBarRef.current.getBoundingClientRect().top + window.scrollY - 8
                      window.scrollTo({ top, behavior: 'instant' })
                    }
                  }, 320)
                }
              }}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="text-slate-400 hover:text-slate-700" onClick={() => setSearch('')}>
                <X size={15} />
              </button>
            )}
          </div>

          {/* Section header + filters */}
          {(() => {
            const expiringCount = inventoryProducts.filter(g => g.lots.some(l => lotStatus(l).label === 'Por vencer')).length
            const expiredCount  = inventoryProducts.filter(g => g.lots.some(l => lotStatus(l).label === 'Vencido')).length
            return (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-sm font-black text-slate-900">Tu inventario</h3>
                    {!loading && (
                      <span className="text-xs font-semibold text-slate-400">
                        {inventoryProducts.length} producto{inventoryProducts.length !== 1 ? 's' : ''}
                      </span>
                    )}
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
              </div>
            )
          })()}

          {/* Product list */}
          {loading ? (
            <div className="space-y-2">
              {[1, 0.75, 0.5, 0.3].map((opacity, i) => (
                <div key={i} className="animate-pulse rounded-xl border border-slate-100 bg-white p-4 shadow-sm" style={{ opacity }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="mb-2 h-3.5 w-3/5 rounded bg-slate-200" />
                      <div className="mb-1.5 h-2.5 w-4/5 rounded bg-slate-200" />
                      <div className="h-2.5 w-1/4 rounded bg-slate-200" />
                    </div>
                    <div className="text-right">
                      <div className="mb-1.5 h-4 w-20 rounded bg-slate-200" />
                      <div className="h-2.5 w-14 rounded bg-slate-200" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : filteredLots.length === 0 ? (
            <EmptyState title="Sin productos" text="No hay inventario disponible en este momento." />
          ) : (
            <div className="relative">
            <div
              className="space-y-2 overflow-y-auto pb-6 sm:overflow-visible"
              style={window.innerWidth < 640 ? { maxHeight: 'calc(var(--vvh, 100dvh) - 7rem)' } : undefined}
            >
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
                              <p className="text-[10px] font-semibold text-slate-400">{formatNumber(group.quantity)} unidades</p>
                            </>
                          ) : (
                            <p className="text-base font-black text-campo-700">{formatNumber(group.quantity)} <span className="text-xs font-bold text-campo-500">uds</span></p>
                          )}
                        </div>
                        <ChevronDown size={18} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </div>
                    </button>

                    <div className={`overflow-hidden transition-all duration-200 ease-in-out ${isOpen ? 'max-h-[2000px]' : 'max-h-0'}`}>
                      <div className="divide-y divide-slate-100 border-t border-slate-100">
                        {group.lots.map(lot => {
                          const st = lotStatus(lot)
                          const eq = lotEquivalent(lot)
                          return (
                            <div key={lot.id} className="flex items-center gap-2 px-4 py-3 transition hover:bg-campo-50/40">
                              <Link to={`/lotes/${lot.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-black text-slate-900">{lotLabel(lot.lot_code, lot)}</p>
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                                  </div>
                                  <p className="mt-0.5 text-xs font-semibold text-slate-500">
                                    {lot.location || 'Sin ubicación'} · {(() => {
                                      const d = daysUntil(lot.expiry_date)
                                      if (d === null) return 'Sin vencimiento'
                                      if (d < 0) return <span className="font-bold text-red-600">Venció hace {Math.abs(d)} días</span>
                                      if (d === 0) return <span className="font-bold text-red-600">Vence hoy</span>
                                      if (d <= 30) return <span className="font-bold text-amber-600">Vence en {d} días</span>
                                      return `Vence: ${formatDate(lot.expiry_date)}`
                                    })()}
                                  </p>
                                </div>
                                <div className="shrink-0 text-right">
                                  {eq ? (
                                    <>
                                      <p className="text-sm font-black text-campo-700">{formatNumber(eq.quantity)} {eq.unit}</p>
                                      <p className="text-[10px] font-semibold text-slate-400">{formatNumber(lot.current_quantity)} unidades</p>
                                    </>
                                  ) : (
                                    <p className="text-sm font-black text-campo-700">{formatNumber(lot.current_quantity)} uds</p>
                                  )}
                                  {lotCajas(lot) > 0 && (
                                    <p className="text-[10px] font-semibold text-campo-500">{formatNumber(lotCajas(lot))} cajas</p>
                                  )}
                                </div>
                              </Link>
                              <button
                                type="button"
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 active:scale-95"
                                onClick={e => { e.stopPropagation(); navigate('/historial') }}
                                title="Ver historial"
                              >
                                <History size={12} />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    </div>{/* min-w-0 flex-1 */}
                  </article>
                )
              })}

              {!search.trim() && inventoryFilter === 'all' && displayedProducts.length > 8 && (
                showAllProducts ? (
                  <button
                    className="w-full rounded-xl border border-slate-200 bg-white py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
                    onClick={() => setShowAllProducts(false)}
                  >
                    Ver menos
                  </button>
                ) : (
                  <button
                    className="w-full rounded-xl border border-slate-200 bg-white py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
                    onClick={() => setShowAllProducts(true)}
                  >
                    Ver todos los productos ({displayedProducts.length})
                  </button>
                )
              )}
            </div>
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-slate-50 to-transparent sm:hidden" />
            </div>
          )}

          {/* Bottom totals */}
          {!loading && (
            <div className="flex flex-wrap items-center justify-center divide-x divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
              {eqTotals.lts > 0 && (
                <div className="px-5 py-3.5 text-center">
                  <p className="text-lg font-black tabular-nums text-campo-700">{formatNumber(eqTotals.lts)} <span className="text-xs font-bold text-campo-500">lts</span></p>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">equiv. líquidos</p>
                </div>
              )}
              {eqTotals.kgs > 0 && (
                <div className="px-5 py-3.5 text-center">
                  <p className="text-lg font-black tabular-nums text-campo-700">{formatNumber(eqTotals.kgs)} <span className="text-xs font-bold text-campo-500">kgs</span></p>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">equiv. sólidos</p>
                </div>
              )}
              <div className="px-5 py-3.5 text-center">
                <p className="text-lg font-black tabular-nums text-slate-900">{formatNumber(totalStock)}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">unidades</p>
              </div>
              <div className="px-5 py-3.5 text-center">
                <p className="text-lg font-black tabular-nums text-slate-900">{productCount}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">productos activos</p>
              </div>
            </div>
          )}

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
                {movementNotes.slice(0,4).map(n => {
                  const firstLot = n.movs[0]?.lots || {}
                  return (
                    <button
                      key={n.id}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                      type="button"
                      onClick={() => setSelectedMovement(n)}
                    >
                      <span className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-black uppercase ${n.type === 'entrada' ? 'bg-campo-100 text-campo-800' : 'bg-red-50 text-red-700'}`}>
                        {n.type === 'entrada' ? 'Ingreso' : 'Salida'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-slate-900">
                          {n.noteNumber ? <span className="font-mono text-campo-700">{n.noteNumber}</span> : cleanProductName(firstLot.product)}
                        </p>
                        <p className="text-xs font-semibold text-slate-400">
                          {n.movs.length > 1 ? `${n.movs.length} productos · ` : ''}{formatDate(n.createdAt)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-black text-campo-700">{n.equivalentLabel}</p>
                        {n.movs.length === 1 ? (
                          <p className="text-[11px] font-semibold text-slate-400">{formatNumber(n.totalUds)} uds</p>
                        ) : null}
                      </div>
                    </button>
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
                  <h2 className="mt-4 text-xl font-black text-slate-950">{reqSuccess.edited ? '¡Solicitud actualizada!' : '¡Solicitud enviada!'}</h2>
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
                                    <span className="text-[10px] font-semibold text-slate-400">({formatNumber(item.quantity)} uds)</span>
                                  </>
                                : <span className="text-xs font-semibold text-slate-600">{formatNumber(item.quantity)} uds</span>
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

                  {editingRequestId && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                      <p className="text-sm font-black text-blue-800">Editando una solicitud enviada</p>
                      <button type="button" className="text-xs font-bold text-blue-700 underline" onClick={stopEditRequest}>
                        Salir sin guardar
                      </button>
                    </div>
                  )}

                  {/* Transportista */}
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-black uppercase tracking-wide text-slate-500">Datos del transportista</p>
                    <label className="block">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Nombre completo</span>
                      <input
                        className="input mt-1"
                        type="text"
                        placeholder="Ej: Roger Senas Guzmán"
                        value={reqTransporter.name}
                        onChange={e => setReqTransporter(v => ({ ...v, name: e.target.value }))}
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">CI</span>
                        <input
                          className="input mt-1"
                          type="text"
                          placeholder="Ej: 3842873 SC"
                          value={reqTransporter.ci}
                          onChange={e => setReqTransporter(v => ({ ...v, ci: e.target.value }))}
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Placa</span>
                        <input
                          className="input mt-1"
                          type="text"
                          placeholder="Ej: 6274-FEG"
                          value={reqTransporter.plate}
                          onChange={e => setReqTransporter(v => ({ ...v, plate: e.target.value.toUpperCase() }))}
                        />
                      </label>
                    </div>
                  </div>

                  {!transporterComplete && (
                    <p className="rounded-lg bg-slate-100 px-3 py-2.5 text-xs font-semibold text-slate-500">
                      Completa los datos del transportista para continuar con el pedido.
                    </p>
                  )}

                  {transporterComplete && (<>

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
                        {reqProductLots.map(l => {
                          const st = lotStatus(l)
                          const statusText = st.label === 'Vencido' ? ' ⚠ VENCIDO' : st.label === 'Por vencer' ? ' · Por vencer' : st.label === 'Retenido' ? ' · Retenido' : ''
                          return (
                            <option key={l.id} value={l.id}>
                              {lotLabel(l.lot_code, l)} · {formatNumber(l.current_quantity)} uds {l.expiry_date ? `· Vence ${formatDate(l.expiry_date)}` : ''}{statusText}
                            </option>
                          )
                        })}
                      </select>
                    </label>
                  )}

                  {/* Selected lot info */}
                  {selectedLot && (() => {
                    const selSt = lotStatus(selectedLot)
                    const cardCls = selSt.label === 'Vencido' ? 'border-red-200 bg-red-50' : selSt.label === 'Por vencer' ? 'border-amber-200 bg-amber-50' : 'border-campo-100 bg-campo-50'
                    const dateCls = selSt.label === 'Vencido' ? 'text-red-600 font-bold' : selSt.label === 'Por vencer' ? 'text-amber-700 font-bold' : 'text-slate-500'
                    return (
                    <div className={`rounded-xl border px-3 py-3 ${cardCls}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-black text-slate-900 [overflow-wrap:anywhere]">{cleanProductName(selectedLot.product)}</p>
                            {selSt.label !== 'Disponible' && (
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${selSt.cls}`}>{selSt.label}</span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs font-semibold text-slate-500">
                            {lotLabel(selectedLot.lot_code, selectedLot)} · {selectedLot.location || 'Sin ubicación'}
                          </p>
                          {selectedLot.expiry_date && (
                            <p className={`text-xs font-semibold ${dateCls}`}>Vence: {formatDate(selectedLot.expiry_date)}</p>
                          )}
                        </div>
                        <div className="shrink-0 rounded-lg bg-white px-3 py-2 text-right shadow-sm">
                          {(() => {
                            const eq = lotEquivalent(selectedLot)
                            return eq ? (
                              <>
                                <p className="text-lg font-black text-campo-700">{formatNumber(eq.quantity)} <span className="text-sm font-bold text-campo-500">{eq.unit}</span></p>
                                <p className="text-[10px] font-semibold text-slate-400">{formatNumber(selectedLot.current_quantity)} uds disp.</p>
                              </>
                            ) : (
                              <>
                                <p className="text-lg font-black text-campo-700">{formatNumber(selectedLot.current_quantity)}</p>
                                <p className="text-[10px] font-bold text-slate-500">uds disp.</p>
                              </>
                            )
                          })()}
                        </div>
                      </div>
                      {packageLabel(selectedLot) && (
                        <p className="mt-2 text-xs font-semibold text-campo-700">Presentación: {packageLabel(selectedLot)}</p>
                      )}
                    </div>
                    )
                  })()}

                  {/* Step 3: cantidad */}
                  {reqLotId && (
                    <label className="block">
                      <span className="text-xs font-black uppercase tracking-wide text-slate-500">3 · Cantidad de unidades</span>
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
                        const itemDays = daysUntil(item.expiry_date)
                        const isExpired  = itemDays !== null && itemDays < 0
                        const isExpiring = itemDays !== null && itemDays >= 0 && itemDays <= 90
                        return (
                        <div key={item.lot_id} className={`flex items-center gap-2 rounded-lg px-3 py-2.5 shadow-sm ${isExpired ? 'bg-red-50 ring-1 ring-red-200' : isExpiring ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-white'}`}>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="text-sm font-black text-slate-900 [overflow-wrap:anywhere]">{cleanProductName(item.product)}</p>
                              {isExpired  && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-700">VENCIDO</span>}
                              {isExpiring && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700">POR VENCER</span>}
                            </div>
                            <p className="text-xs font-semibold text-slate-500">{lotLabel(item.lot_code, item)}</p>
                            <div className="mt-0.5 flex items-baseline gap-1.5">
                              {eq
                                ? <>
                                    <span className="text-sm font-black text-campo-700">{formatNumber(eq.quantity)} {eq.unit}</span>
                                    <span className="text-[10px] font-semibold text-slate-400">({formatNumber(item.quantity)} uds)</span>
                                  </>
                                : <span className="text-xs font-black text-slate-700">{formatNumber(item.quantity)} uds</span>
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

                  {/* Nota adjunta */}
                  {reqItems.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-xs font-black uppercase tracking-wide text-slate-500">Nota adjunta (opcional)</span>
                      <p className="text-[10px] font-semibold text-slate-400">PDF, imagen o Excel — se imprime y entrega con el producto</p>
                      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 transition hover:border-campo-400 hover:bg-campo-50">
                        <Paperclip size={15} className="shrink-0 text-slate-400" />
                        <span className="min-w-0 truncate text-sm font-semibold text-slate-500">
                          {reqAttachFile ? reqAttachFile.name : 'Seleccionar archivo...'}
                        </span>
                        <input type="file" className="hidden" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png" onChange={e => setReqAttachFile(e.target.files?.[0] || null)} />
                      </label>
                      {reqAttachFile && (
                        <button type="button" className="text-xs font-bold text-red-500 hover:underline" onClick={() => setReqAttachFile(null)}>
                          Quitar adjunto
                        </button>
                      )}
                      {editingRequestId && existingAttachment && !reqAttachFile && (
                        <p className="text-[10px] font-semibold text-slate-400">
                          Ya hay una nota adjunta — se mantiene si no seleccionas otro archivo.
                          <button type="button" className="ml-2 font-bold text-red-500 hover:underline" onClick={() => setExistingAttachment(null)}>
                            Quitarla
                          </button>
                        </p>
                      )}
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
                    <button className="btn-primary w-full" type="submit" disabled={reqUploading}>
                      {reqUploading
                        ? 'Subiendo archivo...'
                        : editingRequestId
                          ? <><Send size={18} /> Guardar cambios de la solicitud</>
                          : <><Send size={18} /> Enviar solicitud a almacén</>}
                    </button>
                  )}

                  </>)}
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
                                            <span className="ml-1 text-[10px] font-semibold text-slate-400">({formatNumber(item.quantity)} uds)</span>
                                          </>
                                        : <span className="text-xs font-black text-slate-700">{formatNumber(item.quantity)} uds</span>
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
                                        <span className="ml-1 text-[10px] font-semibold text-slate-400">({formatNumber(req.quantity)} uds)</span>
                                      </>
                                    : <span className="text-xs font-black text-slate-700">{formatNumber(req.quantity)} uds</span>
                                  }
                                </div>
                              </div>
                            )
                          })()}
                          <RequestProgress status={req.status} />
                          {(req.transporter_name || req.transporter_ci || req.transporter_plate) && (
                            <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                              <span className="font-bold">Transportista: </span>
                              {[req.transporter_name, req.transporter_ci, req.transporter_plate].filter(Boolean).join(' · ')}
                            </div>
                          )}
                          {req.attachment_url && (
                            <a href={attachmentViewerUrl(req.attachment_url)} target="_blank" rel="noreferrer" className="mt-1.5 flex items-center gap-1.5 text-xs font-bold text-campo-700 hover:underline">
                              <Paperclip size={11} /> Ver nota adjunta
                            </a>
                          )}
                          <div className="mt-2 space-y-0.5">
                            <p className="text-[10px] font-semibold text-slate-400">{formatDate(req.created_at)}</p>
                            {req.admin_notes && (
                              <p className="text-xs font-semibold text-slate-600 italic [overflow-wrap:anywhere]">{req.admin_notes}</p>
                            )}
                          </div>
                          {['pendiente', 'aprobado'].includes(req.status) && (
                            cancelingId === req.id ? (
                              <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5">
                                <p className="text-xs font-bold text-red-800">¿Cancelar esta solicitud? El almacén dejará de verla.</p>
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  <button type="button" className="btn-secondary !min-h-8 !py-1 text-xs" onClick={() => setCancelingId(null)}>
                                    No, volver
                                  </button>
                                  <button
                                    type="button"
                                    className="inline-flex min-h-8 items-center justify-center rounded-lg bg-red-600 px-2 py-1 text-xs font-bold text-white active:scale-[0.98]"
                                    onClick={() => cancelRequest(req.id)}
                                  >
                                    Sí, cancelar
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="mt-2 flex gap-2">
                                <button
                                  type="button"
                                  className="btn-secondary flex-1 !min-h-8 !py-1 text-xs"
                                  onClick={() => startEditRequest(req)}
                                >
                                  Modificar
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex min-h-8 flex-1 items-center justify-center rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-bold text-red-600 transition hover:bg-red-50 active:scale-[0.98]"
                                  onClick={() => setCancelingId(req.id)}
                                >
                                  Cancelar
                                </button>
                              </div>
                            )
                          )}
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
                {movementNotes.map(n => {
                  const firstLot = n.movs[0]?.lots || {}
                  return (
                    <div
                      key={n.id}
                      className="flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors hover:bg-slate-50"
                      onClick={() => setSelectedMovement(n)}
                    >
                      <span className={`shrink-0 rounded-lg px-2 py-1.5 text-[10px] font-black uppercase leading-none ${n.type === 'entrada' ? 'bg-campo-100 text-campo-800' : 'bg-red-50 text-red-700'}`}>
                        {n.type === 'entrada' ? 'Ingreso' : 'Salida'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-slate-900 [overflow-wrap:anywhere]">
                          {n.noteNumber ? (
                            <span className="font-mono text-campo-700">{n.noteNumber}</span>
                          ) : (
                            cleanProductName(firstLot.product)
                          )}
                        </p>
                        <p className="text-xs font-semibold text-slate-500">
                          {n.movs.length > 1 ? `${n.movs.length} productos` : cleanProductName(firstLot.product)} · {formatDate(n.createdAt)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-black leading-snug text-campo-700">{n.equivalentLabel}</p>
                        {n.movs.length === 1 ? (
                          <p className="text-xs font-semibold text-slate-400">{formatNumber(n.totalUds)} uds</p>
                        ) : null}
                      </div>
                      <button
                        className="shrink-0 rounded-lg border border-slate-200 p-1.5 text-slate-400 transition-colors hover:border-campo-300 hover:text-campo-700"
                        type="button"
                        title="Ver nota (PDF)"
                        onClick={(e) => { e.stopPropagation(); openNotePdf(n) }}
                      >
                        <FileText size={15} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Movement detail modal */}
      {selectedMovement && (
        <MovementModal
          movement={selectedMovement}
          clientName={clientName}
          onClose={() => setSelectedMovement(null)}
          onPrint={() => openNotePdf(selectedMovement)}
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
  if (status === 'cancelado') {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2">
        <X size={13} className="shrink-0 text-slate-500" />
        <span className="text-xs font-black text-slate-600">Cancelada por ti</span>
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

function MovementModal({ movement: note, clientName, onClose, onPrint }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end overflow-y-auto bg-black/40 p-4 sm:items-center sm:justify-center" onClick={onClose}>
      <section className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-campo-700">{movementLabel(note.type)}</p>
            <h3 className="mt-1 font-mono text-lg font-black leading-snug text-slate-950">{note.noteNumber || 'Sin nota'}</h3>
            <p className="text-xs font-semibold text-slate-500">{formatDate(note.createdAt)}</p>
          </div>
          <button className="btn-secondary !min-h-9 !px-2.5" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="mt-4 space-y-1.5">
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Productos ({note.movs.length})</p>
          {note.movs.map(m => {
            const lot = m.lots || {}
            return (
              <div key={m.id} className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 [overflow-wrap:anywhere]">{cleanProductName(lot.product)}</p>
                  <p className="text-[11px] font-semibold text-slate-400">Lote: {displayLotCode(lot.lot_code, lot)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-black text-campo-700">{movementEquivalentLabel(m)}</p>
                  <p className="text-[11px] font-semibold text-slate-400">{formatNumber(m.quantity)} uds</p>
                </div>
              </div>
            )
          })}
        </div>

        <dl className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3 text-sm">
          {[
            ['Cantidad total', note.equivalentLabel],
            note.transporter ? ['Transportista', note.transporter] : null,
            note.plate ? ['Placa', note.plate] : null,
            note.observations ? ['Observaciones', note.observations] : null,
          ].filter(Boolean).map(([label, val]) => (
            <div key={label} className="flex items-start justify-between gap-3">
              <dt className="font-semibold text-slate-500">{label}</dt>
              <dd className="font-black text-slate-900 text-right [overflow-wrap:anywhere]">{val}</dd>
            </div>
          ))}
        </dl>
        <button className="btn-primary mt-3 w-full" onClick={onPrint}><FileText size={16} /> Ver nota (PDF)</button>
      </section>
    </div>
  )
}
