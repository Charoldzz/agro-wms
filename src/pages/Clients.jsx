import { useEffect, useState } from 'react'
import { Edit2, Save, X } from 'lucide-react'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'
import { formatNumber } from '../lib/format'

const initialForm = { name: '', contact: '', notes: '' }

function displayClientName(name) {
  return String(name || '').replaceAll('"', '').replace(/\s+/g, ' ').trim()
}

function clientNameKey(name) {
  return displayClientName(name).toLocaleLowerCase('es-BO')
}

function cleanClientNotes(notes) {
  if (!notes) return ''
  if (/importado\s+desde\s+excel/i.test(notes)) return ''
  return notes
}

export default function Clients() {
  const { isAdmin } = useAuth()
  const [clients, setClients] = useState([])
  const [form, setForm] = useState(initialForm)
  const [editingId, setEditingId] = useState(null)
  const [selectedClient, setSelectedClient] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [clientStats, setClientStats] = useState({})

  useEffect(() => {
    loadClients()
  }, [])

  async function loadClients() {
    const { data: lotsData } = await supabase
        .from('lots')
        .select('client_id, current_quantity')
        .eq('inventory_source', 'stock_independiente')
        .eq('status', 'activo')
        .gt('current_quantity', 0)

    const stats = {}
    ;(lotsData || []).forEach((lot) => {
      if (!lot.client_id) return
      if (!stats[lot.client_id]) stats[lot.client_id] = { lots: 0, quantity: 0 }
      stats[lot.client_id].lots += 1
      stats[lot.client_id].quantity += Number(lot.current_quantity || 0)
    })

    const clientIds = Object.keys(stats)
    const { data: clientsData } = clientIds.length
      ? await supabase
        .from('clients')
        .select('*')
        .eq('inventory_source', 'stock_independiente')
        .in('id', clientIds)
        .order('name')
      : { data: [] }

    const uniqueClients = []
    const seenNames = new Set()
    ;(clientsData || []).forEach((client) => {
      const key = clientNameKey(client.name)
      if (!key || seenNames.has(key)) return
      seenNames.add(key)
      uniqueClients.push({ ...client, name: displayClientName(client.name) })
    })

    setClients(uniqueClients)
    setClientStats(stats)
  }

  function startEdit(client) {
    setEditingId(client.id)
    setForm({
      name: client.name || '',
      contact: client.contact || '',
      notes: cleanClientNotes(client.notes),
    })
    setShowForm(true)
  }

  function cancelForm() {
    setEditingId(null)
    setForm(initialForm)
    setShowForm(false)
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (!editingId) return
    await supabase
      .from('clients')
      .update({ contact: form.contact, notes: form.notes })
      .eq('id', editingId)

    cancelForm()
    loadClients()
  }

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle="Lista compacta de clientes"
        action={null}
      />

      {showForm && isAdmin ? (
        <form className="panel mb-4 space-y-3" onSubmit={handleSubmit}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold text-slate-900">Editar contacto</h3>
            <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={cancelForm}>
              <X size={18} />
            </button>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase text-slate-400">Cliente oficial de Solucion</p>
            <p className="mt-1 text-base font-bold text-slate-950 [overflow-wrap:anywhere]">{form.name}</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">El nombre viene de Solucion y no se modifica desde la app.</p>
          </div>
          <label className="block">
            <span className="label">Contacto</span>
            <input className="input mt-1" value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} />
          </label>
          <label className="block">
            <span className="label">Observaciones</span>
            <textarea className="input mt-1" rows="3" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          <button className="btn-primary w-full">
            <Save size={20} /> Guardar contacto
          </button>
        </form>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {clients.length === 0 ? (
          <EmptyState title="Sin clientes" text="No hay clientes de Solucion con inventario activo." />
        ) : (
          clients.map((client) => (
            <article key={client.id} className="rounded-lg border border-slate-200 bg-white/95 px-3 py-3 shadow-soft">
              <div className="flex items-center justify-between gap-3">
                <button className="min-w-0 flex-1 text-left" type="button" onClick={() => setSelectedClient(client)}>
                  <h3 className="truncate text-sm font-bold text-slate-900">{client.name}</h3>
                  <p className="truncate text-xs font-semibold text-campo-700">
                    {formatNumber(clientStats[client.id]?.quantity || 0)} envases · {clientStats[client.id]?.lots || 0} lotes
                  </p>
                </button>
                {isAdmin ? (
                  <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={() => startEdit(client)}>
                    <Edit2 size={17} />
                  </button>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>

      {selectedClient ? (
        <div data-modal-backdrop="true" className="fixed inset-0 z-40 flex items-end overflow-y-auto bg-slate-950/40 p-4 sm:items-center sm:justify-center">
          <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-xl bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-slate-950 [overflow-wrap:anywhere]">{selectedClient.name}</h3>
                <p className="text-sm font-semibold text-slate-500">Informacion del cliente</p>
              </div>
              <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={() => setSelectedClient(null)} title="Cerrar">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <Info
                label="Inventario"
                value={`${formatNumber(clientStats[selectedClient.id]?.quantity || 0)} envases · ${
                  clientStats[selectedClient.id]?.lots || 0
                } lotes`}
              />
              <Info label="Contacto" value={selectedClient.contact || 'Sin contacto registrado'} />
              {cleanClientNotes(selectedClient.notes) ? (
                <Info label="Observaciones" value={cleanClientNotes(selectedClient.notes)} />
              ) : null}
            </div>

            {isAdmin ? (
              <button
                className="btn-primary mt-4 w-full"
                type="button"
                onClick={() => {
                  startEdit(selectedClient)
                  setSelectedClient(null)
                }}
              >
                <Edit2 size={18} /> Editar contacto
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Info({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-bold text-slate-900">{value}</p>
    </div>
  )
}
