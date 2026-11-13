import { ReadTurnRequestSchema, ReadTurnResponseSchema, TurnErrorResponseSchema } from '@strategy-game/shared-types'

const messages = {
  session: 'Your session has ended. Sign in again to view your turn.',
  username: 'Choose a registered username before viewing your turn.',
  forbidden: 'You do not have permission to view this turn.',
  not_found: 'Turn unavailable or you no longer have access to this match.',
  malformed: 'The turn response could not be verified. Refresh to try again.',
  network: 'Unable to connect to the turn service. Refresh to try again.',
  rate_limited: 'Too many requests. Wait before refreshing your turn.',
  unavailable: 'Turn information is temporarily unavailable. Refresh to try again.',
}
export class TurnReadError extends Error {
  readonly reason: keyof typeof messages
  constructor(reason: keyof typeof messages) { super(messages[reason]); this.reason = reason }
}

/** Read-only, no retries or persisted private data. Never return raw transport errors. */
export async function readTurn(matchId: string, signal: AbortSignal) {
  if (!ReadTurnRequestSchema.safeParse({ schemaVersion: 1, matchId }).success) throw new TurnReadError('malformed')
  let response: Response
  try {
    response = await fetch(`/api/matches/${encodeURIComponent(matchId)}/turn`, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', signal,
    })
  } catch { throw new TurnReadError('network') }
  if (!response.ok) {
    if (response.status === 401) throw new TurnReadError('session')
    if (response.status === 403) {
      const error = TurnErrorResponseSchema.safeParse(await response.json().catch(() => null))
      throw new TurnReadError(error.success && error.data.error === 'USERNAME_REQUIRED' ? 'username' : 'forbidden')
    }
    throw new TurnReadError(response.status === 404 ? 'not_found' : response.status === 429 ? 'rate_limited' : 'unavailable')
  }
  try {
    const result = ReadTurnResponseSchema.parse(await response.json())
    if (result.matchId !== matchId) throw new Error('Mismatched match')
    return result
  } catch { throw new TurnReadError('malformed') }
}
