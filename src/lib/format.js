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
