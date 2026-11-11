import { LobbyErrorResponseSchema } from '@strategy-game/shared-types'
import type { LobbyErrorResponse } from '@strategy-game/shared-types'

type ErrorCode = LobbyErrorResponse['error']
const messages: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Your session has ended. Sign in again to continue.',
  USERNAME_REQUIRED: 'Choose a registered username before entering the lobby.',
  INVALID_REQUEST: 'Check the lobby name, capacity and turn duration, then try again.',
  INVALID_ORIGIN: 'Open Sovereign from its configured address, then try again.',
  LOBBY_FULL: 'That lobby is full. Its latest roster is shown below.',
  LOBBY_NOT_OPEN: 'That lobby is no longer open. Its latest status is shown below.',
  HOST_CANNOT_LEAVE: 'The host cannot leave their lobby.',
  NOT_A_PARTICIPANT: 'You are no longer a participant. The roster has been refreshed.',
  NOT_FOUND: 'That lobby is no longer available. Refresh the lobby list.',
  CSRF_REJECTED: 'The security token expired. Try again to obtain a fresh token.',
  RATE_LIMITED: 'Too many requests. Wait a minute before trying again.',
  INTERNAL_ERROR: 'Lobbies are temporarily unavailable. Please try again later.',
  HOST_REQUIRED: 'Only the host can perform that action.',
  NOT_ENOUGH_PARTICIPANTS: 'This action needs more participants.',
  NOT_ALL_READY: 'Every active player, including the host, must be ready. The roster has been refreshed.',
}

export class LobbyRequestError extends Error {
  readonly code: ErrorCode | undefined
  constructor(code?: ErrorCode) {
    super(code ? messages[code] : 'Unable to load lobbies. Check your connection and try again.')
    this.code = code
  }
}

/** No retries, persisted credentials, caller identity fields, or raw server errors. */
export async function lobbyRequest<T>(path: string, schema: { parse: (value: unknown) => T }, signal: AbortSignal, body?: object): Promise<T> {
  let headers: Record<string, string> | undefined
  if (body) {
    // Each explicit mutation samples a current session token. OAuth callbacks
    // rotate sessions; no module-level token survives navigation or logout.
    const response = await fetch('/auth/csrf', { credentials: 'same-origin', cache: 'no-store', signal })
    if (!response.ok) throw new LobbyRequestError(response.status === 401 ? 'UNAUTHENTICATED' : undefined)
    const token: unknown = await response.json()
    if (!token || typeof token !== 'object' || !('csrfToken' in token) || typeof token.csrfToken !== 'string' || !token.csrfToken) throw new LobbyRequestError()
    headers = { 'Content-Type': 'application/json', 'x-csrf-token': token.csrfToken }
  }
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal,
    ...(body ? { method: 'POST', ...(headers ? { headers } : {}), body: JSON.stringify(body) } : {}) })
  if (!response.ok) {
    const parsed = LobbyErrorResponseSchema.safeParse(await response.json().catch(() => null))
    throw new LobbyRequestError(parsed.success ? parsed.data.error : response.status === 401 ? 'UNAUTHENTICATED' : undefined)
  }
  try { return schema.parse(await response.json()) }
  catch { throw new LobbyRequestError() }
}
