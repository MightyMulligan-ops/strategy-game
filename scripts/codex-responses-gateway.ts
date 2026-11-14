/** Trusted host process only. API credentials never enter the worker namespace.
 * This gateway is NOT a sandbox and does not authorize launching a worker.
 */
import { createServer, type Server } from 'node:http';
import { chmod, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ControlDenied, requireControl, type BoundedResponsesGate, type ResponsesTransport } from './codex-run-control.ts';

export class OpenAIResponsesTransport implements ResponsesTransport {
  constructor(private readonly apiKey: string,private readonly project: string,
    private readonly fetcher: typeof fetch = fetch) {
    requireControl(typeof apiKey === 'string' && apiKey.length > 0 && /^proj_[A-Za-z0-9]+$/.test(project),'provider-credential-or-project');
  }
  private async post(path: '/responses/input_tokens' | '/responses',body: Record<string,unknown>): Promise<Response> {
    // Deliberately no base-URL override, redirect following, retry, logging or SDK retry policy.
    const response = await this.fetcher(`https://api.openai.com/v1${path}`,{method:'POST',redirect:'error',
      signal:AbortSignal.timeout(120_000),headers:{Authorization:`Bearer ${this.apiKey}`,'OpenAI-Project':this.project,
        'Content-Type':'application/json'},body:JSON.stringify(body)}).catch(() => { throw new ControlDenied('provider-transport'); });
    if (!response.ok) { await response.body?.cancel(); throw new ControlDenied('provider-rejected'); }
    return response;
  }
  async countInputTokens(body: Record<string,unknown>): Promise<number> {
    // Same complete input/instructions/tools/format/reasoning as inference. No continuation IDs are allowed by admission.
    const countBody = Object.fromEntries(Object.entries(body).filter(([key]) =>
      !['stream','store','max_output_tokens','service_tier'].includes(key)));
    const response = await this.post('/responses/input_tokens',countBody);
    requireControl(response.body,'provider-count-body');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break; size += part.value.length;
        if (size > 8192) { await reader.cancel(); throw new ControlDenied('provider-count-size'); } chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    let count: {object?: unknown;input_tokens?: unknown};
    try { count = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {throw new ControlDenied('provider-count-json');}
    requireControl(count && count.object === 'response.input_tokens' && Number.isSafeInteger(count.input_tokens) &&
      (count.input_tokens as number) > 0,'provider-count-unverified');
    return count.input_tokens as number;
  }
  async infer(body: Record<string,unknown>): Promise<Response> { return this.post('/responses',body); }
}

/** Credential-free worker talks to a bridge inside its own network namespace;
 * the bridge forwards to this ONE socket. Mount only the socket, not its directory.
 * A trusted controller must kill both namespaces and close this server on every exit.
 */
export async function createUnixGateway(socketPath: string,gate: BoundedResponsesGate): Promise<Server> {
  requireControl(socketPath.startsWith('/') && !socketPath.includes('..'),'gateway-socket-path');
  const parent = await lstat(dirname(socketPath));
  requireControl(parent.isDirectory() && !parent.isSymbolicLink() && (parent.mode & 0o077) === 0 &&
    parent.uid === process.getuid?.(),'gateway-untrusted-parent');
  // Never unlink an existing socket or assume a stale listener is safe to replace.
  try { await lstat(socketPath); throw new ControlDenied('gateway-path-exists'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const server = createServer(async (req,res) => {
    let upstream: Response | undefined;
    try {
      requireControl(req.method === 'POST' && req.url === '/v1/responses' &&
        req.headers['content-type']?.split(';')[0] === 'application/json' && !req.headers['content-encoding'], 'gateway-request');
      const chunks: Buffer[] = []; let size = 0;
      for await (const part of req) {
        size += part.length; requireControl(size <= 2_000_000,'request-size'); chunks.push(Buffer.from(part));
      }
      const result = await gate.request(Buffer.concat(chunks).toString('utf8'));
      requireControl(result instanceof Response && result.body,'gateway-upstream'); upstream = result;
      const contentType = result.headers.get('content-type')?.split(';')[0];
      requireControl(contentType === 'application/json' || contentType === 'text/event-stream','gateway-upstream-type');
      res.writeHead(200,{'Content-Type':contentType,'Cache-Control':'no-store'});
      const reader = result.body.getReader(); let responseBytes = 0;
      res.on('close',() => { void reader.cancel().catch(() => {}); });
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          responseBytes += part.value.length;
          requireControl(responseBytes <= 8_000_000,'gateway-response-size');
          if (!res.write(part.value)) await new Promise<void>((resolve,reject) => {
            const cleanup = () => {res.off('drain',drain);res.off('close',close);};
            const drain = () => {cleanup();resolve();}; const close = () => {cleanup();reject(new ControlDenied('worker-disconnected'));};
            res.once('drain',drain);res.once('close',close);
          });
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      res.end();
    } catch {
      // No stack, provider body, prompt, credential or untrusted error text enters logs/artifacts.
      await upstream?.body?.cancel().catch(() => {});
      if (!res.headersSent) {res.writeHead(403,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"error":"request_blocked"}');}
      else res.destroy();
    }
  });
  server.requestTimeout = 130_000; server.headersTimeout = 10_000; server.maxHeadersCount = 20;
  try {
    await new Promise<void>((resolve,reject) => {server.once('error',reject);server.listen(socketPath,()=>{server.off('error',reject);resolve();});});
    await chmod(socketPath,0o600); return server;
  } catch (error) { server.close(); throw error; }
}
