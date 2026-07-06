import { formatDate, formatNumber } from './format'

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

// Abre la nota de salida en una pestaña nueva, lista para imprimir o guardar como PDF.
// Debe llamarse desde un click directo del usuario para evitar el bloqueador de popups.
export function openDispatchReceipt({ guide, empresa, contacto, transportista, placa, observaciones, rows }) {
  const win = window.open('', '_blank')
  if (!win) return false

  const tableRows = rows
    .map((row, i) => {
      const size = Number(row.package_size) || 0
      const equivalente = size > 0 && row.package_unit
        ? `${formatNumber(Number(row.cantidad || 0))} ${row.package_unit}`
        : formatNumber(row.cantidad)
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${escapeHtml(row.product)}</td>
        <td class="c">${escapeHtml(row.lot_code)}</td>
        <td class="c">${row.expiry_date ? escapeHtml(formatDate(row.expiry_date)) : '-'}</td>
        <td class="r">${escapeHtml(equivalente)}</td>
        <td class="r">${escapeHtml(formatNumber(row.uds))}</td>
        <td class="r">${row.cajas ? escapeHtml(formatNumber(row.cajas)) : '-'}</td>
      </tr>`
    })
    .join('')

  win.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Nota de salida ${escapeHtml(guide)}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body { color: #0f172a; font-family: Arial, sans-serif; margin: 24px; }
          .head { align-items: flex-start; display: flex; justify-content: space-between; }
          h1 { font-size: 20px; margin: 0; }
          .sub { color: #475569; font-size: 12px; margin: 2px 0 0; }
          .guide { border: 2px solid #15803d; border-radius: 8px; color: #15803d; font-family: monospace; font-size: 18px; font-weight: bold; padding: 8px 14px; text-align: center; }
          .guide small { color: #475569; display: block; font-family: Arial; font-size: 10px; font-weight: normal; letter-spacing: 1px; }
          .datos { border: 1px solid #cbd5e1; border-radius: 8px; display: grid; gap: 10px 24px; grid-template-columns: repeat(3, 1fr); margin: 18px 0; padding: 12px 14px; }
          .datos div p { margin: 0; }
          .datos .l { color: #64748b; font-size: 9px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; }
          .datos .v { font-size: 13px; font-weight: bold; }
          .obs { grid-column: 1 / -1; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border-bottom: 1px solid #cbd5e1; font-size: 11px; padding: 7px; text-align: left; vertical-align: top; }
          th { background: #f1f5f9; color: #334155; font-size: 10px; letter-spacing: 0.5px; text-transform: uppercase; }
          td.c, th.c { text-align: center; }
          td.r, th.r { text-align: right; }
          .firmas { display: grid; gap: 40px; grid-template-columns: 1fr 1fr; margin-top: 70px; }
          .firma { border-top: 1px solid #0f172a; font-size: 11px; padding-top: 6px; text-align: center; }
          .print-btn { background: #15803d; border: none; border-radius: 8px; color: #fff; cursor: pointer; font-size: 13px; font-weight: bold; padding: 10px 18px; position: fixed; right: 20px; top: 20px; }
          @media print { body { margin: 10mm; } .print-btn { display: none; } }
        </style>
      </head>
      <body>
        <button class="print-btn" onclick="window.print()">Imprimir / Guardar PDF</button>
        <div class="head">
          <div>
            <h1>Todo Agricola Boliviana Ltda</h1>
            <p class="sub">Nota de salida de mercader&iacute;a &mdash; Emitido ${escapeHtml(formatDate(new Date().toISOString()))}</p>
          </div>
          <div class="guide"><small>N&deg; GU&Iacute;A</small>${escapeHtml(guide)}</div>
        </div>
        <div class="datos">
          <div><p class="l">Empresa</p><p class="v">${escapeHtml(empresa)}</p></div>
          <div><p class="l">Contacto</p><p class="v">${escapeHtml(contacto) || '-'}</p></div>
          <div><p class="l">Placa</p><p class="v">${escapeHtml(placa) || '-'}</p></div>
          <div><p class="l">Transportista</p><p class="v">${escapeHtml(transportista) || '-'}</p></div>
          ${observaciones ? `<div class="obs"><p class="l">Observaciones</p><p class="v">${escapeHtml(observaciones)}</p></div>` : ''}
        </div>
        <table>
          <thead>
            <tr>
              <th class="c">N&deg;</th><th>Producto</th><th class="c">Lote</th><th class="c">Venc.</th>
              <th class="r">Cantidad</th><th class="r">Uds</th><th class="r">Cajas</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        <div class="firmas">
          <div class="firma">Entregado por (Almac&eacute;n)</div>
          <div class="firma">Recibido por (Transportista)</div>
        </div>
      </body>
    </html>
  `)
  win.document.close()
  return true
}
