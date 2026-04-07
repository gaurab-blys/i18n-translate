import type Redis from 'ioredis'
import { prisma } from '../infra/prisma/client'
import { createRedis } from '../infra/redis/client'
import { GoogleTranslationProvider, StubTranslationProvider, type TranslationProvider } from '../modules/translate/translate.provider'
import {
  registerTranslationLruEvict,
  startTranslationInvalidationSubscriber,
} from '../translate/redis-invalidate-sub'
import { evictTranslationLruKey } from '../modules/translate/translate.service'
import { initTranslationBullProducer, startTranslationWorker } from '../modules/translate/translate.bullmq'
import { startGlobalTranslationBatcher } from '../modules/translate/translate.globalBatcherWorker'

export type AppDeps = {
  prisma: typeof prisma
  redis: Redis | null
  redisUrl: string | undefined
  provider: TranslationProvider
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms))
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    (async () => {
      await sleep(ms)
      throw new Error(`timeout after ${ms}ms`)
    })(),
  ])
}

export async function bootstrapApp(): Promise<AppDeps> {
  const redis = createRedis()
  const redisUrl = process.env.REDIS_URL

  if (redisUrl) {
    registerTranslationLruEvict(evictTranslationLruKey)
    startTranslationInvalidationSubscriber(redisUrl)
  }

  const provider =
    process.env.TRANSLATION_PROVIDER === 'google'
      ? new GoogleTranslationProvider()
      : new StubTranslationProvider()

  if (redisUrl) {
    let bullReady = false
    try {
      await withTimeout(initTranslationBullProducer(redisUrl), 1000)
      bullReady = true
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('translation queue not ready; continuing without BullMQ', err)
    }

    if (bullReady && process.env.RUN_TRANSLATION_WORKER !== 'false') {
      startTranslationWorker(redisUrl, { redis, provider })
    }

    if (process.env.RUN_TRANSLATION_BATCHER === 'true' && redis) {
      startGlobalTranslationBatcher({ redis, provider })
    }
  }

  return { prisma, redis, redisUrl, provider }
}

