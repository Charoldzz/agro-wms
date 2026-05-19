import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle2, LogOut, Plus, ScanLine, Trash2 } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useAuth } from '../hooks/useAuth.jsx'
import { cleanProductName, displayLotCode } from '../lib/display'
import { formatDate, formatNumber } from '../lib/format'
import { isNetworkMovementError, queueMovement } from '../lib/offlineQueue'
import { supabase } from '../lib/supabase'

const DISPATCH_DRAFT_KEY = 'todo-agricola-dispatch-list-draft'

function emptyDraft() {
  return { items: [], receiverName: '', receiverDocument: '', vehiclePlate: '' }
}

function readDraft() {
  try {
    const draft = JSON.parse(sessionStorage.getItem(DISPATCH_DRAFT_KEY) || 'null')
    if (!draft) return emptyDraft()
    return {
      items: Array.isArray(draft.items) ? draft.items : [],
      receiverName: draft.receiverName || '',
      receiverDocument: draft.receiverDocument || '',
      vehiclePlate: draft.vehiclePlate || '',
    }
  } catch {
    return emptyDraft()
  }
}

function writeDraft(draft) {
  sessionStorage.setItem(DISPATCH_DRAFT_KEY, JSON.stringify(draft))
}

function clearDraft() {
  sessionStorage.removeItem(DISPATCH_DRAFT_KEY)
}

function expiryDays(expiryDate) {
  if (!expiryDate) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((new Date(`${expiryDate}T00:00:00`) - today) / 86400000)
}

export default function DispatchList() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, isOperator } = useAuth()
  const [items, setItems] = useState(() => readDraft().items)
  const [receiverName, setReceiverName] = useState(() => readDraft().receiverName)
  const [receiverDocument, setReceiverDocument] = useState(() => readDraft().receiverDocument)
  const [vehiclePlate, setVehiclePlate] = useState(() => readDraft().vehiclePlate)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)

  const lotId = new URLSearchParams(location.search).get('lot')

  useEffect(() => {
    writeDraft({ items, receiverName, receiverDocument, vehiclePlate })
  }, [items, receiverName, receiverDocument, vehiclePlate])

  useEffect(() => {
    async function addScannedLot() {
      if (!lotId) return

      const { data, error: lotError } = await supabase
        .from('lots')
        .select('*, clients(name)')
        .eq('id', lotId)
        .single()

      if (lotError || !data) {
        setError('No se pudo cargar el lote escaneado.')
        return
      }

      setItems((current) => {
        if (current.some((item) => item.lot.id === data.id)) return current
        return [...current, { lot: data, package_count: '' }]
      })
      navigate('/operacion/despacho-lista', { replace: true })
    }

    addScannedLot()
  }, [lotId, navigate])

  const totalPackages = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.package_count || 0), 0),
    [items],
  )

  function scanLot() {
    navigate(`/scanner?modo=despacho&return=${encodeURIComponent('/operacion/despacho-lista')}`)
  }

  function updateQuantity(lotIdToUpdate, value) {
    const nextValue = value.replace(',', '.')
    if (!/^\d*\.?\d*$/.test(nextValue)) return
    setItems((current) =>
      current.map((item) => (item.lot.id === lotIdToUpdate ? { ...item, package_count: nextValue } : item)),
    )
  }

  function removeItem(lotIdToRemove) {
    setItems((current) => current.filter((item) => item.lot.id !== lotIdToRemove))
  }

  function validateDispatch() {
    if (items.length === 0) return 'Escanea al menos un lote.'
    if (!receiverName.trim()) return 'Escribe el nombre de quien recibe.'
    if (!receiverDocument.trim()) return 'Escribe el numero de documento.'

    for (const item of items) {
      const quantity = Number(item.package_count || 0)
      if (quantity <= 0) return `Escribe cantidad para ${displayLotCode(item.lot.lot_code)}.`
      if (quantity > Number(item.lot.current_quantity || 0)) return `No hay inventario suficiente en ${displayLotCode(item.lot.lot_code)}.`
      if (['retenido', 'cerrado'].includes(item.lot.status)) return `${displayLotCode(item.lot.lot_code)} esta ${item.lot.status}.`
      if (expiryDays(item.lot.expiry_date) < 0) return `${displayLotCode(item.lot.lot_code)} esta vencido.`
    }

    return ''
  }

  async function confirmDispatch() {
    const validationError = validateDispatch()
    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    setError('')
    setStatus('')

    let queued = 0

    for (const item of items) {
      const quantity = Number(item.package_count)
      const notes = [
        vehiclePlate.trim() ? `Placa: ${vehiclePlate.trim()}` : null,
        `Recibe: ${receiverName.trim()}`,
        `Documento: ${receiverDocument.trim()}`,
        'Despacho por lista',
      ]
        .filter(Boolean)
        .join(' | ')

      const email = {
        to: 'hgarayd@outlook.com',
        movement_type: 'salida',
        quantity,
        previous_quantity: Number(item.lot.current_quantity || 0),
        new_quantity: Number(item.lot.current_quantity || 0) - quantity,
        to_location: vehiclePlate.trim() || null,
        notes,
        lot_code: displayLotCode(item.lot.lot_code),
        product: cleanProductName(item.lot.product),
        client: item.lot.clients?.name || 'Sin cliente',
        location: item.lot.location,
        user_email: user.email,
      }

      const { error: rpcError } = await supabase.rpc('register_movement', {
        p_lot_id: item.lot.id,
        p_type: 'salida',
        p_quantity: quantity,
        p_to_location: vehiclePlate.trim() || null,
        p_notes: notes,
        p_user_id: user.id,
      })

      if (rpcError) {
        if (isNetworkMovementError(rpcError)) {
          queueMovement({
            lot_id: item.lot.id,
            type: 'salida',
            quantity,
            to_location: vehiclePlate.trim() || null,
            notes,
            user_id: user.id,
            email,
          })
          queued += 1
          continue
        }

        setError(rpcError.message?.includes('inventario') ? `No hay inventario suficiente en ${displayLotCode(item.lot.lot_code)}.` : rpcError.message)
        setSaving(false)
        return
      }

      await supabase.functions.invoke('send-movement-email', { body: email })
    }

    setItems([])
    clearDraft()
    setStatus(queued > 0 ? `${queued} salida(s) quedaron guardadas para sincronizar cuando vuelva la señal.` : 'Despacho guardado y correo enviado a oficina.')
    setTimeout(() => navigate(isOperator ? '/operacion' : '/'), 1000)
    setSaving(false)
  }

  return (
    <div>
      <PageHeader title="Despacho por lista" subtitle="Escanea varios lotes y confirma una sola salida" />

      <section className="panel mb-4 grid gap-3 sm:grid-cols-2">
        <label>
          <span className="label">Nombre del que recibe</span>
          <input className="input mt-1" value={receiverName} onChange={(event) => setReceiverName(event.target.value)} />
        </label>
        <label>
          <span className="label">Numero de documento</span>
          <input className="input mt-1" value={receiverDocument} onChange={(event) => setReceiverDocument(event.target.value)} />
        </label>
        <label className="sm:col-span-2">
          <span className="label">Placa del vehiculo</span>
          <input className="input mt-1 uppercase" value={vehiclePlate} onChange={(event) => setVehiclePlate(event.target.value.toUpperCase())} placeholder="Opcional" />
        </label>
      </section>

      <section className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px]">
        <button className="btn-primary min-h-14" type="button" onClick={scanLot}>
          <ScanLine size={22} /> Escanear lote
        </button>
        <div className="rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-800">
          Total: {formatNumber(totalPackages)} envases
        </div>
      </section>

      <div className="space-y-3">
        {items.length === 0 ? (
          <EmptyState title="Sin lotes en despacho" text="Escanea el primer QR para agregarlo a la lista." />
        ) : (
          items.map((item) => {
            const days = expiryDays(item.lot.expiry_date)
            const equivalent = Number(item.package_count || 0) * Number(item.lot.package_size || 0)
            return (
              <article key={item.lot.id} className="panel">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-950">{cleanProductName(item.lot.product)}</p>
                    <p className="text-sm font-semibold text-slate-500">
                      {displayLotCode(item.lot.lot_code)} · {item.lot.location || '-'}
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-lg bg-campo-50 p-3">
                        <p className="text-xs font-semibold uppercase text-campo-700">Disponible</p>
                        <p className="mt-1 text-3xl font-black text-campo-800">{formatNumber(item.lot.current_quantity)}</p>
                        <p className="text-sm font-bold text-campo-700">envases</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase text-slate-500">Vencimiento</p>
                        <p className="mt-1 text-base font-black text-slate-950">
                          {item.lot.expiry_date ? formatDate(item.lot.expiry_date) : 'Sin dato'}
                        </p>
                        <p className="text-xs font-bold text-slate-500">{item.lot.status || 'activo'}</p>
                      </div>
                    </div>
                  </div>
                  <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={() => removeItem(item.lot.id)}>
                    <Trash2 size={17} />
                  </button>
                </div>
                {days !== null && days <= 90 ? (
                  <div className={`mt-3 rounded-lg p-2 text-xs font-bold ${days < 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>
                    {days < 0 ? 'Lote vencido, salida bloqueada.' : `Vence en ${days} dias. Revisa FEFO antes de confirmar.`}
                  </div>
                ) : null}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label>
                    <span className="label">Envases a despachar</span>
                    <input
                      className="input mt-1"
                      inputMode="decimal"
                      type="text"
                      value={item.package_count}
                      onChange={(event) => updateQuantity(item.lot.id, event.target.value)}
                      onWheel={(event) => event.currentTarget.blur()}
                    />
                  </label>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">Equivalente</p>
                    <p className="mt-1 text-lg font-black text-slate-950">
                      {Number(item.lot.package_size) > 0 ? `${formatNumber(equivalent)} ${item.lot.package_unit || ''}` : 'Sin dato'}
                    </p>
                  </div>
                </div>
              </article>
            )
          })
        )}
      </div>

      {error ? <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}
      {status ? <div className="mt-4 rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">{status}</div> : null}

      <button className="btn-primary mt-4 w-full" type="button" onClick={confirmDispatch} disabled={saving}>
        {saving ? <LogOut size={20} /> : <CheckCircle2 size={20} />}
        {saving ? 'Guardando...' : 'Confirmar despacho'}
      </button>

      <Link className="btn-secondary mt-3 w-full" to="/operacion">
        <Plus size={20} /> Volver a operar
      </Link>
    </div>
  )
}
