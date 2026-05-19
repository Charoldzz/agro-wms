const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function formatNumber(value: unknown) {
  return Number(value || 0).toLocaleString('es-BO', {
    maximumFractionDigits: 2,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    const fromEmail = Deno.env.get('MOVEMENT_EMAIL_FROM') || 'Agro WMS <onboarding@resend.dev>'

    if (!resendApiKey) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY no configurado' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const typeLabel = body.movement_type === 'entrada' ? 'Entrada' : 'Salida'
    const subject = `${typeLabel} de inventario - ${body.lot_code}`
    const text = [
      `${typeLabel} registrada en Agro WMS`,
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

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [body.to || 'hgaray@tagribol.com'],
        subject,
        text,
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
