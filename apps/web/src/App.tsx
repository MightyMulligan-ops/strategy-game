import { useEffect, useState } from 'react'
import type { SyntheticEvent } from 'react'
import { AuthenticatedPlayerSchema } from '@strategy-game/shared-types'
import type { AuthenticatedPlayer, OAuthProvider } from '@strategy-game/shared-types'
import './App.css'

function App() {
  const [user, setUser] = useState<AuthenticatedPlayer | null>(null)
  const [providers, setProviders] = useState<OAuthProvider[]>([])
  const [csrf, setCsrf] = useState('')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        if (new URLSearchParams(window.location.search).has('authError')) {
          setMessage('Sign-in could not be completed. Try again, or use your original provider if this account is already linked.')
          window.history.replaceState(null, '', '/')
        }
        const available = await fetch('/auth/config', { signal: controller.signal, credentials: 'same-origin' })
        if (!available.ok) throw new Error('unavailable')
        const settings = await available.json() as { enabled: boolean; providers: OAuthProvider[] }
        setProviders(settings.providers.filter((provider) => provider === 'google' || provider === 'discord'))
        if (!settings.enabled) { setMessage('Sign-in is temporarily unavailable.'); return }
        // Sequence first visits so CSRF and identity share one browser cookie.
        const response = await fetch('/auth/csrf', { signal: controller.signal, credentials: 'same-origin' })
        if (!response.ok) throw new Error('unavailable')
        setCsrf((await response.json() as { csrfToken: string }).csrfToken)
        const profile = await fetch('/auth/me', { signal: controller.signal, credentials: 'same-origin' })
        if (profile.ok) setUser(AuthenticatedPlayerSchema.parse((await profile.json() as { user: unknown }).user))
        else if (profile.status !== 401) throw new Error('unavailable')
      } catch {
        if (!controller.signal.aborted) setMessage('Unable to connect. Please refresh and try again.')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [])

  async function mutate(path: string, body: object = {}) {
    return fetch(path, { method: 'POST', credentials: 'same-origin', headers: {
      'Content-Type': 'application/json', 'x-csrf-token': csrf
    }, body: JSON.stringify(body) })
  }
  async function connect(provider: OAuthProvider, linking: boolean) {
    setBusy(true); setMessage('')
    try {
      const response = await mutate(`/auth/${linking ? 'link' : 'login'}/${provider}`)
      if (!response.ok) throw new Error('failed')
      const result = await response.json() as { authorizationUrl: string }
      window.location.assign(result.authorizationUrl)
    } catch { setBusy(false); setMessage('Unable to continue. Refresh the page and try again.') }
  }
  async function chooseUsername(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('')
    try {
      const response = await mutate('/auth/username', { username })
      if (response.status === 409) { setMessage('That username is unavailable. Choose another.'); return }
      if (!response.ok) throw new Error('failed')
      setUser(AuthenticatedPlayerSchema.parse((await response.json() as { user: unknown }).user))
    } catch { setMessage('Unable to save your username. Refresh and try again.') }
    finally { setBusy(false) }
  }
  async function logout(all: boolean) {
    setBusy(true)
    try {
      const response = await mutate(`/auth/${all ? 'logout-all' : 'logout'}`)
      if (!response.ok) throw new Error('failed')
      window.location.replace('/')
    } catch { setBusy(false); setMessage('Unable to sign out. Please try again.') }
  }

  return <main className="auth-layout">
    <section className="introduction" aria-labelledby="brand-title">
      <span className="brand">STRATEGY GAME</span>
      <div className="map-lines" aria-hidden="true"><span /><span /><span /></div>
      <p className="eyebrow">A world of decisions</p>
      <h1 id="brand-title">Every turn<br />starts with a plan.</h1>
      <p className="intro-copy">Build your identity. Join the next chapter of an original multiplayer strategy game.</p>
      <span className="development-label">In development</span>
    </section>
    <section className="account-panel" aria-label="Player account" aria-busy={loading || busy}>
      {loading ? <p role="status">Loading your account…</p> : !user ? <>
        <p className="eyebrow">Welcome, commander</p>
        <h2>Sign in to continue</h2>
        <p className="muted">Choose a provider. Your in-game identity stays yours.</p>
        <div className="provider-buttons">{(['discord', 'google'] as const).map((provider) =>
          <button type="button" className={`provider ${provider}`} key={provider}
            disabled={busy || !csrf || !providers.includes(provider)} onClick={() => void connect(provider, false)}>
            Continue with {provider === 'discord' ? 'Discord' : 'Google'}<span aria-hidden="true">↗</span>
          </button>)}</div>
        <p className="small muted">You can choose your game username after signing in.</p>
      </> : <>
        <p className="eyebrow">Your player profile</p>
        <h2>{user.username ? `Welcome, ${user.username}` : 'Choose your call sign'}</h2>
        {user.username ? <p className="muted">Your account is ready. Match play is coming next.</p> :
          <form onSubmit={(event) => void chooseUsername(event)}>
            <label htmlFor="username">In-game username</label>
            <input id="username" name="username" autoComplete="username" required minLength={3} maxLength={24}
              pattern="[A-Za-z][A-Za-z0-9_]{2,23}" value={username} disabled={busy}
              onChange={(event) => setUsername(event.target.value)} aria-describedby="username-help" />
            <p id="username-help" className="small muted">3–24 letters, numbers, or underscores. Start with a letter. Names ignore case and cannot currently be changed.</p>
            <button type="submit" className="primary" disabled={busy || !csrf}>Save username</button>
          </form>}
        <div className="linked-accounts"><h3>Connected accounts</h3>
          {(['discord', 'google'] as const).map((provider) => <div className="provider-row" key={provider}>
            <span>{provider === 'discord' ? 'Discord' : 'Google'}</span>
            {user.linkedProviders.includes(provider) ? <span className="connected">Connected</span> :
              <button type="button" disabled={busy || !providers.includes(provider)} onClick={() => void connect(provider, true)}>Link account</button>}
          </div>)}
        </div>
        <div className="sign-out"><button type="button" disabled={busy} onClick={() => void logout(false)}>Sign out</button>
          <button type="button" disabled={busy} onClick={() => void logout(true)}>Sign out everywhere</button></div>
      </>}
      <p role="status" className="notice" aria-live="polite">{message || (busy ? 'Please wait…' : '')}</p>
    </section>
  </main>
}

export default App
