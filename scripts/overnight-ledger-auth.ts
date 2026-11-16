/** Dedicated owner-provisioned App for ledger writes. Never available to agent
 * or validation jobs. Generic Actions write tokens must NOT bypass ledger rules. */
import {createPrivateKey,sign} from 'node:crypto';
import {GitHubHttpsTransport,type GitHubTransport} from './codex-github-control.ts';
import {requireControl} from './codex-run-control.ts';
import {obj} from './overnight-production.ts';
import {OWNER_ID} from './overnight-policy.ts';
const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
export async function ledgerAppTransport(env:NodeJS.ProcessEnv,fetcher:typeof fetch=fetch,now:()=>Date=()=>new Date()):Promise<GitHubTransport>{
  requireControl(env.OPENAI_API_KEY===undefined&&/^\d{1,20}$/.test(env.SOVEREIGN_LEDGER_APP_ID??'')&&/^\d{1,20}$/.test(env.SOVEREIGN_LEDGER_INSTALLATION_ID??'')&&
    typeof env.SOVEREIGN_LEDGER_APP_PRIVATE_KEY==='string','queue-ledger-app-not-configured');
  const key=createPrivateKey(env.SOVEREIGN_LEDGER_APP_PRIVATE_KEY);requireControl(key.asymmetricKeyType==='rsa','queue-ledger-app-key');
  const seconds=Math.floor(now().getTime()/1000),payload=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iat:seconds-30,exp:seconds+300,iss:env.SOVEREIGN_LEDGER_APP_ID});
  const jwt=payload+'.'+sign('RSA-SHA256',Buffer.from(payload),key).toString('base64url');
  async function request(path:string,method='GET',body?:unknown){
    const r=await fetcher('https://api.github.com'+path,{method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000),
      headers:{Authorization:'Bearer '+jwt,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    requireControl(r.status===(method==='POST'?201:200),'queue-ledger-app-http');
    const chunks:Uint8Array[]=[];let n=0;const reader=r.body?.getReader();requireControl(reader,'queue-ledger-app-body');
    try{for(;;){const part=await reader.read();if(part.done)break;n+=part.value.length;requireControl(n<=65536,'queue-ledger-app-size');chunks.push(part.value)}}finally{await reader.cancel();reader.releaseLock()}
    return obj(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  }
  const installation=await request('/repos/MightyMulligan-ops/strategy-game/installation');
  requireControl(installation.id===Number(env.SOVEREIGN_LEDGER_INSTALLATION_ID)&&installation.app_id===Number(env.SOVEREIGN_LEDGER_APP_ID)&&obj(installation.account).id===OWNER_ID,'queue-ledger-app-installation');
  const token=await request(`/app/installations/${env.SOVEREIGN_LEDGER_INSTALLATION_ID}/access_tokens`,'POST',{repository_ids:[1451525917],permissions:{contents:'write'}});
  requireControl(typeof token.token==='string'&&token.token.length>0&&Array.isArray(token.repositories)&&token.repositories.length===1&&obj(token.repositories[0]).id===1451525917&&
    obj(token.permissions).contents==='write'&&Object.entries(obj(token.permissions)).every(([k,v])=>k==='contents'||v==='read')&&typeof token.expires_at==='string'&&
    Date.parse(token.expires_at)>now().getTime()&&Date.parse(token.expires_at)-now().getTime()<=3600000,'queue-ledger-app-token');
  return new GitHubHttpsTransport(token.token);
}
export function controllerTransport(env:NodeJS.ProcessEnv,fetcher:typeof fetch=fetch):GitHubTransport{
  const read=new GitHubHttpsTransport(env.GITHUB_TOKEN??'');let write:Promise<GitHubTransport>|undefined;
  return {async request(method,path,body){
    if(method==='GET')return read.request(method,path,body);
    requireControl(method==='POST'&&['/git/trees','/git/commits'].includes(path)||method==='PATCH'&&path==='/git/refs/heads/sovereign-overnight-ledger-v1','queue-ledger-app-write-path');
    write??=ledgerAppTransport(env,fetcher);return (await write).request(method,path,body);
  }};
}
