// Navegación por teclado en formularios: saltar al campo siguiente al apretar
// Enter / el "check" del teclado móvil, para cargar datos de corrido.

// Enfoca el siguiente elemento tabulable VISIBLE después de `el`.
// offsetParent === null descarta lo oculto (ej. el layout que no está en uso,
// desktop vs mobile) y los display:none.
export function focusNextTabbable(el) {
  if (!el) return
  const nodes = Array.from(document.querySelectorAll('input, select, textarea, button, [tabindex]'))
    .filter((n) => !n.disabled && n.getAttribute('tabindex') !== '-1' && n.offsetParent !== null)
  const idx = nodes.indexOf(el)
  if (idx > -1 && nodes[idx + 1]) nodes[idx + 1].focus()
}

// onKeyDown para inputs: Enter (o "check"/return del teclado) → siguiente campo,
// sin enviar el formulario.
export function advanceOnEnter(e) {
  if (e.key === 'Enter') {
    e.preventDefault()
    focusNextTabbable(e.target)
  }
}
