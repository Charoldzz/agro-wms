import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRightLeft, CalendarClock, ChevronRight, LayoutList, Wrench } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import Combobox from '../components/Combobox'
import { useAuth } from '../hooks/useAuth.jsx'
import { supabase } from '../lib/supabase'
import { equivalentLabel, formatDate, formatNumber } from '../lib/format'
import { cleanProductName, displayLotCode } from '../lib/display'

// AJUSTES: todo lo que cambia el stock SIN generar nota de ingreso ni de
// salida. Es lo que une a estas cuatro operaciones y lo que las separa de
// Ingreso y Despacho: la mercadería no cruza la puerta del depósito.
export default function AjustesHub() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [accion, setAccion] = useState(null)
  const [lots, setLots] = useState([])
  const [lotId, setLotId] = useState('')
  const [cargando, setCargando] = useState(false)

  const acciones = [
    {
      key: 'traspaso',
      label: 'Traspaso entre empresas',
      detalle: 'Un cliente le vende a otro. Cambia el dueño, la mercadería no se mueve.',
      Icon: ArrowRightLeft,
      directo: () => navigate('/operacion/traspaso'),
    },
    {
      key: 'fraccionar',
      label: 'Fraccionamiento',
      detalle: 'Cambia el tamaño del envase. El producto y el lote no cambian.',
      Icon: LayoutList,
    },
    ...(isAdmin ? [{
      key: 'vigencia',
      label: 'Extensión de vigencia',
      detalle: 'Revalidación del fabricante. Requiere certificado.',
      Icon: CalendarClock,
    }] : []),
    {
      key: 'reparo',
      label: 'Reparación / merma',
      detalle: 'Envase dañado, derrame, diferencia de conteo.',
      Icon: Wrench,
    },
  ]

  // Los lotes se cargan recién al elegir una acción que necesita uno
  useEffect(() => {
    if (!accion || accion === 'traspaso' || lots.length > 0) return
    setCargando(true)
    supabase
      .from('lots')
      .select('id, lot_code, product, current_quantity, package_size, package_unit, expiry_date, clients(name)')
      .eq('inventory_source', 'stock_independiente')
      .eq('status', 'activo')
      .gt('current_quantity', 0)
      .order('product')
      .then(({ data }) => { setLots(data || []); setCargando(false) })
  }, [accion])

  const opciones = useMemo(() => lots.map((l) => {
    const eq = Number(l.package_size) > 0
      ? equivalentLabel(l.current_quantity, l.package_unit)
      : `${formatNumber(l.current_quantity)} uds`
    return {
      value: l.id,
      label: `${cleanProductName(l.product)} · Lote ${displayLotCode(l.lot_code, l)} · ${l.clients?.name || ''} · ${eq}`,
    }
  }), [lots])

  const elegido = lots.find((l) => l.id === lotId)
  const accionActual = acciones.find((a) => a.key === accion)

  function continuar() {
    if (!elegido) return
    // La ficha del lote abre sola el formulario que corresponde
    if (accion === 'reparo') {
      navigate(`/lotes/${elegido.id}`, { state: { movementMode: 'reparo', scanned: true } })
    } else {
      navigate(`/lotes/${elegido.id}`, { state: { openAction: accion } })
    }
  }

  if (accion && accion !== 'traspaso') {
    return (
      <div>
        <PageHeader title={accionActual?.label || 'Ajuste'} subtitle="Elegí el lote" />
        <section className="panel space-y-3">
          <p className="rounded-lg bg-slate-50 p-2.5 text-[11px] font-semibold text-slate-600">
            {accionActual?.detalle}
          </p>

          <label className="block">
            <span className="label">Lote</span>
            <Combobox
              value={lotId}
              options={opciones}
              onChange={setLotId}
              placeholder={cargando ? 'Cargando lotes…' : 'Buscá por producto, lote o empresa…'}
              className="input mt-1 w-full"
            />
          </label>

          {elegido ? (
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-sm font-black text-slate-950 [overflow-wrap:anywhere]">{cleanProductName(elegido.product)}</p>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-400">
                Lote {displayLotCode(elegido.lot_code, elegido)}
                {elegido.expiry_date ? ` · vence ${formatDate(elegido.expiry_date)}` : ''}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-600 [overflow-wrap:anywhere]">
                {elegido.clients?.name} ·{' '}
                <strong>
                  {Number(elegido.package_size) > 0
                    ? equivalentLabel(elegido.current_quantity, elegido.package_unit)
                    : `${formatNumber(elegido.current_quantity)} uds`}
                </strong>
              </p>
            </div>
          ) : null}

          <div className="grid gap-2">
            <button className="btn-primary w-full" type="button" disabled={!elegido} onClick={continuar}>
              Continuar
            </button>
            <button className="btn-secondary w-full" type="button" onClick={() => { setAccion(null); setLotId('') }}>
              Volver a Ajustes
            </button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Ajustes" subtitle="Cambios que no generan nota de ingreso ni de salida" />

      <div className="space-y-2">
        {acciones.map(({ key, label, detalle, Icon, directo }) => (
          <button
            key={key}
            type="button"
            onClick={() => (directo ? directo() : setAccion(key))}
            className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left shadow-sm transition hover:border-campo-300 active:scale-[0.995]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-campo-50 text-campo-700">
              <Icon size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black text-slate-950">{label}</span>
              <span className="block text-[11px] font-semibold text-slate-500 [overflow-wrap:anywhere]">{detalle}</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-slate-400" />
          </button>
        ))}
      </div>

      <p className="mt-3 rounded-lg bg-slate-50 p-3 text-[11px] font-semibold text-slate-600">
        Ninguna de estas operaciones emite guía: la mercadería no entra ni sale del depósito, solo cambia de
        dueño, de envase, de vencimiento o de cantidad por una merma.
      </p>
    </div>
  )
}
