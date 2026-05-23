import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Send, X } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useAuth } from '../hooks/useAuth.jsx'
import { cleanProductName, displayLotCode } from '../lib/display'
import { formatDate, formatNumber } from '../lib/format'
import { vibrateSuccess } from '../lib/haptics'
import { supabase } from '../lib/supabase'

export default function CorrectionRequests() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [movements, setMovements] = useState([])
  const [clients, setClients] = useState([])
  const [selected, setSelected] = useState(null)
  const [selectedOperation, setSelectedOperation] = useState(null)
  const [detailGroup, setDetailGroup] = useState(null)
  const [correctionType, setCorrectionType] = useState('cantidad')
  const [quantity, setQuantity] = useState('')
  const [lotPatch, setLotPatch] = useState({})
  const [reason, setReason] = useState('')
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function loadRecentMovements() {
      const [{ data, error: operationError }, { data: clientRows }] = await Promise.all([
        supabase
          .from('movements')
          .select('id, operation_id, type, quantity, previous_quantity, new_quantity, from_location, to_location, notes, created_at, approval_status, warehouse_operations(operation_code, type, receiver_name, receiver_document, vehicle_plate, driver_name, driver_document), lots(id, client_id, lot_code, product, package_size, package_unit, location, expiry_date, clients(name))')
          .eq('user_id', user.id)
          .in('type', ['entrada', 'salida'])
          .eq('approval_status', 'aprobado')
          .order('created_at', { ascending: false })
          .limit(30),
        supabase.from('clients').select('id, name').order('name'),
      ])
      if (!operationError) {
        setMovements(data || [])
      } else {
        const { data: legacyRows } = await supabase
          .from('movements')
          .select('id, type, quantity, previous_quantity, new_quantity, from_location, to_location, notes, created_at, approval_status, lots(id, client_id, lot_code, product, package_size, package_unit, location, expiry_date, clients(name))')
          .eq('user_id', user.id)
          .in('type', ['entrada', 'salida'])
          .eq('approval_status', 'aprobado')
          .order('created_at', { ascending: false })
          .limit(30)
        setMovements(legacyRows || [])
      }
      setClients(clientRows || [])
    }

    loadRecentMovements()
  }, [user.id])

  function openRequest(movement) {
    setSelected(movement)
    setCorrectionType('cantidad')
    setQuantity(String(movement.quantity || ''))
    setLotPatch(createLotPatch(movement))
    setReason('')
    setError('')
  }

  function openOperationRequest(group) {
    setSelectedOperation(group)
    setLotPatch(createOperationPatch(group))
    setReason('')
    setError('')
  }

  const movementGroups = useMemo(() => groupMovements(movements), [movements])

  useEffect(() => {
    if (!success) return undefined

    const redirect = window.setTimeout(() => navigate('/operacion', { replace: true }), 1400)
    return () => window.clearTimeout(redirect)
  }, [navigate, success])

  async function submitCorrection() {
    if (!selected) return
    if (correctionType === 'cantidad' && (Number(quantity) < 0 || quantity === '')) {
      setError('Escribe la cantidad correcta.')
      return
    }
    if (correctionType === 'cantidad' && exceedsCorrectionStock(selected, quantity)) {
      setError('No hay inventario suficiente para esa correccion.')
      return
    }
    const requestedPatch = changedLotPatch(selected, lotPatch)
    if (correctionType === 'ficha' && Object.keys(requestedPatch).length === 0) {
      setError('Cambia al menos un dato de la ficha.')
      return
    }
    if (!reason.trim()) {
      setError('Explica brevemente el error.')
      return
    }

    setSaving(true)
    setError('')
    const { error: requestError } = await supabase.rpc('request_movement_correction', {
      p_movement_id: selected.id,
      p_requested_quantity: correctionType === 'cantidad' ? Number(quantity) : Number(selected.quantity || 0),
      p_correction_type: correctionType,
      p_lot_patch: correctionType === 'ficha' ? requestedPatch : {},
      p_reason: reason.trim(),
      p_user_id: user.id,
    })

    if (requestError) {
      setError(requestError.message?.includes('request_movement_correction') ? 'Falta correr el SQL de correcciones operativas.' : requestError.message)
      setSaving(false)
      return
    }

    vibrateSuccess()
    setSuccess(true)
    setSaving(false)
  }

  async function submitOperationCorrection() {
    if (!selectedOperation) return
    const requestedPatch = changedOperationPatch(selectedOperation, lotPatch)

    if (Object.keys(requestedPatch).length === 1) {
      setError('Cambia al menos un dato de la operacion.')
      return
    }
    if (!reason.trim()) {
      setError('Explica brevemente el error.')
      return
    }

    setSaving(true)
    setError('')
    const anchorMovement = selectedOperation.items[0]
    const { error: requestError } = await supabase.rpc('request_movement_correction', {
      p_movement_id: anchorMovement.id,
      p_requested_quantity: Number(anchorMovement.quantity || 0),
      p_correction_type: 'operacion',
      p_lot_patch: requestedPatch,
      p_reason: reason.trim(),
      p_user_id: user.id,
    })

    if (requestError) {
      setError(requestError.message?.includes('request_movement_correction') ? 'Falta correr el SQL de correcciones operativas.' : requestError.message)
      setSaving(false)
      return
    }

    vibrateSuccess()
    setSuccess(true)
    setSaving(false)
  }

  return (
    <div>
      <PageHeader title="Solicitar correccion" subtitle="Ingresos y despachos recientes" />

      <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-bold text-orange-900">
        Si una entrada o despacho tiene un error, solicita correccion de cantidad o datos de la ficha.
      </div>

      <div className="space-y-2">
        {movementGroups.length === 0 ? (
          <EmptyState title="Sin movimientos recientes" text="Tus entradas y salidas recientes apareceran aqui." />
        ) : (
          movementGroups.map((group) => (
            <article
              key={group.id}
              className="panel cursor-pointer transition hover:border-campo-200 hover:bg-campo-50/30 active:scale-[0.995]"
              role="button"
              tabIndex={0}
              onClick={() => setDetailGroup(group)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setDetailGroup(group)
                }
              }}
              title="Ver detalle de la operacion"
            >
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase text-orange-700">{group.label}</p>
                  <p className="mt-1 text-base font-black leading-snug text-slate-950 [overflow-wrap:anywhere]">
                    {group.clientName}
                  </p>
                  <p className="text-xs font-semibold text-slate-500">
                    {formatDate(group.createdAt)}
                  </p>
                  <p className="mt-1 text-xs font-black text-campo-700">
                    {group.items.length} producto{group.items.length === 1 ? '' : 's'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {group.items.slice(0, 2).map((movement) => (
                      <span key={movement.id} className="max-w-full truncate rounded-lg bg-slate-50 px-2 py-1 text-xs font-bold text-slate-600">
                        {cleanProductName(movement.lots?.product)}
                      </span>
                    ))}
                    {group.items.length > 2 ? <span className="rounded-lg bg-slate-50 px-2 py-1 text-xs font-black text-slate-500">+{group.items.length - 2}</span> : null}
                  </div>
                </div>
                <div className="flex items-start justify-between gap-2 sm:block sm:text-right">
                  <p className="rounded-lg bg-campo-50 px-2 py-1 text-sm font-black text-campo-800">
                    {group.items.length === 1 ? `${formatNumber(group.items[0].quantity)} env.` : `${group.items.length} items`}
                  </p>
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      {detailGroup ? (
        <MovementDetail group={detailGroup} onClose={() => setDetailGroup(null)} onOperationRequest={() => {
          openOperationRequest(detailGroup)
        }} onRequest={(movement) => {
          openRequest(movement)
        }} />
      ) : null}

      {selected ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/45 p-4 sm:items-center sm:justify-center" onClick={() => setSelected(null)}>
          <section className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase text-orange-700">Correccion</p>
                <h3 className="text-xl font-black text-slate-950">{cleanProductName(selected.lots?.product)}</h3>
              </div>
              <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={() => setSelected(null)}>
                <X size={18} />
              </button>
            </div>
            <p className="mt-2 text-sm font-bold text-slate-500">
              Elige si el error es de cantidad o de ficha.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-black ${correctionType === 'cantidad' ? 'border-orange-500 bg-orange-50 text-orange-800' : 'border-slate-200 bg-white text-slate-700'}`}
                type="button"
                onClick={() => setCorrectionType('cantidad')}
              >
                Cantidad
              </button>
              <button
                className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-black ${correctionType === 'ficha' ? 'border-orange-500 bg-orange-50 text-orange-800' : 'border-slate-200 bg-white text-slate-700'}`}
                type="button"
                onClick={() => setCorrectionType('ficha')}
              >
                Ficha
              </button>
            </div>
            {correctionType === 'cantidad' ? (
              <QuantityCorrectionFields movement={selected} quantity={quantity} onChange={setQuantity} />
            ) : (
              <LotPatchForm patch={lotPatch} clients={clients} onChange={setLotPatch} />
            )}
            <label className="mt-3 block">
              <span className="label">Motivo</span>
              <textarea className="input mt-1" rows="3" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={correctionType === 'cantidad' ? 'Ej. se escribio 120 envases y eran 102.' : 'Ej. el producto era otro o el vencimiento estaba mal.'} />
            </label>
            {error ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
            <button className="btn-primary mt-4 w-full" type="button" onClick={submitCorrection} disabled={saving}>
              <Send size={18} /> {saving ? 'Enviando...' : 'Enviar solicitud'}
            </button>
          </section>
        </div>
      ) : null}

      {selectedOperation ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/45 p-4 sm:items-center sm:justify-center" onClick={() => setSelectedOperation(null)}>
          <section className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase text-orange-700">Correccion de operacion</p>
                <h3 className="text-xl font-black text-slate-950">{selectedOperation.label}</h3>
                <p className="mt-1 text-sm font-bold text-slate-500">{selectedOperation.items.length} producto{selectedOperation.items.length === 1 ? '' : 's'}</p>
              </div>
              <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={() => setSelectedOperation(null)}>
                <X size={18} />
              </button>
            </div>
            <OperationPatchForm group={selectedOperation} patch={lotPatch} clients={clients} onChange={setLotPatch} />
            <label className="mt-3 block">
              <span className="label">Motivo</span>
              <textarea className="input mt-1" rows="3" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej. la placa o el cliente del despacho estaba mal." />
            </label>
            {error ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
            <button className="btn-primary mt-4 w-full" type="button" onClick={submitOperationCorrection} disabled={saving}>
              <Send size={18} /> {saving ? 'Enviando...' : 'Enviar solicitud'}
            </button>
          </section>
        </div>
      ) : null}

      {success ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-campo-700 p-6 text-white">
          <section className="w-full max-w-sm text-center">
            <span className="mx-auto flex h-40 w-40 items-center justify-center rounded-full border border-white/25 text-white">
              <CheckCircle2 size={118} strokeWidth={1.8} />
            </span>
            <h2 className="mt-5 text-3xl font-black">Solicitud enviada</h2>
            <p className="mt-2 text-base font-semibold text-campo-50">La correccion quedo pendiente de revision.</p>
            <p className="mt-3 text-sm font-bold text-white/80">Volviendo a operar...</p>
          </section>
        </div>
      ) : null}
    </div>
  )
}

function QuantityCorrectionFields({ movement, quantity, onChange }) {
  const stockReference = correctionStockReference(movement)

  return (
    <div className="mt-3">
      <div className="rounded-lg bg-campo-50 px-3 py-2">
        <p className="text-xs font-black uppercase text-campo-700">{stockReference.label}</p>
        <p className="mt-0.5 text-lg font-black text-slate-950">{formatNumber(stockReference.quantity)} env.</p>
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,0.82fr)_minmax(0,1fr)] gap-2">
        <label className="block min-w-0">
          <span className="label">Cantidad previa</span>
          <input className="input mt-1 bg-slate-50 text-slate-500" value={formatNumber(movement.quantity)} readOnly />
        </label>
        <label className="block min-w-0">
          <span className="label">Cantidad correcta</span>
          <input className="input mt-1" inputMode="decimal" value={quantity} onChange={(event) => onChange(event.target.value.replace(',', '.'))} />
        </label>
      </div>
    </div>
  )
}

function LotPatchForm({ patch, clients, onChange }) {
  return (
    <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
      <PatchField label="Cliente">
        <select className="input" value={patch.client_id || ''} onChange={(event) => onChange({ ...patch, client_id: event.target.value })}>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>
      </PatchField>
      <PatchField label="ID lote">
        <input className="input" value={patch.lot_code || ''} onChange={(event) => onChange({ ...patch, lot_code: event.target.value })} />
      </PatchField>
      <PatchField label="Producto">
        <input className="input" value={patch.product || ''} onChange={(event) => onChange({ ...patch, product: event.target.value })} />
      </PatchField>
      <PatchField label="Ubicacion">
        <select className="input" value={patch.location || ''} onChange={(event) => onChange({ ...patch, location: event.target.value })}>
          <option value="Nave 1">Nave 1</option>
          <option value="Nave 2">Nave 2</option>
          <option value="Nave 3">Nave 3</option>
          <option value="Playa">Playa</option>
        </select>
      </PatchField>
      <PatchField label="Tamano presentacion">
        <input className="input" inputMode="decimal" value={patch.package_size || ''} onChange={(event) => onChange({ ...patch, package_size: event.target.value.replace(',', '.') })} />
      </PatchField>
      <PatchField label="Unidad">
        <select className="input" value={patch.package_unit || ''} onChange={(event) => onChange({ ...patch, package_unit: event.target.value })}>
          <option value="gr">Gramos</option>
          <option value="kg">Kilos</option>
          <option value="ml">Mililitros</option>
          <option value="lt">Litros</option>
          <option value="un">Unidades</option>
        </select>
      </PatchField>
      <PatchField label="Vencimiento">
        <input className="input date-input" type="date" value={patch.expiry_date || ''} onChange={(event) => onChange({ ...patch, expiry_date: event.target.value })} />
      </PatchField>
    </div>
  )
}

function OperationPatchForm({ group, patch, clients, onChange }) {
  return (
    <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
      <PatchField label="Cliente">
        <select className="input" value={patch.client_id || ''} onChange={(event) => onChange({ ...patch, client_id: event.target.value })}>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>
      </PatchField>
      {group.type === 'salida' ? (
        <>
          <PatchField label="Placa">
            <input className="input" value={patch.vehicle_plate || ''} onChange={(event) => onChange({ ...patch, vehicle_plate: event.target.value })} />
          </PatchField>
          <PatchField label="Recibe">
            <input className="input" value={patch.receiver_name || ''} onChange={(event) => onChange({ ...patch, receiver_name: event.target.value })} />
          </PatchField>
          <PatchField label="Documento">
            <input className="input" value={patch.receiver_document || ''} onChange={(event) => onChange({ ...patch, receiver_document: event.target.value })} />
          </PatchField>
        </>
      ) : null}
    </div>
  )
}

function PatchField({ label, children }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function createLotPatch(movement) {
  return {
    client_id: movement.lots?.client_id || '',
    lot_code: movement.lots?.lot_code || '',
    product: movement.lots?.product || '',
    location: movement.lots?.location || '',
    package_size: movement.lots?.package_size ?? '',
    package_unit: movement.lots?.package_unit || '',
    expiry_date: movement.lots?.expiry_date || '',
  }
}

function changedLotPatch(movement, patch) {
  const original = createLotPatch(movement)
  return Object.fromEntries(
    Object.entries(patch).filter(([key, value]) => String(value ?? '').trim() !== String(original[key] ?? '').trim()),
  )
}

function createOperationPatch(group) {
  const operationMeta = operationMetadata(group)
  return {
    movement_ids: group.items.map((movement) => movement.id),
    client_id: group.items[0]?.lots?.client_id || '',
    vehicle_plate: operationMeta.vehiclePlate || '',
    receiver_name: operationMeta.receiverName || '',
    receiver_document: operationMeta.receiverDocument || '',
  }
}

function changedOperationPatch(group, patch) {
  const original = createOperationPatch(group)
  return Object.fromEntries(
    Object.entries(patch).filter(([key, value]) => key === 'movement_ids' || String(value ?? '').trim() !== String(original[key] ?? '').trim()),
  )
}

function correctionStockReference(movement) {
  if (movement.type === 'salida') {
    return {
      label: 'Disponible al registrar la salida',
      quantity: Number(movement.previous_quantity || 0),
    }
  }

  return {
    label: 'Stock despues del ingreso',
    quantity: Number(movement.new_quantity || 0),
  }
}

function exceedsCorrectionStock(movement, value) {
  return movement.type === 'salida' && Number(value || 0) > Number(movement.previous_quantity || 0)
}

function MovementDetail({ group, onClose, onRequest, onOperationRequest }) {
  const operationMeta = operationMetadata(group)

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/45 p-4 sm:items-center sm:justify-center" onClick={onClose}>
      <section className="w-full max-w-xl rounded-xl bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase text-orange-700">{group.label}</p>
            <h3 className="mt-1 text-xl font-black leading-snug text-slate-950 [overflow-wrap:anywhere]">{group.clientName}</h3>
            <p className="mt-1 text-xs font-bold text-slate-500">
              {formatDate(group.createdAt)} - {group.items.length} producto{group.items.length === 1 ? '' : 's'}
            </p>
            {group.type === 'salida' ? (
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-bold text-slate-600">
                {operationMeta.receiverName ? <span className="rounded-lg bg-slate-50 px-2 py-1">Recibe: {operationMeta.receiverName}</span> : null}
                {operationMeta.receiverDocument ? <span className="rounded-lg bg-slate-50 px-2 py-1">Documento: {operationMeta.receiverDocument}</span> : null}
                {operationMeta.vehiclePlate ? <span className="rounded-lg bg-slate-50 px-2 py-1">Placa: {operationMeta.vehiclePlate}</span> : null}
              </div>
            ) : null}
          </div>
          <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <button className="mt-3 inline-flex min-h-9 items-center rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-black text-orange-800 transition hover:bg-orange-100" type="button" onClick={onOperationRequest}>
          Corregir operacion
        </button>

        <div className="mt-4 max-h-[68vh] space-y-2 overflow-y-auto pr-1">
          {group.items.map((movement) => (
            <MovementLine key={movement.id} movement={movement} onRequest={() => onRequest(movement)} />
          ))}
        </div>
      </section>
    </div>
  )
}

function MovementLine({ movement, onRequest }) {
  const equivalent = Number(movement.quantity || 0) * Number(movement.lots?.package_size || 0)

  return (
    <article className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <p className="font-black leading-snug text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(movement.lots?.product)}</p>
          <p className="text-xs font-bold text-slate-500">
            Lote {displayLotCode(movement.lots?.lot_code)} - {movement.lots?.location || '-'}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="inline-flex rounded-lg bg-campo-50 px-2 py-1 text-base font-black text-campo-800">{formatNumber(movement.quantity)} env.</p>
          <button
            className="mt-1 block min-h-7 rounded-lg border border-orange-200 bg-white px-2 py-1 text-xs font-black text-orange-700 transition hover:bg-orange-50 sm:ml-auto"
            type="button"
            onClick={onRequest}
          >
            Pedir correccion
          </button>
        </div>
      </div>
      <dl className="mt-2 grid gap-1.5 rounded-lg bg-white p-2 text-xs font-bold text-slate-600 sm:grid-cols-2">
        <DetailRow label="Equivalente" value={Number(movement.lots?.package_size) > 0 ? `${formatNumber(equivalent)} ${movement.lots?.package_unit || ''}` : 'Sin dato'} />
        <DetailRow label="Stock anterior" value={`${formatNumber(movement.previous_quantity)} env.`} />
        <DetailRow label="Stock despues" value={`${formatNumber(movement.new_quantity)} env.`} />
      </dl>
      {visibleMovementNotes(movement.notes) ? <p className="mt-2 text-xs font-semibold text-slate-500 [overflow-wrap:anywhere]">{visibleMovementNotes(movement.notes)}</p> : null}
    </article>
  )
}

function operationMetadata(group) {
  const operation = group.operation
  const notes = group.items[0]?.notes || ''
  return {
    vehiclePlate: operation?.vehicle_plate || noteValue(notes, 'Placa'),
    receiverName: operation?.receiver_name || noteValue(notes, 'Recibe'),
    receiverDocument: operation?.receiver_document || noteValue(notes, 'Documento'),
  }
}

function noteValue(notes, label) {
  const prefix = `${label}:`
  return String(notes || '')
    .split('|')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length)
    .trim() || ''
}

function visibleMovementNotes(notes) {
  return String(notes || '')
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith('Placa:') && !part.startsWith('Recibe:') && !part.startsWith('Documento:') && part !== 'Despacho por lista')
    .join(' | ')
}

function groupMovements(movements) {
  const groups = new Map()

  movements.forEach((movement) => {
    const clientName = movement.lots?.clients?.name || 'Cliente sin nombre'
    const minuteStamp = String(movement.created_at || '').slice(0, 16)
    const isListDispatch = movement.type === 'salida' && movement.notes?.includes('Despacho por lista')
    const isEntryBatch = movement.type === 'entrada' && movement.notes?.includes('Nuevo ingreso desde almacen')
    const groupingKey = movement.operation_id
      ? `operation:${movement.operation_id}`
      : isListDispatch
      ? `dispatch:${clientName}:${minuteStamp}:${movement.notes || ''}`
      : isEntryBatch
        ? `entry:${clientName}:${minuteStamp}`
        : `movement:${movement.id}`

    if (!groups.has(groupingKey)) {
      groups.set(groupingKey, {
        id: groupingKey,
        type: movement.type,
        clientName,
        createdAt: movement.created_at,
        label: correctionGroupLabel(movement.type),
        operation: movement.warehouse_operations || null,
        items: [],
      })
    }

    groups.get(groupingKey).items.push(movement)
  })

  return [...groups.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

function correctionGroupLabel(type) {
  if (type === 'entrada') return 'Ingreso'
  if (type === 'salida') return 'Despacho'
  return type
}

function DetailRow({ label, value, strong }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`max-w-[14rem] text-right [overflow-wrap:anywhere] ${strong ? 'text-base font-black text-campo-800' : 'text-slate-950'}`}>{value || '-'}</dd>
    </div>
  )
}
