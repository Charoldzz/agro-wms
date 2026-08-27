// ── Separador de miles en campos de cantidad ────────────────────────────
// Formato boliviano: punto para miles, coma para decimales. La entrada
// canónica usa punto decimal ("50000" / "50000.5"); solo se formatea la VISTA.
export function formatQtyInput(raw) {
  if (raw === '' || raw == null) return ''
  const [intPart, decPart] = String(raw).split('.')
  const intFmt = (intPart || '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return decPart !== undefined ? `${intFmt},${decPart}` : intFmt
}

// Convierte lo que se ve (con puntos de miles y coma decimal) al valor canónico
// (punto decimal, sin miles). Devuelve null si el texto no es un número válido.
export function parseQtyInput(display) {
  const v = String(display).replace(/\./g, '').replace(',', '.')
  return /^\d*\.?\d*$/.test(v) ? v : null
}

export function formatDate(value) {
  if (!value) return '-'
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T00:00:00`)
    : new Date(value)
  return new Intl.DateTimeFormat('es-BO', {
    dateStyle: 'medium',
    timeStyle: /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? undefined : 'short',
  }).format(date)
}

// Solo la fecha, sin hora — para documentos formales (comprobantes, notas)
export function formatDateOnly(value) {
  if (!value) return '-'
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T00:00:00`)
    : new Date(value)
  return new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium' }).format(date)
}

// Fecha corta numérica DD-MM-YYYY para encabezados de operación
export function formatDateShort(value) {
  if (!value) return '-'
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T00:00:00`)
    : new Date(value)
  const d = String(date.getDate()).padStart(2, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${d}-${m}-${date.getFullYear()}`
}

export function formatNumber(value) {
  return new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 }).format(
    Number(value || 0),
  )
}

// ── Cantidades que vienen del programa de escritorio ───────────────────
// El programa anota SIEMPRE en kilos y litros. La app, en cambio, guarda los
// productos chicos en gramos y mililitros (un frasco de 500 ml se guarda como
// 500, no como 0,5). Al mezclar los dos sin convertir, esos productos salían
// 1.000 veces más chicos: MATAPOL X 500 GRS mostraba "3,46 kgs" donde hay
// 3.458 kgs, y una salida de 4 kgs aparecía como "0 kgs".
//
// Toda cantidad que venga de desktop_movements tiene que pasar por acá antes
// de mostrarse o de sumarse con las de la app.
// Un valor vacío se devuelve tal cual: "no hay dato" no es lo mismo que cero.
export function cantidadDelPrograma(valor, unidad) {
  if (valor === null || valor === undefined || valor === '') return valor
  const u = String(unidad || '').toLowerCase().trim()
  const v = Number(valor)
  if (!Number.isFinite(v)) return valor
  return (u === 'gr' || u === 'grs' || u === 'g' || u === 'ml' || u === 'cc') ? v * 1000 : v
}

// ── Equivalente (lts / kgs) ────────────────────────────────────────────
// Unidad canónica para acumular y comparar: ml→lt, gr→kg, l*→lt, k*→kg;
// cualquier otra (incl. vacía) → uds. El valor de ml/gr se convierte a lt/kg.
// Usar SIEMPRE la misma unidad canónica como clave de los totales.
export function normalizeEquivalent(value, unit) {
  let u = String(unit || '').toLowerCase().trim()
  let v = Number(value || 0)
  if (u === 'gr' || u === 'grs' || u === 'g') { u = 'kg'; v /= 1000 }
  else if (u === 'ml' || u === 'cc') { u = 'lt'; v /= 1000 }
  else if (/^l/.test(u)) u = 'lt'
  else if (/^k/.test(u)) u = 'kg'
  else u = 'uds'
  return { value: v, unit: u }
}

// Pluraliza la unidad canónica según la cantidad: singular SOLO cuando es
// exactamente 1 ("1 lt" / "1 kg"), plural en todo lo demás ("560 kgs"). uds no cambia.
export function pluralUnit(unit, value) {
  if (unit === 'uds') return 'uds'
  return Math.round(Number(value || 0) * 100) / 100 === 1 ? unit : `${unit}s`
}

// Etiqueta de cantidad en equivalente lista para mostrar ("560 kgs", "1 lt",
// "8 uds"). Fuente ÚNICA de la verdad para que la misma cantidad se vea igual
// en toda la app. Acepta unidad cruda (kg/lt/ml/gr) o ya canónica (kgs/lts):
// solo ml/gr se dividen, así que es seguro pasarle un valor ya normalizado.
export function equivalentLabel(value, unit) {
  const eq = normalizeEquivalent(value, unit)
  return `${formatNumber(eq.value)} ${pluralUnit(eq.unit, eq.value)}`
}

export function movementLabel(type) {
  const labels = {
    entrada: 'Entrada',
    salida: 'Salida',
    traslado: 'Traslado interno',
    ajuste: 'Reparo',
  }
  return labels[type] || type
}
