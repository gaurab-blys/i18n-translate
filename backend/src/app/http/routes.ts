import type { Express } from 'express'
import type Redis from 'ioredis'
import type { TranslationProvider } from '../../modules/translate/translate.provider'
import { createTranslateRouter } from '../../modules/translate/translate.router'
import { createUsersRouter } from '../../modules/users/users.router'
import { createLanguagesRouter } from '../../modules/languages/languages.router'

export function registerRoutes(app: Express, deps: { redis: Redis | null; provider: TranslationProvider }) {
  app.use('/users', createUsersRouter({ redis: deps.redis, provider: deps.provider }))
  app.use('/languages', createLanguagesRouter())
  app.use('/translate', createTranslateRouter({ redis: deps.redis, provider: deps.provider }))
}

