export function cleanProductName(product) {
  if (!product) return '-'
  return product
    .split(' | Cod:')[0]
    .split(' | Grupo:')[0]
    .split(' | Subgrupo:')[0]
    .trim()
}

export function displayLotCode(lotCode) {
  if (!lotCode) return '-'
  const cleanCode = lotCode
    .replace(/^EXCEL-\d+-/i, '')

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
