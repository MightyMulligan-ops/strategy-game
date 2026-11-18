import {RepeatingCommandSchema,RepeatingCurrentSchema,RepeatingHistorySchema,LoopTurnNumberSchema,MovementDraftErrorSchema,ReadTurnRequestSchema,UsernameSchema} from '@strategy-game/shared-types';
import {MovementDraftError} from '@strategy-game/database';
import type {LoopRepository,AuthPersistence} from '@strategy-game/database';
import type {FastifyInstance} from 'fastify';
import {privateResponseHeaders,sameOrigin,sessionPlayer} from '../auth/security.js';
export type LoopPersistence=Pick<LoopRepository,'current'|'command'|'history'>;
export async function registerLoopRoutes(app:FastifyInstance,options:{origin:string;accounts:AuthPersistence;loops:LoopPersistence}){
 await app.register(async routes=>{
  routes.setErrorHandler((error,_request,reply)=>{
   privateResponseHeaders(reply);const e=error as {code?:string;statusCode?:number};
   const code=error instanceof MovementDraftError?error.code:e.statusCode===429?'RATE_LIMITED':e.code==='FST_CSRF_INVALID_TOKEN'||e.code==='FST_CSRF_MISSING_SECRET'?'CSRF_REJECTED':e.code?.startsWith('FST_ERR_CTP_')?'INVALID_REQUEST':'INTERNAL_ERROR';
   const status=code==='UNAUTHENTICATED'?401:['USERNAME_REQUIRED','INVALID_ORIGIN','CSRF_REJECTED'].includes(code)?403:code==='NOT_FOUND'?404:code==='INVALID_REQUEST'?400:code==='INVALID_DRAFT'?422:code==='RATE_LIMITED'?429:code==='INTERNAL_ERROR'?500:409;
   if(status===500)routes.log.error('Repeating turn request failed; check service availability and stored state');return reply.code(status).send(MovementDraftErrorSchema.parse({schemaVersion:1,error:code}));
  });
  routes.addHook('onRequest',async(request,reply)=>{privateResponseHeaders(reply);if(request.method==='POST'&&!sameOrigin(request,options.origin))throw new MovementDraftError('INVALID_ORIGIN');
   const user=await sessionPlayer(request,options.accounts);if(!user)throw new MovementDraftError('UNAUTHENTICATED');if(!UsernameSchema.safeParse(user.username).success)throw new MovementDraftError('USERNAME_REQUIRED');});
  function path(params:unknown){const p=params as {matchId?:unknown;turnNumber?:unknown};const id=ReadTurnRequestSchema.safeParse({schemaVersion:1,matchId:p.matchId});if(!id.success)throw new MovementDraftError('INVALID_REQUEST');
   const n=p.turnNumber===undefined?undefined:typeof p.turnNumber==='string'&&/^[1-9]\d*$/.test(p.turnNumber)?Number(p.turnNumber):NaN;if(n!==undefined&&!LoopTurnNumberSchema.safeParse(n).success)throw new MovementDraftError('INVALID_REQUEST');return {matchId:id.data.matchId,n};}
  routes.get('/api/matches/:matchId/loop/current',async request=>{const p=path(request.params);if(Object.keys(request.query as object).length||request.body!==undefined)throw new MovementDraftError('INVALID_REQUEST');const v=RepeatingCurrentSchema.parse(await options.loops.current(p.matchId,request.session.playerIdentityId!));if(v.matchId!==p.matchId)throw new MovementDraftError('INTERNAL_ERROR');return v;});
  routes.get('/api/matches/:matchId/loop/turns/:turnNumber/aftermath',async request=>{const p=path(request.params);if(Object.keys(request.query as object).length||request.body!==undefined)throw new MovementDraftError('INVALID_REQUEST');const v=RepeatingHistorySchema.parse(await options.loops.history(p.matchId,p.n!,request.session.playerIdentityId!));if(v.matchId!==p.matchId||v.turnNumber!==p.n)throw new MovementDraftError('INTERNAL_ERROR');return v;});
  routes.post('/api/matches/:matchId/loop/turns/:turnNumber/commands',{onRequest:[app.csrfProtection]},async request=>{
   const p=path(request.params),body=RepeatingCommandSchema.safeParse(request.body);if(!body.success||Object.keys(request.query as object).length)throw new MovementDraftError('INVALID_REQUEST');if(body.data.turnNumber!==p.n)throw new MovementDraftError('WRONG_TURN');
   const v=RepeatingCurrentSchema.parse(await options.loops.command(p.matchId,p.n!,request.session.playerIdentityId!,body.data));if(v.matchId!==p.matchId||v.turn.turnNumber!==p.n||v.own.revision!==body.data.expectedRevision+1||v.schemaVersion!==body.data.schemaVersion)throw new MovementDraftError('INTERNAL_ERROR');return v;
  });
 });
}
