// Interruptores de funciones que se guardan sin borrarlas.
//
// TRASLADO_ENABLED: el traslado interno mueve un lote de una ubicación a
// otra. Hoy el depósito tiene UNA sola ubicación, así que la operación no se
// usa y solo confunde al operador (además su nombre choca con "Traspaso").
// Se apaga en la interfaz, pero NO se borra: los traslados históricos siguen
// en la base y en el kardex, y con poner `true` acá vuelve a aparecer todo.
export const TRASLADO_ENABLED = false
