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

// Dev-only escape hatch: opening the app with `?preview` skips the Google
// round-trip and signs in a fake admin user, so the UI can be inspected
// locally (design work, screenshots). Vite replaces `import.meta.env.DEV`
// statically, so this whole branch is dead code in production builds.
export const PREVIEW_USER_ID = 'preview-user'
const PREVIEW_USER =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('preview')
    ? {
        id: PREVIEW_USER_ID,
        email: ADMIN_EMAIL,
        user_metadata: { full_name: 'משתמש תצוגה' },
      }
    : null

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

  if (PREVIEW_USER) return { session: null, user: PREVIEW_USER, loading: false }

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
