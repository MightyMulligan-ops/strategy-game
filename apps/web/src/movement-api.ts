import { MovementDraftErrorSchema, ReadMovementPlanSchema, MovementDraftRequestSchema, SetTurnReadyRequestSchema, SetTurnReadyResponseSchema } from '@strategy-game/shared-types'
import type { MovementDraftErrorCode, MovementDraftRequest } from '@strategy-game/shared-types'

export class MovementRequestError extends Error {
  readonly code: MovementDraftErrorCode | undefined
  readonly uncertain: boolean
  constructor(code?: MovementDraftErrorCode, uncertain = false) {
    super(code === 'READY_LOCKED' ? 'Your Ready status locks editing. Become Unready before changing orders.'
      : code === 'TURN_CLOSED' ? 'Turn 1 is closed. Refresh to inspect the final accepted queue; no movement has executed.'
      : code === 'READY_UNCHANGED' ? 'Readiness already has that value. Refresh the authoritative state.'
      : code === 'STALE_REVISION' ? 'Your draft changed. Review the latest queue before trying again.'
      : code === 'DEADLINE_PASSED' ? 'The deadline has passed. This turn no longer accepts drafts.'
        : code === 'INVALID_DRAFT' ? 'The complete route must stay within the map and its cumulative 250-unit budget.'
          : code === 'NOT_FOUND' ? 'Movement drafts are unavailable or access has ended.'
            : code === 'RATE_LIMITED' ? 'Too many requests. Wait before trying again.'
              : code === 'CSRF_REJECTED' || code === 'INVALID_ORIGIN' ? 'The security check failed. Refresh before trying again.'
                : 'Unable to verify movement drafts. Refresh to load the authoritative queue.')
    this.code = code; this.uncertain = uncertain
  }
}
async function checked(response: Response, uncertain: boolean) {
  if (response.ok) return
  const parsed = MovementDraftErrorSchema.safeParse(await response.json().catch(() => null))
  throw new MovementRequestError(parsed.success ? parsed.data.error : response.status === 401 ? 'UNAUTHENTICATED' : undefined, uncertain && response.status >= 500)
}
const path = (matchId: string) => `/api/matches/${encodeURIComponent(matchId)}/turns/1/orders`
export async function readMovementDraft(matchId: string, signal: AbortSignal) {
  try {
    const response = await fetch(path(matchId), { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal })
    await checked(response, false)
    const result = ReadMovementPlanSchema.parse(await response.json())
    if (result.matchId !== matchId) throw new MovementRequestError()
    return result
  } catch (error) { if (error instanceof MovementRequestError) throw error; throw new MovementRequestError() }
}
/** Exactly one POST per explicit action. Unknown outcomes are reconciled by GET, never replayed. */
export async function writeMovementDraft(matchId: string, input: MovementDraftRequest, signal: AbortSignal) {
  const body = MovementDraftRequestSchema.parse(input)
  let token: Response
  try { token = await fetch('/auth/csrf', { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal }) }
  catch { throw new MovementRequestError() }
  await checked(token, false)
  const data: unknown = await token.json().catch(() => null)
  if (!data || typeof data !== 'object' || !('csrfToken' in data) || typeof data.csrfToken !== 'string' || !data.csrfToken) throw new MovementRequestError()
  try {
    const response = await fetch(path(matchId), { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': data.csrfToken }, body: JSON.stringify(body) })
    await checked(response, true)
    const result = ReadMovementPlanSchema.parse(await response.json())
    if (result.state !== 'READY' || result.matchId !== matchId || result.own.revision !== input.expectedRevision + 1) throw new MovementRequestError(undefined, true)
    return result
  } catch (error) { if (error instanceof MovementRequestError) throw error; throw new MovementRequestError(undefined, true) }
}

export async function writeTurnReady(matchId: string, expectedRevision: number, ready: boolean, signal: AbortSignal) {
  const body = SetTurnReadyRequestSchema.parse({ schemaVersion: 1, expectedRevision, ready })
  let token: Response
  try { token = await fetch('/auth/csrf', { credentials: 'same-origin', cache: 'no-store', signal }) } catch { throw new MovementRequestError() }
  await checked(token, false)
  const data: unknown = await token.json().catch(() => null)
  if (!data || typeof data !== 'object' || !('csrfToken' in data) || typeof data.csrfToken !== 'string' || !data.csrfToken) throw new MovementRequestError()
  try {
    const response = await fetch(`/api/matches/${encodeURIComponent(matchId)}/turns/1/ready`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': data.csrfToken }, body: JSON.stringify(body) })
    await checked(response, true)
    const result = SetTurnReadyResponseSchema.parse(await response.json())
    if (result.matchId !== matchId || result.own.revision !== expectedRevision + 1 || result.own.ready !== ready) throw new MovementRequestError(undefined, true)
    return result
  } catch (error) { if (error instanceof MovementRequestError) throw error; throw new MovementRequestError(undefined, true) }
}
