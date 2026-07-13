import { createClient } from '@supabase/supabase-js'

// El link de invitación/recuperación llega como #access_token=...&type=invite.
// Hay que marcarlo ANTES de crear el cliente de Supabase, porque este consume
// y limpia el hash de la URL al iniciar la sesión.
export const SET_PASSWORD_FLAG = 'agro-set-password'
if (typeof window !== 'undefined' && /type=(invite|recovery)/.test(window.location.hash)) {
  sessionStorage.setItem(SET_PASSWORD_FLAG, '1')
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null

// Invita un usuario por correo vía la edge function invite-user (solo admin).
// El invitado recibe el correo, crea su contraseña y entra con el rol y la
// empresa que se le asignaron acá.
export async function inviteUser({ email, role, clientId = null, fullName = null }) {
  const { data, error } = await supabase.functions.invoke('invite-user', {
    body: {
      email,
      role,
      client_id: clientId,
      full_name: fullName,
      redirect_to: window.location.origin + window.location.pathname,
    },
  })
  if (error) {
    let msg = error.message
    try {
      const body = await error.context?.json()
      if (body?.error) msg = body.error
    } catch { /* sin detalle del servidor */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}
