// Auth state hook. Exposes the current session/user and a loading flag while
// the initial session is being restored. Subscribes to auth changes so
// sign-in / sign-out anywhere updates the whole app.

import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// The question-store admin. MUST match the email in the is_admin() SQL function
// (supabase/migrations/0001_init.sql) — that DB-side check is the real security
// boundary; this is only for showing/hiding admin UI.
export const ADMIN_EMAIL =
  import.meta.env.VITE_ADMIN_EMAIL || 'gbeeri613@gmail.com'

export function isAdmin(user) {
  return !!user && user.email === ADMIN_EMAIL
}

export function useAuth() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return { session, user: session?.user ?? null, loading }
}

export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // Come back to whatever origin we launched from (localhost in dev, the
      // Vercel URL in prod). Both must be listed in Supabase → Auth → URL
      // Configuration → Redirect URLs.
      redirectTo: window.location.origin,
    },
  })
}

export async function signOut() {
  return supabase.auth.signOut()
}
