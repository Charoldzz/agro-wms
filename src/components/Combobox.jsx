import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { focusNextTabbable } from '../lib/formNav'

// Combobox con autocompletado: se escribe para filtrar, se elige con flechas +
// Enter o clic. El desplegable va por portal, posicionado en coordenadas del
// DOCUMENTO (position:absolute) para: (1) no ser recortado por contenedores con
// overflow (ej. la tabla de ingreso); (2) quedar bien anclado en el celular aun
// con el teclado abierto (usa visualViewport); (3) abrirse hacia arriba si no hay
// lugar abajo.
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
  const [pos, setPos] = useState(null)
  const inputRef = useRef(null)
  const popRef = useRef(null)

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

  function computePos() {
    const el = inputRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vv = window.visualViewport
    const vpTop = vv ? vv.offsetTop : 0
    const vpH = vv ? vv.height : window.innerHeight
    const spaceBelow = (vpTop + vpH) - r.bottom
    const spaceAbove = r.top - vpTop
    const up = spaceBelow < 210 && spaceAbove > spaceBelow
    const maxHeight = Math.max(132, Math.min(300, (up ? spaceAbove : spaceBelow) - 12))
    setPos({
      left: r.left + window.scrollX,
      width: r.width,
      maxHeight,
      up,
      downTop: r.bottom + window.scrollY + 3,
      anchorTop: r.top + window.scrollY - 3,
    })
  }

  // Ajuste fino cuando abre hacia arriba: alinea el borde inferior con el input.
  useLayoutEffect(() => {
    if (!open || !pos || !pos.up || !popRef.current) return
    popRef.current.style.top = (pos.anchorTop - popRef.current.offsetHeight) + 'px'
  }, [open, pos, items.length])

  function openList() {
    if (disabled) return
    setText(label)
    setTouched(false)
    setHi(0)
    computePos()
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
    function recompute() { computePos() }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', recompute, true)
    window.addEventListener('resize', recompute)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', recompute)
      window.visualViewport.addEventListener('scroll', recompute)
    }
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', recompute, true)
      window.removeEventListener('resize', recompute)
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', recompute)
        window.visualViewport.removeEventListener('scroll', recompute)
      }
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
        onChange={(e) => { setText(e.target.value); setTouched(true); setHi(0); if (!open) { setOpen(true) } computePos() }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKey}
      />
      {open && pos && items.length > 0 && createPortal(
        <div
          ref={popRef}
          data-combobox-pop
          style={{
            position: 'absolute',
            left: pos.left,
            width: pos.width,
            top: pos.up ? (pos.anchorTop - pos.maxHeight) : pos.downTop,
            maxHeight: pos.maxHeight,
            zIndex: 60,
          }}
          className="overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
        >
          {items.map((it, i) => (
            <div
              key={String(it.value) + i}
              onMouseDown={(e) => { e.preventDefault(); commit(it) }}
              onMouseEnter={() => setHi(i)}
              className={`cursor-pointer truncate px-3 py-2.5 text-sm ${it.__extra ? 'font-black text-campo-700' : 'font-semibold text-slate-700'} ${i === hi ? 'bg-campo-50' : ''}`}
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
