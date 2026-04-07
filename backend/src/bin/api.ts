import 'dotenv/config'
import { createHttpServer } from '../app/http/server'
import { registerRoutes } from '../app/http/routes'
import { bootstrapApp } from '../app/bootstrap'
import crypto from 'node:crypto'

async function main() {
  const deps = await bootstrapApp()
  const app = createHttpServer()

  app.use((req, res, next) => {
    const id = req.header('x-request-id') || crypto.randomUUID()
    res.setHeader('x-request-id', id)
    ;(req as any).requestId = id
    next()
  })

  app.get('/health', async (_req, res) => {
    // Liveness: API process is up. (DB/Redis may be temporarily unavailable.)
    return res.json({ ok: true })
  })

  app.get('/ready', async (_req, res) => {
    // Readiness: dependencies reachable.
    try {
      await deps.prisma.$queryRaw`SELECT 1`
      return res.json({ ok: true })
    } catch (err) {
      return res.status(503).json({ ok: false, error: String(err) })
    }
  })

  registerRoutes(app, { redis: deps.redis, provider: deps.provider })

  // Error handler must be registered after routes.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: any, res: any, _next: any) => {
    const status = typeof err?.status === 'number' ? err.status : 500
    const message = err?.message ? String(err.message) : 'Internal Server Error'
    const requestId = (_req as any).requestId
    // eslint-disable-next-line no-console
    console.error('request failed', { requestId, status, message, stack: err?.stack })
    return res.status(status).json({ error: message, requestId })
  })

  const port = Number(process.env.PORT || 8080)
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on :${port}`)
  })
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})

