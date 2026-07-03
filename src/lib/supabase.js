// The one shared Supabase client. The whole app talks to the backend through
// this; there is no server of our own. Security is enforced by Row Level
// Security policies in the database (see supabase/migrations), not here.

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// Fail loudly if the env is missing — the app is useless without it — but
// still construct a client with placeholders so the UI renders instead of
// white-screening (sign-in and data calls will fail with clear errors).
if (!url || !key) {
  console.error(
    'Missing Supabase env vars. Set VITE_SUPABASE_URL and ' +
      'VITE_SUPABASE_ANON_KEY (see .env.example).',
  )
}

export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  key || 'placeholder-anon-key',
  {
    auth: {
      // Persist the session in localStorage and refresh it automatically so a
      // signed-in user stays signed in across reloads and devices.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)
