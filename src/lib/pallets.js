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

// CRITERIO DE PALLETS (2026-07-19) — copiado del programa C# (CobranzasModule):
//
//     pallets = (int)Math.Ceiling(cantidad / CantidadPorPallet)
//
// O sea: ENTEROS y SIEMPRE HACIA ARRIBA, agrupando por PRODUCTO de la empresa
// (no lote por lote). Un pallet es un espacio físico: si un producto ocupa
// aunque sea una esquina, ocupa un pallet entero. No existe "0,08 de pallet".
//
// DIFERENCIA con el programa, a propósito: el programa factura sobre
// "saldo inicial + ingresos del período" (no resta las salidas), porque cobra
// el almacenaje del período. La web calcula sobre el STOCK ACTUAL, porque
// responde otra pregunta: "¿cuánto espacio ocupo hoy?". Por eso el número de
// la web se llama PALLETS OCUPADOS y no es un dato de facturación.
//
// SOLO dato real (CantidadPorPallet del programa). Sin dato no se estima:
// el producto no suma pallets (regla de Harold: nunca adivinar).

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

// Pallets que ocupa UN lote: entero, hacia arriba.
export function lotBillingPallets(lot) {
  const units = palletUnitsPerPallet(lot)
  if (!units) return null
  const quantity = Number(lot?.current_quantity || 0)
  if (quantity <= 0) return 0
  return Math.ceil(quantity / units)
}

// Identidad de producto dentro de una empresa: por CÓDIGO cuando existe
// (regla firme: relacionar por código, nunca por nombre).
function productKey(lot) {
  const code = String(lot?.solucion_product_code || '').trim().toUpperCase()
  const name = String(lot?.product || '').trim().toUpperCase()
  return `${lot?.client_id || ''}|${code || name}|${palletUnitsPerPallet(lot) || 0}`
}

// Total de pallets ocupados: se AGRUPA POR PRODUCTO (como el programa), se suma
// la cantidad del grupo y recién ahí se redondea hacia arriba. Redondear lote
// por lote inflaría el total: dos lotes del mismo producto comparten pallet.
export function sumBillingPallets(lots) {
  const grupos = new Map()
  let missing = 0

  for (const lot of lots || []) {
    const units = palletUnitsPerPallet(lot)
    const quantity = Number(lot?.current_quantity || 0)
    if (!units) {
      if (quantity > 0) missing += 1
      continue
    }
    if (quantity <= 0) continue
    const key = productKey(lot)
    const actual = grupos.get(key) || { units, quantity: 0 }
    actual.quantity += quantity
    grupos.set(key, actual)
  }

  let value = 0
  for (const g of grupos.values()) value += Math.ceil(g.quantity / g.units)

  return { value, covered: grupos.size, missing }
}
