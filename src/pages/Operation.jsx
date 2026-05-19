import { Link } from 'react-router-dom'
import { ArrowRightLeft, Boxes, CalendarClock, LogIn, LogOut, PackagePlus, Wrench } from 'lucide-react'
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
        <Link className="btn-secondary min-h-16 !justify-start !px-5 text-left text-lg" to="/lotes">
          <Boxes size={24} /> Ver lotes y stock
        </Link>
        <Link className="btn-secondary min-h-16 !justify-start !px-5 text-left text-lg" to="/vencimientos">
          <CalendarClock size={24} /> Productos proximos a vencer
        </Link>
      </section>

      <section className="panel mt-4">
        <h3 className="mb-3 text-lg font-bold text-slate-950">Flujo de trabajo</h3>
        <div className="grid gap-3 sm:grid-cols-4">
          <Step icon={LogIn} title="Entrada" text="Aumenta el stock del lote escaneado." />
          <Step icon={LogOut} title="Salida" text="Descuenta stock con validacion de inventario." />
          <Step icon={Wrench} title="Reparo" text="Corrige el stock con observacion obligatoria." />
          <Step icon={ArrowRightLeft} title="Traslado" text="Cambia la ubicacion interna del lote." />
        </div>
      </section>
    </div>
  )
}

function Step({ icon: Icon, title, text }) {
  return (
    <div className="rounded-lg bg-slate-50 p-4">
      <Icon className="text-campo-700" size={24} />
      <p className="mt-3 font-bold text-slate-950">{title}</p>
      <p className="mt-1 text-sm font-medium text-slate-500">{text}</p>
    </div>
  )
}
