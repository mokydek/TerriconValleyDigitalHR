// JanaМен — шлюз локального Docker-стека (роль Kong + хостинга Vercel в облачной версии).
//
//   /              собранный SPA (dist) с fallback на index.html
//   /config.js     конфигурация во время выполнения: адрес API и анонимный ключ
//   /auth/v1/*     Supabase Auth (GoTrue)
//   /rest/v1/*     PostgREST (данные защищены RLS в Postgres)
//   /api/ai-jana   серверная функция AI Jana — тот же код, что и на Vercel
//
// Анонимный ключ подписывается на старте секретом из docker-тома и нигде не хранится.
import { createHmac } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 8080)
const DIST = path.resolve(process.env.DIST_DIR ?? path.join(here, '..', 'dist'))
const AUTH_URL = new URL(process.env.AUTH_URL ?? 'http://auth:9999')
const REST_URL = new URL(process.env.REST_URL ?? 'http://rest:3000')
const JWT_SECRET = (process.env.JWT_SECRET ?? readFileSync(process.env.JWT_SECRET_FILE ?? '/secrets/jwt_secret', 'utf8')).trim()

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
function signJwt(payload) {
  const data = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}`
  return `${data}.${createHmac('sha256', JWT_SECRET).update(data).digest('base64url')}`
}
const issuedAt = Math.floor(Date.now() / 1000)
const ANON_KEY = signJwt({ iss: 'supabase', role: 'anon', iat: issuedAt, exp: issuedAt + 10 * 365 * 24 * 3600 })

// AI Jana обращается к данным от имени пользователя через этот же шлюз
process.env.SUPABASE_URL = `http://127.0.0.1:${PORT}`
process.env.SUPABASE_ANON_KEY = ANON_KEY
const { default: aiJana } = await import('./ai-jana.mjs')

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
}
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

function sendJson(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function proxy(req, res, target, prefix) {
  let upstreamPath = req.url.slice(prefix.length) || '/'
  if (!upstreamPath.startsWith('/')) upstreamPath = '/' + upstreamPath
  const upstream = http.request(
    { hostname: target.hostname, port: target.port, path: upstreamPath, method: req.method, headers: { ...req.headers, host: target.host } },
    (ur) => {
      res.writeHead(ur.statusCode ?? 502, ur.headers)
      ur.pipe(res)
    },
  )
  upstream.on('error', (error) => {
    if (res.headersSent) return res.destroy()
    sendJson(res, 502, { message: 'Сервис временно недоступен', detail: error.message })
  })
  req.pipe(upstream)
}

async function runAiJana(req, res) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  let body = {}
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    return sendJson(res, 400, { error: 'bad_json' })
  }
  // Минимальная совместимость с интерфейсом VercelRequest / VercelResponse
  const vres = {
    statusCode: 200,
    headers: {},
    status(code) {
      this.statusCode = code
      return this
    },
    setHeader(name, value) {
      this.headers[name] = value
      return this
    },
    json(payload) {
      res.writeHead(this.statusCode, { ...SECURITY_HEADERS, ...this.headers, 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(payload))
      return this
    },
  }
  try {
    await aiJana({ method: req.method, headers: req.headers, body, query: {} }, vres)
  } catch (error) {
    console.error(error)
    if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' })
  }
}

function serveStatic(req, res, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return sendJson(res, 400, { error: 'bad_path' })
  }
  let file = path.resolve(path.join(DIST, decoded))
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return sendJson(res, 403, { error: 'forbidden' })
  const exists = existsSync(file) && statSync(file).isFile()
  if (!exists) {
    if (pathname.startsWith('/assets/')) return sendJson(res, 404, { error: 'not_found' })
    file = path.join(DIST, 'index.html') // маршруты SPA
  }
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  if (pathname === '/healthz') return sendJson(res, 200, { ok: true })
  if (pathname === '/config.js') {
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' })
    return res.end(`window.__JANAMEN__ = { supabaseUrl: location.origin, anonKey: ${JSON.stringify(ANON_KEY)}, realtime: false };\n`)
  }
  if (pathname === '/auth/v1' || pathname.startsWith('/auth/v1/')) return proxy(req, res, AUTH_URL, '/auth/v1')
  if (pathname === '/rest/v1' || pathname.startsWith('/rest/v1/')) return proxy(req, res, REST_URL, '/rest/v1')
  if (pathname === '/api/ai-jana') return void runAiJana(req, res)
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method_not_allowed' })
  return serveStatic(req, res, pathname)
})

server.listen(PORT, () => console.log(`JanaМен: http://localhost:${PORT}`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
