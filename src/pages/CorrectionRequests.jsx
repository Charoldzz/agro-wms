import { useEffect, useState } from 'react'
import { AlertCircle, Send, X } from 'lucide-react'
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
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function loadRecentMovements() {
      const { data } = await supabase
        .from('movements')
        .select('id, type, quantity, created_at, approval_status, lots(lot_code, product, clients(name))')
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
      <PageHeader title="Solicitar correccion" subtitle="Corrige errores sin borrar auditoria" />

      <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-bold text-orange-900">
        Si una entrada o despacho quedo con cantidad incorrecta, solicita la correccion. El movimiento original queda registrado.
      </div>

      <div className="space-y-2">
        {movements.length === 0 ? (
          <EmptyState title="Sin movimientos recientes" text="Tus entradas y salidas recientes apareceran aqui." />
        ) : (
          movements.map((movement) => (
            <article key={movement.id} className="panel">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-black text-slate-950">{movementLabel(movement.type)}</p>
                  <p className="font-black text-slate-900 [overflow-wrap:anywhere]">{cleanProductName(movement.lots?.product)}</p>
                  <p className="text-xs font-semibold text-slate-500">
                    {displayLotCode(movement.lots?.lot_code)} - {movement.lots?.clients?.name || '-'} - {formatDate(movement.created_at)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="rounded-lg bg-campo-50 px-2 py-1 text-lg font-black text-campo-800">{formatNumber(movement.quantity)} env.</p>
                  <button className="mt-2 text-sm font-black text-orange-700" type="button" onClick={() => openRequest(movement)}>
                    Pedir correccion
                  </button>
                </div>
              </div>
            </article>
          ))
        )}
      </div>

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
