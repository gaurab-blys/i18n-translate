import { Router } from 'express'
import { z } from 'zod'
import type Redis from 'ioredis'
import type { TranslationProvider } from './translate.provider'
import { runTranslateBulk, runTranslateSingle } from './translate.bullmq'
import { getTranslationLru } from './translate.service'

const bodySchema = z.object({
  text: z.string().min(1),
  target_language: z.enum(['fr', 'gr', 'cn']),
})

const bulkBodySchema = z.object({
  target_language: z.enum(['fr', 'gr', 'cn']),
  items: z.array(z.object({ text: z.string().min(1) })).min(1).max(100),
})

export function createTranslateRouter(params: {
  redis: Redis | null
  provider: TranslationProvider
}) {
  const router = Router()

  router.post('/', async (req, res) => {
    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() })
    }

    const result = await runTranslateSingle({
      text: parsed.data.text,
      targetLanguage: parsed.data.target_language,
      provider: params.provider,
      redis: params.redis,
    })

    return res.json(result)
  })

  router.post('/bulk', async (req, res) => {
    const parsed = bulkBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() })
    }

    const texts = parsed.data.items.map((i) => i.text)
    const results = await runTranslateBulk({
      texts,
      targetLanguage: parsed.data.target_language,
      provider: params.provider,
      redis: params.redis,
      lru: getTranslationLru(),
    })

    return res.json({ results })
  })

  return router
}

