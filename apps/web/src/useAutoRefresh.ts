import { useEffect, useRef } from 'react'

/** Read-only refreshes: one request at a time, hidden-tab pause and bounded backoff. */
export function useAutoRefresh(refresh: () => Promise<boolean>, enabled = true) {
  const latest = useRef(refresh)
  useEffect(() => { latest.current = refresh }, [refresh])
  useEffect(() => {
    if (!enabled) return
    let stopped = false, running = false, failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => { clearTimeout(timer); if (!stopped) timer = setTimeout(() => void update(), Math.min(60_000, 10_000 * 2 ** failures)) }
    const update = async () => {
      if (stopped || running) return
      if (document.visibilityState === 'hidden' || navigator.onLine === false) { schedule(); return }
      running = true
      try { failures = await latest.current() ? 0 : Math.min(3, failures + 1) }
      catch { failures = Math.min(3, failures + 1) }
      finally { running = false; schedule() }
    }
    const wake = () => { if (document.visibilityState !== 'hidden') void update() }
    schedule()
    window.addEventListener('focus', wake); window.addEventListener('online', wake); document.addEventListener('visibilitychange', wake)
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener('focus', wake); window.removeEventListener('online', wake); document.removeEventListener('visibilitychange', wake) }
  }, [enabled])
}
