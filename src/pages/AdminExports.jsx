import { useEffect, useMemo, useState } from 'react'
import { Download, FileText, RefreshCcw, Search } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import SimpleDateSelect from '../components/SimpleDateSelect'
import { cleanProductName, displayLotCode, packageLabel } from '../lib/display'
import { formatDate, formatNumber, movementLabel, equivalentLabel as fmtEquivalent } from '../lib/format'
import { exportTableExcel, printTablePdf } from '../lib/exports'
import { desgloseEnvases } from '../lib/envases'
import { supabase } from '../lib/supabase'

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function equivalentLabel(item) {
  const size = Number(item?.package_size || 0)
  if (size <= 0) return ''
  return fmtEquivalent(Number(item.current_quantity || item.quantity || 0) * size, item.package_unit)
}

function rowsToExcel(name, headers, rows) {
  const tableRows = [headers, ...rows]
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('')
  const html = `<html><head><meta charset="utf-8" /></head><body><table>${tableRows}</table></body></html>`
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${name}-${new Date().toISOString().slice(0, 10)}.xls`
  link.click()
  URL.revokeObjectURL(url)
}

function printReport(title, headers, rows) {
  const tableRows = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('')
  const printWindow = window.open('', '_blank')
  if (!printWindow) return

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body { color: #0f172a; font-family: Arial, sans-serif; margin: 24px; }
          h1 { margin: 0 0 4px; }
          p { color: #475569; margin: 4px 0 18px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border-bottom: 1px solid #cbd5e1; font-size: 11px; padding: 7px; text-align: left; vertical-align: top; }
          th { background: #f1f5f9; color: #334155; }
          .print-btn { background: #15803d; border: none; border-radius: 8px; color: #fff; cursor: pointer; font-size: 13px; font-weight: bold; padding: 10px 18px; position: fixed; right: 20px; top: 20px; }
          @media print { body { margin: 10mm; } .print-btn { display: none; } }
        </style>
      </head>
      <body>
        <button class="print-btn" onclick="window.print()">Imprimir / Guardar PDF</button>
        <h1>Todo Agricola Boliviana Ltda</h1>
        <p>${escapeHtml(title)} - Emitido ${escapeHtml(formatDate(new Date().toISOString()))}</p>
        <table>
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>
  `)
  printWindow.document.close()
}

export default function AdminExports() {
  const [lots, setLots] = useState([])
  const [movements, setMovements] = useState([])
  const [search, setSearch] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [movementType, setMovementType] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [notice, setNotice] = useState('')
  const [syncStatus, setSyncStatus] = useState('')
  const [syncing, setSyncing] = useState(false)

  async function exportForDesktop() {
    setSyncing(true)
    setSyncStatus('')
    const { data, error } = await supabase
      .from('movements')
      .select('id, type, quantity, notes, created_at, operation_id, lots(lot_code, product, solucion_product_code, package_size, package_unit, clients(name)), warehouse_operations(guide_number)')
      .not('operation_id', 'is', null)
      .in('type', ['entrada', 'salida'])
      .order('created_at', { ascending: true })

    if (error) {
      setSyncStatus('No se pudieron cargar las operaciones web.')
      setSyncing(false)
      return
    }

    const exportMovements = (data || []).map((m) => ({
      NoteNumber: m.warehouse_operations?.guide_number || '',
      Type: m.type === 'entrada' ? 'INGRESO' : 'SALIDA',
      Date: m.created_at,
      ProductCode: m.lots?.solucion_product_code || '',
      ProductName: cleanProductName(m.lots?.product) || '',
      Lot: displayLotCode(m.lots?.lot_code, m.lots) || '',
      Quantity: Number(m.quantity || 0),
      PackageSize: Number(m.lots?.package_size || 0) || null,
      PackageUnit: m.lots?.package_unit || null,
      DispatchCompany: m.lots?.clients?.name || '',
      Observations: m.notes || '',
      WebMovementId: m.id,
    }))

    const payload = {
      GeneratedAt: new Date().toISOString(),
      Source: 'todo-agricola-web',
      FormatVersion: 1,
      Movements: exportMovements,
    }
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `operaciones-web-para-programa-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    setSyncStatus(`Archivo generado: ${exportMovements.length} operaciones web listas para importar en el programa.`)
    setSyncing(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const [{ data: lotRows, error: lotError }, { data: movementRows, error: movementError }] = await Promise.all([
      supabase
        .from('lots')
        .select('*, clients(name)')
        .eq('inventory_source', 'stock_independiente')
        .eq('status', 'activo')
        .gt('current_quantity', 0)
        .order('product'),
      supabase
        .from('movements')
        .select('*, lots(lot_code, product, package_size, package_unit, location, expiry_date, clients(name)), profiles!movements_user_id_fkey(full_name)')
        .order('created_at', { ascending: false })
        .limit(1500),
    ])

    const safeLots = lotRows || []
    let safeMovements = movementRows || []

    setNotice(lotError ? 'No se pudo cargar el inventario para exportar. Revisa la conexion o intenta nuevamente.' : '')

    if (movementError) {
      const { data: fallbackMovements, error: fallbackError } = await supabase
        .from('movements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1500)

      if (!fallbackError) {
        const lotMap = new Map(safeLots.map((lot) => [lot.id, lot]))
        safeMovements = (fallbackMovements || []).map((movement) => ({
          ...movement,
          lots: lotMap.get(movement.lot_id) || null,
          profiles: null,
        }))
      } else {
        safeMovements = []
      }
    }

    setLots(safeLots)
    setMovements(safeMovements)
  }

  function clearFilters() {
    setSearch('')
    setClientFilter('')
    setMovementType('')
    setDateFrom('')
    setDateTo('')
  }

  // Rangos rápidos de fecha para los movimientos
  function applyDatePreset(preset) {
    const now = new Date()
    const iso = (d) => d.toISOString().slice(0, 10)
    if (preset === 'hoy') { const d = iso(now); setDateFrom(d); setDateTo(d) }
    else if (preset === 'semana') { const s = new Date(now); s.setDate(now.getDate() - now.getDay()); setDateFrom(iso(s)); setDateTo(iso(now)) }
    else if (preset === 'mes') { setDateFrom(iso(new Date(now.getFullYear(), now.getMonth(), 1))); setDateTo(iso(now)) }
    else if (preset === 'anio') { setDateFrom(iso(new Date(now.getFullYear(), 0, 1))); setDateTo(iso(now)) }
    else { setDateFrom(''); setDateTo('') }
  }

  const clients = useMemo(() => {
    return [...new Set(lots.map((lot) => lot.clients?.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))
  }, [lots])

  const filteredLots = useMemo(() => {
    const term = search.toLowerCase().trim()
    return lots.filter((lot) => {
      const matchesClient = !clientFilter || lot.clients?.name === clientFilter
      const matchesSearch = !term || [lot.clients?.name, lot.product, lot.lot_code, displayLotCode(lot.lot_code), lot.location, lot.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
      return matchesClient && matchesSearch
    })
  }, [lots, search, clientFilter])

  const filteredMovements = useMemo(() => {
    const term = search.toLowerCase().trim()
    return movements.filter((movement) => {
      const created = movement.created_at ? movement.created_at.slice(0, 10) : ''
      const matchesType = !movementType || movement.type === movementType
      const matchesClient = !clientFilter || movement.lots?.clients?.name === clientFilter
      const matchesFrom = !dateFrom || created >= dateFrom
      const matchesTo = !dateTo || created <= dateTo
      const matchesSearch = !term || [movement.type, movement.notes, movement.lots?.clients?.name, movement.lots?.product, movement.lots?.lot_code, movement.lots?.location, movement.profiles?.full_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
      return matchesType && matchesClient && matchesFrom && matchesTo && matchesSearch
    })
  }, [movements, search, clientFilter, movementType, dateFrom, dateTo])

  const inventoryHeaders = ['Cliente', 'Producto', 'Lote', 'Cantidad', 'Unidades', 'Presentacion', 'Ubicacion', 'Ingreso', 'Vencimiento', 'Estado']
  const inventoryRows = filteredLots.map((lot) => {
    const size = Number(lot.package_size) || 0
    const unidades = size > 0
      ? desgloseEnvases(Number(lot.current_quantity || 0) * size, size, lot.package_unit, 0).unidadesLabel
      : `${formatNumber(lot.current_quantity)} uds`
    return [
      lot.clients?.name || '',
      cleanProductName(lot.product),
      displayLotCode(lot.lot_code),
      equivalentLabel(lot) || `${formatNumber(lot.current_quantity)} uds`,
      unidades,
      packageLabel(lot) || '',
      lot.location || '',
      lot.entry_date ? formatDate(lot.entry_date) : '',
      lot.expiry_date ? formatDate(lot.expiry_date) : '',
      lot.status || '',
    ]
  })

  const movementHeaders = ['Fecha', 'Tipo', 'Cliente', 'Producto', 'Lote', 'Cantidad', 'Unidades', 'Stock anterior', 'Stock nuevo', 'Ubicacion', 'Usuario']
  const movementRows = filteredMovements.map((movement) => {
    const size = Number(movement.lots?.package_size) || 0
    const unit = movement.lots?.package_unit
    const eqOf = (uds) => (size > 0 ? fmtEquivalent(Number(uds || 0) * size, unit) : `${formatNumber(uds)} uds`)
    const envOf = (uds) => (size > 0 ? desgloseEnvases(Number(uds || 0) * size, size, unit, 0).unidadesLabel : `${formatNumber(uds)} uds`)
    return [
      movement.created_at ? formatDate(movement.created_at) : '',
      movementLabel(movement.type),
      movement.lots?.clients?.name || '',
      cleanProductName(movement.lots?.product),
      displayLotCode(movement.lots?.lot_code),
      eqOf(movement.quantity),
      envOf(movement.quantity),
      eqOf(movement.previous_quantity),
      eqOf(movement.new_quantity),
      movement.lots?.location || movement.to_location || '',
      movement.profiles?.full_name || '',
    ]
  })

  return (
    <div>
      <PageHeader title="Exportes" subtitle="Inventario, lotes, vencimientos y movimientos" />

      {notice ? <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-800">{notice}</div> : null}

      <section className="panel mb-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-black text-slate-950">Filtros</h3>
            <p className="text-xs font-semibold text-slate-500">Elige que informacion quieres exportar.</p>
          </div>
          <button className="text-sm font-black text-campo-700" type="button" onClick={clearFilters}>
            Limpiar
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block">
            <span className="label">Buscar</span>
            <div className="mt-1 flex items-center rounded-lg border border-slate-200 bg-white px-3">
              <Search size={20} className="text-slate-400" />
              <input className="min-h-12 flex-1 bg-transparent px-2 outline-none" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cliente, producto, lote..." />
            </div>
          </label>
          <label className="block">
            <span className="label">Cliente</span>
            <select className="input mt-1" value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}>
              <option value="">Todos los clientes</option>
              {clients.map((client) => <option key={client} value={client}>{client}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Tipo de movimiento</span>
            <select className="input mt-1" value={movementType} onChange={(event) => setMovementType(event.target.value)}>
              <option value="">Todos</option>
              <option value="entrada">Ingreso</option>
              <option value="salida">Salida</option>
              <option value="traslado">Traslado</option>
              <option value="ajuste">Reparo</option>
            </select>
          </label>
        </div>
        <div className="mt-3">
          <span className="label">Fechas (solo movimientos)</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {[['hoy', 'Hoy'], ['semana', 'Esta semana'], ['mes', 'Este mes'], ['anio', 'Este año'], ['todo', 'Todo']].map(([key, label]) => {
              const active = key === 'todo' ? (!dateFrom && !dateTo) : false
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyDatePreset(key)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${active ? 'border-campo-400 bg-campo-50 text-campo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  {label}
                </button>
              )
            })}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <input type="date" className="input !min-h-10 !w-auto" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
              <span className="text-xs font-bold text-slate-400">a</span>
              <input type="date" className="input !min-h-10 !w-auto" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </div>
          </div>
        </div>
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
          <b className="text-slate-700">Cliente</b> filtra el inventario y los movimientos. <b className="text-slate-700">Fecha</b> y <b className="text-slate-700">Tipo</b> aplican solo a los movimientos.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <ExportPanel
          title="Inventario actual"
          description={`${formatNumber(filteredLots.length)} lotes filtrados. Incluye cliente, producto, lote, fecha, vencimiento y stock.`}
          onExcel={() => exportTableExcel({ fileName: 'inventario-todo-agricola', sheetName: 'Inventario', title: 'Inventario actual', headers: inventoryHeaders, rows: inventoryRows }).catch((e) => alert(`Error al generar Excel: ${e.message}`))}
          onPdf={() => printTablePdf({ title: 'Inventario actual', headers: inventoryHeaders, rows: inventoryRows, meta: [{ label: 'Lotes', value: formatNumber(filteredLots.length) }] })}
        >
          {inventoryRows.length === 0 ? <EmptyState title="Sin inventario" text="Ajusta los filtros para ver resultados." /> : filteredLots.slice(0, 8).map((lot) => {
            const size = Number(lot.package_size) || 0
            const eq = equivalentLabel(lot)
            const env = size > 0 ? desgloseEnvases(Number(lot.current_quantity || 0) * size, size, lot.package_unit, 0).unidadesLabel : ''
            return (
              <PreviewRow
                key={lot.id}
                title={cleanProductName(lot.product)}
                meta={`${lot.clients?.name || '-'} · ${displayLotCode(lot.lot_code)} · vence ${lot.expiry_date ? formatDate(lot.expiry_date) : '-'}`}
                value={eq || `${formatNumber(lot.current_quantity)} uds`}
                sub={env}
              />
            )
          })}
        </ExportPanel>

        <ExportPanel
          title="Movimientos"
          description={`${formatNumber(filteredMovements.length)} movimientos filtrados. Incluye usuario, stock anterior y stock nuevo.`}
          onExcel={() => exportTableExcel({ fileName: 'movimientos-todo-agricola', sheetName: 'Movimientos', title: 'Movimientos de inventario', headers: movementHeaders, rows: movementRows }).catch((e) => alert(`Error al generar Excel: ${e.message}`))}
          onPdf={() => printTablePdf({ title: 'Movimientos de inventario', headers: movementHeaders, rows: movementRows, meta: [{ label: 'Movimientos', value: formatNumber(filteredMovements.length) }] })}
        >
          {movementRows.length === 0 ? <EmptyState title="Sin movimientos" text="Ajusta los filtros para ver resultados." /> : filteredMovements.slice(0, 8).map((movement) => {
            const size = Number(movement.lots?.package_size) || 0
            const eqRaw = size > 0 ? Number(movement.quantity || 0) * size : Number(movement.quantity || 0)
            const eq = equivalentLabel({ ...movement.lots, quantity: movement.quantity })
            const env = size > 0 ? desgloseEnvases(eqRaw, size, movement.lots?.package_unit, 0).unidadesLabel : ''
            return (
              <PreviewRow
                key={movement.id}
                title={cleanProductName(movement.lots?.product)}
                meta={`${movement.lots?.clients?.name || '-'} · ${formatDate(movement.created_at)}`}
                value={eq || `${formatNumber(movement.quantity)} uds`}
                sub={env}
                movementType={movement.type}
              />
            )
          })}
        </ExportPanel>
      </section>

      <section className="panel mt-4 flex flex-wrap items-center justify-between gap-3 border-dashed border-slate-300">
        <div>
          <h3 className="font-black text-slate-950">Sincronización con el programa</h3>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            Descarga las operaciones registradas en la web (ingresos y salidas con guía) en formato JSON para importarlas en el Panel Stock.
          </p>
          {syncStatus ? <p className="mt-1 text-sm font-bold text-campo-700">{syncStatus}</p> : null}
        </div>
        <button className="btn-secondary !min-h-11" type="button" onClick={exportForDesktop} disabled={syncing}>
          <RefreshCcw size={18} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Generando...' : 'Exportar para el programa'}
        </button>
      </section>
    </div>
  )
}

function ExportPanel({ title, description, children, onExcel, onPdf }) {
  return (
    <section className="panel">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-black text-slate-950">{title}</h3>
          <p className="mt-1 text-sm font-semibold text-slate-500">{description}</p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <button className="btn-secondary !min-h-10 !px-3 !py-2" type="button" onClick={onExcel}>
            <Download size={18} /> Excel
          </button>
          <button className="btn-secondary !min-h-10 !px-3 !py-2" type="button" onClick={onPdf}>
            <FileText size={18} /> PDF
          </button>
        </div>
      </div>
      <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">{children}</div>
    </section>
  )
}

const MOVEMENT_TONE = {
  entrada: 'bg-campo-100 text-campo-800',
  salida: 'bg-red-100 text-red-800',
  traslado: 'bg-blue-100 text-blue-800',
  ajuste: 'bg-orange-100 text-orange-800',
}
const MOVEMENT_SHORT = { entrada: 'Ingreso', salida: 'Salida', traslado: 'Traslado', ajuste: 'Reparo' }

function PreviewRow({ title, meta, value, sub, movementType }) {
  return (
    <article className="rounded-lg border border-slate-100 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {movementType ? (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${MOVEMENT_TONE[movementType] || 'bg-slate-100 text-slate-700'}`}>
                {MOVEMENT_SHORT[movementType] || movementType}
              </span>
            ) : null}
            <p className="font-black leading-snug text-slate-950 [overflow-wrap:anywhere]">{title}</p>
          </div>
          <p className="mt-0.5 text-xs font-semibold text-slate-500 [overflow-wrap:anywhere]">{meta}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-black text-campo-800 whitespace-nowrap">{value}</p>
          {sub ? <p className="text-[10px] font-semibold text-slate-400 whitespace-nowrap">{sub}</p> : null}
        </div>
      </div>
    </article>
  )
}
