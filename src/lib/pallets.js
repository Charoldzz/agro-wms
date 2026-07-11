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

// NOTA: la fórmula de pallets POR CLIENTE del programa (Cobranzas) no pudo
// reproducirse desde los datos (tiene ajustes manuales en el código fuente).
// Decisión de Harold 2026-07-10: no mostrar pallets por cliente hasta
// aprender la fórmula real — nunca mostrar datos copiados/estimados.

// SOLO dato real (CantidadPorPallet del programa). Sin dato no se estima:
// el lote no suma pallets (regla de Harold: nunca adivinar).
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
