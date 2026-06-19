function rawDataFrom(lot) {
  const raw = lot?.raw_data
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function normalizeUnit(value) {
  const unit = String(value || '').trim().toLowerCase()
  if (['l', 'lt', 'lts', 'litro', 'litros'].includes(unit)) return 'lt'
  if (['k', 'kg', 'kgs', 'kilo', 'kilos'].includes(unit)) return 'kg'
  if (['ml', 'mls', 'mlt', 'mlts', 'mililitro', 'mililitros'].includes(unit)) return 'ml'
  return unit
}

function unitsByPresentation(lot) {
  const size = Number(lot?.package_size || 0)
  const unit = normalizeUnit(lot?.package_unit)

  if (unit === 'lt') {
    if (size === 20) return 960
    if (size === 10 || size === 5) return 720
    if (size === 1) return 600
    if (size === 200) return 800
  }

  if (unit === 'kg') {
    if (size === 50) return 1000
    if (size === 15 || size === 10 || size === 1) return 600
  }

  if (unit === 'ml' && (size === 250 || size === 100)) return 1000

  return null
}

export function palletUnitsPerPallet(lot) {
  const raw = rawDataFrom(lot)
  const value =
    lot?.pallet_units_per_pallet ??
    raw?.pallet_units_per_pallet ??
    raw?.CantidadPorPallet ??
    raw?.cantidad_por_pallet
  const units = Number(value || 0)
  return units > 0 ? units : unitsByPresentation(lot)
}

export function lotBillingPallets(lot) {
  const units = palletUnitsPerPallet(lot)
  if (!units) return null
  const quantity = Number(lot?.current_quantity || 0)
  if (quantity <= 0) return 0
  return quantity / units
}

export function sumBillingPallets(lots) {
  return (lots || []).reduce(
    (totals, lot) => {
      const pallets = lotBillingPallets(lot)
      if (pallets === null) {
        if (Number(lot?.current_quantity || 0) > 0) totals.missing += 1
        return totals
      }
      totals.value += pallets
      totals.covered += 1
      return totals
    },
    { value: 0, covered: 0, missing: 0 },
  )
}
