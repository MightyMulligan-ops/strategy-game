import { EUROPE_PROFILE } from '../../../../packages/shared-types/src/europe-preview.js'
import type { EuropeMapPoint } from '../../../../packages/shared-types/src/europe-preview.js'

type Snapshot = Readonly<{ points: readonly EuropeMapPoint[]; selected: number | null }>
export type DefenseDraft = Snapshot & Readonly<{ revision: number; history: readonly Snapshot[] }>
export type DraftAction = { type: 'add'; point: EuropeMapPoint } | { type: 'move'; index: number; point: EuropeMapPoint; checkpoint: boolean }
  | { type: 'remove'; index: number } | { type: 'select'; index: number } | { type: 'clear' } | { type: 'undo' }
export const insideEuropeMap = (point: EuropeMapPoint) => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y)
  && point.x >= 0 && point.y >= 0 && point.x <= EUROPE_PROFILE.width && point.y <= EUROPE_PROFILE.height
const snapshot = (points: readonly EuropeMapPoint[], selected: number | null): Snapshot => Object.freeze({
  points: Object.freeze(points.map(p => Object.freeze({ ...p }))), selected,
})
export function createDefenseDraft(points: readonly EuropeMapPoint[] = []): DefenseDraft {
  if (points.length > 32 || points.some(p => !insideEuropeMap(p))) throw new Error('Invalid prototype draft geometry')
  return Object.freeze({ ...snapshot(points, points.length ? 0 : null), revision: 0, history: Object.freeze([]) })
}
export function editDefenseDraft(state: DefenseDraft, action: DraftAction): DefenseDraft {
  if (action.type === 'select') return state.points[action.index] ? Object.freeze({ ...state, selected: action.index }) : state
  let points = [...state.points], selected = state.selected
  const history = [...state.history]
  let checkpoint = true
  if (action.type === 'undo') {
    const previous = history.pop()
    if (!previous) return state
    points = [...previous.points]; selected = previous.selected; checkpoint = false
  } else if (action.type === 'add') {
    if (!insideEuropeMap(action.point) || points.length >= 32) return state
    points.push(action.point); selected = points.length - 1
  } else if (action.type === 'move') {
    if (!points[action.index] || !insideEuropeMap(action.point)) return state
    if (points[action.index]!.x === action.point.x && points[action.index]!.y === action.point.y) return state
    points[action.index] = action.point; checkpoint = action.checkpoint
  } else if (action.type === 'remove') {
    if (!points[action.index]) return state
    points.splice(action.index, 1); selected = points.length ? Math.min(action.index, points.length - 1) : null
  } else if (action.type === 'clear') {
    if (!points.length) return state
    points = []; selected = null
  }
  if (state.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Prototype revision exhausted')
  if (checkpoint) history.push(snapshot(state.points, state.selected))
  return Object.freeze({ ...snapshot(points, selected), revision: state.revision + 1, history: Object.freeze(history.slice(-20)) })
}
