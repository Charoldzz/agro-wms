import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, CheckCircle2, ChevronLeft, ChevronRight, PackagePlus, Plus, Save } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import ListProductCard from '../components/ListProductCard'
import SimpleDateSelect from '../components/SimpleDateSelect'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'
import { formatNumber } from '../lib/format'
import { cleanProductName, displayLotCode, packageLabel } from '../lib/display'
import { vibrateSuccess } from '../lib/haptics'
import { compressImageFile } from '../lib/image'
import ConfirmChecks, { allConfirmChecksDone, emptyConfirmChecks } from '../components/ConfirmChecks'
import { clearDraft, readDraft, writeDraft } from '../lib/drafts'
import { internalLocations } from '../lib/locations'

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
const ENTRY_DRAFT_KEY = 'todo-agricola-operator-entry-draft'

function displayClientName(name) {
  return String(name || '').replaceAll('"', '').replace(/\s+/g, ' ').trim()
}

function clientNameKey(name) {
  return displayClientName(name).toLocaleLowerCase('es-BO')
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
  const pieces = []
  if (boxes > 0) pieces.push(`${formatNumber(unitsPerBox)} env x caja`)
  if (looseUnits > 0) pieces.push(`${formatNumber(looseUnits)} env sueltos`)
  return pieces.join(' - ') || 'Sin empaque'
}

function isMissingOperationRpc(error) {
  return String(error?.message || '').includes('create_entry_operation')
}

export default function OperatorEntry() {
  const navigate = useNavigate()
  const { user, isOperator } = useAuth()
  const [clients, setClients] = useState([])
  const initialDraft = readDraft(ENTRY_DRAFT_KEY, { form: initialForm, entryItems: [], step: 1 })
  const [form, setForm] = useState(initialDraft.form)
  const [entryItems, setEntryItems] = useState(initialDraft.entryItems)
  const [editingEntryId, setEditingEntryId] = useState('')
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState('')
  const [step, setStep] = useState(initialDraft.step)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [entrySuccess, setEntrySuccess] = useState(null)
  const [confirmChecks, setConfirmChecks] = useState(emptyConfirmChecks())
  const [guidePreview, setGuidePreview] = useState('TAB---')

  useEffect(() => {
    loadClients()
    loadGuidePreview()
  }, [])

  useEffect(() => {
    writeDraft(ENTRY_DRAFT_KEY, { form, entryItems, step })
  }, [form, entryItems, step])

  async function loadClients() {
    const { data } = await supabase
      .from('clients')
      .select('id, name, contact, solucion_codigo')
      .not('solucion_codigo', 'is', null)
      .neq('solucion_codigo', 0)
      .order('name')
    const uniqueClients = []
    const seenNames = new Set()

    ;(data || []).forEach((client) => {
      const key = clientNameKey(client.name)
      if (!key || seenNames.has(key)) return
      seenNames.add(key)
      uniqueClients.push(client)
    })

    setClients(uniqueClients)
  }

  async function loadGuidePreview() {
    const { data } = await supabase.rpc('preview_next_warehouse_guide')
    if (data) setGuidePreview(data)
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

  function goToStep(targetStep) {
    if (targetStep === step) return

    if (targetStep > 1) {
      const firstStepError = validateStep(1)
      if (firstStepError) {
        setError(firstStepError)
        setStep(1)
        return
      }
    }

    if (targetStep > 2) {
      const secondStepError = validateStep(2)
      if (secondStepError) {
        setError(secondStepError)
        setStep(2)
        return
      }
    }

    setError('')
    setStep(targetStep)
  }

  function reviewEntry() {
    const firstStepError = validateStep(1)
    const secondStepError = validateStep(2)
    if (firstStepError || secondStepError) {
      setError(firstStepError || secondStepError)
      setStep(firstStepError ? 1 : 2)
      return
    }

    setError('')
    setConfirmChecks(emptyConfirmChecks())
    setConfirming(true)
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
    if (saving) return

    setError('')
    setStatus('')

    const firstStepError = validateStep(1)
    const secondStepError = validateStep(2)
    if (firstStepError || secondStepError) {
      setError(firstStepError || secondStepError)
      setConfirming(false)
      return
    }

    setSaving(true)

    try {
      const photoUrl = await uploadPhoto(createOperatorLotCode())
      const operationItems = entryItems.map((item, index) => ({
        lot_code: item.lot_code || createOperatorLotCode(index),
        product: item.product,
        box_count: Number(item.box_count || 0),
        units_per_box: Number(item.units_per_box || 0),
        loose_units: Number(item.loose_units || 0),
        package_size: Number(item.package_size || 0) > 0 ? Number(item.package_size) : null,
        package_unit: Number(item.package_size || 0) > 0 ? item.package_unit : null,
        location: item.location,
        expiry_date: item.expiry_date || null,
      }))
      const { data: operation, error: operationError } = await supabase.rpc('create_entry_operation', {
        p_client_id: form.client_id,
        p_driver_name: form.driver_name.trim(),
        p_driver_document: form.driver_document.trim(),
        p_vehicle_plate: form.vehicle_plate.trim(),
        p_entry_date: today,
        p_photo_url: photoUrl,
        p_notes: form.notes || null,
        p_items: operationItems,
        p_user_id: user.id,
      })

      if (operationError) {
        if (isMissingOperationRpc(operationError)) {
          throw new Error('Falta actualizar Supabase con operaciones de almacen. Ejecuta supabase/warehouse_operations.sql para habilitar ingresos por operacion.')
        }
        throw operationError
      }

      const emailItems = operationItems.map((item) => {
        const lotCode = item.lot_code
        const boxCount = Number(item.box_count || 0)
        const unitsPerBox = Number(item.units_per_box || 0)
        const looseUnits = Number(item.loose_units || 0)
        const packageCount = entryPackageCount(item)
        const packageSize = Number(item.package_size || 0)

        return {
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
        }
      })

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

      vibrateSuccess()
      clearDraft(ENTRY_DRAFT_KEY)
      setConfirming(false)
      setEntrySuccess({
        products: entryItems.length,
        client: selectedClient?.name || 'cliente',
        operationCode: operation?.operation_code || null,
        guideNumber: operation?.guide_number || guidePreview,
        emailError: Boolean(emailError),
      })
      setStatus(
        emailError
          ? 'Ingreso creado. Falta configurar o revisar el envio automatico de correo.'
          : 'Ingreso creado y correo enviado a oficina.',
      )
      setTimeout(() => {
        navigate(isOperator ? '/operacion' : '/')
      }, 2600)
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
          <StepBadge active={step === 1} done={step > 1} label="Cliente" onClick={() => goToStep(1)} />
          <StepBadge active={step === 2} done={step > 2} label="Productos" onClick={() => goToStep(2)} />
          <StepBadge active={step === 3} done={false} label="Foto y revisar" onClick={() => goToStep(3)} />
        </div>
      </section>

      <form className="panel grid gap-3 sm:grid-cols-2" onSubmit={(event) => event.preventDefault()}>
        {step === 1 ? (
          <>
            <div className="sm:col-span-2 rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">
              Paso 1: selecciona el cliente y los datos del transporte.
            </div>
            <Field label="Nº guía">
              <input className="input bg-slate-100 font-black text-slate-700" value={guidePreview} readOnly />
              <span className="mt-1 block text-xs font-semibold text-slate-500">Se asigna automaticamente al guardar la operacion.</span>
            </Field>
            <Field label="Cliente">
              <select className="input" value={form.client_id} onChange={(event) => setForm({ ...form, client_id: event.target.value })} required>
                <option value="">Seleccionar cliente</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{displayClientName(client.name)}</option>
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
            <Field label="Tamaño presentación">
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
            <Field label="Ubicación">
              <select className="input" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} required>
                <option value="">Seleccionar ubicación</option>
                {internalLocations.map((location) => (
                  <option key={location} value={location}>{location}</option>
                ))}
              </select>
            </Field>
            <Field label="Vencimiento del producto" hint="Selecciona día, mes y año. Si el producto no vence, déjalo como sin vencimiento.">
              <SimpleDateSelect
                value={form.expiry_date}
                onChange={(value) => setForm({ ...form, expiry_date: value })}
                clearLabel="Sin vencimiento"
                previewLabel="Vence"
              />
            </Field>
            <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
              <div className="rounded-lg bg-campo-50 p-3">
                <p className="text-xs font-semibold uppercase text-campo-700">Envases totales</p>
                <p className="mt-1 text-2xl font-black text-campo-800">{formatNumber(totalEntryPackages)} env.</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase text-slate-500">Equivalente</p>
                <p className="mt-1 text-2xl font-black text-slate-950">
                  {formatNumber(equivalent)} {form.package_unit}
                </p>
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
                    <EntryItemCard
                      key={item.id}
                      item={item}
                      onEdit={editEntryProduct}
                      onRemove={removeEntryProduct}
                    />
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
        {status ? (
          <div className="rounded-lg border border-campo-100 bg-campo-50 p-4 text-sm font-bold text-campo-800 sm:col-span-2" role="status" aria-live="polite">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={20} />
              <span>Entrada guardada con exito.</span>
            </div>
            <p className="mt-1 font-semibold">{status}</p>
          </div>
        ) : null}

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
              <button className="btn-primary" type="button" onClick={reviewEntry} disabled={saving}>
              <Save size={20} /> Revisar ingreso
            </button>
          )}
        </div>
      </form>

      {confirming ? (
        <div data-modal-backdrop="true" className="fixed inset-0 z-50 flex items-end bg-slate-950/45 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:items-center sm:justify-center">
          <div role="dialog" aria-modal="true" className="flex max-h-[94dvh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="shrink-0 border-b border-slate-100 p-4">
              <h3 className="text-xl font-bold text-slate-950">Confirmar nuevo ingreso</h3>
              <p className="mt-2 text-sm font-semibold text-slate-500">
                Vas a ingresar {entryItems.length} producto{entryItems.length === 1 ? '' : 's'} para{' '}
                <strong className="font-black text-slate-950">{selectedClient?.name || 'cliente'}</strong>.
              </p>
            </div>
            <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-4 pb-4 [-webkit-overflow-scrolling:touch]">
            <div className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-700">
              <div className="flex justify-between gap-3"><span>Nº guía</span><span>{guidePreview}</span></div>
              <div className="flex justify-between gap-3"><span>Chofer</span><span>{form.driver_name}</span></div>
              <div className="flex justify-between gap-3"><span>CI chofer</span><span>{form.driver_document}</span></div>
              <div className="flex justify-between gap-3"><span>Placa</span><span>{form.vehicle_plate}</span></div>
              <div className="flex justify-between gap-3"><span>Foto</span><span>{photoFile ? 'Adjunta' : 'Sin foto'}</span></div>
              {entryItems.map((item) => (
                <div key={item.id} className="rounded-lg bg-white p-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(item.product)}</p>
                    <div className="rounded-lg bg-campo-50 px-2 py-1 text-right text-campo-800">
                      <p className="font-black">{formatNumber(item.box_count)} cajas</p>
                      <p className="text-xs font-black">{formatNumber(item.package_count)} env.</p>
                      <p className="text-xs font-black text-slate-900">
                        {formatNumber(Number(item.package_count || 0) * Number(item.package_size || 0))} {item.package_unit || ''}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">
                    Cliente: {selectedClient?.name || '-'} - Lote {item.lot_code ? displayLotCode(item.lot_code) : 'automatico'}
                  </p>
                  <p className="text-xs text-slate-500">
                    Presentacion: {packageLabel(item) || 'Sin dato'} - {entryPackageBreakdown(item)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {item.location} - vence {item.expiry_date || 'Sin dato'}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-black">
                    <div className="rounded-lg bg-slate-50 p-2 text-slate-600">
                      <span className="block uppercase text-slate-400">Stock antes</span>
                      <span className="text-slate-950">0 env.</span>
                    </div>
                    <div className="rounded-lg bg-campo-50 p-2 text-campo-800">
                      <span className="block uppercase opacity-70">Stock despues</span>
                      <span>{formatNumber(item.package_count)} env.</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <ConfirmChecks
              checks={confirmChecks}
              onChange={setConfirmChecks}
              items={[
                { key: 'product', label: 'Productos correctos' },
                { key: 'client', label: 'Cliente correcto' },
                { key: 'quantity', label: 'Cantidades correctas' },
              ]}
            />
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-slate-100 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <button className="btn-secondary w-full" type="button" onClick={() => setConfirming(false)} disabled={saving}>
                Cancelar
              </button>
              <button className="btn-primary w-full" type="button" onClick={createEntry} disabled={saving || !allConfirmChecksDone(confirmChecks)}>
                {saving ? <PackagePlus size={20} /> : <CheckCircle2 size={20} />}
                {saving ? 'Guardando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {entrySuccess ? (
        <div data-modal-backdrop="true" className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-campo-700 p-6 text-white">
          <section className="w-full max-w-sm py-8 text-center">
            <span className="mx-auto flex h-40 w-40 items-center justify-center rounded-full border border-white/25 text-white">
              <CheckCircle2 size={118} strokeWidth={1.8} />
            </span>
            <h2 className="mt-5 text-3xl font-black">Ingreso guardado</h2>
            <p className="mt-2 text-2xl font-black text-white">{entrySuccess.guideNumber}</p>
            <p className="mt-2 text-base font-semibold text-campo-50">
              {entrySuccess.products} producto{entrySuccess.products === 1 ? '' : 's'} registrado{entrySuccess.products === 1 ? '' : 's'} para {entrySuccess.client}.
            </p>
            <p className="mt-3 text-sm font-bold text-white/85">
              {entrySuccess.emailError ? 'Ingreso aplicado. Revisa el envio del correo a oficina.' : 'Entrada confirmada y correo enviado a oficina.'}
            </p>
            <button className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-white/20 bg-white/10 px-4 py-3 font-black text-white transition active:scale-[0.99]" type="button" onClick={() => navigate(isOperator ? '/operacion' : '/')}>
              Volver a operar
            </button>
          </section>
        </div>
      ) : null}
    </div>
  )
}

function EntryItemCard({ item, onEdit, onRemove }) {
  const equivalentTotal = Number(item.package_count || 0) * Number(item.package_size || 0)

  return (
    <ListProductCard
      title={cleanProductName(item.product)}
      boxes={item.box_count}
      envases={item.package_count}
      equivalent={equivalentTotal}
      equivalentUnit={item.package_unit}
      presentation={packageLabel(item) || 'Sin dato'}
      secondary={`${item.lot_code ? displayLotCode(item.lot_code) : 'ID automatico'} - ${item.location}`}
      detailTitle="Producto del ingreso"
      detailRows={[
        { label: 'Cajas', value: `${formatNumber(item.box_count)} cajas` },
        { label: 'Envases', value: `${formatNumber(item.package_count)} env.` },
        { label: 'Equivalente', value: `${formatNumber(equivalentTotal)} ${item.package_unit}` },
        { label: 'Presentacion', value: packageLabel(item) || 'Sin dato' },
        { label: 'Empaque', value: entryPackageBreakdown(item) },
        { label: 'Lote', value: item.lot_code ? displayLotCode(item.lot_code) : 'ID automatico' },
        { label: 'Ubicacion', value: item.location || '-' },
        { label: 'Vencimiento', value: item.expiry_date || 'Sin dato' },
      ]}
      onEdit={() => onEdit(item)}
      onRemove={() => onRemove(item.id)}
    />
  )
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-1 block text-xs font-semibold text-slate-500">{hint}</span> : null}
    </label>
  )
}

function StepBadge({ active, done, label, onClick }) {
  return (
    <button
      className={`min-h-12 rounded-lg px-2 py-3 transition active:scale-[0.99] ${active ? 'bg-campo-600 text-white' : done ? 'bg-campo-50 text-campo-700' : 'bg-slate-50 text-slate-500'}`}
      type="button"
      onClick={onClick}
      aria-current={active ? 'step' : undefined}
    >
      {label}
    </button>
  )
}
