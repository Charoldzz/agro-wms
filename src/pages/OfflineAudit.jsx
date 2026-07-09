import { useEffect, useState } from 'react'
import { Check, RefreshCcw, X } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useAuth } from '../hooks/useAuth.jsx'
import { cleanProductName, displayLotCode } from '../lib/display'
import { formatDate, formatNumber } from '../lib/format'
import { supabase } from '../lib/supabase'

export default function OfflineAudit() {
  const { user } = useAuth()
  const [movements, setMovements] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    loadMovements()
  }, [])

  async function loadMovements() {
    setError('')
    const { data, error: loadError } = await supabase
      .from('movements')
      .select('*, lots(lot_code, product, current_quantity, location, clients(name)), profiles(full_name)')
      .ilike('notes', '%[OFFLINE]%')
      .order('created_at', { ascending: false })
      .limit(300)

    if (loadError) {
      const fallback = await supabase
        .from('movements')
        .select('*')
        .ilike('notes', '%[OFFLINE]%')
        .order('created_at', { ascending: false })
        .limit(300)

      if (fallback.error) {
        setError('No se pudo cargar la auditoria offline. Ejecuta el SQL offline_audit_and_dispatch.sql y vuelve a intentar.')
        setMovements([])
        return
      }

      setMovements(await enrichMovements(fallback.data || []))
      return
    }

    setMovements(data || [])
  }

  async function enrichMovements(rawMovements) {
    const lotIds = [...new Set(rawMovements.map((movement) => movement.lot_id).filter(Boolean))]
    const userIds = [...new Set(rawMovements.map((movement) => movement.user_id).filter(Boolean))]

    const [{ data: lots }, { data: profiles }] = await Promise.all([
      lotIds.length
        ? supabase.from('lots').select('id, lot_code, product, current_quantity, location, clients(name)').in('id', lotIds)
        : Promise.resolve({ data: [] }),
      userIds.length
        ? supabase.from('profiles').select('id, full_name').in('id', userIds)
        : Promise.resolve({ data: [] }),
    ])

    const lotMap = new Map((lots || []).map((lot) => [lot.id, lot]))
    const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]))

    return rawMovements.map((movement) => ({
      ...movement,
      lots: lotMap.get(movement.lot_id) || null,
      profiles: profileMap.get(movement.user_id) || null,
    }))
  }

  async function reviewMovement(id, action) {
    const fn = action === 'approve' ? 'approve_adjustment' : 'reject_adjustment'
    const { error: reviewError } = await supabase.rpc(fn, {
      p_movement_id: id,
      p_user_id: user.id,
    })

    if (reviewError) {
      setError(reviewError.message)
      return
    }

    loadMovements()
  }

  return (
    <div>
      <PageHeader
        title="Auditoria offline"
        subtitle="Salidas registradas sin señal y sincronizadas para revision"
        action={
          <button className="btn-secondary !min-h-11 !px-3" type="button" onClick={loadMovements}>
            <RefreshCcw size={18} />
          </button>
        }
      />

      {error ? <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

      <div className="space-y-3">
        {movements.length === 0 ? (
          <EmptyState title="Sin salidas offline" text="Cuando se sincronice una salida hecha sin señal, aparecera aqui." />
        ) : (
          movements.map((movement) => (
            <article key={movement.id} className="panel">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-slate-950">{cleanProductName(movement.lots?.product)}</p>
                  <p className="text-sm font-semibold text-slate-500">
                    {displayLotCode(movement.lots?.lot_code)} · {movement.lots?.clients?.name || '-'}
                  </p>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    Registrado: {formatDate(movement.created_at)} · Usuario: {movement.profiles?.full_name || 'Usuario'}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    movement.approval_status === 'pendiente'
                      ? 'bg-orange-50 text-orange-700'
                      : movement.approval_status === 'rechazado'
                        ? 'bg-red-50 text-red-700'
                        : 'bg-campo-50 text-campo-700'
                  }`}
                >
                  {movement.approval_status}
                </span>
              </div>

              <div className="mt-3 grid gap-2 text-sm font-bold text-slate-700 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-3">Salida: {formatNumber(movement.quantity)} unidades</div>
                <div className="rounded-lg bg-slate-50 p-3">Stock actual: {formatNumber(movement.lots?.current_quantity)} unidades</div>
                <div className="rounded-lg bg-slate-50 p-3">Ubicacion: {movement.lots?.location || '-'}</div>
              </div>

              {movement.notes ? <p className="mt-3 text-sm font-semibold text-slate-600">{movement.notes}</p> : null}

              {movement.approval_status === 'pendiente' ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="btn-secondary !min-h-10" type="button" onClick={() => reviewMovement(movement.id, 'reject')}>
                    <X size={17} /> Rechazar
                  </button>
                  <button className="btn-primary !min-h-10" type="button" onClick={() => reviewMovement(movement.id, 'approve')}>
                    <Check size={17} /> Aprobar salida
                  </button>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
    </div>
  )
}
