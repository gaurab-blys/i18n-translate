import express from 'express'
import cors from 'cors'

export function createHttpServer() {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '5mb' }))
  return app
}

