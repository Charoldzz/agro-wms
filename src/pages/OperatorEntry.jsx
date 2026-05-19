import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, CheckCircle2, ChevronLeft, ChevronRight, PackagePlus, Save } from 'lucide-react'
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
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState('')
  const [step, setStep] = useState(1)
  const [confirming, setConfirming] = useState(false)
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

  function selectPhoto(file) {
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  function validateStep(currentStep) {
    setError('')

    if (currentStep === 1) {
      if (!form.client_id) return 'Selecciona el cliente.'
      if (!form.product.trim()) return 'Escribe el producto.'
    }

    if (currentStep === 2) {
      if (Number(form.package_count || 0) <= 0) return 'La cantidad de envases debe ser mayor a cero.'
      if (!form.location) return 'Selecciona la ubicacion.'
    }

    return ''
  }

  function goNext() {
    const validationError = validateStep(step)
    if (validationError) {
      setError(validationError)
      return
    }
    setStep((value) => Math.min(value + 1, 3))
  }

  async function uploadPhoto(lotCode) {
    if (!photoFile) return null

    const extension = photoFile.name.split('.').pop() || 'jpg'
    const path = `${lotCode}-${Date.now()}.${extension}`
    const { error: uploadError } = await supabase.storage.from('lot-photos').upload(path, photoFile, {
      cacheControl: '3600',
      upsert: false,
    })

    if (uploadError) throw uploadError

    const { data } = supabase.storage.from('lot-photos').getPublicUrl(path)
    return data.publicUrl
  }

  async function createEntry() {
    setError('')
    setStatus('')

    const firstStepError = validateStep(1)
    const secondStepError = validateStep(2)
    if (firstStepError || secondStepError) {
      setError(firstStepError || secondStepError)
      setConfirming(false)
      return
    }

    const lotCode = form.lot_code.trim() || createOperatorLotCode()
    const packageCount = Number(form.package_count || 0)
    const packageSize = Number(form.package_size || 0)

    setSaving(true)

    try {
      const photoUrl = await uploadPhoto(lotCode)
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
        p_photo_url: photoUrl,
        p_notes: form.notes || null,
        p_user_id: user.id,
      })

      if (rpcError) throw rpcError

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

      setTimeout(() => {
        navigate(`/lotes/${lotId}`)
      }, 900)
    } catch (entryError) {
      setError(entryError.message?.includes('duplicate') ? 'Ese ID de lote ya existe. Usa otro ID.' : entryError.message)
      setSaving(false)
      setConfirming(false)
    }
  }

  return (
    <div>
      <PageHeader title="Nuevo ingreso" subtitle="Registrar mercaderia nueva en almacen" />

      <section className="panel mb-4">
        <div className="grid grid-cols-3 gap-2 text-center text-xs font-bold">
          <StepBadge active={step === 1} done={step > 1} label="Cliente" />
          <StepBadge active={step === 2} done={step > 2} label="Cantidad" />
          <StepBadge active={step === 3} done={false} label="Foto y revisar" />
        </div>
      </section>

      <form className="panel grid gap-3 sm:grid-cols-2" onSubmit={(event) => event.preventDefault()}>
        {step === 1 ? (
          <>
            <div className="sm:col-span-2 rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">
              Paso 1: selecciona el cliente y registra el producto.
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
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase text-slate-500">Fecha ingreso</p>
              <p className="mt-1 text-lg font-black text-slate-950">{today}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">Automatica, no editable</p>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div className="sm:col-span-2 rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">
              Paso 2: registra envases, presentacion, ubicacion y vencimiento.
            </div>
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
            <Field label="Fecha vencimiento">
              <input className="input" type="date" value={form.expiry_date} onChange={(event) => setForm({ ...form, expiry_date: event.target.value })} />
            </Field>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase text-slate-500">Equivalente</p>
              <p className="mt-1 text-2xl font-black text-slate-950">
                {formatNumber(equivalent)} {form.package_unit}
              </p>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <div className="sm:col-span-2 rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">
              Paso 3: agrega foto si corresponde y revisa antes de confirmar.
            </div>
            <label className="block sm:col-span-2">
              <span className="label">Foto del ingreso</span>
              <div className="mt-1 grid gap-3">
                {photoPreview ? (
                  <img className="h-48 w-full rounded-lg object-cover" src={photoPreview} alt="Ingreso" />
                ) : null}
                <input className="hidden" id="entry-photo" type="file" accept="image/*" capture="environment" onChange={(event) => selectPhoto(event.target.files?.[0])} />
                <label className="btn-secondary w-full cursor-pointer" htmlFor="entry-photo">
                  <Camera size={20} /> Tomar o elegir foto
                </label>
              </div>
            </label>
            <label className="block sm:col-span-2">
              <span className="label">Observaciones</span>
              <textarea className="input mt-1" rows="3" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </label>
            <div className="sm:col-span-2 rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-700">
              <p>Cliente: {selectedClient?.name || '-'}</p>
              <p>Producto: {form.product || '-'}</p>
              <p>Envases: {formatNumber(form.package_count)}</p>
              <p>Equivalente: {formatNumber(equivalent)} {form.package_unit}</p>
              <p>Ubicacion: {form.location || '-'}</p>
              <p>Vencimiento: {form.expiry_date || 'Sin dato'}</p>
            </div>
          </>
        ) : null}

        {error ? <div className="rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700 sm:col-span-2">{error}</div> : null}
        {status ? <div className="rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700 sm:col-span-2">{status}</div> : null}

        <div className="grid grid-cols-2 gap-2 sm:col-span-2">
          <button className="btn-secondary" type="button" onClick={() => setStep((value) => Math.max(value - 1, 1))} disabled={step === 1 || saving}>
            <ChevronLeft size={20} /> Atras
          </button>
          {step < 3 ? (
            <button className="btn-primary" type="button" onClick={goNext}>
              Siguiente <ChevronRight size={20} />
            </button>
          ) : (
            <button className="btn-primary" type="button" onClick={() => setConfirming(true)} disabled={saving}>
              <Save size={20} /> Revisar ingreso
            </button>
          )}
        </div>
      </form>

      {confirming ? (
        <div className="fixed inset-0 z-40 flex items-end bg-slate-950/45 p-4 sm:items-center sm:justify-center">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
            <h3 className="text-xl font-bold text-slate-950">Confirmar nuevo ingreso</h3>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              Vas a ingresar {formatNumber(form.package_count)} envases de {cleanProductName(form.product)} para {selectedClient?.name || 'cliente'}.
            </p>
            <div className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-700">
              <div className="flex justify-between gap-3"><span>Ubicacion</span><span>{form.location}</span></div>
              <div className="flex justify-between gap-3"><span>Equivalente</span><span>{formatNumber(equivalent)} {form.package_unit}</span></div>
              <div className="flex justify-between gap-3"><span>Vencimiento</span><span>{form.expiry_date || 'Sin dato'}</span></div>
              <div className="flex justify-between gap-3"><span>Foto</span><span>{photoFile ? 'Adjunta' : 'Sin foto'}</span></div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button className="btn-secondary w-full" type="button" onClick={() => setConfirming(false)} disabled={saving}>
                Cancelar
              </button>
              <button className="btn-primary w-full" type="button" onClick={createEntry} disabled={saving}>
                {saving ? <PackagePlus size={20} /> : <CheckCircle2 size={20} />}
                {saving ? 'Guardando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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

function StepBadge({ active, done, label }) {
  return (
    <div className={`rounded-lg px-2 py-3 ${active ? 'bg-campo-600 text-white' : done ? 'bg-campo-50 text-campo-700' : 'bg-slate-50 text-slate-500'}`}>
      {label}
    </div>
  )
}
