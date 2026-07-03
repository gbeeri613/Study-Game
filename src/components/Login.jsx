// Signed-out landing screen. One action: sign in with Google. On success
// Supabase redirects back here and useAuth picks up the session.

import { useState } from 'react'
import { signInWithGoogle } from '../lib/useAuth.js'

export default function Login() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const onClick = async () => {
    setBusy(true)
    setError(null)
    const { error } = await signInWithGoogle()
    if (error) {
      setError(error.message)
      setBusy(false)
    }
    // On success the browser navigates to Google, so no need to reset busy.
  }

  return (
    <div className="app">
      <div className="login-screen">
        <div className="card login-card">
          <h1 className="app-title login-title">תרגול מבחנים</h1>
          <p className="muted login-sub">
            התחבר כדי לתרגל ולסנכרן את ההתקדמות שלך בין המכשירים.
          </p>
          <button
            className="btn btn-primary login-google"
            onClick={onClick}
            disabled={busy}
          >
            {busy ? 'מתחבר…' : 'התחברות עם Google'}
          </button>
          {error && <p className="login-error">{error}</p>}
        </div>
      </div>
    </div>
  )
}
