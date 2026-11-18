import { describe, expect, it } from 'vitest'
import { EUROPE_PROFILE, europeMapToWorld, europeWorldToMap } from '../../../../packages/shared-types/src/europe-preview.js'
import { createDefenseDraft, editDefenseDraft } from './defense-draft'
import { fitSpain, fitTheatre, project, toScreen, toWorld } from './camera'

describe('geographic defense draft editor', () => {
  it('stores fixed-point geometry independently of camera and CSS resolution', () => {
    const p = europeWorldToMap(project(-4, 40.8)), draft = createDefenseDraft([p])
    for (const view of [{ width: 1920, height: 948 }, { width: 1366, height: 643 }]) for (const camera of [fitSpain(view), fitTheatre(view)]) {
      const world = europeMapToWorld(p), screen = toScreen(world, camera, view)
      expect(europeWorldToMap(toWorld(screen, camera, view))).toEqual(p)
    }
    expect(draft.points).toEqual([p]); expect(draft.revision).toBe(0)
    expect(Object.isFrozen(draft.points[0])).toBe(true)
  })
  it('groups a drag into one undo checkpoint and increments the revision on undo', () => {
    const original = createDefenseDraft([{ x: 1000, y: 1000 }, { x: 2000, y: 2000 }])
    let draft = editDefenseDraft(original, { type: 'move', index: 0, point: { x: 1100, y: 1100 }, checkpoint: true })
    draft = editDefenseDraft(draft, { type: 'move', index: 0, point: { x: 1200, y: 1200 }, checkpoint: false })
    expect(draft.history).toHaveLength(1)
    const undo = editDefenseDraft(draft, { type: 'undo' })
    expect(undo.points).toEqual(original.points); expect(undo.revision).toBe(3)
    expect(original.points[0]).toEqual({ x: 1000, y: 1000 })
  })
  it('supports add/select/delete/clear/undo without turning selection into a geometry edit', () => {
    let draft = createDefenseDraft()
    draft = editDefenseDraft(draft, { type: 'add', point: { x: 10, y: 20 } })
    draft = editDefenseDraft(draft, { type: 'add', point: { x: 30, y: 40 } })
    draft = editDefenseDraft(draft, { type: 'select', index: 0 }); expect(draft.revision).toBe(2)
    draft = editDefenseDraft(draft, { type: 'remove', index: 0 }); expect(draft.selected).toBe(0); expect(draft.points).toHaveLength(1)
    draft = editDefenseDraft(draft, { type: 'clear' }); expect(draft.selected).toBeNull(); expect(draft.points).toHaveLength(0)
    draft = editDefenseDraft(draft, { type: 'undo' }); expect(draft.points).toEqual([{ x: 30, y: 40 }])
  })
  it('rejects malformed/outside points and bounds geometry/history work', () => {
    const draft = createDefenseDraft([{ x: 1, y: 1 }])
    for (const p of [{ x: -1, y: 1 }, { x: 1.5, y: 2 }, { x: NaN, y: 1 }, { x: EUROPE_PROFILE.width + 1, y: 1 }]) {
      expect(editDefenseDraft(draft, { type: 'add', point: p })).toBe(draft)
      expect(() => createDefenseDraft([p])).toThrow()
    }
    let full = createDefenseDraft()
    for (let i = 0; i < 40; i++) full = editDefenseDraft(full, { type: 'add', point: { x: i, y: i } })
    expect(full.points).toHaveLength(32); expect(full.history).toHaveLength(20)
    expect(editDefenseDraft(draft, { type: 'remove', index: 99 })).toBe(draft)
  })
})
