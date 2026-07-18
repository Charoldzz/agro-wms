import ExcelJS from 'exceljs'
import { docFontsCss } from './comprobante'
import { formatDateOnly } from './format'

const COMPANY = 'Todo Agrícola Boliviana Ltda'

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

// Letra de columna de Excel (1→A, 27→AA)
function colLetter(n) {
  let s = ''
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
  return s
}

// Excel institucional (título verde de la empresa, cabecera verde, tabla de Excel
// estilizada). Genérico: recibe {title, headers, rows}. Mismo diseño que el Excel
// del portal del cliente.
export async function exportTableExcel({ fileName, sheetName = 'Datos', title, headers, rows }) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName)
  const n = headers.length
  const last = colLetter(n)
  ws.columns = headers.map((h) => ({ width: /producto|nombre|cliente/i.test(h) ? 38 : 16 }))

  const titleRow = ws.addRow([COMPANY])
  ws.mergeCells(`A1:${last}1`)
  titleRow.height = 28
  titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
  titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D593A' } }
  titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }

  const subRow = ws.addRow([`${title} · ${formatDateOnly(new Date().toISOString())}`])
  ws.mergeCells(`A2:${last}2`)
  subRow.getCell(1).font = { italic: true, size: 10, color: { argb: 'FF475569' } }
  subRow.getCell(1).alignment = { horizontal: 'left', indent: 1 }

  ws.addRow([])

  if (rows.length > 0) {
    ws.addTable({
      name: `Tabla${(sheetName || 'Datos').replace(/[^a-z0-9]/gi, '')}`,
      ref: 'A4',
      headerRow: true,
      style: { theme: null, showRowStripes: false },
      columns: headers.map((name) => ({ name, filterButton: false })),
      rows,
    })
  } else {
    ws.addRow(headers)
  }

  const hdrRow = ws.getRow(4)
  hdrRow.height = 18
  for (let c = 1; c <= n; c++) {
    const cell = hdrRow.getCell(c)
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6F45' } }
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: c === 1 ? 1 : 0 }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF1D593A' } } }
  }
  rows.forEach((_, i) => {
    const row = ws.getRow(5 + i)
    for (let c = 1; c <= n; c++) {
      const cell = row.getCell(c)
      cell.font = { size: 10 }
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: c === 2 }
      cell.border = { top: { style: 'thin', color: { argb: 'FFCBD5E1' } } }
    }
  })

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${fileName}-${new Date().toISOString().slice(0, 10)}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

// PDF institucional (logo + Bebas Neue + línea verde + tabla) — misma estética que
// los comprobantes y el inventario del portal. Genérico: {title, headers, rows, meta}.
export function printTablePdf({ title, headers, rows, meta = [] }) {
  const w = window.open('', '_blank')
  if (!w) return
  const logoUrl = `${window.location.origin}/images/todo-logo.png`
  const fecha = formatDateOnly(new Date().toISOString())
  const thead = headers.map((h) => `<th>${esc(h)}</th>`).join('')
  const tbody = rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
  const metaCols = meta.map((m) => `<div><p class="l">${esc(m.label)}</p><p class="v">${esc(m.value)}</p></div>`).join('')

  w.document.write(`<!doctype html><html><head><title>${esc(title)}</title>
<style>
  ${docFontsCss()}
  body { color:#0f172a; font-family:'Inter','Segoe UI',Arial,sans-serif; margin:26px 30px; }
  .top { align-items:center; border-bottom:3px solid #15803d; display:flex; gap:16px; justify-content:space-between; padding-bottom:14px; }
  .brand { align-items:center; display:flex; gap:14px; }
  .brand img { height:54px; width:auto; }
  h1 { font-family:'Bebas Neue','Segoe UI',Arial,sans-serif; font-size:27px; font-weight:400; letter-spacing:1.5px; margin:0; }
  .subttl { color:#475569; font-family:'Bebas Neue','Segoe UI',Arial,sans-serif; font-size:13px; letter-spacing:3px; margin:2px 0 0; text-transform:uppercase; }
  .guide { border:2px solid #15803d; border-radius:10px; color:#15803d; font-family:'Bebas Neue','Segoe UI',Arial,sans-serif; font-size:18px; letter-spacing:1.5px; padding:7px 16px; text-align:center; white-space:nowrap; }
  .guide small { color:#64748b; display:block; font-family:'Segoe UI',Arial,sans-serif; font-size:8.5px; font-weight:600; letter-spacing:2px; }
  .op { border-left:4px solid #15803d; margin:18px 0; padding:4px 0 4px 16px; }
  .op .empresa { font-size:18px; font-weight:600; margin:0 0 8px; }
  .op .cols { display:flex; flex-wrap:wrap; gap:12px 36px; }
  .op .cols p { margin:0; }
  .op .cols .l { color:#64748b; font-size:9px; font-weight:600; letter-spacing:1px; text-transform:uppercase; }
  .op .cols .v { font-size:13px; font-weight:600; margin-top:2px; }
  table { border-collapse:collapse; width:100%; }
  th, td { border-bottom:1px solid #e2e8f0; font-size:11px; font-variant-numeric:tabular-nums; padding:7px 6px; text-align:left; vertical-align:top; }
  td { color:#0f172a; font-weight:500; }
  th { background:#f1f5f9; color:#334155; font-size:9px; font-weight:600; letter-spacing:.5px; text-transform:uppercase; }
  .foot { color:#94a3b8; font-size:9.5px; margin-top:30px; text-align:center; }
  .print-btn { background:#15803d; border:none; border-radius:8px; bottom:20px; box-shadow:0 4px 12px rgba(15,23,42,.25); color:#fff; cursor:pointer; font-size:13px; font-weight:bold; padding:10px 18px; position:fixed; right:20px; }
  @media print { body { margin:10mm; } .print-btn { display:none; } }
</style></head><body>
<button class="print-btn" onclick="window.print()">Imprimir / Guardar PDF</button>
<div class="top">
  <div class="brand"><img src="${esc(logoUrl)}" alt="Todo Agricola" /><div><h1>Todo Agr&iacute;cola Boliviana Ltda</h1><p class="subttl">${esc(title)}</p></div></div>
  <div class="guide"><small>EMITIDO</small>${esc(fecha)}</div>
</div>
<div class="op">
  <p class="empresa">${esc(title)}</p>
  <div class="cols">${metaCols}</div>
</div>
<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
<p class="foot">Documento generado por el sistema de almac&eacute;n de Todo Agr&iacute;cola Boliviana Ltda &mdash; Emitido el ${esc(fecha)}.</p>
</body></html>`)
  w.document.close()
}
