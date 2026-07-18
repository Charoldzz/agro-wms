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
  const [corrections, setCorrections] = useState([])
  const [clients, setClients] = useState([])
  const [issues, setIssues] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    loadPending()

    const channel = supabase
      .channel('admin-pending')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movements' }, loadPending)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movement_correction_requests' }, loadPending)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operational_issue_reports' }, loadPending)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  async function loadPending() {
    const [movementResult, correctionResult, issueResult, clientResult] = await Promise.all([
      supabase
        .from('movements')
        .select('*, lots(product, lot_code, current_quantity, package_size, package_unit, location, clients(name)), profiles!movements_user_id_fkey(full_name)')
        .in('type', ['ajuste', 'traslado', 'salida'])
        .eq('approval_status', 'pendiente')
        .order('created_at', { ascending: false }),
      supabase
        .from('movement_correction_requests')
        .select('*, movements(type, quantity, lots(lot_code, product, clients(name))), profiles!movement_correction_requests_requested_by_fkey(full_name)')
        .eq('status', 'pendiente')
        .order('created_at', { ascending: false }),
      supabase
        .from('operational_issue_reports')
        .select('*, lots(lot_code, product, location, clients(name)), profiles!operational_issue_reports_reported_by_fkey(full_name)')
        .eq('status', 'pendiente')
        .order('created_at', { ascending: false }),
      supabase.from('clients').select('id, name').eq('inventory_source', 'stock_independiente').order('name'),
    ])

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

    if (correctionResult.error) {
      if (!String(correctionResult.error.message || '').includes('movement_correction_requests')) loadErrors.push('correcciones')
      setCorrections([])
    } else {
      setCorrections(correctionResult.data || [])
    }

    if (issueResult.error) {
      if (!String(issueResult.error.message || '').includes('operational_issue_reports')) loadErrors.push('reportes operativos')
      setIssues([])
    } else {
      setIssues(issueResult.data || [])
    }

    if (!clientResult.error) setClients(clientResult.data || [])
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

  async function reviewCorrection(id, action) {
    await supabase.rpc(action === 'approve' ? 'approve_movement_correction' : 'reject_movement_correction', {
      p_request_id: id,
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

  const total = movements.length + corrections.length + issues.length

  return (
    <div>
      <PageHeader title="Por aprobar" subtitle={`${total} por aprobar`} />

      {error ? <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

      {total === 0 ? (
        <EmptyState title="Nada por aprobar" text="No hay reparaciones, traslados, salidas offline ni reportes por revisar." />
      ) : (
        <div className="space-y-4">
          {movements.map((movement) => {
            const size = Number(movement.lots?.package_size) || 0
            const unit = movement.lots?.package_unit
            const currentUds = Number(movement.lots?.current_quantity) || 0
            const currentEq = currentUds * size
            const isAjuste = movement.type === 'ajuste'
            const note = parseMovementNotes(movement.notes)
            // Cantidad afectada en equivalente: del concepto del operador; si falta, del delta de cantidades
            const afectadoEq = isAjuste
              ? (note.afectado != null ? note.afectado : Math.max((currentUds - (Number(movement.quantity) || 0)) * size, 0))
              : (Number(movement.quantity) || 0) * size
            const newEq = Math.max(currentEq - afectadoEq, 0)
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
                      <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Afectada</span>
                      <span className="text-right text-sm font-black text-red-700">{eqLabel(afectadoEq)}{envLabel(afectadoEq) ? <span className="ml-1.5 text-[11px] font-semibold text-slate-400">· {envLabel(afectadoEq)}</span> : null}</span>
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

          {corrections.map((correction) => (
            <article key={correction.id} className="panel border-red-200 bg-red-50">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-black text-slate-950">
                    Correccion de {correctionTypeLabel(correction.correction_type)}
                  </p>
                  <p className="mt-1 font-black text-slate-900 [overflow-wrap:anywhere]">{cleanProductName(correction.movements?.lots?.product)}</p>
                  <p className="text-xs font-semibold text-slate-500">
                    {displayLotCode(correction.movements?.lots?.lot_code)} - {correction.movements?.lots?.clients?.name || '-'} - {correction.profiles?.full_name || 'Usuario'}
                  </p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-red-700">Auditoria</span>
              </div>
              <CorrectionReviewDetails correction={correction} clients={clients} />
              <p className="mt-2 rounded-lg bg-white p-3 text-sm font-semibold text-slate-700">{correction.reason}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button className="btn-secondary w-full" type="button" onClick={() => reviewCorrection(correction.id, 'reject')}>
                  <X size={18} /> Rechazar
                </button>
                <button className="btn-primary w-full" type="button" onClick={() => reviewCorrection(correction.id, 'approve')}>
                  <Check size={18} /> Aprobar
                </button>
              </div>
            </article>
          ))}

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

function CorrectionReviewDetails({ correction, clients }) {
  if (correction.correction_type === 'cantidad') {
    return (
      <div className="mt-3 grid gap-2 text-sm font-bold sm:grid-cols-2">
        <p className="rounded-lg bg-white p-3">Registrado: {formatNumber(correction.movements?.quantity)} uds</p>
        <p className="rounded-lg bg-white p-3">Correcto: {formatNumber(correction.requested_quantity)} uds</p>
      </div>
    )
  }

  const patchRows = lotPatchRows(correction.lot_patch, clients)

  return (
    <div className="mt-3 rounded-lg bg-white p-3">
      <p className="text-xs font-black uppercase text-slate-500">
        Cambios solicitados en {correction.correction_type === 'operacion' ? 'operacion' : 'ficha'}
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {patchRows.map((row) => (
          <div key={row.label} className="rounded-lg bg-slate-50 p-2">
            <p className="text-xs font-bold text-slate-500">{row.label}</p>
            <p className="mt-0.5 font-black text-slate-950 [overflow-wrap:anywhere]">{row.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function lotPatchRows(patch, clients) {
  const values = patch && typeof patch === 'object' ? patch : {}
  const clientMap = new Map((clients || []).map((client) => [client.id, client.name]))
  const labels = {
    client_id: 'Cliente',
    lot_code: 'ID lote',
    product: 'Producto',
    location: 'Ubicacion',
    package_size: 'Tamaño presentación',
    package_unit: 'Unidad',
    expiry_date: 'Vencimiento',
    vehicle_plate: 'Placa',
    receiver_name: 'Recibe',
    receiver_document: 'Documento',
  }

  return Object.entries(values).filter(([key]) => key !== 'movement_ids').map(([key, value]) => ({
    label: labels[key] || key,
    value: key === 'client_id' ? clientMap.get(value) || 'Cliente seleccionado' : String(value || '-'),
  }))
}

function correctionTypeLabel(type) {
  if (type === 'ficha') return 'ficha'
  if (type === 'operacion') return 'operacion'
  return 'cantidad'
}
