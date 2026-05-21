import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, CheckCircle2, ChevronLeft, ChevronRight, Edit2, PackagePlus, Plus, Save, Trash2 } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'
import { formatNumber } from '../lib/format'
import { cleanProductName, displayLotCode, packageLabel } from '../lib/display'
import { compressImageFile } from '../lib/image'

const internalLocations = ['Nave 1', 'Nave 2', 'Nave 3', 'Playa']

const initialForm = {
  lot_code: '',
  client_id: '',
  product: '',
  driver_name: '',
  driver_document: '',
  vehicle_plate: '',
  box_count: '',
  units_per_box: '',
  loose_units: '',
  package_size: '',
  package_unit: 'lt',
  location: '',
  expiry_date: '',
  notes: '',
}

function createOperatorLotCode(index = 0) {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  return index ? `ING-${stamp}-${index + 1}` : `ING-${stamp}`
}

function entryPackageCount(item) {
  return Number(item.box_count || 0) * Number(item.units_per_box || 0) + Number(item.loose_units || 0)
}

function entryPackageBreakdown(item) {
  const boxes = Number(item.box_count || 0)
  const unitsPerBox = Number(item.units_per_box || 0)
  const looseUnits = Number(item.loose_units || 0)
  const boxText = boxes > 0 ? `${formatNumber(boxes)} cajas x ${formatNumber(unitsPerBox)} env.` : 'Sin cajas'
  const looseText = looseUnits > 0 ? `${formatNumber(looseUnits)} sueltos` : '0 sueltos'
  return `${boxText} + ${looseText}`
}

export default function OperatorEntry() {
  const navigate = useNavigate()
  const { user, isOperator } = useAuth()
  const [clients, setClients] = useState([])
  const [form, setForm] = useState(initialForm)
  const [entryItems, setEntryItems] = useState([])
  const [editingEntryId, setEditingEntryId] = useState('')
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
  const totalEntryPackages = useMemo(() => entryPackageCount(form), [form.box_count, form.units_per_box, form.loose_units])
  const equivalent = useMemo(() => totalEntryPackages * Number(form.package_size || 0), [totalEntryPackages, form.package_size])
  const today = new Date().toISOString().slice(0, 10)

  async function selectPhoto(file) {
    if (!file) return
    const compressed = await compressImageFile(file)
    setPhotoFile(compressed)
    setPhotoPreview(URL.createObjectURL(compressed))
  }

  function validateStep(currentStep) {
    setError('')

    if (currentStep === 1) {
      if (!form.client_id) return 'Selecciona el cliente.'
      if (!form.driver_name.trim()) return 'Escribe el nombre del chofer.'
      if (!form.driver_document.trim()) return 'Escribe el numero de identidad del chofer.'
      if (!form.vehicle_plate.trim()) return 'Escribe la placa del vehiculo.'
    }

    if (currentStep === 2) {
      if (entryItems.length === 0) return 'Agrega al menos un producto a la lista.'
    }

    return ''
  }

  function validateEntryProduct() {
    if (!form.product.trim()) return 'Escribe el producto.'
    if (Number(form.box_count || 0) < 0) return 'La cantidad de cajas no puede ser negativa.'
    if (Number(form.box_count || 0) > 0 && Number(form.units_per_box || 0) <= 0) return 'Escribe cuantos envases vienen por caja.'
    if (Number(form.loose_units || 0) < 0) return 'Los envases sueltos no pueden ser negativos.'
    if (entryPackageCount(form) <= 0) return 'Registra envases por caja o envases sueltos para calcular el stock.'
    if (!form.location) return 'Selecciona la ubicacion.'
    return ''
  }

  function addEntryProduct() {
    const productError = validateEntryProduct()
    if (productError) {
      setError(productError)
      return
    }

    const nextItem = {
      id: editingEntryId || crypto.randomUUID(),
      lot_code: form.lot_code.trim(),
      product: form.product.trim(),
      box_count: form.box_count,
      units_per_box: form.units_per_box,
      loose_units: form.loose_units,
      package_count: entryPackageCount(form),
      package_size: form.package_size,
      package_unit: form.package_unit,
      location: form.location,
      expiry_date: form.expiry_date,
    }

    setError('')
    setEntryItems((items) =>
      editingEntryId ? items.map((item) => (item.id === editingEntryId ? nextItem : item)) : [...items, nextItem],
    )
    setEditingEntryId('')
    setForm((value) => ({
      ...value,
      lot_code: '',
      product: '',
      box_count: '',
      units_per_box: '',
      loose_units: '',
      package_size: '',
      expiry_date: '',
    }))
  }

  function removeEntryProduct(id) {
    setEntryItems((items) => items.filter((item) => item.id !== id))
    if (editingEntryId === id) setEditingEntryId('')
  }

  function editEntryProduct(item) {
    setEditingEntryId(item.id)
    setForm((value) => ({
      ...value,
      lot_code: item.lot_code,
      product: item.product,
      box_count: item.box_count,
      units_per_box: item.units_per_box,
      loose_units: item.loose_units,
      package_size: item.package_size,
      package_unit: item.package_unit,
      location: item.location,
      expiry_date: item.expiry_date,
    }))
    setError('')
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

    const entryNotes = [
      'Nuevo ingreso desde almacen.',
      `Chofer: ${form.driver_name.trim()}`,
      `CI chofer: ${form.driver_document.trim()}`,
      `Placa: ${form.vehicle_plate.trim()}`,
      form.notes || null,
    ]
      .filter(Boolean)
      .join(' | ')

    setSaving(true)

    try {
      const photoUrl = await uploadPhoto(createOperatorLotCode())
      const emailItems = []

      for (const [index, item] of entryItems.entries()) {
        const lotCode = item.lot_code || createOperatorLotCode(index)
        const boxCount = Number(item.box_count || 0)
        const unitsPerBox = Number(item.units_per_box || 0)
        const looseUnits = Number(item.loose_units || 0)
        const packageCount = entryPackageCount(item)
        const packageSize = Number(item.package_size || 0)
        const { error: rpcError } = await supabase.rpc('create_lot_entry', {
          p_lot_code: lotCode,
          p_client_id: form.client_id,
          p_product: item.product,
          p_box_count: boxCount,
          p_units_per_box: unitsPerBox,
          p_loose_units: looseUnits,
          p_package_size: packageSize > 0 ? packageSize : null,
          p_package_unit: packageSize > 0 ? item.package_unit : null,
          p_location: item.location,
          p_entry_date: today,
          p_expiry_date: item.expiry_date || null,
          p_photo_url: photoUrl,
          p_notes: entryNotes,
          p_user_id: user.id,
        })

        if (rpcError) throw rpcError

        emailItems.push({
          lot_code: displayLotCode(lotCode),
          product: cleanProductName(item.product),
          box_count: boxCount,
          units_per_box: unitsPerBox,
          loose_units: looseUnits,
          quantity: packageCount,
          previous_quantity: 0,
          new_quantity: packageCount,
          location: item.location,
          package_size: packageSize > 0 ? packageSize : null,
          package_unit: packageSize > 0 ? item.package_unit : null,
        })
      }

      const { error: emailError } = await supabase.functions.invoke('send-movement-email', {
        body: {
          to: 'hgarayd@outlook.com',
          movement_type: 'entrada',
          notes: form.notes || null,
          driver_name: form.driver_name.trim(),
          driver_document: form.driver_document.trim(),
          vehicle_plate: form.vehicle_plate.trim(),
          client: selectedClient?.name || 'Sin cliente',
          user_email: user.email,
          items: emailItems,
        },
      })

      setStatus(
        emailError
          ? 'Ingreso creado. Falta configurar o revisar el envio automatico de correo.'
          : 'Ingreso creado y correo enviado a oficina.',
      )

      setTimeout(() => {
        navigate(isOperator ? '/operacion' : '/')
      }, 900)
    } catch (entryError) {
      setError(entryError.message?.includes('duplicate') ? 'Uno de los ID de lote ya existe. Corrigelo antes de confirmar.' : entryError.message)
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
          <StepBadge active={step === 2} done={step > 2} label="Productos" />
          <StepBadge active={step === 3} done={false} label="Foto y revisar" />
        </div>
      </section>

      <form className="panel grid gap-3 sm:grid-cols-2" onSubmit={(event) => event.preventDefault()}>
        {step === 1 ? (
          <>
            <div className="sm:col-span-2 rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">
              Paso 1: selecciona el cliente y los datos del transporte.
            </div>
            <Field label="Cliente">
              <select className="input" value={form.client_id} onChange={(event) => setForm({ ...form, client_id: event.target.value })} required>
                <option value="">Seleccionar cliente</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Nombre del chofer">
              <input className="input" autoComplete="off" value={form.driver_name} onChange={(event) => setForm({ ...form, driver_name: event.target.value })} required />
            </Field>
            <Field label="Numero de identidad">
              <input className="input" autoComplete="off" value={form.driver_document} onChange={(event) => setForm({ ...form, driver_document: event.target.value })} required />
            </Field>
            <Field label="Placa del vehiculo">
              <input className="input uppercase" autoComplete="off" value={form.vehicle_plate} onChange={(event) => setForm({ ...form, vehicle_plate: event.target.value.toUpperCase() })} required />
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
              Paso 2: agrega cada producto que llega en este ingreso.
            </div>
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
            <Field label="Cantidad de cajas">
              <input
                className="input"
                inputMode="decimal"
                type="text"
                value={form.box_count}
                onChange={(event) => {
                  const value = event.target.value.replace(',', '.')
                  if (/^\d*\.?\d*$/.test(value)) setForm({ ...form, box_count: value })
                }}
                onWheel={(event) => event.currentTarget.blur()}
                placeholder="0 si llega suelto"
              />
            </Field>
            <Field label="Envases por caja">
              <input
                className="input"
                inputMode="decimal"
                type="text"
                value={form.units_per_box}
                onChange={(event) => {
                  const value = event.target.value.replace(',', '.')
                  if (/^\d*\.?\d*$/.test(value)) setForm({ ...form, units_per_box: value })
                }}
                onWheel={(event) => event.currentTarget.blur()}
                placeholder="Ej. 12"
              />
            </Field>
            <Field label="Envases sueltos">
              <input
                className="input"
                inputMode="decimal"
                type="text"
                value={form.loose_units}
                onChange={(event) => {
                  const value = event.target.value.replace(',', '.')
                  if (/^\d*\.?\d*$/.test(value)) setForm({ ...form, loose_units: value })
                }}
                onWheel={(event) => event.currentTarget.blur()}
                placeholder="Opcional"
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
            <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
              <div className="rounded-lg bg-campo-50 p-3">
                <p className="text-xs font-semibold uppercase text-campo-700">Envases totales</p>
                <p className="mt-1 text-2xl font-black text-campo-800">{formatNumber(totalEntryPackages)} env.</p>
                <p className="mt-1 text-xs font-semibold text-campo-700">{entryPackageBreakdown(form)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase text-slate-500">Equivalente</p>
                <p className="mt-1 text-2xl font-black text-slate-950">
                  {formatNumber(equivalent)} {form.package_unit}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-500">Envases totales x presentacion.</p>
              </div>
            </div>
            <button className="btn-primary sm:col-span-2" type="button" onClick={addEntryProduct}>
              {editingEntryId ? <Save size={20} /> : <Plus size={20} />}
              {editingEntryId ? 'Guardar cambios del producto' : 'Agregar producto a la lista'}
            </button>
            <div className="sm:col-span-2 rounded-lg bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-black text-slate-950">Productos del ingreso</p>
                <span className="text-xs font-bold text-slate-500">{entryItems.length} agregado{entryItems.length === 1 ? '' : 's'}</span>
              </div>
              {entryItems.length === 0 ? (
                <p className="text-sm font-semibold text-slate-500">Agrega el primer producto para continuar.</p>
              ) : (
                <div className="space-y-2">
                  {entryItems.map((item) => (
                    <div key={item.id} className="flex items-start justify-between gap-2 rounded-lg bg-white p-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-start gap-2">
                          <p className="min-w-0 flex-1 text-base font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(item.product)}</p>
                          <span className="rounded-lg bg-campo-50 px-2 py-1 text-sm font-black text-campo-800">
                            {formatNumber(item.box_count)} cajas
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-slate-500">
                          {item.lot_code ? displayLotCode(item.lot_code) : 'ID automatico'} - {item.location}
                        </p>
                        <p className="text-xs font-bold text-slate-600">
                          Presentacion: {packageLabel(item) || 'Sin dato'}
                          {' - '}{entryPackageBreakdown(item)}
                        </p>
                        <p className="text-xs font-bold text-campo-700">
                          Total: {formatNumber(item.package_count)} env. - Equiv.: {formatNumber(Number(item.package_count || 0) * Number(item.package_size || 0))} {item.package_unit}
                        </p>
                      </div>
                      <div className="grid gap-1">
                        <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={() => editEntryProduct(item)} title="Editar producto">
                          <Edit2 size={17} />
                        </button>
                        <button className="btn-secondary !min-h-10 !px-3" type="button" onClick={() => removeEntryProduct(item.id)} title="Quitar producto">
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
              <p>Chofer: {form.driver_name || '-'}</p>
              <p>CI chofer: {form.driver_document || '-'}</p>
              <p>Placa: {form.vehicle_plate || '-'}</p>
              <p>Productos: {entryItems.length}</p>
              <div className="mt-2 space-y-2">
                {entryItems.map((item) => (
                  <div key={item.id} className="rounded-lg bg-white p-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(item.product)}</p>
                      <p className="rounded-lg bg-campo-50 px-2 py-1 font-black text-campo-800">{formatNumber(item.box_count)} cajas</p>
                    </div>
                    <p className="text-xs text-slate-500">
                      Presentacion: {packageLabel(item) || 'Sin dato'} - {entryPackageBreakdown(item)}
                    </p>
                    <p className="text-xs text-slate-500">
                      Total: {formatNumber(item.package_count)} env. - Equiv.: {formatNumber(Number(item.package_count || 0) * Number(item.package_size || 0))} {item.package_unit} - {item.location}
                    </p>
                    <p className="text-xs text-slate-500">Vence: {item.expiry_date || 'Sin dato'}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {error ? <div className="rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700 sm:col-span-2">{error}</div> : null}
        {status ? <div className="rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700 sm:col-span-2">{status}</div> : null}

        <div className="grid grid-cols-2 gap-2 sm:col-span-2">
          <button
            className="btn-secondary"
            type="button"
            onClick={() => {
              if (step === 1) {
                navigate(-1)
                return
              }
              setStep((value) => Math.max(value - 1, 1))
            }}
            disabled={saving}
          >
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
              Vas a ingresar {entryItems.length} producto{entryItems.length === 1 ? '' : 's'} para {selectedClient?.name || 'cliente'}.
            </p>
            <div className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-700">
              <div className="flex justify-between gap-3"><span>Chofer</span><span>{form.driver_name}</span></div>
              <div className="flex justify-between gap-3"><span>CI chofer</span><span>{form.driver_document}</span></div>
              <div className="flex justify-between gap-3"><span>Placa</span><span>{form.vehicle_plate}</span></div>
              <div className="flex justify-between gap-3"><span>Foto</span><span>{photoFile ? 'Adjunta' : 'Sin foto'}</span></div>
              {entryItems.map((item) => (
                <div key={item.id} className="rounded-lg bg-white p-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(item.product)}</p>
                    <p className="rounded-lg bg-campo-50 px-2 py-1 font-black text-campo-800">{formatNumber(item.box_count)} cajas</p>
                  </div>
                  <p className="text-xs text-slate-500">
                    Presentacion: {packageLabel(item) || 'Sin dato'} - {entryPackageBreakdown(item)}
                  </p>
                  <p className="text-xs text-slate-500">
                    Total: {formatNumber(item.package_count)} env. - {item.location} - vence {item.expiry_date || 'Sin dato'}
                  </p>
                </div>
              ))}
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
