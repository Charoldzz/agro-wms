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

export function palletUnitsPerPallet(lot) {
  const raw = rawDataFrom(lot)
  const value =
    lot?.pallet_units_per_pallet ??
    raw?.pallet_units_per_pallet ??
    raw?.CantidadPorPallet ??
    raw?.cantidad_por_pallet
  const units = Number(value || 0)
  return units > 0 ? units : null
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
