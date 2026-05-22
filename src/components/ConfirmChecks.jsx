import { CheckCircle2 } from 'lucide-react'

const defaultItems = [
  { key: 'product', label: 'Producto correcto' },
  { key: 'client', label: 'Cliente correcto' },
  { key: 'quantity', label: 'Cantidad correcta' },
]

export function emptyConfirmChecks() {
  return defaultItems.reduce((checks, item) => ({ ...checks, [item.key]: false }), {})
}

export function allConfirmChecksDone(checks) {
  return defaultItems.every((item) => checks[item.key])
}

export default function ConfirmChecks({ checks, onChange, items = defaultItems }) {
  return (
    <fieldset className="mt-3 rounded-lg border border-campo-100 bg-campo-50/70 p-3">
      <legend className="px-1 text-xs font-black uppercase text-campo-700">Validacion operativa</legend>
      <div className="grid gap-2">
        {items.map((item) => (
          <label key={item.key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg bg-white px-3 py-2 text-sm font-black text-slate-800">
            <input
              className="h-5 w-5 accent-emerald-700"
              type="checkbox"
              checked={Boolean(checks[item.key])}
              onChange={(event) => onChange((value) => ({ ...value, [item.key]: event.target.checked }))}
            />
            <CheckCircle2 size={18} className={checks[item.key] ? 'text-campo-700' : 'text-slate-300'} />
            <span>{item.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
