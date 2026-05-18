export default function ConfigWarning() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f7f3] p-4">
      <div className="panel max-w-lg">
        <h1 className="text-2xl font-bold text-slate-950">Falta configurar Supabase</h1>
        <p className="mt-3 text-slate-600">
          Copia <strong>.env.example</strong> como <strong>.env</strong> y completa
          <strong> VITE_SUPABASE_URL</strong> y <strong>VITE_SUPABASE_ANON_KEY</strong>.
        </p>
      </div>
    </div>
  )
}
