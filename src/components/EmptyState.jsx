export default function EmptyState({ title, text }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
      <h3 className="text-lg font-bold text-slate-800">{title}</h3>
      <p className="mt-2 text-sm text-slate-500">{text}</p>
    </div>
  )
}
