import { supabase } from './supabase'

// Empresas hermanas: si comparten el prefijo de código de producto (ej. TCML para
// TECNOMYL S.A y TECNOMYL (REPROCESO)), comparten el mismo catálogo de fichas.
// Devuelve los client_id cuyas fichas de catálogo aplican a la empresa dada.
export async function catalogClientIds(clientId) {
  if (!clientId) return []

  const { data: me } = await supabase
    .from('clients')
    .select('product_code_prefix')
    .eq('id', clientId)
    .maybeSingle()

  let prefix = (me?.product_code_prefix || '').trim().toUpperCase() || null

  // Si la empresa no tiene prefijo cargado, se deduce del código real de sus lotes
  if (!prefix) {
    const { data: lot } = await supabase
      .from('lots')
      .select('solucion_product_code')
      .eq('client_id', clientId)
      .eq('inventory_source', 'stock_independiente')
      .not('solucion_product_code', 'is', null)
      .limit(1)
      .maybeSingle()
    const code = lot?.solucion_product_code || ''
    if (code.includes('-')) prefix = code.split('-')[0].toUpperCase()
  }

  if (!prefix) return [clientId]

  const { data: allClients } = await supabase
    .from('clients')
    .select('id, product_code_prefix')
    .eq('inventory_source', 'stock_independiente')

  const ids = (allClients || [])
    .filter((c) => (c.product_code_prefix || '').trim().toUpperCase() === prefix)
    .map((c) => c.id)
  if (!ids.includes(clientId)) ids.push(clientId)
  return ids
}
