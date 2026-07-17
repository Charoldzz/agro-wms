import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, LogOut, Paperclip, Plus, Search, X } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, equivalentLabel } from '../lib/format'
import { cleanProductName } from '../lib/display'
import { attachmentViewerUrl, normalizeDispatchRequests } from '../lib/dispatchRequests'
import { itemEnvLabel } from '../lib/envases'

const STATUS_LABEL = {
  pendiente: 'Pendiente',
  aprobado: 'Pendiente',
  en_preparacion: 'En preparación',
}

const STATUS_COLOR = {
  pendiente: 'bg-amber-100 text-amber-800',
  aprobado: 'bg-blue-100 text-blue-800',
  en_preparacion: 'bg-campo-100 text-campo-800',
}

export default function SalidasHub() {
  const { user } = useAuth()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [rejectingId, setRejectingId] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectError, setRejectError] = useState('')

  useEffect(() => {
    load()
    const ch = supabase
      .channel('salidas-hub')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_dispatch_requests' }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('client_dispatch_requests')
      .select('*, clients(name), lots(id, lot_code, product, current_quantity, package_size, package_unit)')
      .in('status', ['pendiente', 'aprobado', 'en_preparacion'])
      .order('created_at', { ascending: false })
    const normalized = await normalizeDispatchRequests(data || [])
    setRequests(normalized)
    setLoading(false)
  }

  function startReject(id) {
    setRejectingId(id)
    setRejectReason('')
    setRejectError('')
  }

  async function confirmReject(id) {
    if (!rejectReason.trim()) {
      setRejectError('Escribe el motivo del rechazo para que el cliente lo vea.')
      return
    }
    const { error } = await supabase.rpc('reject_dispatch_request', {
      p_request_id: id,
      p_reason: rejectReason.trim(),
    })
    if (error) {
      setRejectError(`No se pudo rechazar: ${error.message}`)
      return
    }
    setRejectingId(null)
    setRejectReason('')
    load()
  }

  const term = search.toLowerCase().trim()
  // "pendiente" y "aprobado" (fantasma) se cuentan juntos como pendiente
  const isPend = (s) => s === 'pendiente' || s === 'aprobado'
  const filteredRequests = requests.filter((req) => {
    if (statusFilter === 'pendiente' && !isPend(req.status)) return false
    if (statusFilter === 'en_preparacion' && req.status !== 'en_preparacion') return false
    if (!term) return true
    const items = Array.isArray(req.items) ? req.items : []
    return [
      req.clients?.name,
      req.transporter_name,
      req.transporter_plate,
      req.notes,
      STATUS_LABEL[req.status],
      ...items.map((it) => it.product),
      req.product,
      req.lots?.product,
    ].filter(Boolean).some((v) => String(v).toLowerCase().includes(term))
  })

  return (
    <div>
      <PageHeader title="Salidas" subtitle="Solicitudes pendientes y despachos manuales" />

      <Link className="btn-primary mb-5 w-full !min-h-12" to="/nueva-salida">
        <Plus size={20} /> Nueva salida manual
      </Link>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Solicitudes pendientes</h2>
        {filteredRequests.length > 0 && (
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-black text-white">{filteredRequests.length}</span>
        )}
      </div>

      {requests.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {[
            { key: 'all', label: 'Todas', match: () => true },
            { key: 'pendiente', label: 'Pendientes', match: (s) => isPend(s) },
            { key: 'en_preparacion', label: 'En preparación', match: (s) => s === 'en_preparacion' },
          ].map((f) => {
            const count = requests.filter((r) => f.match(r.status)).length
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setStatusFilter(f.key)}
                className={`rounded-full px-3 py-1 text-xs font-bold transition ${statusFilter === f.key ? 'bg-campo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {f.label} {count > 0 ? `(${count})` : ''}
              </button>
            )
          })}
        </div>
      )}

      {requests.length > 0 && (
        <div className="relative mb-3">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input w-full pl-9"
            placeholder="Buscar empresa, producto, transportista..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-100 bg-white p-6 text-center text-sm font-semibold text-slate-400">Cargando...</div>
      ) : filteredRequests.length === 0 ? (
        <div className="rounded-xl border border-slate-100 bg-white p-8 text-center">
          <ClipboardList size={36} className="mx-auto mb-2 text-slate-300" />
          <p className="text-sm font-bold text-slate-500">
            {requests.length === 0 ? 'No hay solicitudes pendientes.' : 'Sin resultados para la búsqueda.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRequests.map((req) => {
            const items = Array.isArray(req.items) && req.items.length > 0
              ? req.items
              : [{ product: req.product || req.lots?.product, quantity: req.quantity, lot_id: req.lot_id }]

            return (
              <div key={req.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="font-black text-slate-950">{req.clients?.name || 'Cliente'}</p>
                    <p className="text-xs text-slate-400">{req.created_at ? formatDate(req.created_at) : ''}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_COLOR[req.status] || 'bg-slate-100 text-slate-600'}`}>
                    {STATUS_LABEL[req.status] || req.status}
                  </span>
                </div>

                <div className="mb-3 space-y-1">
                  {items.map((item, idx) => {
                    const size = Number(item.package_size) || 0
                    const equivalente = size > 0 && item.package_unit
                      ? equivalentLabel(Number(item.quantity || 0) * size, item.package_unit)
                      : null
                    return (
                      <div key={item.lot_id || idx} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-slate-800">{cleanProductName(item.product) || '—'}</span>
                          {item.note && <span className="block text-[10px] font-semibold italic text-slate-500">Obs.: {item.note}</span>}
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-sm font-black text-campo-700">{equivalente || `${formatNumber(item.quantity)} uds`}</span>
                          {equivalente && <span className="block text-[10px] font-semibold text-slate-400">{itemEnvLabel(item)}</span>}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {(req.transporter_name || req.transporter_plate) && (
                  <p className="mb-1 text-xs text-slate-500">
                    {req.transporter_name && <span>Transportista: <span className="font-semibold">{req.transporter_name}</span></span>}
                    {req.transporter_plate && <span className="ml-2">· Placa: <span className="font-semibold">{req.transporter_plate}</span></span>}
                  </p>
                )}

                {req.attachment_url && (
                  <a
                    href={attachmentViewerUrl(req.attachment_url)}
                    target="_blank"
                    rel="noreferrer"
                    className="mb-3 inline-flex items-center gap-1.5 text-xs font-bold text-campo-700 hover:underline"
                  >
                    <Paperclip size={12} /> Ver nota adjunta
                  </a>
                )}

                {rejectingId === req.id ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="mb-2 text-xs font-bold text-red-800">Motivo del rechazo (el cliente lo verá en su historial):</p>
                    <textarea
                      className="w-full rounded-lg border border-red-200 bg-white p-2 text-sm focus:border-red-400 focus:outline-none"
                      rows={2}
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Ej: sin stock suficiente del producto solicitado"
                      autoFocus
                    />
                    {rejectError && <p className="mt-1 text-xs font-bold text-red-700">{rejectError}</p>}
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button className="btn-secondary !min-h-9 !py-1.5 text-sm" type="button" onClick={() => setRejectingId(null)}>
                        Cancelar
                      </button>
                      <button
                        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold text-white transition active:scale-[0.99]"
                        type="button"
                        onClick={() => confirmReject(req.id)}
                      >
                        <X size={15} /> Confirmar rechazo
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Link className="btn-primary flex-1 !min-h-10 !py-2 text-sm" to={`/nueva-salida?request=${req.id}`}>
                      <LogOut size={16} /> {req.status === 'en_preparacion' ? 'Continuar despacho' : 'Iniciar despacho'}
                    </Link>
                    <button
                      className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-bold text-red-600 transition hover:bg-red-50 active:scale-[0.99]"
                      type="button"
                      onClick={() => startReject(req.id)}
                    >
                      <X size={15} /> Rechazar
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
