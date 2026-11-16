import {expect,test} from 'vitest';
import {HostedSessionJournal,validateHostedJournal,type HostedJournal,type HostedJournalStore} from '../codex-hosted-journal.ts';

class MemoryJournal implements HostedJournalStore {
  revision=0; value: HostedJournal|null=null; failed=false;
  async read() {return {revision:String(this.revision),value:this.value ? structuredClone(this.value) : null};}
  async compareAndSwap(_runId:string,revision:string,value:HostedJournal) {
    if(this.failed) throw Error('store offline');
    if(revision!==String(this.revision)) return false;
    this.value=structuredClone(value);this.revision++;return true;
  }
}
const run='run-76',scope='a'.repeat(64),session='sess_fixture_1',turn='turn_fixture_1';
test('one-shot journal preserves reserved -> creating -> running -> completed',async()=>{
  const store=new MemoryJournal(),journal=new HostedSessionJournal(store);
  await journal.begin(run,scope);
  await journal.markCreateStarted(run);
  await journal.recordSession(run,session);
  const result=await journal.recordRootCompletion(run,session,turn);
  expect(result).toEqual({version:1,runId:run,scopeDigest:scope,phase:'completed',sessionId:session,rootTurnId:turn});
  expect(()=>validateHostedJournal(result)).not.toThrow();
  await expect(journal.begin(run,scope)).rejects.toThrow('hosted-duplicate-run');
  await expect(journal.markCreateStarted(run)).rejects.toThrow();
  await expect(journal.markUncertain(run)).rejects.toThrow();
});
test('creation is irrevocable; duplicate creation never authorized',async()=>{
  const j=new HostedSessionJournal(new MemoryJournal());
  await j.begin(run,scope);await j.markCreateStarted(run);
  await expect(j.markCreateStarted(run)).rejects.toThrow();
  await j.markUncertain(run);
  await expect(j.recordSession(run,session)).rejects.toThrow();
  await expect(j.markCreateStarted(run)).rejects.toThrow();
});
test('concurrent start has exactly one winner',async()=>{
  const store=new MemoryJournal(),a=new HostedSessionJournal(store),b=new HostedSessionJournal(store);
  const results=await Promise.allSettled([a.begin(run,scope),b.begin(run,scope)]);
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  expect(store.value?.phase).toBe('reserved');
});
test('session ID must be authenticated externally and match completion identity',async()=>{
  const j=new HostedSessionJournal(new MemoryJournal());
  await j.begin(run,scope);await j.markCreateStarted(run);
  await expect(j.recordSession(run,'http://bad')).rejects.toThrow();
  await j.recordSession(run,session);
  await expect(j.recordRootCompletion(run,'sess_other',turn)).rejects.toThrow();
  await expect(j.recordRootCompletion(run,session,'turn/../../bad')).rejects.toThrow();
  expect((await j.markFailed(run,session)).phase).toBe('failed');
  await expect(j.recordRootCompletion(run,session,turn)).rejects.toThrow();
});
test('unknown outcomes retain session and block any automatic replay',async()=>{
  const store=new MemoryJournal(),j=new HostedSessionJournal(store);
  await j.begin(run,scope);await j.markCreateStarted(run);await j.recordSession(run,session);
  const ambiguous=await j.markUncertain(run);
  expect(ambiguous.sessionId).toBe(session);
  await expect(j.recordRootCompletion(run,session,turn)).rejects.toThrow();
  await expect(j.recordSession(run,session)).rejects.toThrow();
});
test('failed durable write prevents advancing to billable creation',async()=>{
  const store=new MemoryJournal(),j=new HostedSessionJournal(store);
  await j.begin(run,scope);store.failed=true;
  await expect(j.markCreateStarted(run)).rejects.toThrow('store offline');
  expect(store.value?.phase).toBe('reserved');
});
test('rejects inconsistent persisted records',async()=>{
  const store=new MemoryJournal();
  store.value={version:1,runId:run,scopeDigest:scope,phase:'completed',sessionId:session};
  await expect(new HostedSessionJournal(store).markUncertain(run)).rejects.toThrow('hosted-completion-without-turn');
});
