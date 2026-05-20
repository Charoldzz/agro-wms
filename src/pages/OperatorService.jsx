import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRightLeft, Wrench } from 'lucide-react'
import PageHeader from '../components/PageHeader'

export default function OperatorService() {
  const navigate = useNavigate()
  const [mode, setMode] = useState('reparo')

  function startScan() {
    navigate(`/scanner?modo=${mode}`)
  }

  return (
    <div>
      <PageHeader title="Reparacion / Traslado" subtitle="Elige la operacion y escanea el lote" />

      <section className="panel space-y-4">
        <div>
          <span className="label">Operacion</span>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              className={`min-h-16 rounded-lg border px-4 py-3 text-left text-base font-black ${mode === 'reparo' ? 'border-orange-500 bg-orange-50 text-orange-800' : 'border-slate-200 bg-white text-slate-700'}`}
              type="button"
              onClick={() => setMode('reparo')}
            >
              Reparacion
            </button>
            <button
              className={`min-h-16 rounded-lg border px-4 py-3 text-left text-base font-black ${mode === 'traslado' ? 'border-orange-500 bg-orange-50 text-orange-800' : 'border-slate-200 bg-white text-slate-700'}`}
              type="button"
              onClick={() => setMode('traslado')}
            >
              Traslado
            </button>
          </div>
        </div>

        <div className="rounded-lg bg-orange-50 p-3 text-sm font-bold text-orange-800">
          Primero selecciona la operacion. Luego escanea el QR del lote para registrar el movimiento correcto.
        </div>

        <button className="min-h-16 w-full justify-center inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-3 text-base font-semibold text-white shadow-soft transition active:scale-[0.99]" type="button" onClick={startScan}>
          {mode === 'traslado' ? <ArrowRightLeft size={22} /> : <Wrench size={22} />}
          Escanear lote
        </button>
      </section>
    </div>
  )
}
