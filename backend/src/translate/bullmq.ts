import { Queue, QueueEvents, Worker } from 'bullmq'
import type Redis from 'ioredis'
import type { SupportedLanguage, TranslationProvider } from './provider'
import { translateBulkWithCache, type BulkItemResult } from './bulk'
import { getTranslationLru, translateWithCache } from './service'

type LruForBulk = NonNullable<Parameters<typeof translateBulkWithCache>[0]['lru']>

export const TRANSLATION_QUEUE_NAME = 'itl-translation'

const defaultPrefix = 'bull'

function bullmqEnabled(): boolean {
  return process.env.TRANSLATION_USE_BULLMQ !== 'false'
}

function workerConcurrency(): number {
  const v = Number(process.env.TRANSLATION_QUEUE_CONCURRENCY ?? '2')
  if (!Number.isFinite(v)) return 2
  return Math.min(32, Math.max(1, Math.floor(v)))
}

function singleJobTimeoutMs(): number {
  const v = Number(process.env.TRANSLATION_JOB_TIMEOUT_MS ?? '120000')
  return Number.isFinite(v) && v > 0 ? v : 120_000
}

function bulkJobTimeoutMs(): number {
  const v = Number(process.env.TRANSLATION_BULK_JOB_TIMEOUT_MS ?? '300000')
  return Number.isFinite(v) && v > 0 ? v : 300_000
}

const defaultJobOpts = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: 500,
  removeOnFail: 1000,
}

let queue: Queue | null = null
let queueEvents: QueueEvents | null = null
let worker: Worker | null = null

type WorkerDeps = { redis: Redis | null; provider: TranslationProvider }
let workerDeps: WorkerDeps | null = null

export async function initTranslationBullProducer(redisUrl: string) {
  if (!bullmqEnabled()) return
  if (queue) return
  const connection = { url: redisUrl }
  queue = new Queue(TRANSLATION_QUEUE_NAME, { connection, prefix: defaultPrefix })
  queueEvents = new QueueEvents(TRANSLATION_QUEUE_NAME, { connection, prefix: defaultPrefix })
  await queueEvents.waitUntilReady()
}

export function startTranslationWorker(redisUrl: string, deps: WorkerDeps): Worker | null {
  if (!bullmqEnabled()) return null
  if (worker) return worker
  workerDeps = deps
  worker = new Worker(
    TRANSLATION_QUEUE_NAME,
    async (job) => {
      const { provider, redis } = workerDeps!
      if (job.name === 'single') {
        const { text, targetLanguage, userId } = job.data as {
          text: string
          targetLanguage: SupportedLanguage
          userId?: string | null
        }
        return translateWithCache({ text, targetLanguage, provider, redis, userId: userId ?? null })
      }
      if (job.name === 'bulk') {
        const { texts, targetLanguage, userId } = job.data as {
          texts: string[]
          targetLanguage: SupportedLanguage
          userId?: string | null
        }
        return translateBulkWithCache({
          texts,
          targetLanguage,
          provider,
          redis,
          lru: getTranslationLru(),
          userId: userId ?? null,
        })
      }
      throw new Error(`Unknown job name: ${job.name}`)
    },
    {
      connection: { url: redisUrl },
      prefix: defaultPrefix,
      concurrency: workerConcurrency(),
    }
  )
  worker.on('failed', (job, err) => {
    // eslint-disable-next-line no-console
    console.error('translation worker job failed', job?.id, err)
  })
  return worker
}

export async function stopTranslationWorker() {
  await worker?.close()
  worker = null
}

export async function closeTranslationBullProducer() {
  await queueEvents?.close()
  await queue?.close()
  queueEvents = null
  queue = null
}

function producerReady(): boolean {
  return !!(queue && queueEvents && bullmqEnabled())
}

export async function runTranslateSingle(params: {
  text: string
  targetLanguage: SupportedLanguage
  provider: TranslationProvider
  redis: Redis | null
  userId?: string | null
}): Promise<Awaited<ReturnType<typeof translateWithCache>>> {
  if (!producerReady()) {
    return translateWithCache(params)
  }
  const job = await queue!.add(
    'single',
    { text: params.text, targetLanguage: params.targetLanguage, userId: params.userId ?? null },
    defaultJobOpts
  )
  try {
    return await job.waitUntilFinished(queueEvents!, singleJobTimeoutMs())
  } catch {
    // Fallback to inline translation (still uses cache) if the queue is slow/backlogged.
    return translateWithCache(params)
  }
}

export async function runTranslateBulk(params: {
  texts: string[]
  targetLanguage: SupportedLanguage
  provider: TranslationProvider
  redis: Redis | null
  lru: LruForBulk | null
  userId?: string | null
}): Promise<BulkItemResult[]> {
  if (!producerReady()) {
    return translateBulkWithCache(params)
  }
  const job = await queue!.add(
    'bulk',
    { texts: params.texts, targetLanguage: params.targetLanguage, userId: params.userId ?? null },
    defaultJobOpts
  )
  try {
    return await job.waitUntilFinished(queueEvents!, bulkJobTimeoutMs())
  } catch {
    // Fallback to inline bulk translation if the queue is slow/backlogged.
    return translateBulkWithCache(params)
  }
}
