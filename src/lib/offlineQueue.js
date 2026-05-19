import { supabase } from './supabase'

const QUEUE_KEY = 'todo-agricola-offline-movements'

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
  } catch {
    return []
  }
}

function writeQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  window.dispatchEvent(new CustomEvent('offline-movement-queue', { detail: queue.length }))
}

export function getQueuedMovementCount() {
  return readQueue().length
}

export function isNetworkMovementError(error) {
  const message = String(error?.message || error || '').toLowerCase()
  return !navigator.onLine || message.includes('failed to fetch') || message.includes('network') || message.includes('fetch')
}

export function queueMovement(payload) {
  const queue = readQueue()
  queue.push({
    id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    created_at: new Date().toISOString(),
    ...payload,
  })
  writeQueue(queue)
  return queue.length
}

export async function syncQueuedMovements() {
  if (!supabase || !navigator.onLine) return { synced: 0, remaining: getQueuedMovementCount() }

  const queue = readQueue()
  const remaining = []
  let synced = 0

  for (const item of queue) {
    const { error } = await supabase.rpc('register_movement', {
      p_lot_id: item.lot_id,
      p_type: item.type,
      p_quantity: item.quantity,
      p_to_location: item.to_location || null,
      p_notes: item.notes || null,
      p_user_id: item.user_id,
    })

    if (error) {
      remaining.push(item)
      continue
    }

    synced += 1
    if (item.email) {
      await supabase.functions.invoke('send-movement-email', { body: item.email })
    }
  }

  writeQueue(remaining)
  return { synced, remaining: remaining.length }
}
