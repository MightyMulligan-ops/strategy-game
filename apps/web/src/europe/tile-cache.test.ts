import { describe, expect, it, vi } from 'vitest'
import { TileCache } from './tile-cache'
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)) }
describe('decoded tile cache lifecycle', () => {
  it('loads once, evicts least recently used values and releases on disposal', async () => {
    const load = vi.fn(async (key: string) => key)
    const release = vi.fn(), changed = vi.fn()
    const cache = new TileCache(load, release, changed, 2)
    cache.sync(['a', 'b']); await flush()
    cache.sync(['a', 'b']); await flush()
    expect(load).toHaveBeenCalledTimes(2)
    cache.get('a'); cache.sync(['a', 'c']); await flush()
    expect(cache.size).toBe(2); expect(cache.get('b')).toBeUndefined()
    expect(release).toHaveBeenCalledWith('b')
    cache.dispose(); expect(cache.size).toBe(0)
    expect(release).toHaveBeenCalledTimes(3)
    cache.sync(['d']); expect(load).toHaveBeenCalledTimes(3)
  })
  it('aborts obsolete requests and releases late decoded results', async () => {
    let finish: (value: string) => void = () => {}
    let signal: AbortSignal | undefined
    const load = vi.fn((_key: string, s: AbortSignal) => { signal = s; return new Promise<string>(resolve => { finish = resolve }) })
    const release = vi.fn(), changed = vi.fn()
    const cache = new TileCache(load, release, changed)
    cache.sync(['old']); cache.sync([])
    expect(signal?.aborted).toBe(true)
    finish('late'); await flush()
    expect(release).toHaveBeenCalledWith('late'); expect(cache.size).toBe(0); expect(changed).not.toHaveBeenCalled()
    cache.dispose()
  })
  it('does not automatically retry failures, but allows an explicit retry', async () => {
    const load = vi.fn(async () => { throw new Error('offline') })
    const cache = new TileCache(load, vi.fn(), vi.fn(), 2)
    cache.sync(['a']); await flush(); cache.sync(['a']); await flush()
    expect(load).toHaveBeenCalledTimes(1); expect(cache.errorCount).toBe(1)
    cache.retry(); cache.sync(['a']); await flush()
    expect(load).toHaveBeenCalledTimes(2)
    cache.sync(['b', 'c']); await flush(); expect(cache.errorCount).toBeLessThanOrEqual(2)
    cache.dispose()
  })
})
