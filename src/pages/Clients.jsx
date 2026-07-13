import { useEffect, useState } from 'react'
import { Edit2, Save, UserPlus, X } from 'lucide-react'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase, inviteUser } from '../lib/supabase'
import { formatNumber } from '../lib/format'
import { lotBillingPallets } from '../lib/pallets'

const initialForm = { name: '', contact: '', notes: '', product_code_prefix: '' }

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
  const [showPortalForm, setShowPortalForm] = useState(false)
  const [portalEmail, setPortalEmail] = useState('')
  const [portalMsg, setPortalMsg] = useState('')
  const [portalError, setPortalError] = useState('')
  const [creatingUser, setCreatingUser] = useState(false)
  const [showOperForm, setShowOperForm] = useState(false)
  const [operForm, setOperForm] = useState({ name: '', email: '' })
  const [operMsg, setOperMsg] = useState('')
  const [operError, setOperError] = useState('')
  const [invitingOper, setInvitingOper] = useState(false)

  useEffect(() => {
    loadClients()
  }, [])

  async function loadClients() {
    const { data: lotsData } = await supabase
        .from('lots')
        .select('client_id, current_quantity, raw_data')
        .eq('inventory_source', 'stock_independiente')
        .eq('status', 'activo')
        .gt('current_quantity', 0)

    const stats = {}
    ;(lotsData || []).forEach((lot) => {
      if (!lot.client_id) return
      if (!stats[lot.client_id]) stats[lot.client_id] = { lots: 0, quantity: 0, pallets: 0, missingPalletRules: 0 }
      stats[lot.client_id].lots += 1
      stats[lot.client_id].quantity += Number(lot.current_quantity || 0)
      const pallets = lotBillingPallets(lot)
      if (pallets === null) stats[lot.client_id].missingPalletRules += 1
      else stats[lot.client_id].pallets += pallets
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
      product_code_prefix: client.product_code_prefix || '',
    })
    setShowForm(true)
  }

  function cancelForm() {
    setEditingId(null)
    setForm(initialForm)
    setShowForm(false)
  }

  function openClientDetail(client) {
    setSelectedClient(client)
    setShowPortalForm(false)
    setPortalEmail('')
    setPortalMsg('')
    setPortalError('')
  }

  async function handleInvitePortalUser(event) {
    event.preventDefault()
    if (!selectedClient) return
    setPortalError('')
    setCreatingUser(true)
    try {
      const email = portalEmail.trim().toLowerCase()
      await inviteUser({
        email,
        role: 'cliente',
        clientId: selectedClient.id,
        fullName: selectedClient.name,
      })
      setPortalMsg(`Invitación enviada a ${email}. Cuando cree su contraseña entrará directo al portal de ${selectedClient.name}.`)
      setShowPortalForm(false)
      setPortalEmail('')
    } catch (err) {
      setPortalError(err.message)
    } finally {
      setCreatingUser(false)
    }
  }

  async function handleInviteOperator(event) {
    event.preventDefault()
    setOperError('')
    setInvitingOper(true)
    try {
      const email = operForm.email.trim().toLowerCase()
      await inviteUser({
        email,
        role: 'operador',
        fullName: operForm.name.trim() || null,
      })
      setOperMsg(`Invitación enviada a ${email}. Cuando cree su contraseña entrará como operador.`)
      setShowOperForm(false)
      setOperForm({ name: '', email: '' })
    } catch (err) {
      setOperError(err.message)
    } finally {
      setInvitingOper(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (!editingId) return
    const prefix = form.product_code_prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    await supabase
      .from('clients')
      .update({ contact: form.contact, notes: form.notes, product_code_prefix: prefix || null })
      .eq('id', editingId)

    cancelForm()
    loadClients()
  }

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle="Lista compacta de clientes"
        action={isAdmin ? (
          <button className="btn-secondary w-full sm:w-auto" type="button" onClick={() => { setShowOperForm(!showOperForm); setOperMsg(''); setOperError('') }}>
            <UserPlus size={18} /> Invitar operador
          </button>
        ) : null}
      />

      {operMsg ? (
        <p className="mb-4 rounded-lg bg-campo-50 px-3 py-2 text-sm font-bold text-campo-800">{operMsg}</p>
      ) : null}

      {showOperForm && isAdmin ? (
        <form className="panel mb-4 space-y-3" onSubmit={handleInviteOperator}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold text-slate-900">Invitar operador</h3>
            <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={() => setShowOperForm(false)}>
              <X size={18} />
            </button>
          </div>
          <label className="block">
            <span className="label">Nombre del operador</span>
            <input
              className="input mt-1"
              required
              placeholder="Ej: Juan Pérez"
              value={operForm.name}
              onChange={(event) => setOperForm({ ...operForm, name: event.target.value })}
            />
          </label>
          <label className="block">
            <span className="label">Correo</span>
            <input
              className="input mt-1"
              type="email"
              required
              placeholder="correo@ejemplo.com"
              value={operForm.email}
              onChange={(event) => setOperForm({ ...operForm, email: event.target.value })}
            />
          </label>
          <p className="text-xs font-semibold text-slate-400">
            Le llegará un correo para crear su contraseña. Al entrar verá las pantallas de operador.
          </p>
          {operError ? <p className="text-xs font-bold text-red-600">{operError}</p> : null}
          <button className="btn-primary w-full" type="submit" disabled={invitingOper}>
            <UserPlus size={18} /> {invitingOper ? 'Enviando...' : 'Enviar invitación'}
          </button>
        </form>
      ) : null}

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
            <span className="label">Prefijo de codigo de productos</span>
            <input
              className="input mt-1 font-mono uppercase"
              value={form.product_code_prefix}
              maxLength={8}
              placeholder="Ej: ADSP, GATB"
              onChange={(event) => setForm({ ...form, product_code_prefix: event.target.value })}
            />
            <p className="mt-1 text-xs font-semibold text-slate-400">Solo letras y numeros. Se usa para generar codigos como ADSP-00001.</p>
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
            <Save size={20} /> Guardar
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
                <button className="min-w-0 flex-1 text-left" type="button" onClick={() => openClientDetail(client)}>
                  <h3 className="truncate text-sm font-bold text-slate-900">{client.name}</h3>
                  <p className="truncate text-xs font-semibold text-campo-700">
                    {formatNumber(clientStats[client.id]?.quantity || 0)} unidades · — pallets
                    {client.product_code_prefix ? <span className="ml-2 rounded bg-campo-50 px-1 font-mono text-campo-600">{client.product_code_prefix}</span> : null}
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
                value={`${formatNumber(clientStats[selectedClient.id]?.quantity || 0)} unidades · ${
                  clientStats[selectedClient.id]?.lots || 0
                } lotes · — pallets`}
              />
              <Info label="Contacto" value={selectedClient.contact || 'Sin contacto registrado'} />
              {cleanClientNotes(selectedClient.notes) ? (
                <Info label="Observaciones" value={cleanClientNotes(selectedClient.notes)} />
              ) : null}
            </div>

            {isAdmin ? (
              <div className="mt-4 rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-semibold uppercase text-slate-400">Usuario del portal</p>
                {portalMsg ? (
                  <p className="mt-2 rounded-lg bg-campo-50 px-3 py-2 text-sm font-bold text-campo-800">{portalMsg}</p>
                ) : null}
                {showPortalForm ? (
                  <form className="mt-2 space-y-2" onSubmit={handleInvitePortalUser}>
                    <label className="block">
                      <span className="label">Correo del cliente</span>
                      <input
                        className="input mt-1 w-full"
                        type="email"
                        required
                        placeholder="correo@empresa.com"
                        value={portalEmail}
                        onChange={(event) => setPortalEmail(event.target.value)}
                      />
                    </label>
                    <p className="text-xs font-semibold text-slate-400">
                      Le llegará un correo para crear su contraseña. Al entrar verá solo el portal de {selectedClient.name}.
                    </p>
                    {portalError ? <p className="text-xs font-bold text-red-600">{portalError}</p> : null}
                    <div className="flex gap-2">
                      <button className="btn-primary flex-1" type="submit" disabled={creatingUser}>
                        <UserPlus size={18} /> {creatingUser ? 'Enviando...' : 'Enviar invitación'}
                      </button>
                      <button className="btn-secondary !px-3" type="button" onClick={() => { setShowPortalForm(false); setPortalError('') }}>
                        Cancelar
                      </button>
                    </div>
                  </form>
                ) : (
                  <button className="btn-secondary mt-2 w-full" type="button" onClick={() => { setShowPortalForm(true); setPortalMsg('') }}>
                    <UserPlus size={18} /> Invitar usuario de portal
                  </button>
                )}
              </div>
            ) : null}

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
