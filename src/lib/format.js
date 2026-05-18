export function formatDate(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('es-BO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
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
    ajuste: 'Ajuste',
  }
  return labels[type] || type
}
