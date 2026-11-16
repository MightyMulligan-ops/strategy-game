import {expect,test} from 'vitest';
import {diagnosticFor,failureDiagnostics,eventFailure,pilotRequest,PilotFailure,PilotCleanupFailure,sanitizeDiagnostic} from '../codex-pilot-diagnostics.ts';
import {ControlDenied} from '../codex-run-control.ts';

test('HTTP failure retains only stage, status, allowlisted code and request identifiers',async()=>{
  const secret=['sk','proj','fixture-secret'].join('-');const records:unknown[]=[];let calls=0;
  try {
    await pilotRequest('source_upload','https://api.openai.com/v1/files',{},async()=>{
      calls++;return Response.json({error:{code:'insufficient_permissions',message:secret,
        param:'untrusted private parameter'}},{status:403,headers:{'x-request-id':'req_fixture'}});
    },d=>records.push(d),'source-upload-provider-status');
    throw Error('Expected denial');
  }catch(error){
    expect(error).toBeInstanceOf(PilotFailure);
    records.push(diagnosticFor(error,'admission'));
  }
  expect(calls).toBe(1);
  expect(records[1]).toMatchObject({stage:'source_upload',code:'source-upload-provider-status',httpStatus:403,
    requestId:'req_fixture',providerCode:'insufficient_permissions'});
  expect(JSON.stringify(records)).not.toMatch(/sk-proj|untrusted private|message|param/);
});
test('malicious codes, IDs, bodies, network exceptions and arbitrary errors never enter diagnostics',async()=>{
  for(const response of [
    Response.json({error:{code:'sk-proj-secret',message:'private'}},{status:400,headers:{'x-request-id':'sk-proj-secret'}}),
    new Response('private <html>token</html>',{status:502}),
    new Response('x'.repeat(17*1024),{status:500}),
  ]){
    try{await pilotRequest('session_create','https://api.openai.com/v1/agents/sessions',{},async()=>response);}
    catch(error){expect(JSON.stringify(diagnosticFor(error,'admission'))).not.toMatch(/sk-proj|private|html|token/);}
  }
  try{await pilotRequest('session_create','https://api.openai.com/v1/agents/sessions',{},async()=>{throw Error('secret');});}
  catch(error){expect(diagnosticFor(error,'admission')).toMatchObject({stage:'session_create',code:'network_or_timeout'});}
  expect(diagnosticFor(new Error('private stack'),'admission').code).toBe('controller_failure');
  expect(diagnosticFor(new ControlDenied('sk-proj-private'),'admission').code).toBe('controller_failure');
});
test('root failure and cleanup failure remain separately diagnosable without provider messages',()=>{
  const primary=eventFailure({type:'agent.session.environment.failed',environment:{error:{
    code:'environment_setup_failed',message:'secret shell output'}}},'opaque_session')!;
  const cleanup=new PilotFailure({version:1,stage:'session_delete',code:'hosted-http-status',httpStatus:503});
  const records=failureDiagnostics(new PilotCleanupFailure(primary,cleanup),'session_create');
  expect(records).toMatchObject([
    {stage:'session_stream',code:'hosted-root-failed',providerCode:'environment_setup_failed',sessionId:'opaque_session'},
    {stage:'session_delete',httpStatus:503},
  ]);
  expect(JSON.stringify(records)).not.toContain('secret shell');
  expect(eventFailure({type:'agent.session.turn.failed',turn:{subagent_id:'child',error:{message:'private'}}},'s')).toBeUndefined();
});
test('logging boundary rebuilds even typed diagnostic objects from allowlisted fields',()=>{
  const result=sanitizeDiagnostic({version:1,stage:'session_stream',code:'sk-proj-private',
    sessionId:'sk-proj-private',requestId:'req_safe',providerCode:'private',httpStatus:NaN,
    ...{message:'private output',responseBody:'private body'}});
  expect(result).toEqual({version:1,stage:'session_stream',code:'controller_failure',requestId:'req_safe',providerCode:'provider_error'});
});
