import {generateKeyPairSync,verify} from 'node:crypto';
import {expect,test} from 'vitest';
import {ledgerAppTransport,controllerTransport} from '../overnight-ledger-auth.ts';
import {OWNER_ID} from '../overnight-policy.ts';
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
const now=new Date('2026-11-17T03:30:00.000Z');
const env={SOVEREIGN_LEDGER_APP_ID:'123',SOVEREIGN_LEDGER_INSTALLATION_ID:'456',SOVEREIGN_LEDGER_APP_PRIVATE_KEY:pair.privateKey.export({format:'pem',type:'pkcs8'}).toString(),GITHUB_TOKEN:'synthetic'};
test('App enrollment verifies installation/repository and mints only a short-lived single-repository contents token',async()=>{
  const calls:string[]=[];
  await ledgerAppTransport(env,async(url,init)=>{
    calls.push(String(url));const authorization=(init!.headers as Record<string,string>).Authorization!,jwt=authorization.slice(7),parts=jwt.split('.');
    expect(verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),pair.publicKey,Buffer.from(parts[2]!,'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(parts[1]!,'base64url').toString()).iss).toBe('123');
    if(init!.method==='GET')return Response.json({id:456,app_id:123,account:{id:OWNER_ID}});
    expect(JSON.parse(String(init!.body))).toEqual({repository_ids:[1451525917],permissions:{contents:'write'}});
    return Response.json({token:'synthetic-installation-token',expires_at:new Date(now.getTime()+1800000).toISOString(),repositories:[{id:1451525917}],permissions:{contents:'write',metadata:'read'}},{status:201});
  },()=>now);
  expect(calls).toHaveLength(2);expect(calls.every(x=>x.startsWith('https://api.github.com/'))).toBe(true);
});
test.each(['owner','installation','repository','permissions','expiry','provider-key'])(
  'App transport fails closed on %s mismatch',async(kind)=>{
    await expect(ledgerAppTransport({...env,...(kind==='provider-key'?{OPENAI_API_KEY:'synthetic'}:{})},async(_url,init)=>{
      if(init!.method==='GET')return Response.json({id:kind==='installation'?999:456,app_id:123,account:{id:kind==='owner'?999:OWNER_ID}});
      return Response.json({token:'synthetic',expires_at:new Date(now.getTime()+(kind==='expiry'?7200000:1800000)).toISOString(),
        repositories:[{id:kind==='repository'?1:1451525917}],permissions:{contents:'write',...(kind==='permissions'?{actions:'write'}:{})}},{status:201});
    },()=>now)).rejects.toThrow();
  });
test('ledger credential transport cannot be used to create PRs, alter main or delete state',async()=>{
  const transport=controllerTransport(env);
  await expect(transport.request('POST','/pulls',{})).rejects.toThrow();
  await expect(transport.request('PATCH','/git/refs/heads/main',{})).rejects.toThrow();
});
