/** Local, credential-free inspection/report CLI. Deliberately no launch command. */
import {readFileSync,lstatSync} from 'node:fs';
import {parseManifest,manifestDigest} from './overnight-policy.ts';
import {validateQueueLedger,type QueueLedger} from './overnight-ledger.ts';
import {morningReport} from './overnight-queue.ts';
import {requireControl} from './codex-run-control.ts';
function read(path:string,max:number){
  const s=lstatSync(path);requireControl(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.size>0&&s.size<=max,'queue-inspection-file');return readFileSync(path);
}
export function inspect(args:readonly string[]):string {
  if(args[0]==='manifest'&&args.length===2){
    const m=parseManifest(read(args[1]!,128*1024));
    return m.enabled?`Manifest shape valid; digest ${manifestDigest(m)}. Owner authorization NOT VERIFIED. No execution.\n`:'Queue DISABLED. No tasks, schedule, approval or execution.\n';
  }
  if(args[0]==='report'&&args.length===3){
    const l=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(read(args[1]!,256*1024))) as QueueLedger;
    validateQueueLedger(l);return morningReport(l,args[2]!);
  }
  throw Error('queue-inspection-usage');
}
if(process.argv[1]?.endsWith('overnight-inspect.ts')){
  try{process.stdout.write(inspect(process.argv.slice(2)))}
  catch{process.stderr.write('Queue inspection denied. Use manifest FILE or report LEDGER QUEUE_ID. No launch command exists.\n');process.exitCode=1}
}
