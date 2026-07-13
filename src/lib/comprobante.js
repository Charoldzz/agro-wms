import { formatDate, formatDateOnly, formatNumber } from './format'

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

// Total de la nota en equivalente, separado por unidad ("475 lts · 515 kgs").
// Los items sin presentación no suman (regla: nunca mezclar uds con lts/kgs).
export function totalEquivalente(rows) {
  const totals = new Map()
  rows.forEach((row) => {
    const size = Number(row.package_size) || 0
    let unit = String(row.package_unit || '').toLowerCase().trim()
    let value = Number(row.cantidad || 0)
    if (!(size > 0) || !unit) return
    if (unit === 'ml') { unit = 'lts'; value /= 1000 }
    else if (unit === 'gr' || unit === 'grs') { unit = 'kgs'; value /= 1000 }
    else if (/^l/.test(unit)) unit = 'lts'
    else if (/^k/.test(unit)) unit = 'kgs'
    else return
    totals.set(unit, (totals.get(unit) || 0) + value)
  })
  return [...totals.entries()].map(([u, v]) => `${formatNumber(v)} ${u}`).join(' · ')
}

// Nota de operación (ingreso o salida) con la estética institucional:
// logo + línea verde, N° de nota destacado, datos, tabla y firmas.
// Debe llamarse desde un click directo del usuario (popup blocker).
function openOperationNote({ tipo, guide, empresa, contacto, transportista, placa, observaciones, rows }) {
  const win = window.open('', '_blank')
  if (!win) return false

  const esSalida = tipo === 'salida'
  const titulo = esSalida ? 'Nota de salida de mercadería' : 'Nota de ingreso de mercadería'
  const firmaIzq = esSalida ? 'Entregado por (Almacén)' : 'Entregado por (Transportista)'
  const firmaDer = esSalida ? 'Recibido por (Transportista)' : 'Recibido por (Almacén)'
  const logoUrl = `${window.location.origin}/images/todo-logo.png`

  const tableRows = rows
    .map((row, i) => {
      const size = Number(row.package_size) || 0
      const cantidad = size > 0 && row.package_unit
        ? `${formatNumber(Number(row.cantidad || 0))} ${row.package_unit}`
        : `${formatNumber(Number(row.cantidad || 0))} uds`
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${escapeHtml(row.product)}</td>
        <td class="c mono">${escapeHtml(row.lot_code)}</td>
        <td class="c">${row.expiry_date ? escapeHtml(formatDate(row.expiry_date)) : '-'}</td>
        <td class="r"><strong>${escapeHtml(cantidad)}</strong></td>
        <td class="r">${escapeHtml(row.unidades_label || formatNumber(row.uds || 0))}</td>
        <td class="r">${escapeHtml(row.cajas_label || '-')}</td>
      </tr>`
    })
    .join('')

  const total = totalEquivalente(rows)

  win.document.write(`<!doctype html>
<html>
  <head>
    <title>${escapeHtml(titulo)} ${escapeHtml(guide)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet" />
    <style>
      body { color: #0f172a; font-family: 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 26px 30px; }
      .top { align-items: center; border-bottom: 3px solid #15803d; display: flex; gap: 16px; justify-content: space-between; padding-bottom: 14px; }
      .brand { align-items: center; display: flex; gap: 14px; }
      .brand img { height: 54px; width: auto; }
      h1 { font-family: 'Bebas Neue', 'Segoe UI', Arial, sans-serif; font-size: 27px; font-weight: 400; letter-spacing: 1.5px; margin: 0; }
      .sub { color: #475569; font-family: 'Bebas Neue', 'Segoe UI', Arial, sans-serif; font-size: 13px; letter-spacing: 3px; margin: 2px 0 0; text-transform: uppercase; }
      .guide { border: 2px solid #15803d; border-radius: 10px; color: #15803d; font-family: 'Bebas Neue', 'Segoe UI', Arial, sans-serif; font-size: 24px; font-weight: 400; letter-spacing: 2px; padding: 7px 18px; text-align: center; white-space: nowrap; }
      .guide small { color: #64748b; display: block; font-family: 'Segoe UI', Arial, sans-serif; font-size: 9px; font-weight: 600; letter-spacing: 2px; }
      .datos { border: 1px solid #cbd5e1; border-radius: 10px; display: grid; gap: 12px 24px; grid-template-columns: repeat(3, 1fr); margin: 18px 0; padding: 14px 16px; }
      .datos p { margin: 0; }
      .datos .l { color: #64748b; font-size: 9px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; }
      .datos .v { font-size: 13px; font-weight: bold; margin-top: 2px; }
      .obs { grid-column: 1 / -1; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border-bottom: 1px solid #e2e8f0; font-size: 12px; font-variant-numeric: tabular-nums; padding: 8px 7px; text-align: left; vertical-align: top; }
      td { color: #0f172a; font-weight: 500; }
      th { background: #f1f5f9; color: #334155; font-size: 9.5px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; }
      td.c, th.c { text-align: center; }
      td.r, th.r { text-align: right; }
      .mono { letter-spacing: 0.3px; }
      tfoot td { background: #f0fdf4; border-bottom: none; border-top: 2px solid #15803d; color: #14532d; font-size: 12.5px; font-weight: bold; padding: 9px 7px; }
      .firmas { display: grid; gap: 40px; grid-template-columns: 1fr 1fr; margin-top: 70px; }
      .firma { border-top: 1px solid #0f172a; font-size: 11px; padding-top: 6px; text-align: center; }
      .foot { color: #94a3b8; font-size: 9.5px; margin-top: 30px; text-align: center; }
      .print-btn { background: #15803d; border: none; border-radius: 8px; bottom: 20px; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.25); color: #fff; cursor: pointer; font-size: 13px; font-weight: bold; padding: 10px 18px; position: fixed; right: 20px; }
      @media print { body { margin: 10mm; } .print-btn { display: none; } }
    </style>
  </head>
  <body>
    <button class="print-btn" onclick="window.print()">Imprimir / Guardar PDF</button>
    <div class="top">
      <div class="brand">
        <img src="${escapeHtml(logoUrl)}" alt="Todo Agricola" />
        <div>
          <h1>Todo Agr&iacute;cola Boliviana Ltda</h1>
          <p class="sub">${escapeHtml(titulo)}</p>
        </div>
      </div>
      <div class="guide"><small>N&deg; GU&Iacute;A</small>${escapeHtml(guide || '-')}</div>
    </div>
    <div class="datos">
      <div><p class="l">Empresa</p><p class="v">${escapeHtml(empresa || '-')}</p></div>
      <div><p class="l">Fecha</p><p class="v">${escapeHtml(formatDateOnly(new Date().toISOString()))}</p></div>
      <div><p class="l">Movimiento</p><p class="v">${esSalida ? 'Salida' : 'Ingreso'}</p></div>
      <div><p class="l">Transportista</p><p class="v">${escapeHtml(transportista || '-')}</p></div>
      <div><p class="l">Placa</p><p class="v">${escapeHtml(placa || '-')}</p></div>
      <div><p class="l">Contacto</p><p class="v">${escapeHtml(contacto || '-')}</p></div>
      ${observaciones ? `<div class="obs"><p class="l">Observaciones</p><p class="v">${escapeHtml(observaciones)}</p></div>` : ''}
    </div>
    <table>
      <thead>
        <tr>
          <th class="c">N&deg;</th><th>Producto</th><th class="c">Lote</th><th class="c">Venc.</th>
          <th class="r">Cantidad</th><th class="r">Unidades</th><th class="r">Cajas</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
      ${total ? `<tfoot><tr><td colspan="4">TOTAL</td><td class="r">${escapeHtml(total)}</td><td></td><td></td></tr></tfoot>` : ''}
    </table>
    <div class="firmas">
      <div class="firma">${escapeHtml(firmaIzq)}</div>
      <div class="firma">${escapeHtml(firmaDer)}</div>
    </div>
    <p class="foot">Documento generado por el sistema de almac&eacute;n de Todo Agr&iacute;cola Boliviana Ltda &mdash; Emitido el ${escapeHtml(formatDateOnly(new Date().toISOString()))}.</p>
  </body>
</html>`)
  win.document.close()
  return true
}

// Nota de salida (comprobante del despacho)
export function openDispatchReceipt(args) {
  return openOperationNote({ ...args, tipo: 'salida' })
}

// Nota de ingreso (comprobante del ingreso)
export function openEntryReceipt(args) {
  return openOperationNote({ ...args, tipo: 'ingreso' })
}
