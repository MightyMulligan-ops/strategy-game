// PostgreSQL adapter for a separately provisioned trusted audit database.
// No connection string, permissions, migrations, or agent invocation in this module.
import type { DurableLedgerStore, SignedLedgerEvent } from "./automation-ledger.ts";
type Row = Record<string,unknown>;
export interface PgLedgerClient {
  query(sql:string, values?:readonly unknown[]):Promise<{rows:Row[]}>;
  release():void;
}
export interface PgLedgerPool { connect():Promise<PgLedgerClient>; query(sql:string,values?:readonly unknown[]):Promise<{rows:Row[]}>; }
export class PostgresLedgerStore implements DurableLedgerStore {
  constructor(private readonly pool:PgLedgerPool) {}
  async read(taskKey:string):Promise<readonly SignedLedgerEvent[]> {
    const result=await this.pool.query(
      "SELECT payload FROM automation_audit.ledger_events WHERE task_key=$1 ORDER BY sequence ASC",[taskKey]);
    // Always validate this untrusted database output with verifyLedger and a
    // separately authenticated HMAC key and checkpoint before acting on it.
    return result.rows.map(r=>r.payload as SignedLedgerEvent);
  }
  async compareAndAppend(taskKey:string,expectedHead:string|null,event:SignedLedgerEvent):Promise<boolean> {
    const client=await this.pool.connect();
    let transaction=false;
    try {
      await client.query("BEGIN");transaction=true;
      const current=await client.query(
        "SELECT sequence,digest FROM automation_audit.ledger_heads WHERE task_key=$1 FOR UPDATE",[taskKey]);
      if(current.rows.length!==1 || current.rows[0]!.digest!==expectedHead ||
        Number(current.rows[0]!.sequence)+1!==event.sequence) {
        await client.query("ROLLBACK");transaction=false;return false;
      }
      await client.query(
        "INSERT INTO automation_audit.ledger_events(task_key,sequence,event_id,digest,payload) VALUES($1,$2,$3,$4,$5::jsonb)",
        [taskKey,event.sequence,event.eventId,event.digest,JSON.stringify(event)]);
      await client.query(
        "UPDATE automation_audit.ledger_heads SET sequence=$2,digest=$3 WHERE task_key=$1",
        [taskKey,event.sequence,event.digest]);
      await client.query("COMMIT");transaction=false;return true;
    } catch {
      if(transaction) await client.query("ROLLBACK").catch(()=>undefined);
      // Fail closed, including unique-key collisions and uncertain commit.
      return false;
    } finally {client.release();}
  }
  // Trusted operator-only bootstrap; callers must verify identity and grant.
  // Unique task keys prevent overwriting or resetting existing history.
  async provision(taskKey:string,genesis:SignedLedgerEvent):Promise<boolean> {
    if(genesis.sequence!==1 || genesis.previousDigest!==null || genesis.kind!=="task-claimed")return false;
    const client=await this.pool.connect();let transaction=false;
    try {
      await client.query("BEGIN");transaction=true;
      await client.query("INSERT INTO automation_audit.ledger_heads(task_key,sequence,digest) VALUES($1,1,$2)",
        [taskKey,genesis.digest]);
      await client.query("INSERT INTO automation_audit.ledger_events(task_key,sequence,event_id,digest,payload) VALUES($1,1,$2,$3,$4::jsonb)",
        [taskKey,genesis.eventId,genesis.digest,JSON.stringify(genesis)]);
      await client.query("COMMIT");transaction=false;return true;
    } catch {
      if(transaction)await client.query("ROLLBACK").catch(()=>undefined);
      return false;
    } finally {client.release();}
  }
}
