function getViteEnvEdgeBaseUrl(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (import.meta as any)?.env as { VITE_EDGE_BASE_URL?: string } | undefined
  return String(meta?.VITE_EDGE_BASE_URL ?? '')
}

/**
 * Fipulse Edge base URL, no trailing slash. Empty = same origin (dev proxy).
 */
export function getEdgeBaseUrl(): string {
  const raw = getViteEnvEdgeBaseUrl()
  return raw.trim().replace(/\/+$/, '')
}

/**
 * Origin for auth links and absolute URLs. When Edge base is empty, use browser origin (dev proxy).
 */
export function edgeOriginForAuth(): string {
  const b = getEdgeBaseUrl()
  if (b) return b
  if (typeof window !== 'undefined') return window.location.origin
  return ''
}

