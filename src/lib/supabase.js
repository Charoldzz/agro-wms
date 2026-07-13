import { createClient } from '@supabase/supabase-js'

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

// Crea una cuenta de portal para un cliente sin tocar la sesión del admin:
// usa un cliente temporal sin persistencia; empresa y nombre van en metadata
// y el trigger handle_new_user arma el perfil como 'cliente' de esa empresa.
export async function createPortalUser({ email, password, clientId, fullName }) {
  const temp = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await temp.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, client_id: clientId } },
  })
  if (error) throw new Error(error.message)
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error('Ese correo ya tiene una cuenta.')
  }
  return data.user
}
