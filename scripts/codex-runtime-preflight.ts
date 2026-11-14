/** No credentials, inference or application code are used during this probe. */
import { readFile, lstat, readlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { sha256 } from './codex-automation-policy.ts';
import { requireControl } from './codex-run-control.ts';

export type IsolationProbe = { available: true; toolDigest: string } | { available: false; reason: string };
export async function probeNamespaceIsolation(reviewedBwrapSha256: string): Promise<IsolationProbe> {
  requireControl(/^[a-f0-9]{64}$/.test(reviewedBwrapSha256),'unreviewed-sandbox-tool');
  const path='/usr/bin/bwrap';
  try {
    const info=await lstat(path);
    requireControl(info.isFile() && !info.isSymbolicLink() && info.size < 5_000_000,'sandbox-tool-file');
    const digest=sha256(await readFile(path)); requireControl(digest===reviewedBwrapSha256,'sandbox-tool-drift');
    const parentNamespace=await readlink('/proc/self/ns/net');
    const probe=spawnSync(path,['--unshare-all','--die-with-parent','--new-session','--cap-drop','ALL',
      '--ro-bind','/usr','/usr','--ro-bind','/bin','/bin','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64',
      '--proc','/proc','--dev','/dev','--','/usr/bin/readlink','/proc/self/ns/net'],
    {env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:5000,maxBuffer:8192,stdio:['ignore','pipe','pipe']});
    if(probe.error || probe.status!==0 || !/^net:\[\d+\]\s*$/.test(probe.stdout) || probe.stdout.trim()===parentNamespace)
      return {available:false,reason:'namespace-isolation-unavailable'};
    return {available:true,toolDigest:digest};
  } catch {return {available:false,reason:'sandbox-tool-unverified-or-unavailable'};}
}
