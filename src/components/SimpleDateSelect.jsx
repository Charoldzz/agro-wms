import { useEffect, useMemo, useState } from 'react'
import { formatDate } from '../lib/format'

const monthOptions = [
  { value: '01', label: 'Enero' },
  { value: '02', label: 'Febrero' },
  { value: '03', label: 'Marzo' },
  { value: '04', label: 'Abril' },
  { value: '05', label: 'Mayo' },
  { value: '06', label: 'Junio' },
  { value: '07', label: 'Julio' },
  { value: '08', label: 'Agosto' },
  { value: '09', label: 'Septiembre' },
  { value: '10', label: 'Octubre' },
  { value: '11', label: 'Noviembre' },
  { value: '12', label: 'Diciembre' },
]

const emptyParts = { day: '', month: '', year: '' }

function splitDate(value) {
  if (!value) return emptyParts
  const [year, month, day] = String(value).split('-')
  return { day: day || '', month: month || '', year: year || '' }
}

function daysInMonth(year, month) {
  if (!year || !month) return 31
  return new Date(Number(year), Number(month), 0).getDate()
}

function composeDate(parts) {
  if (!parts.day || !parts.month || !parts.year) return ''
  return `${parts.year}-${parts.month}-${parts.day}`
}

export default function SimpleDateSelect({
  value,
  onChange,
  clearLabel = 'Limpiar fecha',
  previewLabel = 'Fecha',
  startYear,
  endYear,
  showPreview = true,
}) {
  const [parts, setParts] = useState(splitDate(value))
  const currentYear = new Date().getFullYear()
  const firstYear = startYear ?? currentYear
  const lastYear = endYear ?? currentYear + 11
  const isEmpty = !value

  useEffect(() => {
    setParts(splitDate(value))
  }, [value])

  const yearOptions = useMemo(() => {
    const years = []
    for (let year = firstYear; year <= lastYear; year += 1) years.push(String(year))
    if (parts.year && !years.includes(parts.year)) years.push(parts.year)
    return years.sort((a, b) => Number(a) - Number(b))
  }, [firstYear, lastYear, parts.year])

  const dayLimit = daysInMonth(parts.year, parts.month)
  const dayOptions = useMemo(
    () => Array.from({ length: dayLimit }, (_, index) => String(index + 1).padStart(2, '0')),
    [dayLimit],
  )

  function updatePart(part, nextValue) {
    const next = { ...parts, [part]: nextValue }
    const limit = daysInMonth(next.year, next.month)
    if (next.day && Number(next.day) > limit) next.day = String(limit).padStart(2, '0')
    setParts(next)
    onChange(composeDate(next))
  }

  function clearDate() {
    setParts(emptyParts)
    onChange('')
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.35fr)_minmax(0,1fr)] gap-2 sm:grid-cols-[90px_1fr_110px_auto]">
        <select className="input" value={parts.day} onChange={(event) => updatePart('day', event.target.value)}>
          <option value="">Día</option>
          {dayOptions.map((day) => (
            <option key={day} value={day}>{Number(day)}</option>
          ))}
        </select>
        <select className="input" value={parts.month} onChange={(event) => updatePart('month', event.target.value)}>
          <option value="">Mes</option>
          {monthOptions.map((month) => (
            <option key={month.value} value={month.value}>{month.label}</option>
          ))}
        </select>
        <select className="input" value={parts.year} onChange={(event) => updatePart('year', event.target.value)}>
          <option value="">Año</option>
          {yearOptions.map((year) => (
            <option key={year} value={year}>{year}</option>
          ))}
        </select>
        <button
          className={`btn-secondary col-span-3 !min-h-12 !px-3 !py-2 text-sm sm:col-span-1 ${isEmpty ? 'border-campo-200 bg-campo-50 text-campo-800' : ''}`}
          type="button"
          onClick={clearDate}
          aria-pressed={isEmpty}
        >
          {clearLabel}
        </button>
      </div>
      {showPreview && value ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-black text-slate-700">
          {previewLabel}: {formatDate(value)}
        </p>
      ) : null}
    </div>
  )
}
