import {expect,test} from 'vitest';
import {uploadPinnedSource} from '../codex-openai-source.ts';
import {sha256} from '../codex-automation-policy.ts';
const bytes=new Uint8Array([1,2,3,4,5]);
const digest=sha256(bytes);
test('uploads only digest-checked bytes with restricted purpose',async()=>{
  let url='',init:RequestInit={};
  const out=await uploadPinnedSource('secret-fixture',bytes,digest,async(u,o)=>{
    url=u;init=o;
    return new Response(JSON.stringify({object:'file',id:'file-abc123',purpose:'user_data',bytes:5}),{status:200});
  });
  expect(out).toEqual({fileId:'file-abc123',sha256:digest,bytes:5});
  expect(url).toBe('https://api.openai.com/v1/files');
  expect(init.redirect).toBe('error');
  expect(init.headers).toMatchObject({Authorization:'Bearer secret-fixture'});
  const form=init.body as FormData;
  expect(form.get('purpose')).toBe('user_data');
  expect((form.get('file') as File).name).toBe('sovereign-source.tar.gz');
  expect(await (form.get('file') as File).arrayBuffer()).toEqual(bytes.buffer);
});
test('refuses wrong hashes and missing keys before HTTP call',async()=>{
  let calls=0;
  const transport=async()=>{calls++;return new Response('{}',{status:200});};
  await expect(uploadPinnedSource('key',bytes,'a'.repeat(64),transport)).rejects.toThrow('source-upload-integrity');
  await expect(uploadPinnedSource('',bytes,digest,transport)).rejects.toThrow('source-upload-key');
  expect(calls).toBe(0);
});
test('provider errors never echo sensitive bodies or key',async()=>{
  const t=async()=>new Response('secret-fixture private error',{status:401});
  let error='';
  try{await uploadPinnedSource('secret-fixture',bytes,digest,t);}catch(e){error=String(e);}
  expect(error).toContain('source-upload-provider-status');
  expect(error).not.toContain('secret-fixture');
  expect(error).not.toContain('private error');
});
test('only accepts a matching upload response',async()=>{
  for(const response of [
    {object:'file',id:'bad-id',purpose:'user_data',bytes:5},
    {object:'file',id:'file-good',purpose:'assistants',bytes:5},
    {object:'file',id:'file-good',purpose:'user_data',bytes:6},
    {object:'other',id:'file-good',purpose:'user_data',bytes:5},
  ]) {
    await expect(uploadPinnedSource('key',bytes,digest,async()=>
      new Response(JSON.stringify(response),{status:200}))).rejects.toThrow('source-upload-provider-identity');
  }
});
