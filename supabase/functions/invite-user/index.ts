// Invitar usuarios (clientes y operadores) por correo — solo administrador.
// DEPLOY: Supabase Dashboard → Edge Functions → Deploy a new function →
//         nombre exacto: invite-user → pegar este archivo completo.
// No necesita secretos extra: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
// vienen configurados automaticamente en las edge functions.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Quien llama tiene que ser un administrador con sesion valida
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: userData } = await admin.auth.getUser(jwt)
    if (!userData?.user) return json({ error: 'Sesion invalida.' }, 401)

    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', userData.user.id)
      .single()
    if (profile?.role !== 'administrador') {
      return json({ error: 'Solo el administrador puede invitar usuarios.' }, 403)
    }

    const { email, role, client_id, full_name, redirect_to } = await req.json()
    if (!email || !['cliente', 'operador'].includes(role)) {
      return json({ error: 'Faltan datos de la invitacion.' }, 400)
    }
    if (role === 'cliente' && !client_id) {
      return json({ error: 'Falta la empresa del cliente.' }, 400)
    }

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { role, client_id: client_id ?? null, full_name: full_name ?? null },
      redirectTo: redirect_to || undefined,
    })
    if (error) return json({ error: error.message }, 400)

    return json({ ok: true, user_id: data.user?.id })
  } catch (err) {
    return json({ error: String((err as Error)?.message ?? err) }, 500)
  }
})
