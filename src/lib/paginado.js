// La base devuelve COMO MUCHO 1.000 filas por pedido, sin importar el número
// que se le ponga en .limit(). Poner .limit(5000) no trae 5.000: trae 1.000 y
// no avisa. Eso hizo que durante meses el Kardex mostrara saldos negativos y
// que el Excel de Exportes saliera con 1.000 de 4.214 movimientos.
//
// Por eso: cuando una consulta PUEDA devolver más de 1.000 filas, no se usa
// .limit() — se usa esto, que va pidiendo de a tandas hasta que no queda nada.
//
//   const { data, error } = await traerTodo((desde, cuantos) =>
//     supabase.from('lots').select('*').range(desde, desde + cuantos - 1))
//
// Si la consulta lleva .order(), va antes del .range().

const POR_TANDA = 1000

export async function traerTodo(hacerPedido, { porTanda = POR_TANDA, tope = 100000 } = {}) {
  const todo = []
  for (let desde = 0; desde < tope; desde += porTanda) {
    const { data, error } = await hacerPedido(desde, porTanda)
    if (error) return { data: todo, error }
    const tanda = data || []
    todo.push(...tanda)
    // Una tanda incompleta significa que ya no queda nada más
    if (tanda.length < porTanda) break
  }
  return { data: todo, error: null }
}

// Lo mismo para las funciones de la base (rpc), que tienen el mismo tope.
//
//   const { data, error } = await traerTodoRpc((desde, cuantos) =>
//     supabase.rpc('kardex_export', { p_desde: desde, p_limite: cuantos }))
export const traerTodoRpc = traerTodo
