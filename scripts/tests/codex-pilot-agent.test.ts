import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {expect,test,vi} from 'vitest';
import {runPilotAgent} from '../codex-pilot-agent.ts';
import {makePilotInput} from '../codex-pilot-prepare.ts';
import {sha256} from '../codex-automation-policy.ts';
import {HOSTED_ARTIFACTS} from '../codex-hosted-agents.ts';

test('offline controller: source upload, one streamed session, artifacts, cleanup, durable diagnostics and no replay',async()=>{
  const root=await mkdtemp(join(tmpdir(),'sovereign-controller-'));
  const output=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
  try {
    const dir=join(root,'sovereign-pilot');await mkdir(dir);
    const archive=new Uint8Array([1,2,3]);const input=makePilotInput('Synthetic approved task','a'.repeat(40),archive,'run_123',new Date());
    await writeFile(join(dir,'source.tar.gz'),archive);await writeFile(join(dir,'pilot-input.json'),JSON.stringify(input));
    const env={GITHUB_REPOSITORY:'MightyMulligan-ops/strategy-game',GITHUB_ACTOR:'MightyMulligan-ops',
      GITHUB_ACTOR_ID:'353505747',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',
      GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'123',GITHUB_SHA:input.scope.sourceSha,SOVEREIGN_ISSUE:'76',
      OPENAI_API_KEY:['sk','proj','synthetic-secret'].join('-'),RUNNER_TEMP:root};
    const patch=Buffer.from('diff --git a/packages/game-engine/src/combat.ts b/packages/game-engine/src/combat.ts\n');
    const manifest=JSON.stringify({format:'sovereign-codex-proposal-v1',source_sha:input.scope.sourceSha,
      scope_digest:input.scopeDigest,patch_sha256:sha256(patch),patch_bytes:patch.length,
      paths:[{path:'packages/game-engine/src/combat.ts',bytes:10,sha256:'b'.repeat(64)}]});
    const artifacts=[patch,Buffer.from(manifest),Buffer.from('Synthetic proposal. Independent validation still required.')];
    const calls:{url:string;init:RequestInit}[]=[];
    const transport=async(url:string,init:RequestInit)=>{
      calls.push({url,init});
      if(url.endsWith('/files'))return Response.json({object:'file',id:'file_fixture',purpose:'user_data',bytes:3});
      if(url.endsWith('/sessions'))return new Response('data: '+JSON.stringify({type:'agent.session.in_progress',session:{id:'opaque-session'}})+'\n\n'+
        'data: '+JSON.stringify({type:'agent.session.turn.completed',session_id:'opaque-session',turn:{id:'opaque-turn',subagent_id:null}})+'\n\n');
      if(init.method==='DELETE')return Response.json({object:'agent.session.deleted',id:'opaque-session',deleted:true});
      if(url.includes('/artifacts?'))return Response.json({object:'list',has_more:false,data:HOSTED_ARTIFACTS.map((path,i)=>({
        id:'artifact_'+i,path,turn_id:'opaque-turn',session_id:'opaque-session'}))});
      const index=Number(/artifact_(\d)/.exec(url)?.[1]);
      return new Response(new Uint8Array(artifacts[index]!));
    };
    await runPilotAgent(env,transport);
    expect(await readFile(join(dir,'untrusted-output','proposal.patch'))).toEqual(patch);
    expect(calls.filter(c=>c.url.endsWith('/sessions'))).toHaveLength(1);
    const creation=calls.find(c=>c.url.endsWith('/sessions'))!;
    expect(creation.init.body).not.toContain(env.OPENAI_API_KEY);
    expect(JSON.parse(creation.init.body as string).environment.network.access).toBe('disabled');
    const diagnostics=await readFile(join(dir,'diagnostics.jsonl'),'utf8');
    expect(diagnostics).toContain('opaque-session');expect(diagnostics).toContain('root_completed');
    expect(diagnostics).not.toContain(env.OPENAI_API_KEY);expect(diagnostics).not.toContain('diff --git');
    expect(JSON.parse(await readFile(join(dir,'session-state.json'),'utf8')).value.phase).toBe('completed');
    const beforeReplay=calls.length;
    await expect(runPilotAgent(env,transport)).rejects.toThrow('hosted-duplicate-run');
    expect(calls).toHaveLength(beforeReplay);
    expect(calls.filter(c=>c.url.endsWith('/sessions'))).toHaveLength(1);
  }finally{output.mockRestore();await rm(root,{recursive:true,force:true});}
});

test('offline source permission failure is diagnosed without creating a session or logging a secret',async()=>{
  const root=await mkdtemp(join(tmpdir(),'sovereign-controller-'));
  const output=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
  try {
    const dir=join(root,'sovereign-pilot');await mkdir(dir);
    const archive=new Uint8Array([1]);const input=makePilotInput('Synthetic','a'.repeat(40),archive,'run_123',new Date());
    await writeFile(join(dir,'source.tar.gz'),archive);await writeFile(join(dir,'pilot-input.json'),JSON.stringify(input));
    let calls=0;
    const env={GITHUB_REPOSITORY:'MightyMulligan-ops/strategy-game',GITHUB_ACTOR:'MightyMulligan-ops',
      GITHUB_ACTOR_ID:'353505747',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',
      GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'123',GITHUB_SHA:input.scope.sourceSha,SOVEREIGN_ISSUE:'76',
      OPENAI_API_KEY:['sk','proj','private-fixture'].join('-'),RUNNER_TEMP:root};
    await expect(runPilotAgent(env,async()=>{calls++;return Response.json({error:{code:'insufficient_permissions',message:env.OPENAI_API_KEY}},
      {status:403,headers:{'x-request-id':'req_fixture'}});})).rejects.toThrow('source-upload-provider-status');
    expect(calls).toBe(1);
    const log=await readFile(join(dir,'diagnostics.jsonl'),'utf8');
    expect(log).toContain('source_upload');expect(log).toContain('403');expect(log).toContain('req_fixture');
    expect(log).not.toContain(env.OPENAI_API_KEY);
  }finally{output.mockRestore();await rm(root,{recursive:true,force:true});}
});
