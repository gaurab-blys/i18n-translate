import type Redis from 'ioredis'
import type { SupportedLanguage, TranslationProvider } from './provider'
import {
  batchingMaxBatchSize,
  batchingResponseTtlSec,
  batchingWindowMs,
  requestStreamKey,
  responseKey,
} from './global-batcher'

type WorkerDeps = {
  redis: Redis
  provider: TranslationProvider
}

const GROUP = 'itl-translation-batcher'

function consumerName() {
  return `c-${process.pid}`
}

function parseEntry(fields: string[]) {
  // ioredis returns fields as [k1, v1, k2, v2, ...]
  const out: Record<string, string> = {}
  for (let i = 0; i < fields.length; i += 2) {
    out[fields[i]!] = fields[i + 1]!
  }
  return out
}

async function ensureGroup(redis: Redis, stream: string) {
  try {
    await redis.xgroup('CREATE', stream, GROUP, '$', 'MKSTREAM')
  } catch (err: any) {
    const msg = String(err?.message ?? err)
    if (!msg.includes('BUSYGROUP')) throw err
  }
}

export async function startGlobalTranslationBatcher(deps: WorkerDeps) {
  const { redis, provider } = deps
  const windowMs = batchingWindowMs()
  const maxBatch = batchingMaxBatchSize()
  const respTtl = batchingResponseTtlSec()
  const consumer = consumerName()
  const logBatches = process.env.TRANSLATION_GLOBAL_BATCH_LOG === 'true'

  const languages: SupportedLanguage[] = ['en', 'fr', 'gr', 'cn']
  const streams = languages.map((l) => requestStreamKey(l))
  for (const s of streams) {
    await ensureGroup(redis, s)
  }

  // eslint-disable-next-line no-console
  console.log(
    `Global translation batcher started (window=${windowMs}ms maxBatch=${maxBatch} group=${GROUP} consumer=${consumer})`
  )

  while (true) {
    const batchStart = Date.now()
    const remaining = () => Math.max(0, windowMs - (Date.now() - batchStart))

    // First blocking read to collect at least one message (or timeout).
    const first = (await redis.xreadgroup(
      'GROUP',
      GROUP,
      consumer,
      'COUNT',
      maxBatch,
      'BLOCK',
      windowMs,
      'STREAMS',
      ...streams,
      ...streams.map(() => '>')
    )) as any

    if (!first) continue

    type Item = { stream: string; id: string; requestId: string; text: string }
    const items: Item[] = []

    for (const [stream, entries] of first as [string, any[]][]) {
      for (const [id, fields] of entries as [string, string[]][]) {
        const parsed = parseEntry(fields)
        const requestId = parsed.requestId
        const text = parsed.text
        if (!requestId || text === undefined) {
          // Malformed entry: ack and skip.
          await redis.xack(stream, GROUP, id)
          continue
        }
        items.push({ stream, id, requestId, text })
        if (items.length >= maxBatch) break
      }
      if (items.length >= maxBatch) break
    }

    // Drain more within the remaining window without blocking.
    while (items.length < maxBatch && remaining() > 0) {
      const more = (await redis.xreadgroup(
        'GROUP',
        GROUP,
        consumer,
        'COUNT',
        maxBatch - items.length,
        'BLOCK',
        0,
        'STREAMS',
        ...streams,
        ...streams.map(() => '>')
      )) as any
      if (!more) break
      for (const [stream, entries] of more as [string, any[]][]) {
        for (const [id, fields] of entries as [string, string[]][]) {
          const parsed = parseEntry(fields)
          const requestId = parsed.requestId
          const text = parsed.text
          if (!requestId || text === undefined) {
            await redis.xack(stream, GROUP, id)
            continue
          }
          items.push({ stream, id, requestId, text })
          if (items.length >= maxBatch) break
        }
        if (items.length >= maxBatch) break
      }
    }

    // Group by target language (stream suffix).
    const byLang = new Map<SupportedLanguage, Item[]>()
    for (const it of items) {
      const lang = it.stream.split(':').pop() as SupportedLanguage
      const list = byLang.get(lang)
      if (list) list.push(it)
      else byLang.set(lang, [it])
    }

    for (const [targetLanguage, list] of byLang) {
      // Dedupe identical text within the window.
      const byText = new Map<string, Item[]>()
      for (const it of list) {
        const group = byText.get(it.text)
        if (group) group.push(it)
        else byText.set(it.text, [it])
      }

      const texts = [...byText.keys()]
      if (logBatches) {
        // eslint-disable-next-line no-console
        console.log(
          `global batch: lang=${targetLanguage} requests=${list.length} uniqueTexts=${texts.length} windowMs=${windowMs}`
        )
      }
      let translated: string[]
      try {
        translated = await provider.translateMany(texts, targetLanguage)
      } catch (err) {
        // Provider failure: do not ack; let pending retry via consumer recovery.
        // eslint-disable-next-line no-console
        console.error('global translation batcher provider error', err)
        continue
      }

      // Set responses + ack consumed items.
      for (let i = 0; i < texts.length; i++) {
        const text = texts[i]!
        const val = translated[i]
        if (val === undefined) continue
        const group = byText.get(text)
        if (!group) continue
        for (const it of group) {
          await redis.set(responseKey(it.requestId), val, 'EX', respTtl)
          await redis.xack(it.stream, GROUP, it.id)
        }
      }
    }

    const elapsed = Date.now() - batchStart
    if (elapsed > 1000) {
      // eslint-disable-next-line no-console
      console.warn(`global translation batcher slow loop: ${elapsed}ms`)
    }
  }
}

