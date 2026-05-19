import { Link } from 'react-router-dom'
import { ArrowRightLeft, LogIn, LogOut, QrCode } from 'lucide-react'
import PageHeader from '../components/PageHeader'

export default function Operation() {
  return (
    <div>
      <PageHeader title="Modo operario" subtitle="Escanea un lote y registra el movimiento" />

      <section className="grid gap-3">
        <Link className="btn-primary min-h-20 !justify-start !px-5 text-left text-lg" to="/scanner">
          <QrCode size={28} /> Escanear QR del lote
        </Link>
      </section>

      <section className="panel mt-4">
        <h3 className="mb-3 text-lg font-bold text-slate-950">Flujo de trabajo</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Step icon={LogIn} title="Entrada" text="Aumenta el stock del lote escaneado." />
          <Step icon={LogOut} title="Salida" text="Descuenta stock con validacion de inventario." />
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
