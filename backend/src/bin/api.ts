import 'dotenv/config'
import { createHttpServer } from '../app/http/server'
import { registerRoutes } from '../app/http/routes'
import { bootstrapApp } from '../app/bootstrap'

async function main() {
  const deps = await bootstrapApp()
  const app = createHttpServer()

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
    return res.status(status).json({ error: message })
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

