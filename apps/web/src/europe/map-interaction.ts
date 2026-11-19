import type { Point } from './camera'

/** UI intent only. The existing command endpoint decides validity and outcomes. */
export type FormationMapInteraction = {
  selectedId: string | null
  select: (formationId: string) => void
  queueMove: ((formationId: string, destination: Point) => void) | null
}
