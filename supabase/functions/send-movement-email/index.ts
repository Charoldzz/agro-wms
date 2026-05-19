const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function formatNumber(value: unknown) {
  return Number(value || 0).toLocaleString('es-BO', {
    maximumFractionDigits: 2,
  })
}

function escapeHtml(value: unknown) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    const fromEmail = Deno.env.get('MOVEMENT_EMAIL_FROM') || 'Todo Agricola <onboarding@resend.dev>'
    const appUrl = Deno.env.get('APP_PUBLIC_URL') || 'https://agro-wms.vercel.app'

    if (!resendApiKey) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY no configurado' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const toEmail = Deno.env.get('MOVEMENT_EMAIL_TO') || body.to || 'hgarayd@outlook.com'
    const typeLabel = body.movement_type === 'entrada' ? 'Entrada' : 'Salida'
    const subject = `${typeLabel} de inventario - ${body.lot_code}`
    const logoUrl = `${appUrl.replace(/\/$/, '')}/images/todo-logo.png`
    const text = [
      `${typeLabel} registrada en Todo Agricola`,
      ``,
      `Lote: ${body.lot_code}`,
      `Producto: ${body.product}`,
      `Cliente: ${body.client}`,
      `Ubicacion: ${body.location || '-'}`,
      `Cantidad: ${formatNumber(body.quantity)}`,
      `Stock anterior: ${formatNumber(body.previous_quantity)}`,
      `Stock nuevo: ${formatNumber(body.new_quantity)}`,
      `Usuario: ${body.user_email || 'Usuario'}`,
      body.notes ? `Observaciones: ${body.notes}` : null,
    ]
      .filter(Boolean)
      .join('\n')
    const html = `
      <!doctype html>
      <html>
        <body style="margin:0;background:#f6f7f3;font-family:Arial,sans-serif;color:#0f172a;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f3;padding:24px 12px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                  <tr>
                    <td style="padding:22px 24px;border-bottom:1px solid #e2e8f0;">
                      <img src="${logoUrl}" width="160" alt="Todo Agricola" style="display:block;max-width:160px;height:auto;margin-bottom:16px;" />
                      <h1 style="margin:0;color:#14532d;font-size:22px;line-height:1.25;">${escapeHtml(typeLabel)} de inventario</h1>
                      <p style="margin:8px 0 0;color:#475569;font-size:14px;">Resumen para registro en oficina</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:22px 24px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                        <tr>
                          <td style="padding:10px 0;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">Lote</td>
                          <td style="padding:10px 0;text-align:right;font-size:14px;font-weight:700;border-bottom:1px solid #f1f5f9;">${escapeHtml(body.lot_code)}</td>
                        </tr>
                        <tr>
                          <td style="padding:10px 0;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">Producto</td>
                          <td style="padding:10px 0;text-align:right;font-size:14px;font-weight:700;border-bottom:1px solid #f1f5f9;">${escapeHtml(body.product)}</td>
                        </tr>
                        <tr>
                          <td style="padding:10px 0;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">Cliente</td>
                          <td style="padding:10px 0;text-align:right;font-size:14px;font-weight:700;border-bottom:1px solid #f1f5f9;">${escapeHtml(body.client)}</td>
                        </tr>
                        <tr>
                          <td style="padding:10px 0;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">Ubicacion</td>
                          <td style="padding:10px 0;text-align:right;font-size:14px;font-weight:700;border-bottom:1px solid #f1f5f9;">${escapeHtml(body.location || '-')}</td>
                        </tr>
                        <tr>
                          <td style="padding:10px 0;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">Cantidad</td>
                          <td style="padding:10px 0;text-align:right;font-size:18px;font-weight:800;color:#14532d;border-bottom:1px solid #f1f5f9;">${formatNumber(body.quantity)}</td>
                        </tr>
                        <tr>
                          <td style="padding:10px 0;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">Stock anterior</td>
                          <td style="padding:10px 0;text-align:right;font-size:14px;font-weight:700;border-bottom:1px solid #f1f5f9;">${formatNumber(body.previous_quantity)}</td>
                        </tr>
                        <tr>
                          <td style="padding:10px 0;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">Stock nuevo</td>
                          <td style="padding:10px 0;text-align:right;font-size:14px;font-weight:700;border-bottom:1px solid #f1f5f9;">${formatNumber(body.new_quantity)}</td>
                        </tr>
                        <tr>
                          <td style="padding:10px 0;color:#64748b;font-size:13px;">Usuario</td>
                          <td style="padding:10px 0;text-align:right;font-size:14px;font-weight:700;">${escapeHtml(body.user_email || 'Usuario')}</td>
                        </tr>
                      </table>
                      ${
                        body.notes
                          ? `<div style="margin-top:18px;padding:14px;border-radius:8px;background:#f8fafc;color:#334155;font-size:14px;"><strong>Observaciones:</strong> ${escapeHtml(body.notes)}</div>`
                          : ''
                      }
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject,
        text,
        html,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return new Response(JSON.stringify({ error: errorText }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
