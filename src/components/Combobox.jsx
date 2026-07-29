import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Mueve el foco al siguiente elemento tabulable VISIBLE después de `el`.
// (offsetParent === null descarta lo oculto, ej. el layout que no está en uso.)
function focusNextTabbable(el) {
  if (!el) return
  const nodes = Array.from(document.querySelectorAll('input, select, textarea, button, [tabindex]'))
    .filter(n => !n.disabled && n.getAttribute('tabindex') !== '-1' && n.offsetParent !== null)
  const idx = nodes.indexOf(el)
  if (idx > -1 && nodes[idx + 1]) nodes[idx + 1].focus()
}

// Combobox con autocompletado: se escribe para filtrar, se elige con flechas +
// Enter o clic. El desplegable va por portal (position:fixed) para no ser
// recortado por contenedores con overflow (ej. la tabla de ingreso).
//
// options: [{ value, label }]  ·  value: valor actual  ·  onChange(value)
// extraOption: { value, label, onSelect } — fila fija al final (ej. "Producto nuevo")
// advanceOnCommit: al elegir, salta el foco al campo siguiente
// autoFocus: toma el foco al montarse (para foco al agregar ítem)
export default function Combobox({
  value,
  options = [],
  onChange,
  onCommit,
  onFocus,
  extraOption,
  placeholder = 'Buscar…',
  disabled = false,
  className = '',
  advanceOnCommit = false,
  autoFocus = false,
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [touched, setTouched] = useState(false)
  const [hi, setHi] = useState(0)
  const [rect, setRect] = useState(null)
  const inputRef = useRef(null)

  const selected = options.find(o => o.value === value)
  const label = selected ? selected.label : ''
  const shown = open ? text : label

  const q = text.trim().toUpperCase()
  const base = (touched && q) ? options.filter(o => (o.label || '').toUpperCase().includes(q)) : options
  const items = extraOption ? [...base, { value: extraOption.value, label: extraOption.label, __extra: true }] : base

  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function reposition() {
    const el = inputRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      setRect({ left: r.left, top: r.bottom + 2, width: r.width })
    }
  }

  function openList() {
    if (disabled) return
    setText(label)
    setTouched(false)
    setHi(0)
    reposition()
    setOpen(true)
    onFocus && onFocus()
    setTimeout(() => { try { inputRef.current && inputRef.current.select() } catch (e) { /* noop */ } }, 0)
  }

  function close() { setOpen(false); setText(''); setTouched(false) }

  function commit(item) {
    if (!item) return
    if (item.__extra) { close(); extraOption && extraOption.onSelect && extraOption.onSelect(); return }
    onChange && onChange(item.value)
    close()
    onCommit && onCommit()
    if (advanceOnCommit) setTimeout(() => focusNextTabbable(inputRef.current), 0)
  }

  useEffect(() => {
    if (!open) return
    function onDoc(e) {
      const inInput = inputRef.current && inputRef.current.contains(e.target)
      const inPop = e.target.closest && e.target.closest('[data-combobox-pop]')
      if (!inInput && !inPop) close()
    }
    function onScrollResize() { reposition() }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onScrollResize, true)
    window.addEventListener('resize', onScrollResize)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', onScrollResize, true)
      window.removeEventListener('resize', onScrollResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function onKey(e) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); openList() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(items.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); commit(items[hi]) }
    else if (e.key === 'Escape') { e.preventDefault(); close() }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        className={className}
        value={shown}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={openList}
        onChange={(e) => { setText(e.target.value); setTouched(true); setHi(0); if (!open) { reposition(); setOpen(true) } }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKey}
      />
      {open && rect && items.length > 0 && createPortal(
        <div
          data-combobox-pop
          style={{ position: 'fixed', left: rect.left, top: rect.top, width: rect.width, zIndex: 60 }}
          className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
        >
          {items.map((it, i) => (
            <div
              key={String(it.value) + i}
              onMouseDown={(e) => { e.preventDefault(); commit(it) }}
              onMouseEnter={() => setHi(i)}
              className={`cursor-pointer truncate px-3 py-2 text-sm ${it.__extra ? 'font-black text-campo-700' : 'font-semibold text-slate-700'} ${i === hi ? 'bg-campo-50' : ''}`}
              title={it.label}
            >
              {it.label}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
