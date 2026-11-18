// Server-only turn execution; the historical public engine entry point stays unchanged.
export {planCombatTurn,validateCombatInitialSnapshot,freezeCombatInput,resolveCombatTurn} from "./combat-turn.js";
export {planLoop,validateLoopState,previewLoop,reviseLoop,applyLoop,freezeLoop,resolveLoop,openLoopNext,initialLoopTurn,loopSame,LoopFailure} from './combat-loop.js';
