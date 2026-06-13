export function cleanProductName(product) {
  if (!product) return '-'
  return product
    .split(' | Cod:')[0]
    .split(' | Grupo:')[0]
    .split(' | Subgrupo:')[0]
    .trim()
}

const PRODUCT_CODE_FIELDS = [
  'solucion_product_code',
  'stock_product_code',
  'product_code',
  'codigo_producto',
  'cod_producto',
  'codigo',
  'code',
  'CODIGO',
  'Codigo',
]

function firstTextValue(source, keys) {
  if (!source || typeof source !== 'object') return ''
  for (const key of keys) {
    const value = source[key]
    if (value !== null && value !== undefined && String(value).trim()) {
      return String(value).trim()
    }
  }
  return ''
}

function payloadFrom(lot) {
  return lot?.raw_data || lot?.source_payload || lot?.metadata || lot?.payload || null
}

export function productCode(lot) {
  if (!lot || typeof lot !== 'object') return ''

  const direct = firstTextValue(lot, PRODUCT_CODE_FIELDS)
  if (direct) return direct

  const payload = payloadFrom(lot)
  if (payload && typeof payload === 'object') {
    const fromPayload = firstTextValue(payload, PRODUCT_CODE_FIELDS)
    if (fromPayload) return fromPayload
  }

  const match = String(lot.product || '').match(/\|\s*Cod:\s*([^|]+)/i)
  return match ? match[1].trim() : ''
}

export function productCodeLabel(lot) {
  const code = productCode(lot)
  return code ? `Codigo ${code}` : ''
}

export function isGeneratedLotCode(lotCode) {
  const code = String(lotCode || '').trim()
  return /^EXCEL-\d+-/i.test(code)
    || /^SOL-\d+/i.test(code)
    || /^AUTO-/i.test(code)
    || /^SIN-?LOTE/i.test(code)
}

export function stockLotCode(lotCode) {
  const code = String(lotCode || '').trim()
  if (!code) return ''

  const solucionStyle = code.match(/^SOL-\d+-\d+-(.+)-\d{4}-\d{2}-\d{2}$/i)
  if (solucionStyle?.[1]) return solucionStyle[1].trim()

  return ''
}

export function displayLotCode(lotCode, lot = null) {
  if (!lotCode) return lot ? (productCodeLabel(lot) || 'Sin lote') : '-'
  const cleanCode = String(lotCode)
    .replace(/^EXCEL-\d+-/i, '')
    .trim()

  const realStockLot = stockLotCode(cleanCode)
  if (realStockLot) return realStockLot

  if (lot && isGeneratedLotCode(lotCode)) {
    return productCodeLabel(lot) || 'Sin lote'
  }

  if (cleanCode.includes('-LOTE-')) {
    return `Lote ${cleanCode.split('-LOTE-').pop()}`
  }

  return cleanCode
}

export function packageLabel(lot) {
  if (!lot?.package_size) return ''
  return `${Number(lot.package_size)} ${lot.package_unit || ''}`.trim()
}

export function productTotalKey(lot) {
  return cleanProductName(lot?.product)
}
