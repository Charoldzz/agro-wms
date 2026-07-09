import { useEffect, useMemo, useState } from 'react'
import { Download, FileText, RefreshCcw, Search } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import SimpleDateSelect from '../components/SimpleDateSelect'
import { cleanProductName, displayLotCode, packageLabel } from '../lib/display'
import { formatDate, formatNumber, movementLabel } from '../lib/format'
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
  return `${formatNumber(Number(item.current_quantity || item.quantity || 0) * size)} ${item.package_unit || ''}`.trim()
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
        .select('*, lots(lot_code, product, package_size, package_unit, location, expiry_date, clients(name)), profiles(full_name)')
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

  const inventoryHeaders = ['Cliente', 'Producto', 'Lote', 'Unidades', 'Presentacion', 'Equivalente', 'Ubicacion', 'Ingreso', 'Vencimiento', 'Estado']
  const inventoryRows = filteredLots.map((lot) => [
    lot.clients?.name || '',
    cleanProductName(lot.product),
    displayLotCode(lot.lot_code),
    formatNumber(lot.current_quantity),
    packageLabel(lot) || '',
    equivalentLabel(lot),
    lot.location || '',
    lot.entry_date ? formatDate(lot.entry_date) : '',
    lot.expiry_date ? formatDate(lot.expiry_date) : '',
    lot.status || '',
  ])

  const movementHeaders = ['Fecha', 'Tipo', 'Cliente', 'Producto', 'Lote', 'Cantidad', 'Equivalente', 'Stock anterior', 'Stock nuevo', 'Ubicacion', 'Usuario']
  const movementRows = filteredMovements.map((movement) => [
    movement.created_at ? formatDate(movement.created_at) : '',
    movementLabel(movement.type),
    movement.lots?.clients?.name || '',
    cleanProductName(movement.lots?.product),
    displayLotCode(movement.lots?.lot_code),
    formatNumber(movement.quantity),
    equivalentLabel({ ...movement.lots, quantity: movement.quantity }),
    formatNumber(movement.previous_quantity),
    formatNumber(movement.new_quantity),
    movement.lots?.location || movement.to_location || '',
    movement.profiles?.full_name || '',
  ])

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

        <div className="grid gap-3 lg:grid-cols-[1fr_220px_180px_160px_160px]">
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
            <span className="label">Tipo</span>
            <select className="input mt-1" value={movementType} onChange={(event) => setMovementType(event.target.value)}>
              <option value="">Todos</option>
              <option value="entrada">Ingreso</option>
              <option value="salida">Despacho</option>
              <option value="traslado">Traslado</option>
              <option value="ajuste">Reparo</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Desde</span>
            <div className="mt-1">
              <SimpleDateSelect
                value={dateFrom}
                onChange={setDateFrom}
                clearLabel="Sin fecha"
                previewLabel="Desde"
                startYear={new Date().getFullYear() - 5}
                endYear={new Date().getFullYear() + 2}
              />
            </div>
          </label>
          <label className="block">
            <span className="label">Hasta</span>
            <div className="mt-1">
              <SimpleDateSelect
                value={dateTo}
                onChange={setDateTo}
                clearLabel="Sin fecha"
                previewLabel="Hasta"
                startYear={new Date().getFullYear() - 5}
                endYear={new Date().getFullYear() + 2}
              />
            </div>
          </label>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <ExportPanel
          title="Inventario actual"
          description={`${formatNumber(filteredLots.length)} lotes filtrados. Incluye cliente, producto, lote, fecha, vencimiento y stock.`}
          onExcel={() => rowsToExcel('inventario-todo-agricola', inventoryHeaders, inventoryRows)}
          onPdf={() => printReport('Inventario actual', inventoryHeaders, inventoryRows)}
        >
          {inventoryRows.length === 0 ? <EmptyState title="Sin inventario" text="Ajusta los filtros para ver resultados." /> : inventoryRows.slice(0, 8).map((row) => (
            <PreviewRow key={`${row[0]}-${row[2]}-${row[3]}`} title={row[1]} meta={`${row[0]} - ${row[2]} - vence ${row[8] || '-'}`} value={`${row[3]} uds`} />
          ))}
        </ExportPanel>

        <ExportPanel
          title="Movimientos"
          description={`${formatNumber(filteredMovements.length)} movimientos filtrados. Incluye usuario, stock anterior y stock nuevo.`}
          onExcel={() => rowsToExcel('movimientos-todo-agricola', movementHeaders, movementRows)}
          onPdf={() => printReport('Movimientos de inventario', movementHeaders, movementRows)}
        >
          {movementRows.length === 0 ? <EmptyState title="Sin movimientos" text="Ajusta los filtros para ver resultados." /> : movementRows.slice(0, 8).map((row) => (
            <PreviewRow key={`${row[0]}-${row[2]}-${row[4]}-${row[5]}`} title={row[3]} meta={`${row[1]} - ${row[2]} - ${row[0]}`} value={`${row[5]} uds`} />
          ))}
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

function PreviewRow({ title, meta, value }) {
  return (
    <article className="rounded-lg bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-black leading-snug text-slate-950 [overflow-wrap:anywhere]">{title}</p>
          <p className="text-xs font-semibold text-slate-500 [overflow-wrap:anywhere]">{meta}</p>
        </div>
        <span className="rounded-lg bg-campo-50 px-2 py-1 text-sm font-black text-campo-800">{value}</span>
      </div>
    </article>
  )
}
