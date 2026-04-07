import 'dotenv/config'
import { createRedis } from '../infra/redis/client'
import { GoogleTranslationProvider, StubTranslationProvider } from '../modules/translate/translate.provider'
import { startGlobalTranslationBatcher } from '../modules/translate/translate.globalBatcherWorker'

const redisUrl = process.env.REDIS_URL
if (!redisUrl) {
  throw new Error('REDIS_URL is required for the translation batcher worker')
}

const redis = createRedis()
if (!redis) {
  throw new Error('Could not create Redis client')
}

const provider =
  process.env.TRANSLATION_PROVIDER === 'google'
    ? new GoogleTranslationProvider()
    : new StubTranslationProvider()

startGlobalTranslationBatcher({ redis, provider }).catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Global translation batcher crashed', err)
  process.exit(1)
})

