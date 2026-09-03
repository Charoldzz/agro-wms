import { supabase } from './supabase'

// Manda el aviso de movimiento al cliente y, si NO sale, lo deja anotado.
//
// Antes esto era `.catch(() => {})`: el error se tiraba a la basura. El
// operador veía "guardado", el cliente nunca se enteraba de que llegó su
// mercadería, y nadie sabía que el aviso no había salido.
//
// Nunca corta la operación: el ingreso o la salida ya se guardaron bien y el
// correo es un extra. Solo deja el rastro para que el depósito lo vea.
export async function avisarMovimiento(body) {
  try {
    const { error } = await supabase.functions.invoke('send-movement-email', { body })
    if (!error) return { ok: true }
    await anotar(body, error.message || 'No se pudo llamar al envío de correo.')
    return { ok: false }
  } catch (e) {
    await anotar(body, e?.message || 'No se pudo llamar al envío de correo.')
    return { ok: false }
  }
}

async function anotar(body, motivo) {
  try {
    await supabase.from('email_failures').insert({
      tipo: 'movimiento',
      client_id: body?.client_id || null,
      client_name: body?.client_name || null,
      guia: body?.guide || null,
      motivo,
    })
  } catch { /* si tampoco se puede anotar, no se rompe nada */ }
}
