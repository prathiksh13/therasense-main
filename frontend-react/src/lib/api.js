const FLASK_API = import.meta.env.VITE_FLASK_API_URL?.replace(/\/$/, '')
const NODE_API = import.meta.env.VITE_NODE_API_URL?.replace(/\/$/, '')

// Flask APIs (ML / Python)
export function flaskApi(path) {
  if (!path) return FLASK_API
  if (/^https?:\/\//i.test(path)) return path
  return `${FLASK_API}${path.startsWith('/') ? path : `/${path}`}`
}

// Node APIs (Socket + main backend)
export function nodeApi(path) {
  if (!path) return NODE_API
  if (/^https?:\/\//i.test(path)) return path
  return `${NODE_API}${path.startsWith('/') ? path : `/${path}`}`
}
