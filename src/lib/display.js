export function cleanProductName(product) {
  if (!product) return '-'
  return product
    .split(' | Cod:')[0]
    .split(' | Grupo:')[0]
    .split(' | Subgrupo:')[0]
    .trim()
}

const VISIBLE_PRODUCT_CODE_FIELDS = [
  'solucion_product_code',
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

// Devuelve { size, unit } para calcular equivalentes.
// SOLO usa package_size/package_unit del registro — REGLA de Harold: la
// presentación nunca se adivina del nombre (un "BIDON BLANCO HDPE 20 LTS."
// de embalaje contado en unidades NO es un producto de 20 lts).
export function lotSizeAndUnit(lotOrItem) {
  const size = Number(lotOrItem?.package_size || 0)
  const unit = String(lotOrItem?.package_unit || '').toLowerCase().trim()
  if (size > 0 && unit) return { size, unit: normalizeUnit(unit) }
  return { size: 0, unit: '' }
}

// Extrae el número de unidades por caja del nombre del producto.
// Reconoce patrones NxM donde N = unidades por caja (ej: "4x10 LTS" → 4, "10x1" → 10).
export function unitsPerBoxFromName(name) {
  const m = String(name || '').match(/\b(\d+)\s*[xX×]\s*(\d+(?:[.,]\d+)?)/)
  if (!m) return 0
  return parseInt(m[1], 10) || 0
}

function normalizeUnit(u) {
  const s = String(u || '').toLowerCase().trim()
  if (['lts', 'ltr', 'ltrs', 'l'].includes(s)) return 'lt'
  if (['kgs', 'gm'].includes(s)) return 'kg'
  if (s === 'cc') return 'ml'
  if (s === 'gr') return 'gr'
  return s
}

// Nombre visible de una ficha de catálogo: agrega la presentación SOLO si el nombre
// no la trae. Fuente ÚNICA de la verdad (la usan el catálogo, el ingreso y la lista
// de almacenes) para que el nombre del lote y de la ficha coincidan siempre.
// Detecta un número seguido de unidad ("5 LTS", "500 ML", "4X5 LTS", "20L_BO", "X 200 lt").
const CATALOG_HAS_UNIT_RE = /\d\s*(?:ltrs?|lts?|kgs?|grs?|gr|gm|ml|cc|l)(?![a-z])/i
// Multiplicador sin unidad ("4X5", "PROD X 5"): agrega solo la unidad
const CATALOG_BARE_X_N_RE = /\d\s*[xX×]\s*\d|\s[xX×]\s*\d/i

export function catalogDisplayName(p) {
  if (!p?.name) return ''
  if (CATALOG_HAS_UNIT_RE.test(p.name)) return p.name            // ya trae presentación → tal cual
  if (p.package_size && p.package_unit) {
    if (CATALOG_BARE_X_N_RE.test(p.name)) return `${p.name} ${p.package_unit}`
    return `${p.name} X ${p.package_size} ${p.package_unit}`
  }
  return p.name
}
