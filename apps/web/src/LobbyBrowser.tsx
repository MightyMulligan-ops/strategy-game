import { useCallback, useEffect, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import {
  CreateLobbyRequestSchema, CreateLobbyResponseSchema, JoinLobbyResponseSchema, LeaveLobbyResponseSchema,
  ListLobbiesResponseSchema, SetLobbyReadyResponseSchema, StartLobbyResponseSchema,
  ViewLobbyResponseSchema, LOBBY_TURN_DURATION_PRESETS_MS,
} from '@strategy-game/shared-types'
import type { LobbyDetail, LobbySummary } from '@strategy-game/shared-types'
import { lobbyRequest, LobbyRequestError } from './lobby-api'

function duration(ms: number): string {
  return ms % 3_600_000 === 0 ? `${ms / 3_600_000} hour${ms === 3_600_000 ? '' : 's'}`
    : ms % 60_000 === 0 ? `${ms / 60_000} minutes` : `${ms} ms`
}

export default function LobbyBrowser({ busy, onBegin, onEnd, onSessionError }: {
  busy: boolean; onBegin: () => boolean; onEnd: () => void; onSessionError: () => Promise<void>
}) {
  const [lobbies, setLobbies] = useState<readonly LobbySummary[] | null>(null)
  const [listStatus, setListStatus] = useState<'OPEN' | 'RUNNING'>('OPEN')
  const [detail, setDetail] = useState<LobbyDetail | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const [sessionInvalid, setSessionInvalid] = useState(false)
  const [name, setName] = useState('')
  const [capacity, setCapacity] = useState('10')
  const [turnDuration, setTurnDuration] = useState(String(LOBBY_TURN_DURATION_PRESETS_MS[0]))
  const listRead = useRef<AbortController | null>(null)
  const detailRead = useRef<AbortController | null>(null)
  const mutation = useRef<AbortController | null>(null)

  const explain = useCallback(async (error: unknown) => {
    if (error instanceof LobbyRequestError && (error.code === 'UNAUTHENTICATED' || error.code === 'USERNAME_REQUIRED')) {
      setSessionInvalid(true); setLobbies(null); setDetail(null)
      await onSessionError()
    }
    return error instanceof LobbyRequestError ? error.message : 'Unable to connect. Please try again.'
  }, [onSessionError])

  const loadList = useCallback(async () => {
    listRead.current?.abort()
    const controller = new AbortController(); listRead.current = controller
    setListLoading(true)
    try {
      const result = await lobbyRequest(`/api/lobbies?status=${listStatus}`, ListLobbiesResponseSchema, controller.signal)
      if (!controller.signal.aborted) { setLobbies(result.lobbies); setListError('') }
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = await explain(error)
        if (!controller.signal.aborted) { setLobbies(null); setListError(message) }
      }
    } finally { if (!controller.signal.aborted) setListLoading(false) }
  }, [explain, listStatus])

  function refreshList() { setListLoading(true); setListError(''); return loadList() }

  const loadDetail = useCallback(async (id: string) => {
    detailRead.current?.abort()
    const controller = new AbortController(); detailRead.current = controller
    setSelected(id); setDetail(null); setDetailError(''); setDetailLoading(true)
    try {
      const result = await lobbyRequest(`/api/lobbies/${encodeURIComponent(id)}`, ViewLobbyResponseSchema, controller.signal)
      if (!controller.signal.aborted) setDetail(result.lobby)
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = await explain(error)
        if (!controller.signal.aborted) setDetailError(message)
      }
    } finally { if (!controller.signal.aborted) setDetailLoading(false) }
  }, [explain])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) void loadList() })
    return () => { cancelled = true; listRead.current?.abort(); detailRead.current?.abort(); mutation.current?.abort() }
  }, [loadList])

  async function act(action: 'create' | 'join' | 'leave' | 'ready' | 'start', input?: object) {
    if (sessionInvalid || !onBegin()) return
    setActionError(''); setNotice('')
    const controller = new AbortController(); mutation.current = controller
    const target = detail?.lobbyId
    try {
      const path = action === 'create' ? '/api/lobbies' : `/api/lobbies/${encodeURIComponent(target!)}/${action}`
      const result = action === 'create'
        ? await lobbyRequest(path, CreateLobbyResponseSchema, controller.signal, input)
        : action === 'join'
          ? await lobbyRequest(path, JoinLobbyResponseSchema, controller.signal, { schemaVersion: 1 })
          : action === 'leave'
            ? await lobbyRequest(path, LeaveLobbyResponseSchema, controller.signal, { schemaVersion: 1 })
            : action === 'ready'
              ? await lobbyRequest(path, SetLobbyReadyResponseSchema, controller.signal, input)
              : await lobbyRequest(path, StartLobbyResponseSchema, controller.signal, { schemaVersion: 1 })
      if (controller.signal.aborted) return
      setNotice(action === 'create' ? 'Lobby created. You are the host.' : action === 'leave' ? 'You left the lobby.'
        : action === 'ready' ? 'Your readiness was updated.'
          : action === 'start' ? ('outcome' in result && result.outcome === 'ALREADY_STARTED' ? 'This match has already started.' : 'Match started. Gameplay setup is a future milestone.')
            : 'outcome' in result && result.outcome === 'ALREADY_JOINED' ? 'You already belong to this lobby.' : 'You joined the lobby.')
      if (action === 'create') setName('')
      await Promise.all([refreshList(), loadDetail(result.lobby.lobbyId)])
    } catch (error) {
      if (controller.signal.aborted) return
      const message = await explain(error)
      if (controller.signal.aborted) return
      setActionError(message)
      if (error instanceof LobbyRequestError && ['LOBBY_FULL', 'LOBBY_NOT_OPEN', 'HOST_CANNOT_LEAVE', 'NOT_A_PARTICIPANT', 'NOT_FOUND', 'HOST_REQUIRED', 'NOT_ENOUGH_PARTICIPANTS', 'NOT_ALL_READY'].includes(error.code ?? '')) {
        await Promise.all([refreshList(), ...(target ? [loadDetail(target)] : [])])
      }
    } finally {
      onEnd()
    }
  }

  function create(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = CreateLobbyRequestSchema.safeParse({ schemaVersion: 1,
      settings: { name, playerCapacity: Number(capacity), turnDurationMs: Number(turnDuration), visibility: 'PUBLIC' } })
    if (!parsed.success) { setActionError('Enter a name without surrounding spaces, 2–40 players, and a valid turn duration.'); return }
    void act('create', parsed.data)
  }

  const disabled = busy || sessionInvalid
  const ownParticipant = detail?.participants.find((player) => player.playerId === detail.viewer.playerId)
  const startReason = !detail || detail.status !== 'OPEN' ? 'This match has already started.'
    : detail.participantCount < 2 ? 'At least two players must join before starting.'
      : !ownParticipant?.ready ? 'Mark yourself ready before starting.'
        : detail.readyCount !== detail.participantCount ? 'Waiting for every player to be ready.'
          : 'All players are ready. You can start the match.'
  return <section className="lobby-workspace" aria-labelledby="lobbies-title">
    <div className="workspace-heading"><div><p className="eyebrow">Multiplayer / public lobbies</p><h1 id="lobbies-title">The assembly</h1>
      <p className="muted">Find your company. Set the pace. Prepare for what comes next.</p></div>
      <span className="development-label">Lobby readiness · Gameplay coming later</span></div>
    <div className="lobby-grid">
      <section className="panel lobby-list" aria-labelledby="open-lobbies-title" aria-busy={listLoading}>
        <div className="section-heading"><h2 id="open-lobbies-title">{listStatus === 'OPEN' ? 'Open lobbies' : 'Started lobbies'}</h2><button disabled={disabled || listLoading} onClick={() => void refreshList()}>Refresh list</button></div>
        <label htmlFor="lobby-status">Lobby status</label><select id="lobby-status" value={listStatus} disabled={disabled || listLoading}
          onChange={(event) => setListStatus(event.target.value === 'RUNNING' ? 'RUNNING' : 'OPEN')}><option value="OPEN">Open</option><option value="RUNNING">Started</option></select>
        {listLoading ? <p role="status">Loading lobbies…</p> : listError ? <p role="alert" className="notice">{listError}</p>
          : lobbies?.length === 0 ? <div className="empty-state"><h3>{listStatus === 'OPEN' ? 'A seat at the table' : 'Awaiting the first start'}</h3><p className="muted">{listStatus === 'OPEN' ? 'No open lobbies yet. Create one for other players to discover.' : 'No started lobbies yet. Hosts can start once every player is ready.'}</p></div>
          : <ul className="lobby-cards">{lobbies?.map((lobby) => <li key={lobby.lobbyId}>
            <div className="section-heading"><h3>{lobby.settings.name}</h3><span className="badge">{lobby.durationCategory}</span></div>
            <p className="muted">Hosted by {lobby.host.username}</p>
            <p>{lobby.participantCount} / {lobby.settings.playerCapacity} players <span className="muted">· {duration(lobby.settings.turnDurationMs)} per turn</span></p>
            <p className="small muted">{lobby.readyCount} / {lobby.participantCount} ready</p>
            <button aria-pressed={selected === lobby.lobbyId} disabled={disabled || detailLoading} onClick={() => { setActionError(''); setNotice(''); void loadDetail(lobby.lobbyId) }}>Inspect {lobby.settings.name}</button>
          </li>)}</ul>}
      </section>
      <section className="panel lobby-detail" aria-labelledby="detail-title" aria-busy={detailLoading}>
        <div className="section-heading"><h2 id="detail-title">Lobby details</h2>{selected && <button disabled={disabled || detailLoading} onClick={() => void loadDetail(selected)}>Refresh details</button>}</div>
        {detailLoading ? <p role="status">Loading lobby details…</p> : detailError ? <p role="alert" className="notice">{detailError}</p> : !detail ? <p className="muted">Inspect a lobby to see its settings and participants.</p> : <>
          <span className="badge">{detail.status}</span><h3 className="detail-name">{detail.settings.name}</h3>
          <dl className="lobby-facts"><div><dt>Host</dt><dd>{detail.host.username}</dd></div><div><dt>Players</dt><dd>{detail.participantCount} / {detail.settings.playerCapacity}</dd></div>
            <div><dt>Turn duration</dt><dd>{duration(detail.settings.turnDurationMs)}</dd></div><div><dt>Category</dt><dd>{detail.durationCategory}</dd></div>
            <div><dt>Your role</dt><dd>{detail.viewer.role.replaceAll('_', ' ')}</dd></div><div><dt>Visibility</dt><dd>Public</dd></div></dl>
          <p>{detail.readyCount} / {detail.participantCount} ready</p>
          <h4>Participants</h4><ul className="roster">{detail.participants.map((player) => <li key={player.playerId}>{player.username}{player.playerId === detail.host.playerId && <span className="muted"> · Host</span>} <span className="badge">{player.ready ? 'READY' : 'NOT READY'}</span></li>)}</ul>
          {ownParticipant && detail.status === 'OPEN' && <button disabled={disabled} aria-pressed={ownParticipant.ready}
            onClick={() => void act('ready', { schemaVersion: 1, ready: !ownParticipant.ready })}>{ownParticipant.ready ? 'Mark not ready' : 'Mark ready'}</button>}
          {detail.viewer.canJoin && <button className="primary" disabled={disabled} onClick={() => void act('join')}>Join lobby</button>}
          {detail.viewer.canLeave && <button disabled={disabled} onClick={() => void act('leave')}>Leave lobby</button>}
          {detail.viewer.role === 'HOST' && <><button className="primary" disabled={disabled || !detail.viewer.canStart}
            aria-describedby="start-reason" onClick={() => void act('start')}>Start Match</button>
            <p id="start-reason" className="small muted">{startReason}</p><p className="small muted">You are the host. Hosts cannot leave.</p></>}
          {detail.status === 'RUNNING' && <p className="small muted">This match is running. Joining, leaving and readiness changes are closed. Gameplay setup is a future milestone.</p>}
          {detail.status === 'OPEN' && !detail.availableSlots && <p className="small muted">This lobby is full.</p>}
        </>}
      </section>
      <section className="panel create-lobby" aria-labelledby="create-title"><p className="eyebrow">Set your terms</p><h2 id="create-title">Create a public lobby</h2>
        <form onSubmit={create}><fieldset disabled={disabled}><legend className="sr-only">Lobby settings</legend>
          <label htmlFor="lobby-name">Lobby name</label><input id="lobby-name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Name your assembly" />
          <label htmlFor="capacity">Player capacity</label><input id="capacity" type="number" required min="2" max="40" step="1" value={capacity} onChange={(event) => setCapacity(event.target.value)} aria-describedby="capacity-help" />
          <p id="capacity-help" className="small muted">2–40 players, including you as host.</p>
          <label htmlFor="turn-duration">Turn duration</label><select id="turn-duration" value={turnDuration} onChange={(event) => setTurnDuration(event.target.value)}>{LOBBY_TURN_DURATION_PRESETS_MS.map((ms) => <option key={ms} value={ms}>{duration(ms)}</option>)}</select>
          <p className="small muted">Public visibility. All settings are fixed after creation.</p>
          <button className="primary" type="submit">{busy ? 'Please wait…' : 'Create lobby'}</button>
        </fieldset></form></section>
    </div>
    {actionError && <p className="notice" role="alert">{actionError}</p>}
    <p className="notice" role="status" aria-live="polite">{notice || (busy ? 'Updating lobby…' : '')}</p>
  </section>
}
