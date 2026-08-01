import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ArrowRightLeft, CheckCircle2, Plus, Save, Trash2 } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import Combobox from '../components/Combobox'
import { supabase } from '../lib/supabase'
import {
  equivalentLabel, formatDate, formatDateShort, formatNumber,
  formatQtyInput, normalizeEquivalent, parseQtyInput, pluralUnit,
} from '../lib/format'
import { desgloseEnvases } from '../lib/envases'
import { cleanProductName, displayLotCode } from '../lib/display'
import { vibrateError, vibrateSuccess } from '../lib/haptics'
import { useAuth } from '../hooks/useAuth.jsx'

let rowSeq = 0
const newRow = () => ({ id: `r${++rowSeq}`, lot_id: '', cantidad: '' })

// Traspaso = cambio de dueño SIN movimiento físico. Es una operación interna:
// no genera guía ni cuenta como ingreso/salida del depósito.
export default function TraspasoOperacion() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [clients, setClients] = useState([])
  const [fromClient, setFromClient] = useState('')
  const [toClient, setToClient] = useState('')
  const [notes, setNotes] = useState('')
  const [lots, setLots] = useState([])
  const [rows, setRows] = useState([newRow()])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(null)

  const today = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    supabase.from('clients').select('id, name, product_code_prefix').order('name')
      .then(({ data }) => setClients(data || []))
  }, [])

  // Al cambiar de vendedor se recargan sus lotes y se limpia lo cargado
  useEffect(() => {
    setRows([newRow()])
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

  const fromObj = clients.find((c) => c.id === fromClient)
  const toObj = clients.find((c) => c.id === toClient)
  const toSinCodigo = Boolean(toClient) && !String(toObj?.product_code_prefix || '').trim()

  const lotById = useMemo(() => new Map(lots.map((l) => [l.id, l])), [lots])

  function eqDe(l, v) {
    return Number(l?.package_size) > 0 ? equivalentLabel(v, l.package_unit) : `${formatNumber(v)} uds`
  }
  function envDe(l, v) {
    return Number(l?.package_size) > 0
      ? desgloseEnvases(v, Number(l.package_size), l.package_unit, 0).unidadesLabel
      : ''
  }
  function lotOptionLabel(l) {
    const venc = l.expiry_date ? ` · vence ${formatDate(l.expiry_date)}` : ' · sin venc.'
    return `${cleanProductName(l.product)} · Lote ${displayLotCode(l.lot_code, l)}${venc}`
  }

  // Un lote no se puede cargar dos veces en la misma operación
  function optionsFor(rowId) {
    const usados = new Set(rows.filter((r) => r.id !== rowId && r.lot_id).map((r) => r.lot_id))
    return lots.filter((l) => !usados.has(l.id)).map((l) => ({ value: l.id, label: lotOptionLabel(l) }))
  }

  const validRows = rows.filter((r) => r.lot_id && Number(r.cantidad) > 0)

  // Totales por unidad ("4.000 lts · 500 kgs")
  const totales = useMemo(() => {
    const acc = new Map()
    for (const r of validRows) {
      const l = lotById.get(r.lot_id)
      const eq = normalizeEquivalent(Number(r.cantidad), l?.package_unit)
      acc.set(eq.unit, (acc.get(eq.unit) || 0) + eq.value)
    }
    return [...acc.entries()].map(([u, v]) => `${formatNumber(v)} ${pluralUnit(u, v)}`).join(' · ')
  }, [validRows, lotById])

  function updateRow(id, patch) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function addRow() { setRows((prev) => [...prev, newRow()]) }
  function removeRow(id) {
    setRows((prev) => (prev.length <= 1 ? [newRow()] : prev.filter((r) => r.id !== id)))
  }

  async function submit() {
    setError('')
    if (!fromClient || !toClient) return setError('Elegí la empresa que vende y la que recibe.')
    if (fromClient === toClient) return setError('No puede ser la misma empresa.')
    if (toSinCodigo) return setError(`${toObj?.name} no tiene código de empresa. Cargalo en Empresas antes de traspasar.`)
    if (validRows.length === 0) return setError('Agregá al menos un lote con su cantidad.')
    if (!notes.trim()) return setError('Escribí el motivo del traspaso.')

    for (const r of validRows) {
      const l = lotById.get(r.lot_id)
      if (Number(r.cantidad) > Number(l.current_quantity)) {
        return setError(`${cleanProductName(l.product)}: solo hay ${eqDe(l, l.current_quantity)}.`)
      }
    }

    setSaving(true)
    try {
      const { data: res, error: rpcError } = await supabase.rpc('request_transfer_operation', {
        p_from_client_id: fromClient,
        p_to_client_id: toClient,
        p_notes: notes.trim(),
        p_items: validRows.map((r) => ({ lot_id: r.lot_id, quantity: Number(r.cantidad) })),
      })
      if (rpcError) throw rpcError
      vibrateSuccess()
      // Se guarda el detalle completo para el comprobante en pantalla: qué
      // producto, qué lote, cuánto se fue y cuánto le quedó a cada uno.
      setDone({
        aplicado: Boolean(res?.aplicado),
        codigo: res?.operation_code || '',
        from: fromObj?.name,
        to: toObj?.name,
        totales,
        notes: notes.trim(),
        detalle: validRows.map((r) => {
          const l = lotById.get(r.lot_id)
          const qty = Number(r.cantidad)
          const resto = Math.max(Number(l.current_quantity) - qty, 0)
          return {
            id: r.lot_id,
            product: cleanProductName(l.product),
            lot: displayLotCode(l.lot_code, l),
            expiry: l.expiry_date,
            eq: eqDe(l, qty),
            env: envDe(l, qty),
            restoEq: resto > 0 ? eqDe(l, resto) : null,
          }
        }),
      })
    } catch (err) {
      vibrateError()
      setError(err.message || 'No se pudo registrar el traspaso.')
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div>
        <PageHeader
          title={done.aplicado ? "Traspaso aplicado" : "Traspaso enviado"}
          subtitle={done.aplicado ? "La mercadería ya cambió de dueño" : "Espera la aprobación del administrador"}
        />
        <section className="panel">
          <div className="text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-campo-50 text-campo-700">
              <CheckCircle2 size={34} strokeWidth={2} />
            </span>
            <p className="mt-2 text-xl font-black text-slate-950">
              {done.aplicado ? "Traspaso aplicado" : "Traspaso registrado"}
            </p>
            {done.codigo ? (
              <p className="font-mono text-[11px] font-bold text-slate-400">{done.codigo}</p>
            ) : null}
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-sm font-black text-slate-800">
              <span>{done.from}</span>
              <ArrowRight size={16} className="shrink-0 text-campo-700" />
              <span className="text-campo-700">{done.to}</span>
            </div>
            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Traspaso · {formatDateShort(today)}
            </p>
          </div>

          {/* Detalle: qué se traspasó exactamente */}
          <p className="mt-4 text-[11px] font-black uppercase tracking-wide text-campo-700">
            Mercadería traspasada
          </p>
          <ul className="mt-1.5 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {done.detalle.map((d, i) => (
              <li key={d.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="flex min-w-0 gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-campo-100 text-[10px] font-black text-campo-700">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-black text-slate-950 [overflow-wrap:anywhere]">{d.product}</p>
                    <p className="text-[11px] font-semibold text-slate-400">
                      Lote {d.lot}{d.expiry ? ` · vence ${formatDate(d.expiry)}` : ''}
                    </p>
                    <p className="text-[10px] font-semibold text-slate-400">
                      {d.restoEq ? `Al vendedor le quedan ${d.restoEq}` : 'Se traspasó el lote completo'}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-black text-campo-700">{d.eq}</p>
                  {d.env ? <p className="text-[10px] font-semibold text-slate-400">{d.env}</p> : null}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-campo-50 px-3 py-2">
            <span className="text-[11px] font-black uppercase tracking-wide text-campo-700">
              {done.detalle.length} {done.detalle.length === 1 ? 'lote' : 'lotes'}
            </span>
            <span className="text-base font-black text-campo-800">{done.totales}</span>
          </div>

          {done.notes ? (
            <p className="mt-2 text-[11px] font-semibold italic text-slate-500 [overflow-wrap:anywhere]">
              Motivo: {done.notes}
            </p>
          ) : null}

          {!done.aplicado ? (
            <p className="mt-3 rounded-lg bg-orange-50 p-3 text-xs font-bold text-orange-800">
              Estos lotes quedaron congelados: nadie puede despacharlos, repararlos ni operarlos hasta que un
              administrador apruebe o rechace el traspaso.
            </p>
          ) : null}

          <div className="mt-3 grid gap-2">
            <button className="btn-primary w-full" type="button" onClick={() => navigate('/lotes')}>
              Volver a Almacenes
            </button>
            <button
              className="btn-secondary w-full"
              type="button"
              onClick={() => { setDone(null); setRows([newRow()]); setNotes(''); setFromClient(''); setToClient('') }}
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
      <PageHeader title="Traspaso" subtitle="Cambio de dueño de la mercadería" />

      {/* ── Cabecera: vende → recibe ── */}
      <section className="panel mb-4">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-base font-black text-slate-950 [overflow-wrap:anywhere]">
                {fromObj?.name || 'Empresa que vende'}
              </span>
              <ArrowRight size={18} className="shrink-0 text-campo-700" />
              <span className="text-base font-black text-campo-700 [overflow-wrap:anywhere]">
                {toObj?.name || 'Empresa que recibe'}
              </span>
            </div>
            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Traspaso · {formatDateShort(today)}
            </p>
          </div>
          <div className="shrink-0 rounded-lg border-2 border-campo-600 px-3 py-1.5 text-center">
            <p className="text-[9px] font-bold uppercase tracking-[2px] text-slate-400">Operación</p>
            <p className="font-mono text-sm font-black leading-tight text-campo-700">TRP</p>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Empresa que vende</span>
            <Combobox
              value={fromClient}
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
              onChange={setFromClient}
              placeholder="Buscar empresa…"
              className="input mt-1 w-full"
            />
          </label>
          <label className="block">
            <span className="label">Empresa que recibe</span>
            <Combobox
              value={toClient}
              options={clients.filter((c) => c.id !== fromClient).map((c) => ({ value: c.id, label: c.name }))}
              onChange={setToClient}
              placeholder="Buscar empresa…"
              className="input mt-1 w-full"
            />
            {toSinCodigo ? (
              <span className="mt-1 block rounded-lg bg-red-50 p-2 text-[11px] font-bold text-red-700">
                {toObj?.name} no tiene código de empresa. Un administrador debe cargarlo en Empresas antes de
                poder traspasarle mercadería.
              </span>
            ) : null}
          </label>
        </div>

        <p className="mt-3 rounded-lg bg-slate-50 p-2.5 text-[11px] font-semibold text-slate-600">
          <ArrowRightLeft size={14} className="mr-1 inline text-campo-700" />
          Operación interna: no es un ingreso ni una salida del depósito y no genera guía. Cambia el inventario
          de cada empresa, pero el total del almacén queda igual.
        </p>
      </section>

      {!fromClient ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
          <p className="text-sm font-bold text-slate-500">Elegí la empresa que vende para cargar sus lotes.</p>
        </div>
      ) : (
        <>
          {/* ── Tabla (computadora) ── */}
          <div className="mb-4 hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm sm:block">
            <table className="w-full border-collapse" style={{ minWidth: '860px', tableLayout: 'fixed' }}>
              <thead>
                <tr className="bg-campo-700 text-white">
                  <th className="border-b border-campo-600 px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wide" style={{ width: '36px' }}>N°</th>
                  <th className="border-b border-campo-600 px-2 py-2.5 text-left text-xs font-bold uppercase tracking-wide">Producto / Lote</th>
                  <th className="border-b border-campo-600 px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wide" style={{ width: '110px' }}>Venc.</th>
                  <th className="border-b border-campo-600 px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wide" style={{ width: '130px' }}>Stock</th>
                  <th className="border-b border-campo-600 px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wide" style={{ width: '130px' }}>Se traspasa</th>
                  <th className="border-b border-campo-600 px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wide" style={{ width: '140px' }}>Le queda</th>
                  <th className="border-b border-campo-600 px-2 py-2.5" style={{ width: '44px' }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const l = lotById.get(r.lot_id)
                  const qty = Number(r.cantidad) || 0
                  const stock = Number(l?.current_quantity) || 0
                  const resto = Math.max(stock - qty, 0)
                  const excede = qty > stock
                  return (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-2 text-center text-xs font-black text-slate-400">{i + 1}</td>
                      <td className="px-2 py-2">
                        <Combobox
                          value={r.lot_id}
                          options={optionsFor(r.id)}
                          onChange={(v) => updateRow(r.id, { lot_id: v, cantidad: '' })}
                          placeholder="Buscar producto o lote…"
                          className="input w-full !py-1.5 text-sm"
                        />
                      </td>
                      <td className="px-2 py-2 text-center text-xs font-semibold text-slate-500">
                        {l?.expiry_date ? formatDate(l.expiry_date) : '—'}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {l ? (
                          <>
                            <p className="text-xs font-black text-slate-800">{eqDe(l, stock)}</p>
                            {envDe(l, stock) ? <p className="text-[10px] font-semibold text-slate-400">{envDe(l, stock)}</p> : null}
                          </>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className={`input w-full !py-1.5 text-right text-sm font-bold ${excede ? 'border-red-400 text-red-700' : ''}`}
                          inputMode="decimal"
                          placeholder="0"
                          disabled={!l}
                          value={formatQtyInput(r.cantidad)}
                          onChange={(e) => { const v = parseQtyInput(e.target.value); if (v !== null) updateRow(r.id, { cantidad: v }) }}
                        />
                        {l && qty > 0 && envDe(l, qty) ? (
                          <p className="mt-0.5 text-right text-[10px] font-semibold text-campo-700">{envDe(l, qty)}</p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {l && qty > 0 ? (
                          resto > 0 ? (
                            <>
                              <p className="text-xs font-black text-slate-700">{eqDe(l, resto)}</p>
                              {envDe(l, resto) ? <p className="text-[10px] font-semibold text-slate-400">{envDe(l, resto)}</p> : null}
                            </>
                          ) : (
                            <span className="text-[10px] font-black uppercase tracking-wide text-amber-700">Lote completo</span>
                          )
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button className="rounded p-1 text-slate-300 hover:text-red-600" type="button" title="Quitar" onClick={() => removeRow(r.id)}>
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* ── Fichas (celular) ── */}
          <div className="mb-4 space-y-3 sm:hidden">
            {rows.map((r, i) => {
              const l = lotById.get(r.lot_id)
              const qty = Number(r.cantidad) || 0
              const stock = Number(l?.current_quantity) || 0
              const resto = Math.max(stock - qty, 0)
              const excede = qty > stock
              return (
                <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-campo-100 text-xs font-black text-campo-700">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <Combobox
                        value={r.lot_id}
                        options={optionsFor(r.id)}
                        onChange={(v) => updateRow(r.id, { lot_id: v, cantidad: '' })}
                        placeholder="Buscar producto o lote…"
                        className="input w-full text-sm"
                      />
                    </div>
                    <button className="mt-1 shrink-0 rounded p-1 text-slate-300" type="button" onClick={() => removeRow(r.id)}>
                      <Trash2 size={16} />
                    </button>
                  </div>

                  {l ? (
                    <>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-slate-50 px-3 py-2">
                          <p className="text-[10px] font-black uppercase text-slate-500">Stock del lote</p>
                          <p className="text-sm font-black text-slate-800">{eqDe(l, stock)}</p>
                          {envDe(l, stock) ? <p className="text-[10px] font-semibold text-slate-400">{envDe(l, stock)}</p> : null}
                        </div>
                        <div className="rounded-lg bg-slate-50 px-3 py-2">
                          <p className="text-[10px] font-black uppercase text-slate-500">Vencimiento</p>
                          <p className="text-sm font-black text-slate-800">{l.expiry_date ? formatDate(l.expiry_date) : 'Sin dato'}</p>
                        </div>
                      </div>

                      <label className="mt-2 block">
                        <span className="text-[10px] font-black uppercase text-campo-600">
                          Cantidad a traspasar {l.package_unit ? `(${l.package_unit})` : ''}
                        </span>
                        <input
                          className={`input mt-1 w-full text-right font-bold ${excede ? 'border-red-400 text-red-700' : ''}`}
                          inputMode="decimal"
                          placeholder="0"
                          value={formatQtyInput(r.cantidad)}
                          onChange={(e) => { const v = parseQtyInput(e.target.value); if (v !== null) updateRow(r.id, { cantidad: v }) }}
                        />
                      </label>

                      {qty > 0 ? (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div className={`rounded-lg px-3 py-2 ${excede ? 'bg-red-50' : 'bg-campo-50'}`}>
                            <p className={`text-[10px] font-black uppercase ${excede ? 'text-red-600' : 'text-campo-600'}`}>Se traspasa</p>
                            <p className={`text-sm font-black ${excede ? 'text-red-700' : 'text-campo-800'}`}>{eqDe(l, qty)}</p>
                            {envDe(l, qty) ? <p className={`text-[10px] font-semibold ${excede ? 'text-red-500' : 'text-campo-700/80'}`}>{envDe(l, qty)}</p> : null}
                          </div>
                          <div className="rounded-lg bg-slate-50 px-3 py-2">
                            <p className="text-[10px] font-black uppercase text-slate-500">Le queda</p>
                            <p className="text-sm font-black text-slate-800">{eqDe(l, resto)}</p>
                            {resto === 0 ? (
                              <p className="text-[10px] font-black uppercase text-amber-700">Lote completo</p>
                            ) : envDe(l, resto) ? (
                              <p className="text-[10px] font-semibold text-slate-400">{envDe(l, resto)}</p>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      {excede ? (
                        <p className="mt-2 rounded-lg bg-red-50 p-2 text-[11px] font-bold text-red-700">
                          Ese lote solo tiene {eqDe(l, stock)}.
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </div>
              )
            })}
          </div>

          <button
            className="mb-4 w-full rounded-xl border-[1.5px] border-dashed border-campo-300 bg-campo-50 px-4 py-3.5 text-sm font-black text-campo-700 transition active:scale-[0.99]"
            type="button"
            onClick={addRow}
          >
            <Plus size={17} className="mr-1 inline" /> Agregar lote
          </button>

          {/* ── Resumen ── */}
          {validRows.length > 0 ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-campo-200 bg-campo-50 px-4 py-3">
              <p className="text-[11px] font-black uppercase tracking-wide text-campo-700">
                {validRows.length} {validRows.length === 1 ? 'lote' : 'lotes'} a traspasar
              </p>
              <p className="text-base font-black text-campo-800">{totales}</p>
            </div>
          ) : null}
        </>
      )}

      <section className="panel space-y-3">
        <label className="block">
          <span className="label">Motivo</span>
          <textarea
            className="input mt-1"
            rows={2}
            placeholder="EJ.: VENTA DE MAXIAGRO A UPL BOLIVIA SEGUN ACUERDO"
            value={notes}
            onChange={(e) => setNotes(e.target.value.toUpperCase())}
          />
        </label>

        {!isAdmin ? (
          <p className="rounded-lg bg-orange-50 p-2.5 text-[11px] font-bold text-orange-800">
            Al enviar, todos los lotes quedan congelados hasta que un administrador apruebe: nadie va a poder
            despacharlos, repararlos ni operarlos.
          </p>
        ) : null}

        {error ? <p className="rounded-lg bg-red-50 p-2 text-xs font-bold text-red-700">{error}</p> : null}

        <button className="btn-primary w-full" type="button" onClick={submit} disabled={saving}>
          <Save size={20} /> {saving ? 'Guardando...' : isAdmin ? 'Registrar traspaso' : 'Enviar a aprobación'}
        </button>
      </section>
    </div>
  )
}
