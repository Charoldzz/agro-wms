import { APP_VERSION_LABEL } from '../lib/version'

export default function AppVersion() {
  return (
    <div className="pointer-events-none fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] right-2 z-50 rounded-full border border-white/60 bg-white/70 px-2 py-1 text-[10px] font-bold text-slate-500 shadow-sm backdrop-blur sm:bottom-3">
      {APP_VERSION_LABEL}
    </div>
  )
}
