import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================
// CORREO PERIÓDICO DE INVENTARIO — al cliente (estado de cuenta)
//
// La llama pg_cron (diario). Recorre las empresas cuya frecuencia toca hoy y a
// cada una le manda su INVENTARIO: sección destacada de "por vencer" (lo
// accionable) + tabla completa (producto·lote·venc·cantidad) + botón al portal.
// Actualiza inventory_email_last_sent al enviar.
//
// Prueba manual: POST { "client_id": "<id>", "force": true }.
// Secrets: RESEND_API_KEY, MOVEMENT_EMAIL_FROM, APP_PUBLIC_URL.
// ============================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
function escapeHtml(v: unknown) {
  return String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}
function fmtDate(iso: unknown) {
  if (!iso) return '-'
  const s = String(iso)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : s
}
function formatNum(v: unknown) { return Number(v || 0).toLocaleString('es-BO', { maximumFractionDigits: 2 }) }
// Réplica de equivalentLabel de la app (lib/format.js): ml/gr → lt/kg (÷1000).
function eqLabel(value: unknown, unit: unknown) {
  let u = String(unit || '').toLowerCase().trim()
  let v = Number(value || 0)
  if (u === 'gr' || u === 'grs' || u === 'g') { u = 'kg'; v /= 1000 }
  else if (u === 'ml' || u === 'cc') { u = 'lt'; v /= 1000 }
  else if (/^l/.test(u)) u = 'lt'
  else if (/^k/.test(u)) u = 'kg'
  else u = 'uds'
  const plural = u === 'uds' ? 'uds' : (Math.round(v * 100) / 100 === 1 ? u : `${u}s`)
  return `${formatNum(v)} ${plural}`
}
function daysUntil(iso: unknown): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(`${iso}T00:00:00`)
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

const INTERVALS: Record<string, number> = { mensual: 30, quincenal: 15, semanal: 7 }
const VENC_DIAS = 90 // ventana de "por vencer" (igual que ExpiringLots de la app)

// deno-lint-ignore no-explicit-any
async function clientEmails(admin: any, clientId: string): Promise<string[]> {
  const out: string[] = []
  try {
    const { data: profs } = await admin.from('profiles').select('id').eq('client_id', clientId).eq('role', 'cliente')
    for (const p of (profs || [])) {
      const { data: u } = await admin.auth.admin.getUserById(p.id)
      if (u?.user?.email) out.push(u.user.email)
    }
  } catch (e) { console.error('clientEmails error', (e as Error).message) }
  return out
}

// deno-lint-ignore no-explicit-any
async function inventoryLots(admin: any, clientId: string) {
  const [{ data: lots }, { data: cat }] = await Promise.all([
    admin.from('lots').select('product, lot_code, expiry_date, current_quantity, package_unit, solucion_product_code')
      .eq('client_id', clientId).eq('inventory_source', 'stock_independiente')
      .eq('status', 'activo').gt('current_quantity', 0),
    admin.from('product_catalog').select('code, pending_review').eq('client_id', clientId),
  ])
  const pending = new Set((cat || []).filter((p: { pending_review: boolean; code: string }) => p.pending_review && p.code).map((p: { code: string }) => String(p.code).toUpperCase()))
  const visible = (lots || []).filter((l: { solucion_product_code: string }) => !pending.has(String(l.solucion_product_code || '').toUpperCase()))
  // Orden A→Z por producto, y por vencimiento dentro del mismo
  visible.sort((a: { product: string; expiry_date: string }, b: { product: string; expiry_date: string }) => {
    const n = String(a.product || '').localeCompare(String(b.product || ''), 'es')
    return n !== 0 ? n : String(a.expiry_date || '').localeCompare(String(b.expiry_date || ''))
  })
  return visible
}

// deno-lint-ignore no-explicit-any
function buildHtml(nombre: string, lots: any[], appUrl: string) {
  const fecha = new Date().toLocaleDateString('es-BO', { day: '2-digit', month: 'long', year: 'numeric' })
  const productos = new Set(lots.map((l) => l.product)).size

  // ── Por vencer (vencidos o dentro de VENC_DIAS)
  const porVencer = lots
    .map((l) => ({ ...l, d: daysUntil(l.expiry_date) }))
    .filter((l) => l.d !== null && (l.d as number) <= VENC_DIAS)
    .sort((a, b) => (a.d as number) - (b.d as number))

  const vencRows = porVencer.map((l) => {
    const d = l.d as number
    const estado = d < 0 ? 'Vencido' : d === 0 ? 'Vence hoy' : `Vence en ${d} día${d === 1 ? '' : 's'}`
    const color = d < 0 ? '#dc2626' : '#b45309'
    return `<tr>
      <td style="padding:7px 8px;border-bottom:1px solid #fde68a;font-size:12px;font-weight:bold;color:#0f172a;">${escapeHtml(l.product)}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #fde68a;font-size:11px;color:#64748b;">${escapeHtml(l.lot_code || '-')}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #fde68a;font-size:11px;color:#64748b;white-space:nowrap;">${escapeHtml(fmtDate(l.expiry_date))}</td>
      <td align="right" style="padding:7px 8px;border-bottom:1px solid #fde68a;font-size:11px;font-weight:bold;color:${color};white-space:nowrap;">${escapeHtml(estado)}</td>
    </tr>`
  }).join('')

  const vencSection = porVencer.length > 0
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;">
        <tr><td style="padding:14px 16px;">
          <p style="margin:0 0 8px;color:#b45309;font-size:13px;font-weight:bold;">⚠️ ${porVencer.length} ${porVencer.length === 1 ? 'producto por vencer' : 'productos por vencer'}</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${vencRows}</table>
        </td></tr>
      </table>`
    : `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;">
        <tr><td style="padding:14px 16px;"><p style="margin:0;color:#166534;font-size:14px;font-weight:bold;">✓ Todo tu stock está vigente</p></td></tr>
      </table>`

  // ── Tabla completa
  const invRows = lots.map((l) => {
    const d = daysUntil(l.expiry_date)
    const vencColor = d === null ? '#64748b' : d < 0 ? '#dc2626' : d <= VENC_DIAS ? '#b45309' : '#64748b'
    return `<tr>
      <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:12px;font-weight:bold;color:#0f172a;">${escapeHtml(l.product)}</td>
      <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:11px;color:#64748b;">${escapeHtml(l.lot_code || '-')}</td>
      <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:11px;font-weight:bold;color:${vencColor};white-space:nowrap;">${escapeHtml(fmtDate(l.expiry_date))}</td>
      <td align="right" style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:bold;color:#166534;white-space:nowrap;">${escapeHtml(eqLabel(l.current_quantity, l.package_unit))}</td>
    </tr>`
  }).join('')

  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;font-family:Arial,Helvetica,sans-serif;">
  <tr><td align="center">
    <table width="100%" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
      <tr><td style="background:#166534;padding:24px 28px;">
        <p style="margin:0;color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:0.3px;">TODO AGRÍCOLA BOLIVIANA LTDA</p>
        <p style="margin:4px 0 0;color:#bbf7d0;font-size:13px;">Portal de clientes · Depósito Warnes</p>
      </td></tr>
      <tr><td style="padding:28px;">
        <p style="margin:0 0 14px;color:#0f172a;font-size:20px;font-weight:bold;">Tu inventario al día 📦</p>
        <p style="margin:0 0 18px;color:#334155;font-size:15px;line-height:1.6;">Hola <strong>${escapeHtml(nombre)}</strong>, este es el resumen de tu mercadería almacenada en Todo Agrícola al <strong>${escapeHtml(fecha)}</strong> — <strong>${productos}</strong> ${productos === 1 ? 'producto' : 'productos'} · <strong>${lots.length}</strong> ${lots.length === 1 ? 'lote' : 'lotes'}.</p>

        ${vencSection}

        <p style="margin:0 0 8px;color:#166534;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">Detalle de tu inventario</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <thead><tr>
            <th align="left" style="padding:8px;background:#f8fafc;color:#475569;font-size:11px;text-transform:uppercase;">Producto</th>
            <th align="left" style="padding:8px;background:#f8fafc;color:#475569;font-size:11px;text-transform:uppercase;">Lote</th>
            <th align="left" style="padding:8px;background:#f8fafc;color:#475569;font-size:11px;text-transform:uppercase;">Venc.</th>
            <th align="right" style="padding:8px;background:#f8fafc;color:#475569;font-size:11px;text-transform:uppercase;">Cantidad</th>
          </tr></thead>
          <tbody>${invRows}</tbody>
        </table>

        <table cellpadding="0" cellspacing="0" style="margin:22px 0 0;"><tr><td align="center" style="border-radius:10px;background:#166534;">
          <a href="${escapeHtml(appUrl)}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;border-radius:10px;">Ver y descargar mi inventario</a>
        </td></tr></table>

        <p style="margin:20px 0 0;color:#94a3b8;font-size:12px;line-height:1.6;border-top:1px solid #e2e8f0;padding-top:16px;">Recordá: el vencimiento nunca frena una salida, solo te avisamos para que puedas mover el stock a tiempo. Ante cualquier consulta, escribinos.</p>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:16px 28px;"><p style="margin:0;color:#94a3b8;font-size:12px;">Todo Agrícola Boliviana Ltda · Resumen periódico de tu mercadería almacenada.</p></td></tr>
    </table>
  </td></tr>
</table>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const RESEND = Deno.env.get('RESEND_API_KEY')
    const FROM = Deno.env.get('MOVEMENT_EMAIL_FROM') || 'Todo Agrícola Boliviana <almacenes@tagribol.com>'
    const APP = Deno.env.get('APP_PUBLIC_URL') || 'https://todo-agricola.vercel.app'
    if (!RESEND) return json({ error: 'RESEND_API_KEY no configurado' }, 500)

    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { /* sin body: envío programado */ }
    const onlyClient = typeof body.client_id === 'string' ? body.client_id : null
    const force = body.force === true

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    let q = admin.from('clients').select('id, name, inventory_email_frequency, inventory_email_last_sent')
    if (onlyClient) q = q.eq('id', onlyClient)
    else q = q.neq('inventory_email_frequency', 'ninguno')
    const { data: clients } = await q

    const now = Date.now()
    const results: Array<Record<string, unknown>> = []

    for (const c of (clients || [])) {
      if (!force && !onlyClient) {
        const days = INTERVALS[c.inventory_email_frequency] ?? 30
        if (c.inventory_email_last_sent && (now - new Date(c.inventory_email_last_sent).getTime()) < days * 86400000) continue
      }
      const emails = await clientEmails(admin, c.id)
      if (emails.length === 0) { results.push({ client: c.name, skip: 'sin usuarios de portal' }); continue }
      const lots = await inventoryLots(admin, c.id)
      if (lots.length === 0) { results.push({ client: c.name, skip: 'sin stock' }); continue }

      const html = buildHtml(c.name, lots, APP)
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: emails, subject: `Tu inventario en Todo Agrícola · ${c.name}`, html }),
      })
      if (!resp.ok) { results.push({ client: c.name, error: await resp.text() }); continue }
      await admin.from('clients').update({ inventory_email_last_sent: new Date().toISOString() }).eq('id', c.id)
      results.push({ client: c.name, sent_to: emails, productos: new Set(lots.map((l) => l.product)).size, lotes: lots.length })
    }

    return json({ ok: true, processed: results.length, results })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
