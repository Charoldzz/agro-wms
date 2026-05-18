import { useEffect, useState } from 'react'
import { Plus, Save } from 'lucide-react'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'

const initialForm = { name: '', contact: '', notes: '' }

export default function Clients() {
  const { isAdmin } = useAuth()
  const [clients, setClients] = useState([])
  const [form, setForm] = useState(initialForm)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    loadClients()
  }, [])

  async function loadClients() {
    const { data } = await supabase.from('clients').select('*').order('name')
    setClients(data || [])
  }

  async function handleSubmit(event) {
    event.preventDefault()
    await supabase.from('clients').insert(form)
    setForm(initialForm)
    setShowForm(false)
    loadClients()
  }

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle="Terceros con producto almacenado"
        action={
          isAdmin ? (
            <button className="btn-primary !min-h-11 !px-3" onClick={() => setShowForm((value) => !value)}>
              <Plus size={20} />
            </button>
          ) : null
        }
      />

      {showForm && isAdmin ? (
        <form className="panel mb-4 space-y-3" onSubmit={handleSubmit}>
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
            <Save size={20} /> Guardar cliente
          </button>
        </form>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {clients.length === 0 ? (
          <EmptyState title="Sin clientes" text="Registra el primer cliente para crear lotes." />
        ) : (
          clients.map((client) => (
            <article key={client.id} className="rounded-lg border border-slate-200 bg-white/95 px-3 py-3 shadow-soft">
              <h3 className="text-sm font-bold text-slate-900">{client.name}</h3>
            </article>
          ))
        )}
      </div>
    </div>
  )
}
