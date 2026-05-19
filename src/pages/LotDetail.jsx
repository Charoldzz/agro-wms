import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Download, Printer, QrCode, Save } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../hooks/useAuth.jsx'
import { formatDate, formatNumber, movementLabel } from '../lib/format'
import { createLotQrDataUrl } from '../lib/qr'
import { supabase } from '../lib/supabase'
import { cleanProductName, displayLotCode } from '../lib/display'

const initialMovement = {
  type: 'entrada',
  quantity: '',
  to_location: '',
  notes: '',
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export default function LotDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const [lot, setLot] = useState(null)
  const [movements, setMovements] = useState([])
  const [movement, setMovement] = useState(initialMovement)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [error, setError] = useState('')
  const [emailStatus, setEmailStatus] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadLot()
    createLotQrDataUrl(id).then(setQrDataUrl)

    const channel = supabase
      .channel(`lot-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lots', filter: `id=eq.${id}` }, loadLot)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movements', filter: `lot_id=eq.${id}` }, loadLot)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [id])

  async function loadLot() {
    const [{ data: lotData }, { data: movementsData }] = await Promise.all([
      supabase.from('lots').select('*, clients(name, contact)').eq('id', id).single(),
      supabase
        .from('movements')
        .select('*, profiles(full_name)')
        .eq('lot_id', id)
        .order('created_at', { ascending: false }),
    ])
    setLot(lotData)
    setMovements(movementsData || [])
  }

  const nextQuantity = useMemo(() => {
    const quantity = Number(movement.quantity || 0)
    if (!lot) return 0
    if (movement.type === 'entrada') return Number(lot.current_quantity) + quantity
    if (movement.type === 'salida') return Number(lot.current_quantity) - quantity
    if (movement.type === 'ajuste') return quantity
    return Number(lot.current_quantity)
  }, [lot, movement])

  async function handleSubmit(event) {
    event.preventDefault()
    if (!lot) return

    const quantity = Number(movement.quantity)
    if (movement.type === 'salida' && quantity > Number(lot.current_quantity)) {
      setError('No hay inventario suficiente.')
      return
    }

    if (
      movement.type === 'salida' &&
      Number(lot.package_size) > 0 &&
      quantity % Number(lot.package_size) !== 0
    ) {
      setError(`La salida debe ser multiplo de ${formatNumber(lot.package_size)} ${lot.package_unit || ''}.`)
      return
    }

    if (quantity < 0) {
      setError('La cantidad no puede ser negativa.')
      return
    }

    setSaving(true)
    setError('')
    setEmailStatus('')

    const { error: rpcError } = await supabase.rpc('register_movement', {
      p_lot_id: lot.id,
      p_type: movement.type,
      p_quantity: quantity,
      p_to_location: movement.to_location || null,
      p_notes: movement.notes || null,
      p_user_id: user.id,
    })

    if (rpcError) {
      if (rpcError.message.includes('inventario')) {
        setError('No hay inventario suficiente.')
      } else if (rpcError.message.includes('múltiplo') || rpcError.message.includes('multiplo')) {
        setError(`La salida debe ser multiplo de ${formatNumber(lot.package_size)} ${lot.package_unit || ''}.`)
      } else {
        setError(rpcError.message)
      }
    } else {
      await notifyOfficeMovement({
        type: movement.type,
        quantity,
        previousQuantity: Number(lot.current_quantity),
        newQuantity: nextQuantity,
        toLocation: movement.to_location,
        notes: movement.notes,
      })
      setMovement(initialMovement)
      await loadLot()
    }

    setSaving(false)
  }

  async function notifyOfficeMovement(payload) {
    if (!['entrada', 'salida'].includes(payload.type)) return

    const { error: emailError } = await supabase.functions.invoke('send-movement-email', {
      body: {
        to: 'hgaray@tagribol.com',
        movement_type: payload.type,
        quantity: payload.quantity,
        previous_quantity: payload.previousQuantity,
        new_quantity: payload.newQuantity,
        to_location: payload.toLocation || null,
        notes: payload.notes || null,
        lot_code: displayLotCode(lot.lot_code),
        product: cleanProductName(lot.product),
        client: lot.clients?.name || 'Sin cliente',
        location: lot.location,
        user_email: user.email,
      },
    })

    setEmailStatus(
      emailError
        ? 'Movimiento guardado. Falta configurar el envio automatico de correo.'
        : 'Movimiento guardado y correo enviado a oficina.',
    )
  }

  async function saveQrImage() {
    if (!qrDataUrl || !lot) return

    try {
      const response = await fetch(qrDataUrl)
      const blob = await response.blob()
      const file = new File([blob], `${displayLotCode(lot.lot_code)}-qr.png`, { type: 'image/png' })

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `QR ${displayLotCode(lot.lot_code)}`,
        })
        return
      }
    } catch {
      // Si compartir no esta disponible, se abre la imagen como alternativa.
    }

    openQrImage()
  }

  function openQrImage() {
    if (!qrDataUrl) return
    const imageWindow = window.open('', '_blank')
    if (!imageWindow) return

    imageWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>QR ${lot.lot_code}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            body {
              margin: 0;
              min-height: 100vh;
              display: grid;
              place-items: center;
              background: #f6f7f3;
              font-family: Arial, sans-serif;
            }
            img {
              width: min(86vw, 420px);
              height: auto;
              background: white;
              padding: 16px;
              border-radius: 8px;
            }
            p {
              color: #334155;
              text-align: center;
              font-weight: 700;
            }
          </style>
        </head>
        <body>
          <main>
            <img src="${qrDataUrl}" alt="QR ${lot.lot_code}" />
            <p>${escapeHtml(displayLotCode(lot.lot_code))}</p>
          </main>
        </body>
      </html>
    `)
    imageWindow.document.close()
  }

  function printQrLabels() {
    if (!qrDataUrl || !lot) return
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    const label = `
      <article class="label">
        <div class="brand">Todo Agrícola</div>
        <img src="${qrDataUrl}" alt="QR ${escapeHtml(lot.lot_code)}" />
        <h2>${escapeHtml(displayLotCode(lot.lot_code))}</h2>
        <small>Escanear para ver ficha</small>
      </article>
    `

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Etiquetas QR ${escapeHtml(lot.lot_code)}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            * {
              box-sizing: border-box;
            }
            body {
              margin: 0;
              background: #fff;
              color: #0f172a;
              font-family: Arial, sans-serif;
            }
            .sheet {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 12mm;
              min-height: 100vh;
              padding: 12mm;
            }
            .label {
              align-items: center;
              border: 2px solid #0f172a;
              border-radius: 8px;
              display: flex;
              flex-direction: column;
              justify-content: center;
              min-height: 120mm;
              padding: 10mm;
              text-align: center;
            }
            .brand {
              color: #000;
              font-size: 14px;
              font-weight: 800;
              margin-bottom: 3mm;
              text-transform: uppercase;
            }
            img {
              height: 72mm;
              image-rendering: pixelated;
              width: 72mm;
            }
            h2 {
              font-size: 16px;
              font-weight: 700;
              margin: 4mm 0 1mm;
            }
            small {
              color: #334155;
              display: block;
              font-size: 11px;
              font-weight: 700;
              margin-top: 1mm;
            }
            @media print {
              @page {
                margin: 0;
                size: A4;
              }
              body {
                print-color-adjust: exact;
                -webkit-print-color-adjust: exact;
              }
            }
          </style>
        </head>
        <body>
          <main class="sheet">
            ${label}
            ${label}
            ${label}
            ${label}
          </main>
          <script>
            window.addEventListener('load', () => {
              window.print()
            })
          </script>
        </body>
      </html>
    `)
    printWindow.document.close()
  }

  if (!lot) return <div className="p-6 text-center text-slate-600">Cargando lote...</div>

  return (
    <div>
      <PageHeader title={displayLotCode(lot.lot_code)} subtitle={`${cleanProductName(lot.product)} · ${lot.clients?.name}`} />

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="panel">
          {lot.photo_url ? <img className="mb-4 h-48 w-full rounded-lg object-cover" src={lot.photo_url} alt={cleanProductName(lot.product)} /> : null}
          <div className="grid grid-cols-2 gap-3">
            <Info label="Cantidad actual" value={formatNumber(lot.current_quantity)} strong />
            <Info
              label="Presentacion"
              value={lot.package_size ? `${formatNumber(lot.package_size)} ${lot.package_unit || ''}` : 'Sin dato'}
            />
            <Info label="Ubicación" value={lot.location} />
            <Info label="Fecha ingreso" value={formatDate(lot.entry_date)} />
            <Info label="Estado" value={lot.status} />
            <Info label="Cliente" value={lot.clients?.name} />
            <Info label="Contacto" value={lot.clients?.contact || '-'} />
          </div>
        </div>

        <div className="panel text-center">
          <div className="mb-3 flex items-center justify-center gap-2">
            <QrCode className="text-campo-700" />
            <h3 className="font-bold text-slate-900">QR del lote</h3>
          </div>
          {qrDataUrl ? (
            <button className="mx-auto block" type="button" onClick={openQrImage} title="Abrir QR">
              <img src={qrDataUrl} alt={`QR ${lot.lot_code}`} className="h-56 w-56" />
            </button>
          ) : null}
          {qrDataUrl ? (
            <div className="mt-3 grid gap-2">
              <button className="btn-primary w-full" type="button" onClick={printQrLabels}>
                <Printer size={20} /> QR Pallets
              </button>
              <button className="btn-secondary w-full" type="button" onClick={saveQrImage}>
                <Download size={20} /> Descargar QR
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <form className="panel mt-4 space-y-3" onSubmit={handleSubmit}>
        <h3 className="text-lg font-bold text-slate-950">Registrar movimiento</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="label">Tipo</span>
            <select className="input mt-1" value={movement.type} onChange={(event) => setMovement({ ...movement, type: event.target.value })}>
              <option value="entrada">Entrada</option>
              <option value="salida">Salida</option>
              <option value="traslado">Traslado interno</option>
              <option value="ajuste">Ajuste de inventario</option>
            </select>
          </label>
          <label>
            <span className="label">{movement.type === 'ajuste' ? 'Nueva cantidad' : 'Cantidad'}</span>
            <input
              className="input mt-1"
              type="text"
              inputMode="decimal"
              value={movement.quantity}
              onChange={(event) => {
                const value = event.target.value.replace(',', '.')
                if (/^\d*\.?\d*$/.test(value)) setMovement({ ...movement, quantity: value })
              }}
              onWheel={(event) => event.currentTarget.blur()}
              required
            />
          </label>
          {movement.type === 'traslado' ? (
            <label className="sm:col-span-2">
              <span className="label">Nueva ubicación</span>
              <input className="input mt-1" value={movement.to_location} onChange={(event) => setMovement({ ...movement, to_location: event.target.value })} required />
            </label>
          ) : null}
          <label className="sm:col-span-2">
            <span className="label">Observaciones</span>
            <textarea className="input mt-1" rows="3" value={movement.notes} onChange={(event) => setMovement({ ...movement, notes: event.target.value })} />
          </label>
        </div>

        <div className="rounded-lg bg-campo-50 p-3 text-sm font-semibold text-campo-700">
          Stock después del movimiento: {formatNumber(nextQuantity)}
        </div>
        {error ? <div className="rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}
        {emailStatus ? <div className="rounded-lg bg-campo-50 p-3 text-sm font-bold text-campo-700">{emailStatus}</div> : null}

        <button className="btn-primary w-full" disabled={saving}>
          <Save size={20} /> {saving ? 'Guardando...' : 'Guardar movimiento'}
        </button>
      </form>

      <section className="mt-4">
        <h3 className="mb-3 text-lg font-bold text-slate-950">Historial completo</h3>
        <div className="space-y-3">
          {movements.map((item) => (
            <article key={item.id} className="panel">
              <div className="flex justify-between gap-3">
                <div>
                  <p className="font-bold text-slate-900">{movementLabel(item.type)}</p>
                  <p className="text-sm text-slate-500">{formatDate(item.created_at)}</p>
                </div>
                <p className="text-xl font-bold text-campo-700">{formatNumber(item.quantity)}</p>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Usuario: {item.profiles?.full_name || 'Usuario'} · Stock anterior: {formatNumber(item.previous_quantity)} · Stock nuevo: {formatNumber(item.new_quantity)}
              </p>
              {item.notes ? <p className="mt-1 text-sm text-slate-600">{item.notes}</p> : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function Info({ label, value, strong }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase text-slate-400">{label}</p>
      <p className={`${strong ? 'text-2xl' : 'text-base'} mt-1 font-bold text-slate-950`}>{value}</p>
    </div>
  )
}
