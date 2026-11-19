import type { CityId } from "@strategy-game/shared-types"
import type { Point } from './camera'

/** UI intent only. The existing command endpoint decides validity and outcomes. */
export type FormationMapInteraction = {
  selectCity?: (cityId: CityId) => void
  canDrag?: (formationId: string) => boolean
  selectedId: string | null
  select: (formationId: string) => void
  queueMove: ((formationId: string, destination: Point) => void) | null
}
