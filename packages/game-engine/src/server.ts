// Server-only turn execution; the historical public engine entry point stays unchanged.
export {planCombatTurn,validateCombatInitialSnapshot,freezeCombatInput,resolveCombatTurn} from "./combat-turn.js";
export {planLoop,validateLoopState,previewLoop,reviseLoop,applyLoop,freezeLoop,resolveLoop,openLoopNext,initialLoopTurn,loopSame,LoopFailure} from './combat-loop.js';

// Trusted physical-surface preparation only; no browser export.
export {prepareSurfaceNavigation,SurfaceNavigationInputError} from "./surface-navigation.js";
export type {SurfacePoint,SurfaceMap,SurfaceRouteResult,SurfaceKind} from "./surface-navigation.js";

export {initialCityDraft} from './city-economy.js';
export {cityCommander} from './city-garrison.js';
export {CITY_SCENARIO} from './city-scenario.js';
export type {RepeatingDraft} from './combat-loop.js';
