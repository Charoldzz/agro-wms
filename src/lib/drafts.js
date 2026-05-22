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
