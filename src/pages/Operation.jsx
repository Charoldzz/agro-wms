import { Link } from 'react-router-dom'
import { Boxes, CalendarClock, LogOut, PackagePlus, Wrench } from 'lucide-react'
import PageHeader from '../components/PageHeader'

export default function Operation() {
  return (
    <div>
      <PageHeader title="Modo operario" subtitle="Ingresos, despachos y control de almacen" />

      <section className="grid gap-3">
        <Link className="btn-primary min-h-20 !justify-start !px-5 text-left text-lg" to="/operacion/nuevo-ingreso">
          <PackagePlus size={28} /> Nuevo ingreso
        </Link>
        <Link className="min-h-20 !justify-start !px-5 text-left text-lg inline-flex items-center gap-2 rounded-lg bg-maiz px-4 py-3 font-semibold text-slate-950 shadow-soft transition active:scale-[0.99]" to="/scanner?modo=despacho">
          <LogOut size={24} /> Modo despacho
        </Link>
        <Link className="min-h-20 !justify-start !px-5 text-left text-lg inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-3 font-semibold text-white shadow-soft transition active:scale-[0.99]" to="/operacion/reparacion-traslado">
          <Wrench size={24} /> Reparacion / Traslado
        </Link>
        <Link className="btn-secondary min-h-16 !justify-start !px-5 text-left text-lg" to="/lotes">
          <Boxes size={24} /> Ver lotes y stock
        </Link>
        <Link className="btn-secondary min-h-16 !justify-start !px-5 text-left text-lg" to="/vencimientos">
          <CalendarClock size={24} /> Productos proximos a vencer
        </Link>
      </section>

    </div>
  )
}
