// localStorage persistence + JSON file export / backup.
// The JSON file IS the database; localStorage is just the per-device mirror.

export const STORAGE_KEY = 'mc-exam-prep:db:v1'

export const SCHEMA_VERSION = 1

export function emptyDb() {
  return {
    schema_version: SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    questions: [],
  }
}

export function loadDb() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.questions)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveDb(db) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
    return true
  } catch {
    // e.g. storage full or disabled — surface upstream if needed
    return false
  }
}

// yyyymmdd-hhmm in local time, for filenames
function timestampStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}`
  )
}

function triggerDownload(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // revoke on next tick so the download has a chance to start
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Export current db with a refreshed exported_at. Returns the exported object.
export function exportDb(db) {
  const out = { ...db, exported_at: new Date().toISOString() }
  triggerDownload(out, `mc-bank_${timestampStamp()}.json`)
  return out
}
