export function readDraft(key, fallback) {
  try {
    const draft = JSON.parse(localStorage.getItem(key) || 'null')
    return draft ? { ...fallback, ...draft } : fallback
  } catch {
    return fallback
  }
}

export function writeDraft(key, draft) {
  localStorage.setItem(key, JSON.stringify(draft))
}

export function clearDraft(key) {
  localStorage.removeItem(key)
}

export function clearOperationalDrafts() {
  const localKeys = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith('todo-agricola-') && key.includes('draft')) localKeys.push(key)
  }
  localKeys.forEach((key) => localStorage.removeItem(key))

  const sessionKeys = []
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index)
    if (key?.startsWith('scanned-lot-') || key?.startsWith('lot-mode-')) sessionKeys.push(key)
  }
  sessionKeys.forEach((key) => sessionStorage.removeItem(key))
}
