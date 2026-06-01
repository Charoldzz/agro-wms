import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const BACKDROP_SELECTOR = '[data-modal-backdrop="true"], [data-operator-overlay="true"]'
const PANEL_SELECTOR = '[data-overlay-panel="true"], [role="dialog"], section'

export default function InteractionGuard() {
  const location = useLocation()

  useEffect(() => {
    resetDocumentInteraction()
    removeBackdropsOnRouteBoundary(location.pathname)
  }, [location.pathname, location.search])

  useEffect(() => {
    function handlePageShow() {
      resetDocumentInteraction()
      if (window.location.hash.includes('/login')) removeAllBackdrops()
    }

    function handlePointerDown(event) {
      const backdrop = event.target?.closest?.(BACKDROP_SELECTOR)
      if (!backdrop) return

      const panel = event.target?.closest?.(PANEL_SELECTOR)
      if (panel && backdrop.contains(panel)) return

      backdrop.remove()
      resetDocumentInteraction()
    }

    window.addEventListener('pageshow', handlePageShow)
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('touchstart', handlePointerDown, true)

    return () => {
      window.removeEventListener('pageshow', handlePageShow)
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('touchstart', handlePointerDown, true)
    }
  }, [])

  return null
}

function removeBackdropsOnRouteBoundary(pathname) {
  if (pathname === '/login') {
    removeAllBackdrops()
    return
  }

  document.querySelectorAll(BACKDROP_SELECTOR).forEach((element) => {
    if (!isConnectedToReactScreen(element)) element.remove()
  })
}

function isConnectedToReactScreen(element) {
  const root = document.getElementById('root')
  return root?.contains(element)
}

function removeAllBackdrops() {
  document.querySelectorAll(BACKDROP_SELECTOR).forEach((element) => element.remove())
}

function resetDocumentInteraction() {
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
  document.documentElement.style.pointerEvents = ''
  document.body.style.pointerEvents = ''
  document.documentElement.style.removeProperty('opacity')
  document.body.style.removeProperty('opacity')
  document.documentElement.style.removeProperty('filter')
  document.body.style.removeProperty('filter')
  document.getElementById('root')?.style.removeProperty('pointer-events')
  document.getElementById('root')?.style.removeProperty('opacity')
  document.getElementById('root')?.style.removeProperty('filter')
}
