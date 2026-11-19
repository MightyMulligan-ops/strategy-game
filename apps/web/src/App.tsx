import { useCallback, useEffect, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import { AuthenticatedPlayerSchema } from '@strategy-game/shared-types'
import type { AuthenticatedPlayer, OAuthProvider } from '@strategy-game/shared-types'
import './App.css'
import LobbyBrowser from './LobbyBrowser'

function App() {
  const [user, setUser] = useState<AuthenticatedPlayer | null>(null)
  const [providers, setProviders] = useState<OAuthProvider[]>([])
  const [devLoginEnabled, setDevLoginEnabled] = useState(false)
  const [fixture, setFixture] = useState('player-one')
  const [csrf, setCsrf] = useState('')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [accountOpen,setAccountOpen]=useState(false)
  const accountPanel=useRef<HTMLElement>(null),accountButton=useRef<HTMLButtonElement>(null)
  useEffect(()=>{if(accountOpen)accountPanel.current?.focus({preventScroll:true})},[accountOpen])
  const actionLock = useRef(false)
  const sessionRead = useRef<AbortController | null>(null)
  const beginLobbyAction = useCallback(() => {
    if (actionLock.current) return false
    actionLock.current = true; setBusy(true); return true
  }, [])
  const endLobbyAction = useCallback(() => { actionLock.current = false; setBusy(false) }, [])

  const recheckAccount = useCallback(async () => {
    sessionRead.current?.abort()
    const controller = new AbortController(); sessionRead.current = controller
    try {
      const response = await fetch('/auth/me', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      if (controller.signal.aborted) return
      if (response.status === 401) setUser(null)
      else if (response.ok) {
        const profile = AuthenticatedPlayerSchema.parse((await response.json() as { user: unknown }).user)
        if (!controller.signal.aborted) setUser(profile)
      } else throw new Error('unavailable')
      const token = await fetch('/auth/csrf', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      if (!token.ok) throw new Error('unavailable')
      const result = await token.json() as { csrfToken: string }
      if (!controller.signal.aborted) { setCsrf(result.csrfToken); setMessage('Your account was refreshed. Sign in or choose a username if needed.') }
    } catch { if (!controller.signal.aborted) setMessage('Unable to refresh your account. Please reload the page.') }
  }, [])

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
        const settings = await available.json() as { enabled: boolean; providers: OAuthProvider[]; devLoginEnabled?: boolean }
        if (controller.signal.aborted) return
        setProviders(settings.providers.filter((provider) => provider === 'google' || provider === 'discord'))
        setDevLoginEnabled(settings.enabled && settings.devLoginEnabled === true)
        if (!settings.enabled) { setMessage('Sign-in is temporarily unavailable.'); return }
        // Sequence first visits so CSRF and identity share one browser cookie.
        const response = await fetch('/auth/csrf', { signal: controller.signal, credentials: 'same-origin' })
        if (!response.ok) throw new Error('unavailable')
        const token = (await response.json() as { csrfToken: string }).csrfToken
        if (controller.signal.aborted) return
        setCsrf(token)
        const profile = await fetch('/auth/me', { signal: controller.signal, credentials: 'same-origin' })
        if (profile.ok) {
          const player = AuthenticatedPlayerSchema.parse((await profile.json() as { user: unknown }).user)
          if (!controller.signal.aborted) setUser(player)
        }
        else if (profile.status !== 401) throw new Error('unavailable')
      } catch {
        if (!controller.signal.aborted) setMessage('Unable to connect. Please refresh and try again.')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => { controller.abort(); sessionRead.current?.abort() }
  }, [])

  async function mutate(path: string, body: object = {}) {
    return fetch(path, { method: 'POST', credentials: 'same-origin', headers: {
      'Content-Type': 'application/json', 'x-csrf-token': csrf
    }, body: JSON.stringify(body) })
  }
  async function connect(provider: OAuthProvider, linking: boolean) {
    if (actionLock.current) return
    actionLock.current = true
    setBusy(true); setMessage('')
    try {
      const response = await mutate(`/auth/${linking ? 'link' : 'login'}/${provider}`)
      if (!response.ok) throw new Error('failed')
      const result = await response.json() as { authorizationUrl: string }
      window.location.assign(result.authorizationUrl)
    } catch { actionLock.current = false; setBusy(false); setMessage('Unable to continue. Refresh the page and try again.') }
  }
  async function chooseUsername(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    if (actionLock.current) return
    actionLock.current = true; setBusy(true); setMessage('')
    try {
      const response = await mutate('/auth/username', { username })
      if (response.status === 409) { setMessage('That username is unavailable. Choose another.'); return }
      if (!response.ok) throw new Error('failed')
      setUser(AuthenticatedPlayerSchema.parse((await response.json() as { user: unknown }).user))
    } catch { setMessage('Unable to save your username. Refresh and try again.') }
    finally { actionLock.current = false; setBusy(false) }
  }
  async function localTestSignIn() {
    if (actionLock.current || !devLoginEnabled) return
    actionLock.current = true; setBusy(true); setMessage('')
    try {
      const response = await mutate('/auth/dev-login', { fixture })
      if (!response.ok) throw new Error('failed')
      // Same full bootstrap as OAuth navigation: the server rotated the session,
      // so obtain its new CSRF token before onboarding or lobby mutations.
      window.location.replace('/')
    } catch {
      actionLock.current = false; setBusy(false)
      setMessage('Local test sign-in could not be completed. Check the local development settings and try again.')
    }
  }
  async function logout(all: boolean) {
    if (actionLock.current) return
    actionLock.current = true
    setBusy(true)
    try {
      const response = await mutate(`/auth/${all ? 'logout-all' : 'logout'}`)
      if (!response.ok) throw new Error('failed')
      window.location.replace('/')
    } catch { actionLock.current = false; setBusy(false); setMessage('Unable to sign out. Please try again.') }
  }

  const registered = !loading && !!user?.username
  return <main>
    <header className="masthead"><div className="brand-lockup"><img src="/assets/branding/emblem.svg" alt="" width="42" height="44" />
      <img src="/assets/branding/wordmark.svg" alt="Sovereign" width="220" height="42" /></div><span className="eyebrow">Global Crown <span aria-hidden="true">/</span> In development</span>{registered&&<button ref={accountButton} className="account-toggle" aria-controls="player-account-panel" aria-expanded={accountOpen} onClick={()=>setAccountOpen(v=>!v)}>Account</button>}</header>
    <div className={registered ? 'registered-layout' : 'auth-layout'}>
    {registered ? <LobbyBrowser busy={busy} onBegin={beginLobbyAction} onEnd={endLobbyAction} onSessionError={recheckAccount} /> :
      <section className="introduction" aria-labelledby="brand-title">
        <img className="hero-emblem" src="/assets/branding/emblem.svg" alt="Gold crown over a circular globe" width="300" height="310" />
        <p className="eyebrow">A world of decisions</p>
        <h1 id="brand-title">Your place<br />in the world.</h1>
        <p className="intro-copy">An original multiplayer strategy game.<br />Begin with an identity. Build what comes next.</p>
        <span className="development-label">Plan together. Play your own hand.</span>
      </section>}
    <section ref={accountPanel} id="player-account-panel" tabIndex={-1} onKeyDown={e=>{if(e.key==='Escape'&&accountOpen){setAccountOpen(false);accountButton.current?.focus()}}} className={"account-panel"+(accountOpen?" account-open":"")} aria-label="Player account" aria-busy={loading || busy}>
      {loading ? <p role="status">Loading your account…</p> : !user ? <>
        <p className="eyebrow">Welcome, commander</p>
        <h2>Sign in to continue</h2>
        <p className="muted">{devLoginEnabled && providers.length === 0 ? 'Use a local fixture to test the sandbox lobby.' : 'Choose a provider. Your in-game identity stays yours.'}</p>
        <div className="provider-buttons">{(['discord', 'google'] as const).map((provider) =>
          <button type="button" className={`provider ${provider}`} key={provider}
            disabled={busy || !csrf || !providers.includes(provider)} onClick={() => void connect(provider, false)}>
            Continue with {provider === 'discord' ? 'Discord' : 'Google'}<span aria-hidden="true">↗</span>
          </button>)}</div>
        <p className="small muted">You can choose your game username after signing in.</p>
        {devLoginEnabled && <section className="local-test-login" aria-label="Local test sign-in">
          <h3>Local test sign-in</h3><p className="small muted">Development fixtures only. Use a separate browser profile for each player.</p>
          <label htmlFor="local-test-player">Fixture player</label>
          <select id="local-test-player" disabled={busy} value={fixture} onChange={(event) => setFixture(event.target.value)}>
            <option value="player-one">Player One</option><option value="player-two">Player Two</option>
          </select>
          <button type="button" disabled={busy || !csrf} onClick={() => void localTestSignIn()}>Local test sign-in</button>
        </section>}
      </> : <>
        <p className="eyebrow">Your player profile</p>
        <h2>{user.username ? `Welcome, ${user.username}` : 'Choose your call sign'}</h2>
        {user.username ? <p className="muted">Your identity is ready. Explore the public assembly.</p> :
          <form onSubmit={(event) => void chooseUsername(event)}>
            <label htmlFor="username">In-game username</label>
            <input id="username" name="username" autoComplete="username" required minLength={3} maxLength={24}
              pattern="[A-Za-z][A-Za-z0-9_]{2,23}" value={username} disabled={busy}
              onChange={(event) => setUsername(event.target.value)} aria-describedby="username-help" />
            <p id="username-help" className="small muted">3–24 letters, numbers, or underscores. Start with a letter. Names ignore case and cannot currently be changed.</p>
            <button type="submit" className="primary" disabled={busy || !csrf}>Save username</button>
          </form>}
        <div className="linked-accounts"><h3>Connected accounts</h3>
          {devLoginEnabled && user.linkedProviders.length === 0 && <p className="small muted">Local test account. Provider linking is disabled.</p>}
          {(['discord', 'google'] as const).map((provider) => <div className="provider-row" key={provider}>
            <span>{provider === 'discord' ? 'Discord' : 'Google'}</span>
            {user.linkedProviders.includes(provider) ? <span className="connected">Connected</span> :
              <button type="button" disabled={busy || !providers.includes(provider) || (devLoginEnabled && user.linkedProviders.length === 0)} onClick={() => void connect(provider, true)}>Link account</button>}
          </div>)}
        </div>
        <div className="sign-out"><button type="button" disabled={busy} onClick={() => void logout(false)}>Sign out</button>
          <button type="button" disabled={busy} onClick={() => void logout(true)}>Sign out everywhere</button></div>
      </>}
      <p role="status" className="notice" aria-live="polite">{message || (busy ? 'Please wait…' : '')}</p>
    </section>
    </div>
  </main>
}

export default App
