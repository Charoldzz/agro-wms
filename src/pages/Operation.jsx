import { Link } from 'react-router-dom'
import { Boxes, CalendarClock, LogOut, PackagePlus, ScanLine, Wrench } from 'lucide-react'
import PageHeader from '../components/PageHeader'

export default function Operation() {
  return (
    <div>
      <PageHeader title="Modo operario" subtitle="Ingresos, despachos y control de almacen" />

      <section className="grid gap-3 sm:grid-cols-2">
        <Link className="btn-primary min-h-32 !items-start !justify-between !px-5 !py-5 text-left text-xl sm:min-h-40" to="/operacion/nuevo-ingreso">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/15">
            <PackagePlus size={30} />
          </span>
          <span>Nuevo ingreso</span>
        </Link>
        <Link className="inline-flex min-h-32 flex-col items-start justify-between gap-3 rounded-lg bg-maiz px-5 py-5 text-left text-xl font-semibold text-slate-950 shadow-soft transition active:scale-[0.99] sm:min-h-40" to="/scanner?modo=despacho">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/35">
            <LogOut size={28} />
          </span>
          <span>Modo despacho</span>
        </Link>
        <Link className="inline-flex min-h-32 flex-col items-start justify-between gap-3 rounded-lg bg-orange-500 px-5 py-5 text-left text-xl font-semibold text-white shadow-soft transition active:scale-[0.99] sm:min-h-40" to="/operacion/reparacion-traslado">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/15">
            <Wrench size={28} />
          </span>
          <span>Reparacion / Traslado</span>
        </Link>
        <Link className="btn-secondary min-h-32 !items-start !justify-between !px-5 !py-5 text-left text-xl sm:min-h-40" to="/scanner">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-campo-50 text-campo-700">
            <ScanLine size={28} />
          </span>
          <span>Consultar QR</span>
        </Link>
      </section>

      <section className="mt-5">
        <h3 className="mb-2 text-sm font-bold uppercase text-slate-500">Consulta rapida</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link className="btn-secondary min-h-14 !justify-start !px-4 text-left" to="/lotes">
            <Boxes size={22} /> Stock por producto
          </Link>
          <Link className="btn-secondary min-h-14 !justify-start !px-4 text-left" to="/vencimientos">
            <CalendarClock size={22} /> Vencimientos
          </Link>
        </div>
      </section>

    </div>
  )
}
