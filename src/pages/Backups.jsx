import { useState } from 'react'
import { CalendarCheck, DatabaseBackup, Download, FileArchive, RotateCcw, ShieldCheck } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { supabase } from '../lib/supabase'

const BACKUP_TABLES = [
  'clients',
  'lots',
  'movements',
  'warehouse_operations',
  'product_catalog',
  'client_dispatch_requests',
  'desktop_movements',
]

export default function Backups() {
  const [downloading, setDownloading] = useState(false)
  const [status, setStatus] = useState('')

  async function downloadBackup() {
    setDownloading(true)
    setStatus('')
    try {
      const backup = { exported_at: new Date().toISOString(), source: 'todo-agricola-web', tables: {} }
      for (const table of BACKUP_TABLES) {
        const rows = []
        const pageSize = 1000
        for (let from = 0; ; from += pageSize) {
          const { data, error } = await supabase.from(table).select('*').range(from, from + pageSize - 1)
          if (error) { backup.tables[table] = { error: error.message }; break }
          rows.push(...(data || []))
          if (!data || data.length < pageSize) { backup.tables[table] = rows; break }
        }
      }
      const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `backup-todo-agricola-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
      const total = Object.values(backup.tables).reduce((sum, t) => sum + (Array.isArray(t) ? t.length : 0), 0)
      setStatus(`Backup descargado: ${total.toLocaleString('es-BO')} registros de ${BACKUP_TABLES.length} tablas. Guardalo en Drive/OneDrive.`)
    } catch (err) {
      setStatus('No se pudo generar el backup. Revisa la conexión e intenta de nuevo.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div>
      <PageHeader title="Backups" subtitle="Politica de respaldo y recuperacion" />

      <section className="panel mb-4 flex flex-wrap items-center justify-between gap-3 border-2 border-campo-200">
        <div>
          <h3 className="font-black text-slate-950">Backup manual ahora</h3>
          <p className="mt-1 text-sm font-semibold text-slate-600">
            Descarga todas las tablas (clientes, lotes, movimientos, catálogo, solicitudes e historial del programa) en un archivo JSON.
          </p>
          {status ? <p className="mt-1 text-sm font-bold text-campo-700">{status}</p> : null}
        </div>
        <button className="btn-primary !min-h-11" type="button" onClick={downloadBackup} disabled={downloading}>
          <Download size={18} /> {downloading ? 'Generando...' : 'Descargar backup'}
        </button>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <BackupCard
          icon={DatabaseBackup}
          title="Backup automatico diario"
          tone="campo"
          text="Debe quedar activo en Supabase Pro para cubrir borrados, importaciones malas o errores grandes del dia anterior."
          items={['Activar en Supabase antes del piloto oficial.', 'Revisar que el proyecto tenga backups visibles.', 'Hacer backup manual antes de correr SQL fuerte o importar Excel.']}
        />
        <BackupCard
          icon={RotateCcw}
          title="PITR para uso oficial"
          tone="amber"
          text="Cuando el sistema ya opere oficialmente, conviene recuperar a un minuto exacto y no solo al dia anterior."
          items={['Activar Point-in-Time Recovery si el almacen depende del sistema.', 'Usarlo para errores graves de datos.', 'Probar restauracion en proyecto separado.']}
        />
        <BackupCard
          icon={FileArchive}
          title="Copia externa semanal"
          tone="slate"
          text="Ademas del backup de Supabase, guardar una copia fuera de la plataforma protege contra errores de cuenta, permisos o facturacion."
          items={['Exportar con Supabase CLI o pg_dump.', 'Guardar en Drive/OneDrive empresarial.', 'Conservar copias mensuales historicas.']}
        />
        <BackupCard
          icon={ShieldCheck}
          title="Prueba de restauracion"
          tone="orange"
          text="Un backup que nunca se prueba no es confiable. Hay que restaurar en un proyecto nuevo antes de tocar produccion."
          items={['Probar restauracion cada 3 meses.', 'Documentar quien la hizo y fecha.', 'Nunca restaurar directo encima de produccion sin revisar.']}
        />
      </section>

      <section className="panel mt-4">
        <div className="flex items-start gap-3">
          <CalendarCheck className="mt-1 text-campo-700" size={24} />
          <div>
            <h3 className="font-black text-slate-950">Regla operativa recomendada</h3>
            <div className="mt-3 grid gap-2 text-sm font-bold text-slate-700 sm:grid-cols-2">
              <PolicyItem label="Diario" value="Backup automatico Supabase." />
              <PolicyItem label="Semanal" value="Copia externa descargada." />
              <PolicyItem label="Mensual" value="Copia historica guardada." />
              <PolicyItem label="Antes de cambios grandes" value="Backup manual obligatorio." />
            </div>
          </div>
        </div>
      </section>

      <section className="panel mt-4">
        <h3 className="font-black text-slate-950">Comando de referencia para copia externa</h3>
        <p className="mt-1 text-sm font-semibold text-slate-500">Este comando se ejecuta en Git Bash o PowerShell dentro del proyecto, despues de tener Supabase CLI conectado.</p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs font-bold text-white">
{`supabase db dump --linked --file backups/todo-agricola-YYYY-MM-DD.sql`}
        </pre>
      </section>
    </div>
  )
}

function BackupCard({ icon: Icon, title, text, items, tone }) {
  const toneClass = {
    campo: 'bg-campo-50 text-campo-800',
    amber: 'bg-amber-50 text-amber-800',
    slate: 'bg-slate-100 text-slate-700',
    orange: 'bg-orange-50 text-orange-700',
  }[tone]

  return (
    <section className="panel">
      <div className="flex items-start gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${toneClass}`}>
          <Icon size={22} />
        </span>
        <div>
          <h3 className="font-black text-slate-950">{title}</h3>
          <p className="mt-1 text-sm font-semibold text-slate-600">{text}</p>
        </div>
      </div>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item} className="rounded-lg bg-slate-50 p-2 text-sm font-bold text-slate-700">{item}</li>
        ))}
      </ul>
    </section>
  )
}

function PolicyItem({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs font-black uppercase text-slate-400">{label}</p>
      <p className="mt-1 text-slate-950">{value}</p>
    </div>
  )
}
