// Interruptores de funciones que se guardan sin borrarlas.
//
// TRASLADO_ENABLED: el traslado interno mueve un lote de una ubicación a
// otra. Hoy el depósito tiene UNA sola ubicación, así que la operación no se
// usa y solo confunde al operador (además su nombre choca con "Traspaso").
// Se apaga en la interfaz, pero NO se borra: los traslados históricos siguen
// en la base y en el kardex, y con poner `true` acá vuelve a aparecer todo.
export const TRASLADO_ENABLED = false

// QR_ENABLED: etiquetas QR de los lotes, escaneo y acceso por QR. Se apagan
// por ahora — no se usan y solo ocupan lugar en pantalla. NO se borra nada:
// los tokens siguen en la base, las pantallas y la lógica quedan intactas, y
// con poner `true` acá vuelve todo (panel QR de la ficha, impresión de
// etiquetas, escáner y el motivo "QR dañado" al reportar problemas).
export const QR_ENABLED = false
