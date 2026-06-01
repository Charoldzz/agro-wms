import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)
const SESSION_REFRESH_WINDOW_MS = 5 * 60 * 1000
const PROFILE_CACHE_PREFIX = 'todo-agricola-profile:'

function shouldRefreshSession(session) {
  if (!session?.expires_at) return false
  return session.expires_at * 1000 - Date.now() <= SESSION_REFRESH_WINDOW_MS
}

function readCachedProfile(userId) {
  if (!userId) return null
  try {
    const raw = window.localStorage.getItem(`${PROFILE_CACHE_PREFIX}${userId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeCachedProfile(userId, nextProfile) {
  if (!userId || !nextProfile) return
  try {
    window.localStorage.setItem(`${PROFILE_CACHE_PREFIX}${userId}`, JSON.stringify(nextProfile))
  } catch {
    // Cache is only a speed helper. Ignore storage failures.
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)
  const sessionUserIdRef = useRef('')

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    let active = true

    async function restoreSession() {
      const { data } = await supabase.auth.getSession()
      let nextSession = data.session

      if (nextSession && navigator.onLine && shouldRefreshSession(nextSession)) {
        const { data: refreshedData } = await supabase.auth.refreshSession()
        nextSession = refreshedData.session || nextSession
      }

      if (!active) return
      const nextUserId = nextSession?.user?.id || ''
      if (nextUserId !== sessionUserIdRef.current) {
        sessionUserIdRef.current = nextUserId
        setSession(nextSession)
      }
      setLoading(false)
    }

    function restoreWhenVisible() {
      if (document.visibilityState === 'visible') restoreSession()
    }

    restoreSession()
    document.addEventListener('visibilitychange', restoreWhenVisible)
    window.addEventListener('online', restoreSession)

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user?.id || ''
      if (nextUserId === sessionUserIdRef.current) return
      sessionUserIdRef.current = nextUserId
      setSession(nextSession)
    })

    return () => {
      active = false
      document.removeEventListener('visibilitychange', restoreWhenVisible)
      window.removeEventListener('online', restoreSession)
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    let active = true

    async function loadProfile() {
      if (!supabase || !session?.user) {
        setProfileLoading(false)
        setProfile(null)
        return
      }

      const cachedProfile = readCachedProfile(session.user.id)
      if (cachedProfile) setProfile(cachedProfile)
      setProfileLoading(true)
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()

      if (!active) return
      if (!error && data) writeCachedProfile(session.user.id, data)
      setProfile(error ? cachedProfile || null : data)
      setProfileLoading(false)
    }

    loadProfile()

    return () => {
      active = false
    }
  }, [session])

  const value = useMemo(
    () => ({
      session,
      user: session?.user || null,
      profile,
      loading,
      profileLoading,
      appReady: !loading && (!session?.user || !profileLoading),
      isAdmin: profile?.role === 'administrador',
      isOperator: profile?.role === 'operador',
      isClient: profile?.role === 'cliente',
    }),
    [session, profile, loading, profileLoading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
