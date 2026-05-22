import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ChevronRight, Send, X } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useAuth } from '../hooks/useAuth.jsx'
import { cleanProductName, displayLotCode } from '../lib/display'
import { formatDate, formatNumber, movementLabel } from '../lib/format'
import { supabase } from '../lib/supabase'

export default function CorrectionRequests() {
  const { user } = useAuth()
  const [movements, setMovements] = useState([])
  const [selected, setSelected] = useState(null)
  const [detailGroup, setDetailGroup] = useState(null)
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function loadRecentMovements() {
      const { data } = await supabase
        .from('movements')
        .select('id, type, quantity, previous_quantity, new_quantity, from_location, to_location, notes, created_at, approval_status, lots(lot_code, product, package_size, package_unit, location, clients(name))')
        .eq('user_id', user.id)
        .in('type', ['entrada', 'salida'])
        .eq('approval_status', 'aprobado')
        .order('created_at', { ascending: false })
        .limit(30)
      setMovements(data || [])
    }

    loadRecentMovements()
  }, [user.id])

  function openRequest(movement) {
    setSelected(movement)
    setQuantity(String(movement.quantity || ''))
    setReason('')
    setError('')
    setStatus('')
  }

  const movementGroups = useMemo(() => groupMovements(movements), [movements])

  async function submitCorrection() {
    if (!selected) return
    if (Number(quantity) < 0 || quantity === '') {
      setError('Escribe la cantidad correcta.')
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
      p_requested_quantity: Number(quantity),
      p_reason: reason.trim(),
      p_user_id: user.id,
    })

    if (requestError) {
      setError(requestError.message?.includes('request_movement_correction') ? 'Falta correr el SQL de correcciones operativas.' : requestError.message)
      setSaving(false)
      return
    }

    setStatus('Solicitud enviada. Un administrador debe aprobarla.')
    setSaving(false)
  }

  return (
    <div>
      <PageHeader title="Solicitar correccion" subtitle="Entradas y despachos recientes" />

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
                  {group.items.length === 1 ? (
                    <button
                      className="mt-2 inline-flex min-h-8 items-center rounded-lg border border-orange-200 bg-white px-2.5 py-1 text-xs font-black text-orange-700 transition hover:bg-orange-50"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        openRequest(group.items[0])
                      }}
                    >
                      Pedir correccion
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
                <span>Ver detalle de la operacion</span>
                <ChevronRight size={16} />
              </div>
            </article>
          ))
        )}
      </div>

      {detailGroup ? (
        <MovementDetail group={detailGroup} onClose={() => setDetailGroup(null)} onRequest={(movement) => {
          setDetailGroup(null)
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
              Cantidad registrada: {formatNumber(selected.quantity)} env. Indica la cantidad correcta.
            </p>
            <label className="mt-3 block">
              <span className="label">Cantidad correcta</span>
              <input className="input mt-1" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value.replace(',', '.'))} />
              <span className="mt-1 block text-xs font-semibold text-slate-500">Si el error es de ficha, deja la cantidad igual.</span>
            </label>
            <label className="mt-3 block">
              <span className="label">Motivo</span>
              <textarea className="input mt-1" rows="3" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej. se escribio 120 envases y eran 102." />
            </label>
            {error ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
            {status ? (
              <p className="mt-3 rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">
                <AlertCircle className="mr-2 inline" size={18} /> {status}
              </p>
            ) : null}
            <button className="btn-primary mt-4 w-full" type="button" onClick={submitCorrection} disabled={saving || Boolean(status)}>
              <Send size={18} /> {saving ? 'Enviando...' : 'Enviar solicitud'}
            </button>
          </section>
        </div>
      ) : null}
    </div>
  )
}

function MovementDetail({ group, onClose, onRequest }) {
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
          </div>
          <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

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
        {movement.to_location ? <DetailRow label={movement.type === 'salida' ? 'Placa / destino' : 'Hacia'} value={movement.to_location} /> : null}
      </dl>
      {movement.notes ? <p className="mt-2 text-xs font-semibold text-slate-500 [overflow-wrap:anywhere]">{movement.notes}</p> : null}
    </article>
  )
}

function groupMovements(movements) {
  const groups = new Map()

  movements.forEach((movement) => {
    const clientName = movement.lots?.clients?.name || 'Cliente sin nombre'
    const minuteStamp = String(movement.created_at || '').slice(0, 16)
    const isListDispatch = movement.type === 'salida' && movement.notes?.includes('Despacho por lista')
    const isEntryBatch = movement.type === 'entrada' && movement.notes?.includes('Nuevo ingreso desde almacen')
    const groupingKey = isListDispatch
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
        label: isListDispatch ? 'Despacho por lista' : isEntryBatch ? 'Nuevo ingreso' : movementLabel(movement.type),
        items: [],
      })
    }

    groups.get(groupingKey).items.push(movement)
  })

  return [...groups.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

function DetailRow({ label, value, strong }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`max-w-[14rem] text-right [overflow-wrap:anywhere] ${strong ? 'text-base font-black text-campo-800' : 'text-slate-950'}`}>{value || '-'}</dd>
    </div>
  )
}
