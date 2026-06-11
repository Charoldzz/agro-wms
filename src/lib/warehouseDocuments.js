const documentApiUrl = import.meta.env.VITE_WAREHOUSE_DOCUMENT_API_URL

function appDate() {
  return new Date().toLocaleDateString('es-BO')
}

function endpointUrl() {
  if (!documentApiUrl) return ''
  return `${documentApiUrl.replace(/\/$/, '')}/warehouse-order`
}

export function isWarehouseDocumentApiConfigured() {
  return Boolean(endpointUrl())
}

export async function createWarehouseOrderAttachment(type, payload) {
  const url = endpointUrl()
  if (!url) return null

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      payload: {
        date: appDate(),
        ...payload,
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || 'No se pudo generar la orden de almacen.')
  }

  const data = await response.json()
  if (!data?.filename || !data?.content) {
    throw new Error('El generador de documentos no devolvio un adjunto valido.')
  }

  return {
    filename: data.filename,
    content: data.content,
  }
}
