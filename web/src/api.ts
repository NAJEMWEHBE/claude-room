import { useEffect, useState } from 'react'

/* ------------------------------------------------------------------ *
 * claude-room wire types + polling hook — ONLY the
 * pieces the pixel Room consumes: EventLine (SSE contract doc) and
 * fetchJson + useApi.
 *
 * Endpoints are served same-origin by the standalone watcher:
 *   GET  /api/live-agents   -> LiveAgents   (polled every 3s)
 *   GET  /api/stream        -> text/event-stream of EventLine JSON
 * ------------------------------------------------------------------ */

/** One raw event line as it arrives over SSE /api/stream. Every field is
 *  optional on the wire; the Room reacts to `event === 'UserPromptSubmit'` and
 *  `event === 'PreToolUse'`. */
export interface EventLine {
  ts?: number
  event?: string
  session?: string
  tool?: string
  detail?: string
  ok?: boolean
}

/* The roster row type (LiveAgent) lives in roomEngine.ts — the engine owns the
 * wire contract for /api/live-agents rows; Room.tsx defines the { agents, … }
 * envelope locally. This module is just the transport layer. */

/* ------------------------------------------------------------------ *
 * Fetch helper + polling hook
 * ------------------------------------------------------------------ */

export async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal })
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return (await res.json()) as T
}

/**
 * Fetch `path` on mount (and every `pollMs` if given). Returns `fallback`
 * until/unless real data arrives, and keeps showing the last good data on
 * transient errors — so the page never renders a broken/blank panel.
 */
export function useApi<T>(path: string, fallback: T, pollMs?: number) {
  const [data, setData] = useState<T>(fallback)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState(false)

  useEffect(() => {
    let alive = true
    let seq = 0 // out-of-order guard: only the newest in-flight load may commit
    const ctrl = new AbortController()

    const load = async () => {
      const mySeq = ++seq
      try {
        const json = await fetchJson<unknown>(path, ctrl.signal)
        if (!alive || mySeq !== seq) return // a newer poll already started - drop the stale response
        // a 200 body that isn't an object (null / number / string) can never be
        // roster data: treat it like a fetch error so the page keeps last good.
        if (!json || typeof json !== 'object') throw new Error(`${path} -> non-object body`)
        setData(json as T)
        setError(null)
        setLive(true)
      } catch (e) {
        if (!alive || (e as Error).name === 'AbortError') return
        setError((e as Error).message)
        setLive(false)
      } finally {
        if (alive) setLoading(false)
      }
    }

    load()
    let id: number | undefined
    if (pollMs) id = window.setInterval(load, pollMs)

    return () => {
      alive = false
      ctrl.abort()
      if (id) clearInterval(id)
    }
  }, [path, pollMs])

  return { data, error, loading, live }
}
