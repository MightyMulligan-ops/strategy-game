export {
  applyTurnCommand,
  createTurn,
  observeDeadline,
  openNextTurn,
  transitionResolution
} from "./turn.js";
export type { PlayerTurnDraft, TurnCommandResult, TurnState } from "./turn.js";
export { freezeTurnInput, resolveTurn, SIMULATION_VERSION, UnsupportedInitialWorldOperationError } from "./resolution.js";
export type { TurnResolution } from "./resolution.js";
export { groupMovementOrders, SEEDED_MOVEMENT_POLICY, seededSequentialPrecedence } from "./movement-queue.js";
export type { MovementOrderGroup, MovementTieBreaker } from "./movement-queue.js";
export { generateWorld } from "./world-generation.js";
export { initializeTurnOne, createInitialWorldReference, validateInitialWorldSnapshot } from "./turn-initialization.js";
export type { InitialTurnInitialization } from "./turn-initialization.js";
export { planInitialArmies, initializeArmiesTurnOne, validateInitialArmiesSnapshot, InitialArmiesError } from "./initial-armies.js";
export { squaredDistance, geographicDistance, evaluateLeadership, evaluateStartingFootMovement, classifyEncounter, MovementInputError } from "./army-movement.js";
export { planMovementDrafts, initializeMovementDrafts, validateMovementDraftSnapshot, previewMovementDraft, reviseMovementDraft, MovementDraftFailure } from "./movement-drafts.js";
export { planTurnClosure, initializeTurnClosure, validateTurnClosureSnapshot, reviseClosureDraft, applyClosureCommand, observeClosureDeadline, freezeClosureInput } from "./turn-closure.js";
export { planMovementResolution, validateMovementInitialSnapshot, freezeMovementInput, resolveMovement } from "./movement-resolution.js";
export { sweptContact, compareContact, strictStoppingPoint, squaredMilliDistance } from "./swept-contact.js";
export { prepareSurfaceNavigation, SurfaceNavigationInputError } from "./surface-navigation.js";
export type { SurfacePoint, SurfacePolygon, SurfaceMap, MovementDomain, SurfaceKind, SurfaceRouteResult } from "./surface-navigation.js";
