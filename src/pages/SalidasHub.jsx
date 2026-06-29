import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, LogOut, Plus } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber } from '../lib/format'
import { cleanProductName } from '../lib/display'
import { normalizeDispatchRequests } from '../lib/dispatchRequests'

const STATUS_LABEL = {
  pendiente: 'Pendiente',
  aprobado: 'Aprobado',
  en_preparacion: 'En preparación',
}

const STATUS_COLOR = {
  pendiente: 'bg-amber-100 text-amber-800',
  aprobado: 'bg-blue-100 text-blue-800',
  en_preparacion: 'bg-campo-100 text-campo-800',
}

export default function SalidasHub() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)

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

  return (
    <div>
      <PageHeader title="Salidas" subtitle="Solicitudes pendientes y despachos manuales" />

      <Link className="btn-primary mb-5 w-full !min-h-12" to="/nueva-salida">
        <Plus size={20} /> Nueva salida manual
      </Link>

      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Solicitudes pendientes</h2>
        {requests.length > 0 && (
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-black text-white">{requests.length}</span>
        )}
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-100 bg-white p-6 text-center text-sm font-semibold text-slate-400">Cargando...</div>
      ) : requests.length === 0 ? (
        <div className="rounded-xl border border-slate-100 bg-white p-8 text-center">
          <ClipboardList size={36} className="mx-auto mb-2 text-slate-300" />
          <p className="text-sm font-bold text-slate-500">No hay solicitudes pendientes.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
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
                  {items.map((item, idx) => (
                    <div key={item.lot_id || idx} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5">
                      <span className="text-sm font-semibold text-slate-800">{cleanProductName(item.product) || '—'}</span>
                      <span className="text-sm font-bold text-slate-500">{formatNumber(item.quantity)} env.</span>
                    </div>
                  ))}
                </div>

                {(req.transporter_name || req.transporter_plate) && (
                  <p className="mb-3 text-xs text-slate-500">
                    {req.transporter_name && <span>Transportista: <span className="font-semibold">{req.transporter_name}</span></span>}
                    {req.transporter_plate && <span className="ml-2">· Placa: <span className="font-semibold">{req.transporter_plate}</span></span>}
                  </p>
                )}

                <Link className="btn-primary w-full !min-h-10 !py-2 text-sm" to={`/nueva-salida?request=${req.id}`}>
                  <LogOut size={16} /> Iniciar despacho
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
