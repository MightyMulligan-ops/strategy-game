/** Bounded decoded image cache. Visible requests are canceled on pan/zoom/unmount. */
export class TileCache<T> {
  private entries = new Map<string, T>()
  private pending = new Map<string, AbortController>()
  private failed = new Set<string>()
  private disposed = false
  private load: (key: string, signal: AbortSignal) => Promise<T>
  private release: (value: T) => void
  private changed: () => void
  private capacity: number
  constructor(load: (key: string, signal: AbortSignal) => Promise<T>,
    release: (value: T) => void, changed: () => void, capacity = 64) {
    this.load = load; this.release = release; this.changed = changed; this.capacity = capacity
  }
  get(key: string): T | undefined {
    const value = this.entries.get(key)
    if (value !== undefined) { this.entries.delete(key); this.entries.set(key, value) }
    return value
  }
  get errorCount() { return this.failed.size }
  get size() { return this.entries.size }
  sync(keys: string[]) {
    if (this.disposed) return
    const wanted = new Set(keys.slice(0, this.capacity))
    for (const [key, controller] of this.pending) {
      if (!wanted.has(key)) { controller.abort(); this.pending.delete(key) }
    }
    for (const key of wanted) {
      if (this.get(key) !== undefined || this.pending.has(key) || this.failed.has(key)) continue
      const controller = new AbortController()
      this.pending.set(key, controller)
      void this.load(key, controller.signal).then(value => {
        if (controller.signal.aborted || this.disposed) { this.release(value); return }
        this.entries.set(key, value)
        while (this.entries.size > this.capacity) {
          const oldest = this.entries.keys().next().value!
          this.release(this.entries.get(oldest)!)
          this.entries.delete(oldest)
        }
        this.changed()
      }).catch(() => {
        if (!controller.signal.aborted && !this.disposed) {
          this.failed.add(key)
          // Error bookkeeping is bounded separately; no automatic retry loop.
          if (this.failed.size > this.capacity) this.failed.delete(this.failed.values().next().value!)
          this.changed()
        }
      }).finally(() => {
        if (this.pending.get(key) === controller) this.pending.delete(key)
      })
    }
  }
  retry() { this.failed.clear(); this.changed() }
  dispose() {
    this.disposed = true
    for (const controller of this.pending.values()) controller.abort()
    for (const value of this.entries.values()) this.release(value)
    this.pending.clear(); this.entries.clear(); this.failed.clear()
  }
}
