import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRightLeft, Plus, Save, Trash2 } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import Combobox from '../components/Combobox'
import { supabase } from '../lib/supabase'
import { equivalentLabel, formatDate, formatNumber, formatQtyInput, parseQtyInput } from '../lib/format'
import { desgloseEnvases } from '../lib/envases'
import { cleanProductName, displayLotCode } from '../lib/display'
import { vibrateError, vibrateSuccess } from '../lib/haptics'

// Traspaso = cambio de dueño SIN movimiento físico. Por eso es una operación
// interna: no genera guía ni cuenta como ingreso/salida del depósito.
export default function TraspasoOperacion() {
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [fromClient, setFromClient] = useState('')
  const [toClient, setToClient] = useState('')
  const [notes, setNotes] = useState('')
  const [lots, setLots] = useState([])
  const [items, setItems] = useState([])
  const [pickLot, setPickLot] = useState('')
  const [pickQty, setPickQty] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(null)

  useEffect(() => {
    supabase.from('clients').select('id, name, product_code_prefix').order('name')
      .then(({ data }) => setClients(data || []))
  }, [])

  // Al cambiar de vendedor se recargan sus lotes y se limpia lo cargado
  useEffect(() => {
    setItems([])
    setPickLot('')
    setPickQty('')
    if (!fromClient) { setLots([]); return }
    supabase
      .from('lots')
      .select('id, lot_code, product, current_quantity, package_size, package_unit, expiry_date')
      .eq('client_id', fromClient)
      .eq('status', 'activo')
      .gt('current_quantity', 0)
      .order('product')
      .then(({ data }) => setLots(data || []))
  }, [fromClient])

  const toClientObj = clients.find((c) => c.id === toClient)
  const toClientSinCodigo = Boolean(toClient) && !String(toClientObj?.product_code_prefix || '').trim()

  const usedLotIds = new Set(items.map((i) => i.lot_id))
  const availableLots = lots.filter((l) => !usedLotIds.has(l.id))
  const selectedLot = lots.find((l) => l.id === pickLot)

  // pickQty guarda el valor canónico ("5000.5"); en pantalla se ve "5.000,5"
  const qtyNum = Number(pickQty) || 0
  const stockLote = Number(selectedLot?.current_quantity) || 0
  const restante = Math.max(stockLote - qtyNum, 0)

  // Etiquetas de una cantidad para ESTE lote: equivalente + envases
  function eqDe(l, v) {
    return Number(l?.package_size) > 0 ? equivalentLabel(v, l.package_unit) : `${formatNumber(v)} uds`
  }
  function envDe(l, v) {
    return Number(l?.package_size) > 0
      ? desgloseEnvases(v, Number(l.package_size), l.package_unit, 0).unidadesLabel
      : ''
  }

  function lotLabelFull(l) {
    const venc = l.expiry_date ? ` · vence ${formatDate(l.expiry_date)}` : ' · sin vencimiento'
    return `${cleanProductName(l.product)} · Lote ${displayLotCode(l.lot_code, l)}${venc}`
  }

  function addItem() {
    setError('')
    if (!selectedLot) { setError('Elegí el lote que se traspasa.'); return }
    if (!(qtyNum > 0)) { setError('Indicá cuánto se traspasa de ese lote.'); return }
    if (qtyNum > Number(selectedLot.current_quantity)) {
      setError(`Ese lote tiene ${equivalentLabel(selectedLot.current_quantity, selectedLot.package_unit)}.`)
      return
    }
    setItems((prev) => [...prev, { lot_id: selectedLot.id, quantity: qtyNum, lot: selectedLot }])
    setPickLot('')
    setPickQty('')
  }

  async function submit() {
    setError('')
    if (!fromClient || !toClient) { setError('Elegí la empresa que vende y la que recibe.'); return }
    if (fromClient === toClient) { setError('No puede ser la misma empresa.'); return }
    if (toClientSinCodigo) { setError('La empresa que recibe no tiene código de empresa. Cargalo en Empresas antes de traspasar.'); return }
    if (items.length === 0) { setError('Agregá al menos un lote.'); return }
    if (!notes.trim()) { setError('Escribí el motivo del traspaso.'); return }

    setSaving(true)
    try {
      const { data, error: rpcError } = await supabase.rpc('request_transfer_operation', {
        p_from_client_id: fromClient,
        p_to_client_id: toClient,
        p_notes: notes.trim(),
        p_items: items.map((i) => ({ lot_id: i.lot_id, quantity: i.quantity })),
      })
      if (rpcError) throw rpcError
      vibrateSuccess()
      setDone({ items: items.length, data })
    } catch (err) {
      vibrateError()
      setError(err.message || 'No se pudo registrar el traspaso.')
    } finally {
      setSaving(false)
    }
  }

  const nombreVende = clients.find((c) => c.id === fromClient)?.name || ''

  if (done) {
    return (
      <div>
        <PageHeader title="Traspaso enviado" subtitle="Espera la aprobación del administrador" />
        <section className="panel space-y-3 text-center">
          <p className="text-lg font-black text-slate-950">Traspaso registrado</p>
          <p className="text-sm font-semibold text-slate-600">
            {done.items} {done.items === 1 ? 'lote' : 'lotes'} de <strong>{nombreVende}</strong> a{' '}
            <strong>{toClientObj?.name}</strong>.
          </p>
          <p className="rounded-lg bg-orange-50 p-3 text-xs font-bold text-orange-800">
            Esos lotes quedaron congelados: nadie puede despacharlos, repararlos ni operarlos hasta que un
            administrador apruebe o rechace el traspaso.
          </p>
          <div className="grid gap-2">
            <button className="btn-primary w-full" type="button" onClick={() => navigate('/lotes')}>
              Volver a Almacenes
            </button>
            <button
              className="btn-secondary w-full"
              type="button"
              onClick={() => { setDone(null); setItems([]); setNotes(''); setFromClient(''); setToClient('') }}
            >
              Registrar otro traspaso
            </button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Traspaso entre empresas"
        subtitle="Cambia el dueño de la mercadería. No se mueve del depósito."
      />

      <section className="panel space-y-4">
        <div className="rounded-lg bg-slate-50 p-3 text-xs font-semibold text-slate-600">
          <ArrowRightLeft size={16} className="mr-1 inline text-campo-700" />
          Es una operación interna: no es un ingreso ni una salida del depósito, y no genera guía. Cambia el
          inventario de cada empresa, pero el total del almacén queda igual.
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Empresa que vende</span>
            {/* Combobox y no <select>: son 40+ empresas, así se busca escribiendo
                y el desplegable no queda recortado ni se abre fuera de pantalla. */}
            <div className="mt-1">
              <Combobox
                value={fromClient}
                options={clients.map((c) => ({ value: c.id, label: c.name }))}
                onChange={setFromClient}
                placeholder="Buscá la empresa…"
              />
            </div>
          </label>

          <label className="block">
            <span className="label">Empresa que recibe</span>
            <div className="mt-1">
              <Combobox
                value={toClient}
                options={clients.filter((c) => c.id !== fromClient).map((c) => ({ value: c.id, label: c.name }))}
                onChange={setToClient}
                placeholder="Buscá la empresa…"
              />
            </div>
            {toClientSinCodigo ? (
              <span className="mt-1 block rounded-lg bg-red-50 p-2 text-[11px] font-bold text-red-700">
                {toClientObj?.name} no tiene código de empresa asignado. Un administrador debe cargarlo en
                Empresas antes de poder traspasarle mercadería.
              </span>
            ) : null}
          </label>
        </div>

        {fromClient ? (
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="label mb-2">Agregar lote</p>

            <label className="block">
              <span className="text-[11px] font-bold uppercase text-slate-400">Lote</span>
              <div className="mt-1">
                <Combobox
                  value={pickLot}
                  options={availableLots.map((l) => ({ value: l.id, label: lotLabelFull(l) }))}
                  onChange={(v) => { setPickLot(v); setPickQty('') }}
                  placeholder="Buscá por producto o lote…"
                />
              </div>
            </label>

            {selectedLot ? (
              <>
                {/* Ficha del lote elegido: qué hay hoy, en qué envases y cuándo vence */}
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Stock del lote</p>
                    <p className="text-sm font-black text-slate-900">{eqDe(selectedLot, stockLote)}</p>
                    {envDe(selectedLot, stockLote) ? (
                      <p className="text-[10px] font-semibold text-slate-400">{envDe(selectedLot, stockLote)}</p>
                    ) : null}
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Vencimiento</p>
                    <p className="text-sm font-black text-slate-900">
                      {selectedLot.expiry_date ? formatDate(selectedLot.expiry_date) : 'Sin dato'}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Presentación</p>
                    <p className="text-sm font-black text-slate-900">
                      {Number(selectedLot.package_size) > 0
                        ? `${formatNumber(selectedLot.package_size)} ${selectedLot.package_unit || ''}`
                        : 'Sin presentación'}
                    </p>
                  </div>
                </div>

                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                  <label className="block">
                    <span className="text-[11px] font-bold uppercase text-slate-400">
                      Cantidad a traspasar {selectedLot.package_unit ? `(${selectedLot.package_unit})` : ''}
                    </span>
                    <input
                      className="input mt-1 text-right font-bold"
                      inputMode="decimal"
                      placeholder="0"
                      value={formatQtyInput(pickQty)}
                      onChange={(e) => { const v = parseQtyInput(e.target.value); if (v !== null) setPickQty(v) }}
                    />
                  </label>
                  <button className="btn-secondary" type="button" onClick={addItem}>
                    <Plus size={18} /> Agregar
                  </button>
                </div>

                {/* Qué se lleva y qué le queda: los envases van pegados a SU cantidad
                    para que no se confunda con el stock del lote */}
                {qtyNum > 0 ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className={`rounded-lg px-3 py-2 ${qtyNum > stockLote ? 'bg-red-50' : 'bg-campo-50'}`}>
                      <p className={`text-[10px] font-black uppercase tracking-wide ${qtyNum > stockLote ? 'text-red-600' : 'text-campo-700'}`}>
                        Se traspasa
                      </p>
                      <p className={`text-base font-black ${qtyNum > stockLote ? 'text-red-700' : 'text-campo-800'}`}>
                        {eqDe(selectedLot, qtyNum)}
                      </p>
                      {envDe(selectedLot, qtyNum) ? (
                        <p className={`text-[11px] font-semibold ${qtyNum > stockLote ? 'text-red-500' : 'text-campo-700/80'}`}>
                          {envDe(selectedLot, qtyNum)}
                        </p>
                      ) : null}
                    </div>
                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                      <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Le queda al vendedor</p>
                      <p className="text-base font-black text-slate-800">{eqDe(selectedLot, restante)}</p>
                      {envDe(selectedLot, restante) ? (
                        <p className="text-[11px] font-semibold text-slate-400">{envDe(selectedLot, restante)}</p>
                      ) : null}
                      {restante === 0 ? (
                        <p className="text-[10px] font-black uppercase tracking-wide text-amber-700">Se traspasa el lote completo</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {qtyNum > stockLote ? (
                  <p className="mt-2 rounded-lg bg-red-50 p-2 text-[11px] font-bold text-red-700">
                    Ese lote solo tiene {eqDe(selectedLot, stockLote)}.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {items.length > 0 ? (
          <div className="rounded-lg border border-campo-200 bg-campo-50/40 p-3">
            <p className="label mb-2">{items.length} {items.length === 1 ? 'lote' : 'lotes'} a traspasar</p>
            <ul className="space-y-1.5">
              {items.map((i, idx) => {
                const eq = eqDe(i.lot, i.quantity)
                const env = envDe(i.lot, i.quantity)
                const resto = Math.max(Number(i.lot.current_quantity) - i.quantity, 0)
                return (
                  <li key={i.lot_id} className="flex items-start justify-between gap-2 rounded-lg bg-white px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(i.lot.product)}</p>
                      <p className="text-[11px] font-semibold text-slate-400">
                        Lote {displayLotCode(i.lot.lot_code, i.lot)}
                        {i.lot.expiry_date ? ` · vence ${formatDate(i.lot.expiry_date)}` : ''}
                      </p>
                      <p className="text-[10px] font-semibold text-slate-400">
                        {resto > 0 ? `Le quedan ${eqDe(i.lot, resto)}` : 'Se traspasa el lote completo'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-black text-campo-700">{eq}</p>
                      {env ? <p className="text-[10px] font-semibold text-slate-400">{env}</p> : null}
                    </div>
                    <button
                      className="shrink-0 rounded p-1 text-slate-400 hover:text-red-600"
                      type="button"
                      title="Quitar"
                      onClick={() => setItems((prev) => prev.filter((_, k) => k !== idx))}
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}

        <label className="block">
          <span className="label">Motivo</span>
          <textarea
            className="input mt-1"
            rows={2}
            placeholder="Ej.: Venta de MAXIAGRO a UPLB segun acuerdo"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        <p className="rounded-lg bg-orange-50 p-2 text-[11px] font-bold text-orange-800">
          Al enviar, todos los lotes quedan congelados hasta que un administrador apruebe: nadie va a poder
          despacharlos, repararlos ni operarlos.
        </p>

        {error ? <p className="rounded-lg bg-red-50 p-2 text-xs font-bold text-red-700">{error}</p> : null}

        <button className="btn-primary w-full" type="button" onClick={submit} disabled={saving}>
          <Save size={20} /> {saving ? 'Guardando...' : 'Enviar a aprobación'}
        </button>
      </section>
    </div>
  )
}
