export function cleanProductName(product) {
  if (!product) return '-'
  return product
    .split(' | Cod:')[0]
    .split(' | Grupo:')[0]
    .split(' | Subgrupo:')[0]
    .trim()
}

const VISIBLE_PRODUCT_CODE_FIELDS = [
  'stock_product_code',
  'catalog_product_code',
  'catalog_code',
  'codigo_catalogo',
  'codigo_stock',
  'stock_code',
  'product_catalog_code',
  'codigo_visible',
  'display_product_code',
  'visible_product_code',
  'CODIGO_CATALOGO',
  'CatalogCode',
]

const PRODUCT_CODE_FIELDS = [
  'product_code',
  'codigo_producto',
  'cod_producto',
  'codigo',
  'code',
  'CODIGO',
  'Codigo',
  'Code',
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

function isInternalProductCode(value) {
  const text = String(value || '').trim()
  return /^\d{8,}$/.test(text) || /^0{4,}\d+$/.test(text)
}

function cleanVisibleProductCode(value) {
  const text = String(value || '').trim()
  if (!text || isInternalProductCode(text)) return ''
  return text
}

function firstVisibleTextValue(source, keys) {
  if (!source || typeof source !== 'object') return ''
  for (const key of keys) {
    const value = cleanVisibleProductCode(source[key])
    if (value) return value
  }
  return ''
}

function payloadFrom(lot) {
  return lot?.raw_data || lot?.source_payload || lot?.metadata || lot?.payload || null
}

export function productCode(lot) {
  if (!lot || typeof lot !== 'object') return ''

  const directVisible = firstVisibleTextValue(lot, VISIBLE_PRODUCT_CODE_FIELDS)
  if (directVisible) return directVisible

  const payload = payloadFrom(lot)
  if (payload && typeof payload === 'object') {
    const payloadVisible = firstVisibleTextValue(payload, VISIBLE_PRODUCT_CODE_FIELDS)
    if (payloadVisible) return payloadVisible
  }

  const direct = firstVisibleTextValue(lot, PRODUCT_CODE_FIELDS)
  if (direct) return direct

  if (payload && typeof payload === 'object') {
    const fromPayload = firstVisibleTextValue(payload, PRODUCT_CODE_FIELDS)
    if (fromPayload) return fromPayload
  }

  const match = String(lot.product || '').match(/\|\s*Cod:\s*([^|]+)/i)
  return match ? cleanVisibleProductCode(match[1]) : ''
}

export function productCodeLabel(lot) {
  const code = productCode(lot)
  return code ? `Codigo ${code}` : ''
}

export function isGeneratedLotCode(lotCode) {
  const code = String(lotCode || '').trim()
  return /^EXCEL-\d+-/i.test(code)
    || /^SOL-/i.test(code)
    || /^AUTO-/i.test(code)
    || /^SIN-?LOTE/i.test(code)
    || /^Codigo\s+\d+/i.test(code)
}

export function stockLotCode(lotCode) {
  const code = String(lotCode || '').trim()
  if (!code) return ''

  const solucionStyle = code.match(/^SOL-\d+-\d+-(.+)-\d{4}-\d{2}-\d{2}$/i)
  if (solucionStyle?.[1]) {
    const value = solucionStyle[1].trim()
    if (/^SIN-?LOTE$/i.test(value) || /^SINLOTE$/i.test(value)) return ''
    return value
  }

  const stockIndependienteStyle = code.match(/^SOL-[A-Z0-9]+-\d+-\d+-(.+?)-(?:\d{4}-\d{2}-\d{2}|SINVEN)$/i)
  if (stockIndependienteStyle?.[1]) {
    const value = stockIndependienteStyle[1].trim()
    if (/^SIN-?LOTE$/i.test(value) || /^SINLOTE$/i.test(value)) return ''
    return value
  }

  return ''
}

export function isNoLotDisplay(value) {
  const text = String(value || '').trim()
  return !text || text === '-' || /^sin lote$/i.test(text) || /^sin dato$/i.test(text)
}

const LOT_CODE_FIELDS = [
  'lot_code',
  'lote',
  'lot',
  'codigo_lote',
  'source_lot_code',
  'stock_lot_code',
  'LOTE',
  'Lote',
]

function cleanRealLotCode(value) {
  const text = String(value || '').trim()
  if (isNoLotDisplay(text)) return ''
  if (/^SIN-?LOTE/i.test(text) || /^SINLOTE/i.test(text)) return ''
  if (isGeneratedLotCode(text)) return ''
  return text
}

function realLotCodeFromLot(lot) {
  if (!lot || typeof lot !== 'object') return ''

  const direct = cleanRealLotCode(firstTextValue(lot, LOT_CODE_FIELDS))
  if (direct) return direct

  const payload = payloadFrom(lot)
  if (payload && typeof payload === 'object') {
    return cleanRealLotCode(firstTextValue(payload, LOT_CODE_FIELDS))
  }

  return ''
}

export function displayLotCode(lotCode, lot = null) {
  const realLotCode = realLotCodeFromLot(lot)
  if (realLotCode) return realLotCode

  if (!lotCode) return 'SIN LOTE'
  const cleanCode = String(lotCode)
    .replace(/^EXCEL-\d+-/i, '')
    .trim()

  if (/^SIN-?LOTE/i.test(cleanCode) || /^SINLOTE/i.test(cleanCode)) return 'SIN LOTE'

  const realStockLot = stockLotCode(cleanCode)
  if (realStockLot) return realStockLot

  if (isGeneratedLotCode(lotCode)) return 'SIN LOTE'

  if (cleanCode.includes('-LOTE-')) {
    const value = cleanCode.split('-LOTE-').pop()
    return /^SIN-?LOTE/i.test(value) ? 'SIN LOTE' : value
  }

  return cleanCode
}

export function lotLabel(lotCode, lot = null) {
  const value = displayLotCode(lotCode, lot)
  return isNoLotDisplay(value) ? 'SIN LOTE' : value
}

export function packageLabel(lot) {
  if (!lot?.package_size) return ''
  return `${Number(lot.package_size)} ${lot.package_unit || ''}`.trim()
}

export function productTotalKey(lot) {
  return cleanProductName(lot?.product)
}
