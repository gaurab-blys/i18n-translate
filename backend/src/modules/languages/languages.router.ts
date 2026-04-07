import { Router } from 'express'
import { prisma } from '../../infra/prisma/client'

export function createLanguagesRouter() {
  const router = Router()

  router.get('/', async (_req, res) => {
    const languages = await prisma.language.findMany({ orderBy: { id: 'asc' } })
    return res.json(languages)
  })

  return router
}

