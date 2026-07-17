import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useAuth } from '../hooks/useAuth.jsx'
import { cleanProductName, displayLotCode } from '../lib/display'
import { formatDate, formatNumber, movementLabel } from '../lib/format'
import { supabase } from '../lib/supabase'

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
        .select('*, lots(product, lot_code, current_quantity, location, clients(name)), profiles!movements_user_id_fkey(full_name)')
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
        ? supabase.from('lots').select('id, lot_code, product, current_quantity, location, clients(name)').eq('inventory_source', 'stock_independiente').in('id', lotIds)
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
          {movements.map((movement) => (
            <article key={movement.id} className="panel border-orange-200 bg-orange-50">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-black text-slate-950">{movementLabel(movement.type)}</p>
                  <div className="mt-1 flex flex-wrap items-start gap-2">
                    <p className="text-sm font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(movement.lots?.product)}</p>
                    <span className="rounded-lg bg-white px-2 py-1 text-xs font-black text-orange-800">{formatNumber(movement.quantity)} uds</span>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {displayLotCode(movement.lots?.lot_code)} - {movement.profiles?.full_name || 'Usuario'} - {movement.lots?.clients?.name || '-'} - {formatDate(movement.created_at)}
                  </p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-orange-700">{movementLabel(movement.type)}</span>
              </div>

              <div className="mt-3 grid gap-2 text-sm font-bold text-slate-600 sm:grid-cols-2">
                <div className="rounded-lg bg-white p-3">Stock actual: {formatNumber(movement.lots?.current_quantity)} uds</div>
                <div className="rounded-lg bg-white p-3">Ubicacion: {movement.lots?.location || '-'}</div>
              </div>
              {movement.notes ? <p className="mt-3 rounded-lg bg-white p-3 text-sm font-semibold text-slate-600">{movement.notes}</p> : null}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button className="btn-secondary w-full" type="button" onClick={() => reviewMovement(movement.id, 'reject')}>
                  <X size={18} /> Rechazar
                </button>
                <button className="btn-primary w-full" type="button" onClick={() => reviewMovement(movement.id, 'approve')}>
                  <Check size={18} /> Aprobar
                </button>
              </div>
            </article>
          ))}

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
