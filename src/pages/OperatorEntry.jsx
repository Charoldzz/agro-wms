import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PackagePlus, Save } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'
import { formatNumber } from '../lib/format'
import { cleanProductName, displayLotCode } from '../lib/display'

const internalLocations = ['Nave 1', 'Nave 2', 'Nave 3', 'Playa']

const initialForm = {
  lot_code: '',
  client_id: '',
  product: '',
  package_count: '',
  package_size: '',
  package_unit: 'lt',
  location: '',
  expiry_date: '',
  notes: '',
}

function createOperatorLotCode() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  return `ING-${stamp}`
}

export default function OperatorEntry() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [clients, setClients] = useState([])
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadClients()
  }, [])

  async function loadClients() {
    const { data } = await supabase.from('clients').select('id, name, contact').order('name')
    setClients(data || [])
  }

  const selectedClient = clients.find((client) => client.id === form.client_id)
  const equivalent = useMemo(() => {
    return Number(form.package_count || 0) * Number(form.package_size || 0)
  }, [form.package_count, form.package_size])
  const today = new Date().toISOString().slice(0, 10)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setStatus('')

    const lotCode = form.lot_code.trim() || createOperatorLotCode()
    const packageCount = Number(form.package_count || 0)
    const packageSize = Number(form.package_size || 0)

    if (!form.client_id) {
      setError('Selecciona el cliente.')
      return
    }

    if (!form.product.trim()) {
      setError('Escribe el producto.')
      return
    }

    if (packageCount <= 0) {
      setError('La cantidad de envases debe ser mayor a cero.')
      return
    }

    if (!form.location) {
      setError('Selecciona la ubicacion.')
      return
    }

    setSaving(true)

    const { data: lotId, error: rpcError } = await supabase.rpc('create_lot_entry', {
      p_lot_code: lotCode,
      p_client_id: form.client_id,
      p_product: form.product.trim(),
      p_quantity: packageCount,
      p_package_size: packageSize > 0 ? packageSize : null,
      p_package_unit: packageSize > 0 ? form.package_unit : null,
      p_location: form.location,
      p_entry_date: today,
      p_expiry_date: form.expiry_date || null,
      p_notes: form.notes || null,
      p_user_id: user.id,
    })

    if (rpcError) {
      setError(rpcError.message.includes('duplicate') ? 'Ese ID de lote ya existe. Usa otro ID.' : rpcError.message)
      setSaving(false)
      return
    }

    const { error: emailError } = await supabase.functions.invoke('send-movement-email', {
      body: {
        to: 'hgarayd@outlook.com',
        movement_type: 'entrada',
        quantity: packageCount,
        previous_quantity: 0,
        new_quantity: packageCount,
        notes: form.notes ? `Nuevo ingreso desde almacen. ${form.notes}` : 'Nuevo ingreso desde almacen.',
        lot_code: displayLotCode(lotCode),
        product: cleanProductName(form.product),
        client: selectedClient?.name || 'Sin cliente',
        location: form.location,
        user_email: user.email,
      },
    })

    setStatus(
      emailError
        ? 'Lote creado. Falta configurar o revisar el envio automatico de correo.'
        : 'Lote creado y correo enviado a oficina.',
    )
    setSaving(false)

    setTimeout(() => {
      navigate(`/lotes/${lotId}`)
    }, 900)
  }

  return (
    <div>
      <PageHeader title="Nuevo ingreso" subtitle="Registrar mercaderia nueva en almacen" />

      <form className="panel grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit}>
        <div className="sm:col-span-2 rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">
          El lote se crea con stock inicial y queda registrado como entrada en la auditoria.
        </div>

        <Field label="Cliente">
          <select className="input" value={form.client_id} onChange={(event) => setForm({ ...form, client_id: event.target.value })} required>
            <option value="">Seleccionar cliente</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
        </Field>

        <Field label="ID lote">
          <input
            className="input"
            value={form.lot_code}
            onChange={(event) => setForm({ ...form, lot_code: event.target.value })}
            placeholder="Opcional, se genera solo"
          />
        </Field>

        <Field label="Producto">
          <input className="input" value={form.product} onChange={(event) => setForm({ ...form, product: event.target.value })} required />
        </Field>

        <Field label="Cantidad de envases">
          <input
            className="input"
            inputMode="decimal"
            type="text"
            value={form.package_count}
            onChange={(event) => {
              const value = event.target.value.replace(',', '.')
              if (/^\d*\.?\d*$/.test(value)) setForm({ ...form, package_count: value })
            }}
            onWheel={(event) => event.currentTarget.blur()}
            required
          />
        </Field>

        <Field label="Tamano presentacion">
          <input
            className="input"
            inputMode="decimal"
            type="text"
            value={form.package_size}
            onChange={(event) => {
              const value = event.target.value.replace(',', '.')
              if (/^\d*\.?\d*$/.test(value)) setForm({ ...form, package_size: value })
            }}
            onWheel={(event) => event.currentTarget.blur()}
            placeholder="Ej. 5, 20"
          />
        </Field>

        <Field label="Unidad">
          <select className="input" value={form.package_unit} onChange={(event) => setForm({ ...form, package_unit: event.target.value })}>
            <option value="gr">Gramos</option>
            <option value="kg">Kilos</option>
            <option value="ml">Mililitros</option>
            <option value="lt">Litros</option>
            <option value="un">Unidades</option>
          </select>
        </Field>

        <Field label="Ubicacion">
          <select className="input" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} required>
            <option value="">Seleccionar ubicacion</option>
            {internalLocations.map((location) => (
              <option key={location} value={location}>{location}</option>
            ))}
          </select>
        </Field>

        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">Fecha ingreso</p>
          <p className="mt-1 text-lg font-black text-slate-950">{today}</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">Automatica, no editable</p>
        </div>

        <Field label="Fecha vencimiento">
          <input className="input" type="date" value={form.expiry_date} onChange={(event) => setForm({ ...form, expiry_date: event.target.value })} />
        </Field>

        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">Equivalente</p>
          <p className="mt-1 text-2xl font-black text-slate-950">
            {formatNumber(equivalent)} {form.package_unit}
          </p>
        </div>

        <label className="block sm:col-span-2">
          <span className="label">Observaciones</span>
          <textarea className="input mt-1" rows="3" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>

        {error ? <div className="rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700 sm:col-span-2">{error}</div> : null}
        {status ? <div className="rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700 sm:col-span-2">{status}</div> : null}

        <button className="btn-primary sm:col-span-2" disabled={saving}>
          {saving ? <PackagePlus size={20} /> : <Save size={20} />}
          {saving ? 'Creando ingreso...' : 'Crear lote e ingreso'}
        </button>
      </form>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
