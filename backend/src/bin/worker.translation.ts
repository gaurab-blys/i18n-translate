import 'dotenv/config'
import { createRedis } from '../infra/redis/client'
import { GoogleTranslationProvider, StubTranslationProvider } from '../modules/translate/translate.provider'
import { startTranslationWorker } from '../modules/translate/translate.bullmq'

const redisUrl = process.env.REDIS_URL
if (!redisUrl) {
  throw new Error('REDIS_URL is required for the translation worker')
}

const redis = createRedis()
if (!redis) {
  throw new Error('Could not create Redis client')
}

const provider =
  process.env.TRANSLATION_PROVIDER === 'google'
    ? new GoogleTranslationProvider()
    : new StubTranslationProvider()

const w = startTranslationWorker(redisUrl, { redis, provider })
if (!w) {
  // eslint-disable-next-line no-console
  console.error('Translation worker did not start (set TRANSLATION_USE_BULLMQ=true)')
  process.exit(1)
}
// eslint-disable-next-line no-console
console.log('Translation BullMQ worker listening on queue itl-translation')

