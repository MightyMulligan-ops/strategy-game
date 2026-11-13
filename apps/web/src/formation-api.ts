import { ReadFormationsRequestSchema, ReadFormationsResponseSchema } from '@strategy-game/shared-types'

export class FormationReadError extends Error {
  readonly reason: 'session' | 'username' | 'denied' | 'malformed' | 'unavailable'
  constructor(reason: FormationReadError['reason']) {
    super(reason === 'denied' ? 'Formations unavailable or you no longer have access to this match.'
      : reason === 'malformed' ? 'The formation response could not be verified.'
        : 'Unable to load formations. Refresh to try again.')
    this.reason = reason
  }
}
/** Independent GET only; no retries, account IDs, commands or persistent client storage. */
export async function readFormations(matchId: string, signal: AbortSignal) {
  if (!ReadFormationsRequestSchema.safeParse({ schemaVersion: 1, matchId }).success) throw new FormationReadError('malformed')
  let response: Response
  try { response = await fetch(`/api/matches/${encodeURIComponent(matchId)}/formations`, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal }) }
  catch { throw new FormationReadError('unavailable') }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const username = response.status === 403 && typeof body === 'object' && body !== null && 'error' in body && body.error === 'USERNAME_REQUIRED'
    throw new FormationReadError(response.status === 401 ? 'session' : username ? 'username' : response.status === 404 || response.status === 403 ? 'denied' : 'unavailable')
  }
  try {
    const result = ReadFormationsResponseSchema.parse(await response.json())
    if (result.matchId !== matchId) throw new Error('Mismatched match')
    return result
  } catch { throw new FormationReadError('malformed') }
}
