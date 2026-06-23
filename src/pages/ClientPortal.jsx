import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Boxes, CalendarClock, CheckCircle2, ChevronDown,
  ClipboardList, Download, FileText, History, Minus, Package,
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

function lotEquivalent(lot) {
  const s = Number(lot?.package_size || 0)
  if (s <= 0 || !lot?.package_unit) return null
  return { quantity: Number(lot.current_quantity || 0) * s, unit: lot.package_unit }
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
  if (totals.length === 0) return 'Sin equivalente'
  return totals.map(([unit, qty]) => `${formatNumber(qty)} ${unit}`).join(' / ')
}

const STATUS_MAP = {
  pendiente:  { label: 'Despacho pendiente',  cls: 'bg-amber-50 text-amber-800' },
  aprobado:   { label: 'Despacho pendiente',  cls: 'bg-amber-50 text-amber-800' },
  en_preparacion: { label: 'En preparación', cls: 'bg-campo-100 text-campo-800' },
  despachado: { label: 'Despachado',  cls: 'bg-slate-100 text-slate-700' },
  rechazado:  { label: 'Rechazado',   cls: 'bg-red-50 text-red-700' },
}
function requestStatus(s) { return STATUS_MAP[s] || { label: 'Recibido', cls: 'bg-amber-50 text-amber-800' } }

const REQUEST_STEPS = [
  { key: 'pendiente', label: 'Pendiente' },
  { key: 'en_preparacion', label: 'En preparación' },
  { key: 'despachado', label: 'Despachado' },
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
  const productCount  = new Set(lots.map(l => l.product).filter(Boolean)).size
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
      if (!map[key]) map[key] = { key, product: cleanProductName(lot.product), identity: productIdentityLabel(lot), quantity:0, equivalents:{}, lots:[], expiring:0, retained:0 }
      map[key].quantity += Number(lot.current_quantity||0)
      map[key].lots.push(lot)
      const eq = lotEquivalent(lot)
      if (eq) map[key].equivalents[eq.unit] = Number(map[key].equivalents[eq.unit]||0) + eq.quantity
      const st = lotStatus(lot).label
      if (st === 'Por vencer' || st === 'Vencido') map[key].expiring++
      if (st === 'Retenido') map[key].retained++
    })
    return Object.values(map).map(g => ({
      ...g,
      lots: g.lots.sort((a,b) => (a.expiry_date||'9999-12-31').localeCompare(b.expiry_date||'9999-12-31')),
    })).sort((a,b) => a.identity.localeCompare(b.identity,'es',{numeric:true}))
  }, [filteredLots])

  const visibleProducts = (showAllProducts || search.trim()) ? inventoryProducts : inventoryProducts.slice(0,8)

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
  function exportExcel() {
    const headers = ['Cliente','Producto','Lote','Envases','Presentacion','Equivalente','Ubicacion','Ingreso','Vencimiento','Estado']
    const rows = lots.map(l => [clientName, cleanProductName(l.product), displayLotCode(l.lot_code,l), formatNumber(l.current_quantity), l.package_size?`${formatNumber(l.package_size)} ${l.package_unit||''}`:'', l.package_size?`${formatNumber(Number(l.current_quantity||0)*Number(l.package_size||0))} ${l.package_unit||''}`:'', l.location||'', l.entry_date?formatDate(l.entry_date):'', l.expiry_date?formatDate(l.expiry_date):'', lotStatus(l).label])
    const html = `<html><head><meta charset="utf-8"/></head><body><table>${[headers,...rows].map(r=>`<tr>${r.map(c=>`<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</table></body></html>`
    const blob = new Blob([html],{type:'application/vnd.ms-excel;charset=utf-8'})
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href=url; a.download=`inventario-${clientName.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}-${new Date().toISOString().slice(0,10)}.xls`; a.click(); URL.revokeObjectURL(url)
  }

  function printPdf() {
    const rows = lots.map(l=>`<tr><td>${escapeHtml(cleanProductName(l.product))}</td><td>${escapeHtml(displayLotCode(l.lot_code,l))}</td><td>${escapeHtml(formatNumber(l.current_quantity))}</td><td>${escapeHtml(Number(l.package_size)>0?`${formatNumber(Number(l.current_quantity||0)*Number(l.package_size||0))} ${l.package_unit||''}`:'-')}</td><td>${escapeHtml(l.location||'-')}</td><td>${escapeHtml(l.expiry_date?formatDate(l.expiry_date):'-')}</td><td>${escapeHtml(lotStatus(l).label)}</td></tr>`).join('')
    const w = window.open('','_blank'); if(!w) return
    w.document.write(`<!doctype html><html><head><title>Inventario ${escapeHtml(clientName)}</title><meta name="viewport" content="width=device-width,initial-scale=1"/><style>body{color:#0f172a;font-family:Arial,sans-serif;margin:24px}h1{margin:0 0 4px}table{border-collapse:collapse;margin-top:18px;width:100%}th,td{border-bottom:1px solid #cbd5e1;font-size:12px;padding:8px;text-align:left}th{background:#f1f5f9}.terms{color:#475569;font-size:11px;margin-top:18px}@media print{body{margin:12mm}}</style></head><body><h1>Todo Agricola Boliviana Ltda</h1><strong>Inventario actual - ${escapeHtml(clientName)}</strong><p>Emitido: ${escapeHtml(formatDate(new Date().toISOString()))}</p><table><thead><tr><th>Producto</th><th>Lote</th><th>Envases</th><th>Equivalente</th><th>Ubicacion</th><th>Vence</th><th>Estado</th></tr></thead><tbody>${rows}</tbody></table><p class="terms">Informacion referencial sujeta a validacion operativa de Todo Agricola.</p><script>window.addEventListener('load',()=>window.print())</script></body></html>`)
    w.document.close()
  }

  function printReceipt(movement) {
    const lot = movement.lots||{}; const eq = Number(movement.quantity||0)*Number(lot.package_size||0)
    const type = movement.type==='salida'?'despacho':movementLabel(movement.type).toLowerCase()
    const w = window.open('','_blank'); if(!w) return
    w.document.write(`<!doctype html><html><head><title>Comprobante</title><style>body{color:#0f172a;font-family:Arial,sans-serif;margin:24px}h1{margin:0 0 4px}.box{border:1px solid #cbd5e1;border-radius:8px;margin-top:14px;padding:12px}.grid{display:grid;gap:10px;grid-template-columns:repeat(2,1fr)}strong{display:block}@media print{body{margin:12mm}}</style></head><body><h1>Todo Agricola Boliviana Ltda</h1><p>Comprobante de ${escapeHtml(type)} para ${escapeHtml(clientName)}</p><div class="box grid"><div><strong>Fecha</strong>${escapeHtml(formatDate(movement.created_at))}</div><div><strong>Movimiento</strong>${escapeHtml(movementLabel(movement.type))}</div><div><strong>Codigo</strong>${escapeHtml(productCodeLabel(lot)||'-')}</div><div><strong>Lote</strong>${escapeHtml(displayLotCode(lot.lot_code,lot))}</div><div><strong>Producto</strong>${escapeHtml(cleanProductName(lot.product))}</div><div><strong>Cantidad</strong>${escapeHtml(formatNumber(movement.quantity))} envases</div><div><strong>Equivalente</strong>${escapeHtml(Number(lot.package_size)>0?`${formatNumber(eq)} ${lot.package_unit||''}`:'-')}</div><div><strong>Ubicacion</strong>${escapeHtml(lot.location||'-')}</div></div>${movement.notes?`<div class="box"><strong>Referencia</strong>${escapeHtml(movement.notes)}</div>`:''}<script>window.addEventListener('load',()=>window.print())</script></body></html>`)
    w.document.close()
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

  return (
    <div className="space-y-4 pb-2">

      {/* ── DASHBOARD (Inicio) ─────────────────────────────────── */}
      {isInventory && (
        <>
          {/* Greeting */}
          <div className="overflow-hidden rounded-2xl bg-campo-700 text-white shadow-sm">
            {/* Company brand strip */}
            <div className="flex items-center gap-3 border-b border-white/15 bg-campo-800/40 px-5 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1 shadow-sm">
                <img src="/images/todo-logo.png" alt="Todo Agrícola" className="h-full w-full object-contain" />
              </div>
              <div>
                <p className="text-xs font-black tracking-widest text-white/90 uppercase">Todo Agrícola Boliviana</p>
                <p className="text-[10px] font-semibold text-campo-300">Portal de cliente · Almacén G.A.T Bolivia</p>
              </div>
            </div>
            {/* Greeting row */}
            <div className="flex items-start justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-campo-300">Bienvenido</p>
                <h1 className="mt-0.5 text-xl font-black leading-snug [overflow-wrap:anywhere]">{clientName}</h1>
                <p className="mt-0.5 text-sm font-semibold text-campo-200 capitalize">
                  {new Intl.DateTimeFormat('es-BO',{weekday:'long',day:'numeric',month:'long'}).format(new Date())}
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-2 pt-1">
                <button className="inline-flex items-center gap-1.5 rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/20" onClick={exportExcel}>
                  <Download size={14} /> Excel
                </button>
                <button className="inline-flex items-center gap-1.5 rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/20" onClick={printPdf}>
                  <FileText size={14} /> PDF
                </button>
              </div>
            </div>
          </div>

          {/* Metrics */}
          {(() => {
            const eqTotals = {}
            lots.forEach(l => {
              const qty = Number(l.current_quantity || 0) * Number(l.package_size || 0)
              if (qty > 0 && l.package_unit) eqTotals[l.package_unit] = (eqTotals[l.package_unit] || 0) + qty
            })
            const eqLabel = Object.entries(eqTotals).map(([u, v]) => `${formatNumber(v)} ${u}`).join(' · ')
            return (
              <div className="grid grid-cols-3 gap-2">
                <MetricCard icon={Boxes} label="Envases en almacén" value={formatNumber(totalStock)} sub={eqLabel || null} color="campo" />
                <MetricCard icon={Package} label="Productos distintos" value={productCount} color="slate" onClick={() => setShowProductsModal(true)} />
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
                  <article key={group.key} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
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
                  </article>
                )
              })}

              {!search.trim() && inventoryProducts.length > 8 && (
                <button
                  className="w-full rounded-xl border border-slate-200 bg-white py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
                  onClick={() => setShowAllProducts(v => !v)}
                >
                  {showAllProducts ? 'Ver menos' : `Ver todos los productos (${inventoryProducts.length})`}
                </button>
              )}
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
          <div className="rounded-2xl bg-campo-700 px-5 py-5 text-white">
            <p className="text-xs font-bold uppercase tracking-wider text-campo-200">Portal de cliente</p>
            <h1 className="mt-1 text-xl font-black">Solicitar despacho</h1>
            <p className="mt-0.5 text-sm font-semibold text-campo-200">Armá tu lista y enviala directamente a almacén.</p>
          </div>

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
                <div className="p-4">
                  <div className="rounded-xl bg-campo-700 p-5 text-white">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 size={32} className="shrink-0" />
                      <div>
                        <p className="text-lg font-black">¡Solicitud enviada!</p>
                        <p className="mt-0.5 text-sm font-semibold text-campo-200">{reqSuccess.items.length} producto{reqSuccess.items.length > 1 ? 's' : ''} quedaron como despacho pendiente.</p>
                      </div>
                    </div>
                    <div className="mt-4 space-y-2">
                      {reqSuccess.items.map(item => (
                        <div key={item.lot_id} className="rounded-lg bg-white/10 px-3 py-2">
                          <p className="text-sm font-black [overflow-wrap:anywhere]">{cleanProductName(item.product)}</p>
                          <p className="text-xs font-semibold text-campo-200">{formatNumber(item.quantity)} env. · {lotLabel(item.lot_code, item)}</p>
                        </div>
                      ))}
                    </div>
                    <button className="mt-4 w-full rounded-lg bg-white py-2.5 font-black text-campo-800" onClick={() => setReqSuccess(null)}>
                      Nueva solicitud
                    </button>
                  </div>
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
                          <p className="text-lg font-black text-campo-700">{formatNumber(selectedLot.current_quantity)}</p>
                          <p className="text-[10px] font-bold text-slate-500">env. disp.</p>
                          {(() => { const eq = lotEquivalent(selectedLot); return eq ? <p className="text-[10px] font-semibold text-campo-600">{formatNumber(eq.quantity)} {eq.unit}</p> : null })()}
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
                      {reqItems.map(item => (
                        <div key={item.lot_id} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2.5 shadow-sm">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-black text-slate-900 [overflow-wrap:anywhere]">{cleanProductName(item.product)}</p>
                            <p className="text-xs font-semibold text-slate-500">
                              {lotLabel(item.lot_code, item)} · {formatNumber(item.quantity)} env.
                              {Number(item.package_size) > 0 && item.package_unit ? ` · ${formatNumber(Number(item.quantity) * Number(item.package_size))} ${item.package_unit}` : ''}
                            </p>
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
                      ))}
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
              <div className="divide-y divide-slate-100 overflow-y-auto" style={{maxHeight:'520px'}}>
                {requests.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm font-bold text-slate-400">Todavía no hay solicitudes.</p>
                ) : (
                  requests.map(req => {
                    const st = requestStatus(req.status)
                    const items = Array.isArray(req.items) && req.items.length > 0 ? req.items : null
                    return (
                      <div key={req.id} className="px-4 py-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 text-sm font-black text-slate-900 [overflow-wrap:anywhere]">
                            {items ? `${items.length} producto${items.length > 1 ? 's' : ''}` : cleanProductName(req.product || req.lots?.product)}
                          </p>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${st.cls}`}>{st.label}</span>
                        </div>
                        {items && (
                          <div className="mt-1.5 space-y-0.5">
                            {items.slice(0,3).map(item => (
                              <p key={item.lot_id} className="text-xs font-semibold text-slate-500">
                                · {cleanProductName(item.product)} — {formatNumber(item.quantity)} env.
                              </p>
                            ))}
                            {items.length > 3 && <p className="text-xs font-semibold text-slate-400">+ {items.length - 3} más</p>}
                          </div>
                        )}
                        {!items && (
                          <p className="mt-0.5 text-xs font-semibold text-slate-500">
                            {lotLabel(req.lots?.lot_code, req.lots)} · {formatNumber(req.quantity)} env.
                          </p>
                        )}
                        <RequestProgress status={req.status} />
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <p className="text-[10px] font-semibold text-slate-400">{formatDate(req.created_at)}</p>
                          {req.admin_notes && (
                            <p className="text-xs font-semibold text-slate-600 italic">{req.admin_notes}</p>
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
          <div className="rounded-2xl bg-campo-700 px-5 py-5 text-white">
            <p className="text-xs font-bold uppercase tracking-wider text-campo-200">Portal de cliente</p>
            <h1 className="mt-1 text-xl font-black">Historial de movimientos</h1>
            <p className="mt-0.5 text-sm font-semibold text-campo-200">{movements.length} movimientos visibles de tus productos.</p>
          </div>

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
        <p className="text-2xl font-black leading-none tabular-nums">{value}</p>
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
      <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-black text-red-700">
        Solicitud rechazada
      </div>
    )
  }

  const currentStep = requestStepIndex(status)

  return (
    <div className="mt-3">
      <div className="grid grid-cols-3 gap-1.5">
        {REQUEST_STEPS.map((step, index) => {
          const done = index <= currentStep
          return (
            <div key={step.key} className="min-w-0">
              <div className={`h-1.5 rounded-full ${done ? 'bg-campo-600' : 'bg-slate-200'}`} />
              <p className={`mt-1 truncate text-[10px] font-black ${done ? 'text-campo-700' : 'text-slate-400'}`}>
                {step.label}
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
      <section className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="font-black text-slate-950">Productos en almacén</h3>
            <p className="text-xs font-semibold text-slate-500">{products.length} producto{products.length !== 1 ? 's' : ''}</p>
          </div>
          <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="border-b border-slate-100 px-4 py-2.5">
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <Search size={14} className="shrink-0 text-slate-400" />
            <input
              autoFocus
              type="text"
              placeholder="Buscar producto..."
              value={q}
              onChange={e => setQ(e.target.value)}
              className="w-full bg-transparent text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none"
            />
            {q && <button onClick={() => setQ('')} className="text-slate-400"><X size={14} /></button>}
          </div>
        </div>
        <ul className="max-h-[55dvh] divide-y divide-slate-100 overflow-y-auto">
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
      <section className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="font-black text-slate-950">Lotes próximos a vencer</h3>
            <p className="text-xs font-semibold text-slate-500">{alertLots.length} lote{alertLots.length !== 1 ? 's' : ''} en los próximos 90 días</p>
          </div>
          <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="max-h-[60dvh] divide-y divide-slate-100 overflow-y-auto">
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
