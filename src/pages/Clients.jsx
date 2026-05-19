import { useEffect, useState } from 'react'
import { Edit2, Plus, Save, X } from 'lucide-react'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'
import { formatNumber } from '../lib/format'

const initialForm = { name: '', contact: '', notes: '' }

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
    const [{ data: clientsData }, { data: lotsData }] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('lots').select('client_id, current_quantity'),
    ])

    const stats = {}
    ;(lotsData || []).forEach((lot) => {
      if (!lot.client_id) return
      if (!stats[lot.client_id]) stats[lot.client_id] = { lots: 0, quantity: 0 }
      stats[lot.client_id].lots += 1
      stats[lot.client_id].quantity += Number(lot.current_quantity || 0)
    })

    setClients(clientsData || [])
    setClientStats(stats)
  }

  function startCreate() {
    setEditingId(null)
    setForm(initialForm)
    setShowForm((value) => !value)
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

    if (editingId) {
      await supabase.from('clients').update(form).eq('id', editingId)
    } else {
      await supabase.from('clients').insert(form)
    }

    cancelForm()
    loadClients()
  }

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle="Lista compacta de clientes"
        action={
          isAdmin ? (
            <button className="btn-primary !min-h-11 !px-3" onClick={startCreate}>
              <Plus size={20} />
            </button>
          ) : null
        }
      />

      {showForm && isAdmin ? (
        <form className="panel mb-4 space-y-3" onSubmit={handleSubmit}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold text-slate-900">{editingId ? 'Editar cliente' : 'Nuevo cliente'}</h3>
            <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={cancelForm}>
              <X size={18} />
            </button>
          </div>
          <label className="block">
            <span className="label">Nombre cliente</span>
            <input className="input mt-1" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </label>
          <label className="block">
            <span className="label">Contacto</span>
            <input className="input mt-1" value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} />
          </label>
          <label className="block">
            <span className="label">Observaciones</span>
            <textarea className="input mt-1" rows="3" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          <button className="btn-primary w-full">
            <Save size={20} /> {editingId ? 'Guardar cambios' : 'Guardar cliente'}
          </button>
        </form>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {clients.length === 0 ? (
          <EmptyState title="Sin clientes" text="Registra el primer cliente para crear lotes." />
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
        <div className="fixed inset-0 z-40 flex items-end bg-slate-950/40 p-4 sm:items-center sm:justify-center">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-slate-950">{selectedClient.name}</h3>
                <p className="text-sm font-semibold text-slate-500">Informacion del cliente</p>
              </div>
              <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={() => setSelectedClient(null)}>
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
                <Edit2 size={18} /> Editar cliente
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
