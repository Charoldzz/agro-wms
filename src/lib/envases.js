import { formatNumber } from './format'

// Reglas de tipo de envase por presentación (conteo de Harold, 2026-07-10)
// Líquidos: hasta 1 lt = frasco · 3 lts = bolsa (STARFIX) · hasta 5 = galón ·
//           hasta 20 = bidón · hasta 200 = tambor · más = tanque IBC
// Sólidos:  hasta 1 kg = sobre · hasta 15 kgs = bolsa · hasta 50 = saco · más = big bag

function normalizado(size, unit) {
  const u = String(unit || '').toLowerCase()
  const s = Number(size) || 0
  if (u === 'ml') return { s: s / 1000, tipo: 'liquido' }
  if (u === 'gr' || u === 'grs') return { s: s / 1000, tipo: 'solido' }
  if (u.startsWith('l')) return { s, tipo: 'liquido' }
  if (u.startsWith('k')) return { s, tipo: 'solido' }
  return { s, tipo: '' }
}

export function envaseTipo(size, unit) {
  const { s, tipo } = normalizado(size, unit)
  if (!tipo || s <= 0) return null
  if (tipo === 'liquido') {
    if (s <= 1) return { singular: 'frasco', plural: 'frascos' }
    if (s === 3) return { singular: 'bolsa', plural: 'bolsas' }
    if (s <= 5) return { singular: 'galón', plural: 'galones' }
    if (s <= 20) return { singular: 'bidón', plural: 'bidones' }
    if (s <= 200) return { singular: 'tambor', plural: 'tambores' }
    return { singular: 'tanque IBC', plural: 'tanques IBC' }
  }
  if (s <= 1) return { singular: 'sobre', plural: 'sobres' }
  if (s <= 15) return { singular: 'bolsa', plural: 'bolsas' }
  if (s <= 50) return { singular: 'saco', plural: 'sacos' }
  return { singular: 'big bag', plural: 'big bags' }
}

// Desglose completo: cantidad equivalente → cajas + envases sueltos + resto
// qty: cantidad total (lts/kgs), size/unit: presentación, upb: unidades por caja (0 = sin dato)
export function desgloseEnvases(qty, size, unit, upb) {
  const cantidad = Number(qty) || 0
  const pkgSize = Number(size) || 0
  if (cantidad <= 0 || pkgSize <= 0) return { uds: 0, cajas: 0, sueltos: 0, resto: 0, label: '' }

  const uds = Math.floor(cantidad / pkgSize)
  const resto = Math.round((cantidad - uds * pkgSize) * 1000) / 1000
  const porCaja = Number(upb) || 0
  const cajas = porCaja > 0 ? Math.floor(uds / porCaja) : 0
  const sueltos = porCaja > 0 ? uds % porCaja : uds

  const envase = envaseTipo(pkgSize, unit)
  const partes = []
  if (cajas > 0) partes.push(`${formatNumber(cajas)} ${cajas === 1 ? 'caja' : 'cajas'}`)
  if (sueltos > 0) {
    const nombre = envase ? (sueltos === 1 ? envase.singular : envase.plural) : (sueltos === 1 ? 'unidad' : 'unidades')
    partes.push(`${formatNumber(sueltos)} ${nombre}`)
  }
  if (resto > 0) partes.push(`${formatNumber(resto)} ${unit || ''}`.trim())

  return { uds, cajas, sueltos, resto, label: partes.join(' + ') }
}
