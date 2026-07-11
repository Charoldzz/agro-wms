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

function normalizeCompanyName(value) {
  return String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('"', '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const PROGRAM_COMPANY_PALLETS = new Map(Object.entries({
  'ALMACEN G A T BOLIVIA': 107,
  'AGRO PARCEL': 142,
  'TECNOMYL S A': 432,
  'TOTAL AGRO S A': 40,
  'AGROPECUARIA GUANANDI SRL TEC': 15,
  'AUBREY REINALDO VIRICA': 10,
  'TECNOMYL REPROCESO': 8,
  'DENIS BARBIERI': 42,
  'TOTAL PEC SRL': 4,
  'ADILSON SABEC PERES': 114,
  'AGRO NEULAND DEL SUR SRL': 13,
  'MAXIAGRO SRL': 761,
  'FOLCOL S A S': 27,
  'DISAN SRL': 75,
  'ZENTTA BIO SRL': 44,
  'AGRICOLA RIO VICTORIA SRL': 29,
  'SOGIMA SRL': 8,
  'UPL BOLIVIA SRL': 754,
  'AGROCALY SRL': 44,
  'JACOBO MARTENS FRIESEN': 36,
  'DAVID WIEBE DYCK': 46,
  'LA BENDECIDA SRL': 32,
}))

export function companyBillingPallets(companyName, fallback = null) {
  const value = PROGRAM_COMPANY_PALLETS.get(normalizeCompanyName(companyName))
  return value ?? fallback
}

export function hasCompanyBillingPallets(companyName) {
  return PROGRAM_COMPANY_PALLETS.has(normalizeCompanyName(companyName))
}

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
