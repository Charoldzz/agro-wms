import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)
const SESSION_REFRESH_WINDOW_MS = 5 * 60 * 1000

function shouldRefreshSession(session) {
  if (!session?.expires_at) return false
  return session.expires_at * 1000 - Date.now() <= SESSION_REFRESH_WINDOW_MS
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

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
      setSession(nextSession)
      setLoading(false)
    }

    function restoreWhenVisible() {
      if (document.visibilityState === 'visible') restoreSession()
    }

    restoreSession()
    document.addEventListener('visibilitychange', restoreWhenVisible)
    window.addEventListener('online', restoreSession)

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
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
    async function loadProfile() {
      if (!supabase || !session?.user) {
        setProfile(null)
        return
      }

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()

      setProfile(data)
    }

    loadProfile()
  }, [session])

  const value = useMemo(
    () => ({
      session,
      user: session?.user || null,
      profile,
      loading,
      isAdmin: profile?.role === 'administrador',
      isOperator: profile?.role === 'operador',
      isClient: profile?.role === 'cliente',
    }),
    [session, profile, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
