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

export function movementLabel(type) {
  const labels = {
    entrada: 'Entrada',
    salida: 'Salida',
    traslado: 'Traslado interno',
    ajuste: 'Reparo',
  }
  return labels[type] || type
}
