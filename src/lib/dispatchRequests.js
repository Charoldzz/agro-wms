import { cleanProductName, displayLotCode } from './display'
import { supabase } from './supabase'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toUpperCase()
}

function normalizeUnit(value) {
  const unit = normalizeText(value)
  if (['L', 'LT', 'LTS', 'LITRO', 'LITROS'].includes(unit)) return 'LT'
  if (['K', 'KG', 'KGS', 'KILO', 'KILOS'].includes(unit)) return 'KG'
  if (['G', 'GR', 'GRS', 'GRAMO', 'GRAMOS'].includes(unit)) return 'GR'
  if (['ML', 'MLS', 'MILILITRO', 'MILILITROS'].includes(unit)) return 'ML'
  return unit
}

function sameNumber(a, b) {
  if (a === null || a === undefined || a === '' || b === null || b === undefined || b === '') return false
  return Number(a) === Number(b)
}

function isSameProductName(a, b) {
  const left = normalizeText(cleanProductName(a))
  const right = normalizeText(cleanProductName(b))
  if (!left || !right) return false
  return left === right || left.includes(right) || right.includes(left)
}

function isSameLotCode(a, b) {
  const left = normalizeText(displayLotCode(a))
  const right = normalizeText(displayLotCode(b))
  if (!left || !right) return false
  return left === right || left.includes(right) || right.includes(left)
}

function isSameClient(lot, request) {
  if (request?.client_id && lot.client_id === request.client_id) return true
  const requestClient = normalizeText(request?.clients?.name || request?.client_name)
  const lotClient = normalizeText(lot?.clients?.name)
  if (!requestClient || !lotClient) return true
  return lotClient === requestClient
}

function matchLot(item, request, lots) {
  if (!item && !request) return null

  const itemLotId = item?.lot_id
  if (UUID_RE.test(String(itemLotId || ''))) {
    const byId = lots.find((lot) => lot.id === itemLotId)
    if (byId) return byId
  }

  const requestLotId = request?.lot_id
  if (UUID_RE.test(String(requestLotId || ''))) {
    const byRequestId = lots.find((lot) => lot.id === requestLotId)
    if (byRequestId) return byRequestId
  }

  const byCode = lots.find((lot) =>
    isSameClient(lot, request) &&
    isSameLotCode(lot.lot_code, item?.lot_code || request?.lots?.lot_code),
  )
  if (byCode) return byCode

  const hasClientReference = Boolean(request?.client_id || request?.clients?.name || request?.client_name || item?.client_id)
  if (!hasClientReference) return null

  return lots.find((lot) => {
    if (!isSameClient(lot, request)) return false
    if (!isSameProductName(lot.product, item?.product || request?.product || request?.lots?.product)) return false
    if (item?.package_unit && normalizeUnit(lot.package_unit) !== normalizeUnit(item.package_unit)) return false
    if (item?.package_size && !sameNumber(lot.package_size, item.package_size)) return false
    return true
  }) || null
}

function itemFromLot(lot, item = {}, request = {}) {
  if (!lot) return item
  const quantity = item.quantity ?? request.quantity ?? ''
  return {
    ...item,
    lot_id: lot.id,
    client_id: lot.client_id,
    client_name: item.client_name || lot.clients?.name || request.clients?.name || request.client_name || null,
    lot_code: lot.lot_code,
    product: lot.product,
    quantity,
    package_size: lot.package_size,
    package_unit: lot.package_unit,
    location: lot.location,
    available: lot.current_quantity,
    current_quantity: lot.current_quantity,
    expiry_date: lot.expiry_date,
    status: lot.status,
  }
}

function normalizeOneRequest(request, lots) {
  if (!request) return request
  const rawItems = Array.isArray(request.items) && request.items.length > 0
    ? request.items
    : request.lot_id || request.product
      ? [{
          lot_id: request.lot_id,
          lot_code: request.lots?.lot_code,
          product: request.product || request.lots?.product,
          quantity: request.quantity,
          package_size: request.lots?.package_size,
          package_unit: request.lots?.package_unit,
          location: request.lots?.location,
          available: request.lots?.current_quantity,
        }]
      : []

  const normalizedItems = rawItems.map((item) => itemFromLot(matchLot(item, request, lots), item, request))
  const firstMatchedLot = matchLot(normalizedItems[0], request, lots)
  const itemClientIds = Array.from(new Set(normalizedItems.map((item) => item.client_id).filter(Boolean)))
  const clientId = request.client_id || (itemClientIds.length === 1 ? itemClientIds[0] : firstMatchedLot?.client_id) || null
  const firstItemClientName = normalizedItems.find((item) => item.client_name)?.client_name
  const clients = request.clients || firstMatchedLot?.clients || (firstItemClientName ? { name: firstItemClientName } : null)
  const lotsRelation = request.lots || firstMatchedLot || null

  return {
    ...request,
    client_id: clientId,
    clients,
    lots: lotsRelation,
    items: normalizedItems,
  }
}

export async function fetchCurrentDispatchLots() {
  const { data } = await supabase
    .from('lots')
    .select('id, lot_code, client_id, product, current_quantity, package_size, package_unit, location, expiry_date, status, clients(name)')
    .gt('current_quantity', 0)
    .order('updated_at', { ascending: false })
    .limit(5000)

  return data || []
}

export async function normalizeDispatchRequests(requests, currentLots = null) {
  const list = Array.isArray(requests) ? requests : requests ? [requests] : []
  if (list.length === 0) return Array.isArray(requests) ? [] : null

  const lots = currentLots || await fetchCurrentDispatchLots()
  const normalized = list.map((request) => normalizeOneRequest(request, lots))
  return Array.isArray(requests) ? normalized : normalized[0]
}
