// Signed-out landing screen. One action: sign in with Google. On success
// Supabase redirects back here and useAuth picks up the session.

import { useState } from 'react'
import { signInWithGoogle } from '../lib/useAuth.js'
import { IconCap, GoogleG } from './Icons.jsx'

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
    <div className="login-screen">
      <div className="login-orb login-orb-a" />
      <div className="login-orb login-orb-b" />

      <div className="login-content">
        <div className="login-mark">
          <IconCap size={38} />
        </div>
        <h1 className="login-title">תרגול חץ 26׳</h1>
        <p className="login-sub">
          שאלות תרגול מותאמות לחומר הקורס.
          <br />
          התחבר כדי לתרגל ולעקוב אחרי ההתקדמות שלך.
        </p>
        <button className="btn-google" onClick={onClick} disabled={busy}>
          <GoogleG size={20} />
          {busy ? 'מתחבר…' : 'המשך עם Google'}
        </button>
        <p className="login-foot">ההתקדמות שלך נשמרת ומסתנכרנת בין כל המכשירים</p>
        {error && <p className="login-error">{error}</p>}
      </div>
    </div>
  )
}
