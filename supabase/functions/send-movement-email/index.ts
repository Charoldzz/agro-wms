import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================
// CORREO DE MOVIMIENTO — aviso al CLIENTE (+ copia a oficina)
//
// Se dispara desde los ingresos (OperatorEntry) y salidas (NuevaSalida) al
// guardar. Va a los usuarios del portal de esa empresa; copia (BCC) a oficina.
// El front ya calcula las etiquetas (cantidad equivalente + envases), acá solo
// se arman en la estética de Todo Agrícola.
//
// Secretos que necesita (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY        (obligatorio) la llave re_... de Resend
//   MOVEMENT_EMAIL_FROM   (opcional) por defecto "Todo Agrícola Boliviana <almacenes@tagribol.com>"
//   MOVEMENT_OFFICE_BCC   (opcional) copia interna, por defecto hgarayd@outlook.com
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY vienen solos.
// ============================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function escapeHtml(v: unknown) {
  return String(v ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

function fmtDate(v: unknown) {
  if (!v) return ''
  const s = String(v)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : s
}
// Réplica de displayLotCode de la app (lib/display.js): los lotes importados de
// SOLUCION guardan un código compuesto ("SOL-MAXI-00009-44-25RFS0136-2027-01-28");
// el lote real está adentro. Extrae ese código; si no hay, devuelve "SIN LOTE".
function stockLotCode(code: string) {
  const c = code.trim()
  if (!c) return ''
  let m = c.match(/^SOL-\d+-\d+-(.+)-\d{4}-\d{2}-\d{2}$/i)
  if (m?.[1]) { const v = m[1].trim(); return /^SIN-?LOTE$/i.test(v) || /^SINLOTE$/i.test(v) ? '' : v }
  m = c.match(/^SOL-[A-Z0-9]+-\d+-\d+-(.+?)-(?:\d{4}-\d{2}-\d{2}|SINVEN)$/i)
  if (m?.[1]) { const v = m[1].trim(); return /^SIN-?LOTE$/i.test(v) || /^SINLOTE$/i.test(v) ? '' : v }
  return ''
}
function isGeneratedLotCode(code: string) {
  const c = String(code || '').trim()
  return /^EXCEL-\d+-/i.test(c) || /^SOL-/i.test(c) || /^AUTO-/i.test(c) || /^SIN-?LOTE/i.test(c) || /^Codigo\s+\d+/i.test(c)
}
function displayLotCode(lotCode: unknown) {
  const raw = String(lotCode || '')
  if (!raw) return 'SIN LOTE'
  const cleanCode = raw.replace(/^EXCEL-\d+-/i, '').trim()
  if (/^SIN-?LOTE/i.test(cleanCode) || /^SINLOTE/i.test(cleanCode)) return 'SIN LOTE'
  const real = stockLotCode(cleanCode)
  if (real) return real
  if (isGeneratedLotCode(raw)) return 'SIN LOTE'
  if (cleanCode.includes('-LOTE-')) { const v = cleanCode.split('-LOTE-').pop() || ''; return /^SIN-?LOTE/i.test(v) ? 'SIN LOTE' : v }
  return cleanCode
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const RESEND = Deno.env.get('RESEND_API_KEY')
    const FROM = Deno.env.get('MOVEMENT_EMAIL_FROM') || 'Todo Agrícola Boliviana <almacenes@tagribol.com>'
    if (!RESEND) return json({ error: 'RESEND_API_KEY no configurado' }, 500)

    const b = await req.json()
    const esSalida = b.movement_type === 'salida'
    const items: Array<Record<string, unknown>> = Array.isArray(b.items) ? b.items : []
    if (items.length === 0) return json({ error: 'Sin items' }, 400)

    // ── Destinatarios: usuarios del portal de esa empresa (+ copia a oficina)
    // A prueba de fallos: si la búsqueda de correos del cliente falla, NO se cae
    // el envío — se manda igual a la oficina y se loguea el error para verlo.
    const clientEmails: string[] = []
    if (b.client_id) {
      try {
        const admin = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        )
        const { data: profs, error: pErr } = await admin
          .from('profiles').select('id').eq('client_id', b.client_id).eq('role', 'cliente')
        if (pErr) console.error('profiles lookup error:', pErr.message)
        for (const p of (profs || [])) {
          const { data: u, error: uErr } = await admin.auth.admin.getUserById((p as { id: string }).id)
          if (uErr) console.error('getUserById error:', uErr.message)
          const email = u?.user?.email
          if (email) clientEmails.push(email)
        }
      } catch (e) {
        console.error('client email lookup failed:', (e as Error).message)
      }
    }
    // Solo al CLIENTE (sus usuarios de portal). El registro interno lo tiene el
    // sistema (movimientos, notas, kardex, exportes) — no se manda copia a oficina.
    if (clientEmails.length === 0) {
      return json({ ok: true, sent_to: [], note: 'El cliente no tiene usuarios de portal; no se envía.' })
    }
    const to = clientEmails
    console.log('recipients →', JSON.stringify({ to, client_id: b.client_id }))

    // ── Contenido cálido
    const titulo = esSalida ? '¡Despachamos tu mercadería! 🚚' : '¡Recibimos tu mercadería! 📦'
    const intro = esSalida
      ? 'Registramos la salida de tu mercadería de nuestro depósito. Acá tenés el detalle de lo despachado:'
      : 'Ingresó mercadería tuya a nuestro depósito. Acá tenés el detalle de lo recibido:'

    const rows = items.map((it) => `
                <tr>
                  <td style="padding:9px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:bold;color:#0f172a;">${escapeHtml(it.product)}</td>
                  <td style="padding:9px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;">${escapeHtml(displayLotCode(it.lot_code))}</td>
                  <td style="padding:9px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;white-space:nowrap;">${escapeHtml(fmtDate(it.expiry_date) || '-')}</td>
                  <td align="right" style="padding:9px 8px;border-bottom:1px solid #f1f5f9;font-size:14px;font-weight:bold;color:#166534;white-space:nowrap;">${escapeHtml(it.cantidad_label || '-')}</td>
                  <td align="right" style="padding:9px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#334155;white-space:nowrap;">${escapeHtml(it.envases_label || '-')}</td>
                </tr>`).join('')

    const transporte: Array<[string, string]> = []
    if (b.receiver_name) transporte.push(['Recibe', b.receiver_name])
    if (b.driver_name) transporte.push(['Chofer', b.driver_name])
    if (b.vehicle_plate) transporte.push(['Placa', b.vehicle_plate])
    const transporteHtml = transporte.length
      ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;">
                ${transporte.map(([k, v]) => `<tr><td style="padding:6px 0;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">${escapeHtml(k)}</td><td align="right" style="padding:6px 0;font-size:13px;font-weight:bold;color:#0f172a;border-bottom:1px solid #f1f5f9;">${escapeHtml(v)}</td></tr>`).join('')}
              </table>`
      : ''

    const notasHtml = b.notes
      ? `<div style="margin:18px 0 0;padding:12px 14px;border-radius:10px;background:#f8fafc;color:#334155;font-size:13px;"><strong>Observaciones:</strong> ${escapeHtml(b.notes)}</div>`
      : ''

    const html = `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;font-family:Arial,Helvetica,sans-serif;">
  <tr><td align="center">
    <table width="100%" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
      <tr>
        <td style="background:#166534;padding:24px 28px;">
          <p style="margin:0;color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:0.3px;">TODO AGRÍCOLA BOLIVIANA LTDA</p>
          <p style="margin:4px 0 0;color:#bbf7d0;font-size:13px;">Portal de clientes · Depósito Warnes</p>
        </td>
      </tr>
      <tr>
        <td style="padding:28px;">
          <p style="margin:0 0 12px;color:#0f172a;font-size:20px;font-weight:bold;">${titulo}</p>
          <p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.6;">Hola <strong>${escapeHtml(b.client_name || '')}</strong>, ${intro}</p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;">
            <tr><td style="padding:14px 16px;">
              <p style="margin:0;color:#166534;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">${esSalida ? 'Salida' : 'Ingreso'} · ${escapeHtml(fmtDate(b.date) || '')}</p>
              ${b.guide ? `<p style="margin:4px 0 0;color:#14532d;font-size:15px;font-weight:bold;">N° Guía ${escapeHtml(b.guide)}</p>` : ''}
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <thead><tr>
              <th align="left" style="padding:8px;background:#f8fafc;color:#475569;font-size:11px;text-transform:uppercase;">Producto</th>
              <th align="left" style="padding:8px;background:#f8fafc;color:#475569;font-size:11px;text-transform:uppercase;">Lote</th>
              <th align="left" style="padding:8px;background:#f8fafc;color:#475569;font-size:11px;text-transform:uppercase;">Venc.</th>
              <th align="right" style="padding:8px;background:#f8fafc;color:#475569;font-size:11px;text-transform:uppercase;">Cantidad</th>
              <th align="right" style="padding:8px;background:#f8fafc;color:#475569;font-size:11px;text-transform:uppercase;">Envases</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>

          ${transporteHtml}
          ${notasHtml}

          <p style="margin:20px 0 0;color:#94a3b8;font-size:12px;line-height:1.6;border-top:1px solid #e2e8f0;padding-top:16px;">
            Podés ver el detalle completo y tu inventario en tu portal. Ante cualquier consulta, escribinos — estamos para ayudarte.
          </p>
        </td>
      </tr>
      <tr>
        <td style="background:#f8fafc;padding:16px 28px;">
          <p style="margin:0;color:#94a3b8;font-size:12px;">Todo Agrícola Boliviana Ltda · Aviso automático de movimiento de tu mercadería.</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>`

    const subject = esSalida
      ? 'Todo Agrícola · Despachamos tu mercadería 🚚'
      : 'Todo Agrícola · Recibimos tu mercadería 📦'

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    })
    if (!resp.ok) return json({ error: await resp.text() }, 500)
    return json({ ok: true, sent_to: to })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
