import { EuropePreviewCommandSchema, EuropePreviewResultSchema } from '../../../../packages/shared-types/src/europe-preview.js'
import type { EuropePreviewCommand, EuropePreviewResult } from '../../../../packages/shared-types/src/europe-preview.js'

type Outcome = { status: 'current'; result: EuropePreviewResult } | { status: 'stale' } | { status: 'error' }
/** A canceled/late response can never validate newer geometry or a different fixture formation. */
export class EuropePreviewClient {
  private epoch = 0
  private controller: AbortController | null = null
  private fetcher: typeof fetch
  constructor(fetcher: typeof fetch = fetch) { this.fetcher = fetcher }
  invalidate() { this.epoch++; this.controller?.abort(); this.controller = null }
  async validate(input: EuropePreviewCommand): Promise<Outcome> {
    this.invalidate()
    const epoch = this.epoch, controller = new AbortController()
    this.controller = controller
    try {
      const command = EuropePreviewCommandSchema.parse(input)
      const response = await this.fetcher('/__prototype/europe/validate', { method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) })
      if (!response.ok) throw new Error('Surface preview unavailable')
      const result = EuropePreviewResultSchema.parse(await response.json())
      if (result.kind !== command.kind || result.revision !== command.revision) throw new Error('Mismatched surface response')
      return epoch === this.epoch && !controller.signal.aborted ? { status: 'current', result } : { status: 'stale' }
    } catch { return epoch === this.epoch && !controller.signal.aborted ? { status: 'error' } : { status: 'stale' } }
  }
}
