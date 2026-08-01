import { useEffect, useState } from 'react'
import { Check, X, Camera } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useAuth } from '../hooks/useAuth.jsx'
import { cleanProductName, displayLotCode } from '../lib/display'
import { formatDate, formatNumber, movementLabel, equivalentLabel } from '../lib/format'
import { desgloseEnvases } from '../lib/envases'
import { supabase } from '../lib/supabase'

// Separa el concepto crudo del movimiento en campos (Motivo, Afectado, Foto) + observación.
// afectado = cantidad afectada en EQUIVALENTE que cargó el operador (dato principal de la reparación).
function parseMovementNotes(notes) {
  const out = { motivo: '', foto: '', afectado: null, obs: [] }
  String(notes || '').split('|').map((p) => p.trim()).filter(Boolean).forEach((part) => {
    if (/^motivo:/i.test(part)) out.motivo = part.replace(/^motivo:\s*/i, '')
    else if (/^incidencia:/i.test(part)) out.motivo = out.motivo || part.replace(/^incidencia:\s*/i, '')
    else if (/^foto:/i.test(part)) out.foto = part.replace(/^foto:\s*/i, '')
    else if (/^afectado:/i.test(part)) {
      const n = parseFloat(part.replace(/^afectado:\s*/i, '').replace(',', '.'))
      out.afectado = Number.isFinite(n) ? n : null
    } else out.obs.push(part)
  })
  return { motivo: out.motivo, foto: out.foto, afectado: out.afectado, obs: out.obs.join(' · ') }
}

// Fila: dato PRINCIPAL en equivalente + envase secundario en gris
function StockLine({ label, eq, env, tone }) {
  const color = tone === 'red' ? 'text-red-700' : tone === 'green' ? 'text-campo-700' : 'text-slate-900'
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
      <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-slate-400">{label}</span>
      <div className="min-w-0 text-right">
        <p className={`text-sm font-black [overflow-wrap:anywhere] ${color}`}>{eq}</p>
        {env ? <p className="text-[11px] font-semibold text-slate-400">{env}</p> : null}
      </div>
    </div>
  )
}

export default function AdminPending() {
  const { user } = useAuth()
  const [movements, setMovements] = useState([])
  const [clients, setClients] = useState([])
  const [issues, setIssues] = useState([])
  const [transfers, setTransfers] = useState([])
  const [error, setError] = useState('')
  // Confirmacion visible de lo que acaba de pasar (aprobado / rechazado)
  const [ok, setOk] = useState(null)

  useEffect(() => {
    loadPending()

    const channel = supabase
      .channel('admin-pending')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movements' }, loadPending)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operational_issue_reports' }, loadPending)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  async function loadPending() {
    const [movementResult, issueResult, clientResult] = await Promise.all([
      supabase
        .from('movements')
        .select('*, lots(product, lot_code, current_quantity, package_size, package_unit, location, clients(name)), profiles!movements_user_id_fkey(full_name)')
        .in('type', ['ajuste', 'traslado', 'salida'])
        .eq('approval_status', 'pendiente')
        .order('created_at', { ascending: false }),
      supabase
        .from('operational_issue_reports')
        .select('*, lots(lot_code, product, location, clients(name)), profiles!operational_issue_reports_reported_by_fkey(full_name)')
        .eq('status', 'pendiente')
        .order('created_at', { ascending: false }),
      supabase.from('clients').select('id, name').eq('inventory_source', 'stock_independiente').order('name'),
    ])

    // Traspasos entre clientes esperando aprobación (tabla propia, no son movimientos).
    // OJO: lot_transfers apunta DOS veces a lots (lot_id = el del vendedor,
    // new_lot_id = el que se le crea al comprador al aprobar), así que hay que
    // decir explícitamente por cuál se embebe o la consulta falla entera.
    const { data: transferRows, error: transferError } = await supabase
      .from('transfer_operations')
      .select('*, origen:from_client_id(name), destino:to_client_id(name), items:lot_transfers(id, lot_code, product, quantity, lots!lot_transfers_lot_id_fkey(package_size, package_unit, current_quantity))')
      .eq('status', 'pendiente')
      .order('created_at', { ascending: false })
    setTransfers(transferRows || [])

    let movementRows = movementResult.data || []
    const loadErrors = []

    if (movementResult.error) {
      const { data, error: fallbackError } = await supabase
        .from('movements')
        .select('*')
        .in('type', ['ajuste', 'traslado', 'salida'])
        .eq('approval_status', 'pendiente')
        .order('created_at', { ascending: false })

      if (fallbackError) {
        loadErrors.push('movimientos')
      } else {
        movementRows = await enrichMovements(data || [])
      }
    }

    if (issueResult.error) {
      if (!String(issueResult.error.message || '').includes('operational_issue_reports')) loadErrors.push('reportes operativos')
      setIssues([])
    } else {
      setIssues(issueResult.data || [])
    }

    if (!clientResult.error) setClients(clientResult.data || [])
    // Si la consulta de traspasos falla, avisar: antes se tragaba el error y la
    // pantalla decia "0 por aprobar" aunque hubiera traspasos esperando.
    if (transferError) loadErrors.push('traspasos')
    setError(loadErrors.length ? `No se pudieron cargar: ${loadErrors.join(', ')}.` : '')
    setMovements(movementRows)
  }

  async function enrichMovements(rows) {
    const lotIds = [...new Set(rows.map((row) => row.lot_id).filter(Boolean))]
    const userIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))]
    const [{ data: lotRows }, { data: profileRows }] = await Promise.all([
      lotIds.length
        ? supabase.from('lots').select('id, lot_code, product, current_quantity, package_size, package_unit, location, clients(name)').eq('inventory_source', 'stock_independiente').in('id', lotIds)
        : Promise.resolve({ data: [] }),
      userIds.length ? supabase.from('profiles').select('id, full_name').in('id', userIds) : Promise.resolve({ data: [] }),
    ])
    const lotMap = new Map((lotRows || []).map((lot) => [lot.id, lot]))
    const profileMap = new Map((profileRows || []).map((profile) => [profile.id, profile]))
    return rows.map((row) => ({
      ...row,
      lots: row.lots || lotMap.get(row.lot_id) || null,
      profiles: row.profiles || profileMap.get(row.user_id) || null,
    }))
  }

  async function reviewMovement(id, action) {
    await supabase.rpc(action === 'approve' ? 'approve_adjustment' : 'reject_adjustment', {
      p_movement_id: id,
      p_user_id: user.id,
    })
    loadPending()
  }

  async function resolveIssue(id) {
    await supabase
      .from('operational_issue_reports')
      .update({ status: 'resuelto', resolved_by: user.id, resolved_at: new Date().toISOString() })
      .eq('id', id)
    loadPending()
  }

  async function approveTransfer(transfer) {
    setError('')
    const { error: rpcError } = await supabase.rpc('approve_transfer_operation', { p_operation_id: transfer.id })
    if (rpcError) { setError(rpcError.message); return }
    // Sin esto la tarjeta simplemente desaparecía y no quedaba claro si se
    // habia aprobado o si algo habia fallado.
    setOk({
      titulo: 'Traspaso aprobado',
      texto: `${transfer.items?.length || 0} ${(transfer.items?.length || 0) === 1 ? 'lote pasó' : 'lotes pasaron'} de ${transfer.origen?.name || '—'} a ${transfer.destino?.name || '—'}.`,
      codigo: transfer.operation_code,
    })
    await loadPending()
  }

  async function rejectTransfer(transfer) {
    const reason = window.prompt('¿Por qué se rechaza el traspaso?')
    if (reason === null) return
    if (!reason.trim()) {
      setError('Escribí por qué se rechaza el traspaso.')
      return
    }
    setError('')
    const { error: rpcError } = await supabase.rpc('reject_transfer_operation', {
      p_operation_id: transfer.id,
      p_reason: reason.trim(),
    })
    if (rpcError) { setError(rpcError.message); return }
    setOk({
      titulo: 'Traspaso rechazado',
      texto: `Los lotes de ${transfer.origen?.name || '—'} quedaron liberados y vuelven a estar operativos.`,
      codigo: transfer.operation_code,
    })
    await loadPending()
  }

  const total = movements.length + issues.length + transfers.length

  return (
    <div>
      <PageHeader title="Por aprobar" subtitle={`${total} por aprobar`} />

      {error ? <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

      {ok ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-campo-300 bg-campo-50 p-3">
          <Check size={20} className="mt-0.5 shrink-0 text-campo-700" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-campo-800">
              {ok.titulo}{ok.codigo ? <span className="ml-2 font-mono text-[11px] font-bold text-campo-700/70">{ok.codigo}</span> : null}
            </p>
            <p className="text-[12px] font-semibold text-campo-800/90 [overflow-wrap:anywhere]">{ok.texto}</p>
          </div>
          <button type="button" className="shrink-0 rounded p-1 text-campo-700/60" onClick={() => setOk(null)} title="Cerrar">
            <X size={16} />
          </button>
        </div>
      ) : null}

      {total === 0 ? (
        <EmptyState title="Nada por aprobar" text="No hay reparaciones, traspasos, salidas offline ni reportes por revisar." />
      ) : (
        <div className="space-y-4">
          {transfers.map((op) => {
            const items = op.items || []
            return (
              <article key={op.id} className="panel border-sky-200 bg-sky-50">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-sky-600 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-white">
                    Traspaso
                  </span>
                  <span className="text-[11px] font-semibold text-slate-500">{formatDate(op.created_at)}</span>
                  {op.operation_code ? (
                    <span className="font-mono text-[11px] font-bold text-slate-400">{op.operation_code}</span>
                  ) : null}
                </div>

                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg bg-white px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Vende</p>
                    <p className="text-sm font-black text-slate-900 [overflow-wrap:anywhere]">{op.origen?.name || '—'}</p>
                  </div>
                  <div className="rounded-lg bg-white px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-wide text-sky-600">Recibe</p>
                    <p className="text-sm font-black text-sky-800 [overflow-wrap:anywhere]">{op.destino?.name || '—'}</p>
                  </div>
                </div>

                <p className="mt-3 text-[11px] font-black uppercase tracking-wide text-slate-500">
                  {items.length} {items.length === 1 ? 'lote' : 'lotes'}
                </p>
                <ul className="mt-1 space-y-1">
                  {items.map((it) => {
                    const size = Number(it.lots?.package_size) || 0
                    const unit = it.lots?.package_unit
                    const qty = Number(it.quantity) || 0
                    const total = Number(it.lots?.current_quantity) || 0
                    const eq = size > 0 ? equivalentLabel(qty, unit) : `${formatNumber(qty)} uds`
                    const env = size > 0 ? desgloseEnvases(qty, size, unit, 0).unidadesLabel : ''
                    const parcial = total > 0 && qty < total
                    return (
                      <li key={it.id} className="flex items-start justify-between gap-2 rounded-lg bg-white px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-[13px] font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(it.product)}</p>
                          <p className="text-[11px] font-semibold text-slate-400">
                            Lote {displayLotCode(it.lot_code)}
                            {parcial ? <span className="text-amber-700"> · parcial</span> : null}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-black text-campo-700">{eq}</p>
                          {env ? <p className="text-[10px] font-semibold text-slate-400">{env}</p> : null}
                        </div>
                      </li>
                    )
                  })}
                </ul>

                <p className="mt-2 text-[11px] font-semibold italic text-slate-600 [overflow-wrap:anywhere]">
                  Motivo: {op.notes}
                </p>
                <p className="text-[10px] font-semibold text-slate-400">Registrado por {op.created_by_name || '—'}</p>

                <div className="mt-3 flex gap-2">
                  <button className="btn-primary flex-1" type="button" onClick={() => approveTransfer(op)}>
                    <Check size={18} /> Aprobar
                  </button>
                  <button className="btn-secondary flex-1" type="button" onClick={() => rejectTransfer(op)}>
                    <X size={18} /> Rechazar
                  </button>
                </div>
              </article>
            )
          })}
          {movements.map((movement) => {
            const size = Number(movement.lots?.package_size) || 0
            const unit = movement.lots?.package_unit
            // Las cantidades ya están en equivalente (lts/kgs); sin presentación son uds.
            const currentEq = Number(movement.lots?.current_quantity) || 0
            const isAjuste = movement.type === 'ajuste'
            const note = parseMovementNotes(movement.notes)
            // Para un ajuste, movement.quantity ES el stock final (así lo guarda la
            // base y así lo aplica al aprobar). El cambio = final − actual, con signo:
            // + sube (diferencia de conteo hacia arriba), − baja.
            const newEq = isAjuste ? (Number(movement.quantity) || 0) : Math.max(currentEq - (Number(movement.quantity) || 0), 0)
            const deltaEq = newEq - currentEq                 // + sube, − baja
            const afectadoEq = isAjuste ? Math.abs(deltaEq) : (Number(movement.quantity) || 0)
            const subeStock = deltaEq > 0
            const eqLabel = (v) => (size > 0 ? equivalentLabel(v, unit) : `${formatNumber(v)} uds`)
            const envLabel = (v) => (size > 0 ? desgloseEnvases(v, size, unit, 0).unidadesLabel : '')
            const tipoLabel = isAjuste ? 'Reparación' : movement.type === 'traslado' ? 'Traslado' : movementLabel(movement.type)
            return (
              <article key={movement.id} className="panel border-orange-200 bg-orange-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(movement.lots?.product)}</p>
                    <p className="mt-0.5 text-[11px] font-semibold text-slate-500 [overflow-wrap:anywhere]">Lote {displayLotCode(movement.lots?.lot_code)} · {movement.lots?.clients?.name || '-'} · {movement.lots?.location || '-'}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-black text-orange-700">{tipoLabel}</span>
                </div>

                {note.motivo ? (
                  <span className="mt-2 inline-flex rounded-full bg-white px-3 py-1 text-xs font-bold text-orange-800">{note.motivo}</span>
                ) : null}

                {isAjuste ? (
                  <div className="mt-2.5 rounded-lg bg-white px-3">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2">
                      <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{subeStock ? 'Diferencia (sube)' : 'Afectada'}</span>
                      <span className={`text-right text-sm font-black ${subeStock ? 'text-campo-700' : 'text-red-700'}`}>{subeStock ? '+' : '−'}{eqLabel(afectadoEq)}{envLabel(afectadoEq) ? <span className="ml-1.5 text-[11px] font-semibold text-slate-400">· {envLabel(afectadoEq)}</span> : null}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 py-2">
                      <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Stock</span>
                      <span className="text-right">
                        <span className="text-sm font-black text-slate-500">{eqLabel(currentEq)}</span>
                        <span className="mx-1.5 text-slate-300">→</span>
                        <span className="text-sm font-black text-campo-700">{eqLabel(newEq)}</span>
                        {size > 0 ? <span className="block text-[11px] font-semibold text-slate-400">{envLabel(currentEq)} → {envLabel(newEq)}</span> : null}
                      </span>
                    </div>
                  </div>
                ) : movement.type === 'traslado' ? (
                  <div className="mt-2.5 flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Nueva ubicación</span>
                    <span className="text-sm font-black text-slate-900">{movement.to_location || '-'}</span>
                  </div>
                ) : (
                  <div className="mt-2.5 flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Cantidad</span>
                    <span className="text-right text-sm font-black text-slate-900">{eqLabel(afectadoEq)}{envLabel(afectadoEq) ? <span className="ml-1.5 text-[11px] font-semibold text-slate-400">· {envLabel(afectadoEq)}</span> : null}</span>
                  </div>
                )}

                {note.obs ? <p className="mt-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold italic text-slate-600 [overflow-wrap:anywhere]">{note.obs}</p> : null}

                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-[11px] font-semibold text-slate-400">{movement.profiles?.full_name || 'Operador'} · {formatDate(movement.created_at)}</p>
                  {note.foto ? (
                    <a className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-campo-700 shadow-sm" href={note.foto} target="_blank" rel="noreferrer">
                      <Camera size={14} /> Ver foto
                    </a>
                  ) : null}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="btn-secondary w-full" type="button" onClick={() => reviewMovement(movement.id, 'reject')}>
                    <X size={18} /> Rechazar
                  </button>
                  <button className="btn-primary w-full" type="button" onClick={() => reviewMovement(movement.id, 'approve')}>
                    <Check size={18} /> Aprobar
                  </button>
                </div>
              </article>
            )
          })}


          {issues.map((issue) => (
            <article key={issue.id} className="panel border-slate-200 bg-white">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-black text-slate-950">Reporte operativo: {issue.issue_type?.replaceAll('_', ' ')}</p>
                  <p className="mt-1 font-black text-slate-900 [overflow-wrap:anywhere]">{cleanProductName(issue.lots?.product)}</p>
                  <p className="text-xs font-semibold text-slate-500">
                    {displayLotCode(issue.lots?.lot_code)} - {issue.lots?.clients?.name || '-'} - {issue.lots?.location || '-'}
                  </p>
                </div>
                <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-black text-orange-700">Reporte</span>
              </div>
              {issue.notes ? <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-700">{issue.notes}</p> : null}
              <button className="btn-primary mt-3 w-full" type="button" onClick={() => resolveIssue(issue.id)}>
                <Check size={18} /> Marcar revisado
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

