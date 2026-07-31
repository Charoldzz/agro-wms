import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================
// CORREO PERIÓDICO DE INVENTARIO — envío al cliente (resumen + botón al portal)
//
// La llama pg_cron (diario). Recorre las empresas cuya frecuencia toca hoy
// (según inventory_email_frequency + inventory_email_last_sent) y a cada una le
// manda el resumen de su inventario. No adjunta PDF: el detalle/PDF está en el
// portal (botón). Actualiza inventory_email_last_sent al enviar.
//
// Prueba manual: POST body { "client_id": "<id>", "force": true } → manda a esa
// empresa sin importar la frecuencia.
//
// Secrets: RESEND_API_KEY, MOVEMENT_EMAIL_FROM (default almacenes@tagribol.com),
// APP_PUBLIC_URL (default todo-agricola.vercel.app). SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY vienen solos.
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

const INTERVALS: Record<string, number> = { mensual: 30, quincenal: 15, semanal: 7 }

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
async function inventorySummary(admin: any, clientId: string) {
  const [{ data: lots }, { data: cat }] = await Promise.all([
    admin.from('lots').select('product, solucion_product_code')
      .eq('client_id', clientId).eq('inventory_source', 'stock_independiente')
      .eq('status', 'activo').gt('current_quantity', 0),
    admin.from('product_catalog').select('code, pending_review').eq('client_id', clientId),
  ])
  const pending = new Set((cat || []).filter((p: { pending_review: boolean; code: string }) => p.pending_review && p.code).map((p: { code: string }) => String(p.code).toUpperCase()))
  const visible = (lots || []).filter((l: { solucion_product_code: string }) => !pending.has(String(l.solucion_product_code || '').toUpperCase()))
  const productos = new Set(visible.map((l: { product: string }) => l.product)).size
  return { productos, lotes: visible.length }
}

function buildHtml(nombre: string, productos: number, lotes: number, appUrl: string) {
  const fecha = new Date().toLocaleDateString('es-BO', { day: '2-digit', month: 'long', year: 'numeric' })
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;font-family:Arial,Helvetica,sans-serif;">
  <tr><td align="center">
    <table width="100%" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
      <tr><td style="background:#166534;padding:24px 28px;">
        <p style="margin:0;color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:0.3px;">TODO AGRÍCOLA BOLIVIANA LTDA</p>
        <p style="margin:4px 0 0;color:#bbf7d0;font-size:13px;">Portal de clientes · Depósito Warnes</p>
      </td></tr>
      <tr><td style="padding:28px;">
        <p style="margin:0 0 14px;color:#0f172a;font-size:20px;font-weight:bold;">Tu inventario al día 📦</p>
        <p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.6;">Hola <strong>${escapeHtml(nombre)}</strong>, te compartimos el resumen de tu mercadería almacenada en Todo Agrícola. Podés ver el detalle completo y descargar tu inventario desde el portal.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;"><tr><td style="padding:16px 18px;">
          <p style="margin:0 0 8px;color:#166534;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">Inventario al ${escapeHtml(fecha)}</p>
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="color:#14532d;font-size:22px;font-weight:bold;">${productos}<span style="font-size:12px;font-weight:normal;color:#4d7c0f;"> productos</span></td>
            <td style="color:#14532d;font-size:22px;font-weight:bold;">${lotes}<span style="font-size:12px;font-weight:normal;color:#4d7c0f;"> lotes activos</span></td>
          </tr></table>
        </td></tr></table>
        <table cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr><td align="center" style="border-radius:10px;background:#166534;">
          <a href="${escapeHtml(appUrl)}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;border-radius:10px;">Ver mi inventario completo</a>
        </td></tr></table>
        <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;border-top:1px solid #e2e8f0;padding-top:16px;">Ante cualquier consulta sobre tu mercadería, escribinos — estamos para ayudarte.</p>
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
        if (c.inventory_email_last_sent && (now - new Date(c.inventory_email_last_sent).getTime()) < days * 86400000) {
          continue
        }
      }
      const emails = await clientEmails(admin, c.id)
      if (emails.length === 0) { results.push({ client: c.name, skip: 'sin usuarios de portal' }); continue }
      const { productos, lotes } = await inventorySummary(admin, c.id)
      if (lotes === 0) { results.push({ client: c.name, skip: 'sin stock' }); continue }

      const html = buildHtml(c.name, productos, lotes, APP)
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: emails, subject: `Tu inventario en Todo Agrícola · ${c.name}`, html }),
      })
      if (!resp.ok) { results.push({ client: c.name, error: await resp.text() }); continue }
      await admin.from('clients').update({ inventory_email_last_sent: new Date().toISOString() }).eq('id', c.id)
      results.push({ client: c.name, sent_to: emails, productos, lotes })
    }

    return json({ ok: true, processed: results.length, results })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
