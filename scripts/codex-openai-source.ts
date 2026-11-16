/** Trusted project-scoped source upload to OpenAI Files API (no hosted session).
 * Never give the API key to a coding agent or validator.
 */
import {sha256} from './codex-automation-policy.ts';
import {ControlDenied,requireControl} from './codex-run-control.ts';
import {boundedBody,pilotRequest,type PilotReporter} from './codex-pilot-diagnostics.ts';
type Fetcher=(url:string,init:RequestInit)=>Promise<Response>;
const URL='https://api.openai.com/v1/files';
const FILE_ID=/^file[-_][A-Za-z0-9_-]{1,128}$/;
export type SourceUpload=Readonly<{fileId:string;sha256:string;bytes:number}>;
export async function uploadPinnedSource(
  apiKey:string,sourceArchive:Uint8Array,expectedSha256:string,fetcher:Fetcher=fetch,report:PilotReporter=()=>{},
):Promise<SourceUpload>{
  requireControl(typeof apiKey==='string'&&apiKey.length>0,'source-upload-key');
  requireControl(sourceArchive instanceof Uint8Array&&
    sourceArchive.byteLength>0&&sourceArchive.byteLength<=50*1024*1024&&
    /^[a-f0-9]{64}$/.test(expectedSha256)&&sha256(sourceArchive)===expectedSha256,
    'source-upload-integrity');
  const form=new FormData();
  form.set('purpose','user_data');
  form.set('expires_after[anchor]','created_at');
  form.set('expires_after[seconds]','3600');
  form.set('file',new Blob([new Uint8Array(sourceArchive)]), 'sovereign-source.tar.gz');
  // This call must not retry after an ambiguous response: avoid orphan uploads.
  const response=await pilotRequest('source_upload',URL,{method:'POST',redirect:'error',cache:'no-store',
    headers:{Authorization:'Bearer '+apiKey},body:form},fetcher,report,'source-upload-provider-status');
  let value:unknown;
  try {
    value=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(await boundedBody(response,4096)));
  } catch {throw new ControlDenied('source-upload-provider-response');}
  requireControl(value!==null&&typeof value==='object'&&!Array.isArray(value),
    'source-upload-provider-data');
  const result=value as Record<string,unknown>;
  requireControl(result.object==='file'&&typeof result.id==='string'&&
    FILE_ID.test(result.id)&&result.purpose==='user_data' &&
    (result.bytes===null||result.bytes===sourceArchive.byteLength),
    'source-upload-provider-identity');
  return {fileId:result.id,sha256:expectedSha256,bytes:sourceArchive.byteLength};
}
