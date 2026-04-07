import type Redis from 'ioredis'
import { prisma } from '../prisma'
import type { SupportedLanguage, TranslationProvider } from './provider'
import { publishTranslationLruInvalidation } from './redis-invalidate-sub'
import { sha256 } from './service'
import { detectSourceLanguage, isNonTranslatable } from './detect'
import { normalizeForProvider, normalizeForTranslationKey } from './normalize'

const REDIS_TTL_SEC = 60 * 60 * 24 * 30

function defaultSourceLanguageForKey(): SupportedLanguage {
  // App default language; used only when detection is unknown.
  return 'en'
}

function hashV2(input: { sourceText: string; sourceLanguageCode: SupportedLanguage; targetLanguageCode: SupportedLanguage }) {
  return sha256(`${input.sourceText}|${input.sourceLanguageCode}|${input.targetLanguageCode}`)
}

function cacheKeyV2(hash: string, sourceLanguageCode: SupportedLanguage, targetLanguageCode: SupportedLanguage) {
  return `translation:global:${sourceLanguageCode}:${targetLanguageCode}:${hash}`
}

function cacheKeyV2ForUser(userId: string, hash: string, sourceLanguageCode: SupportedLanguage, targetLanguageCode: SupportedLanguage) {
  return `translation:${userId}:${sourceLanguageCode}:${targetLanguageCode}:${hash}`
}

function translationDbPersistEnabled(): boolean {
  const v = process.env.TRANSLATION_DB_PERSIST
  if (v === undefined || v === '') return true
  return v !== 'false' && v !== '0'
}

function bulkChunkSize(): number {
  const v = Number(process.env.TRANSLATION_BULK_CHUNK ?? '100')
  if (!Number.isFinite(v)) return 100
  return Math.min(200, Math.max(1, Math.floor(v)))
}

function translationBulkDebounceMs(): number {
  const v = Number(process.env.TRANSLATION_DEBOUNCE_MS ?? '0')
  if (!Number.isFinite(v) || v < 0) return 0
  return Math.min(30_000, v)
}

export type TranslationCacheSource = 'memory' | 'redis' | 'db' | 'provider'

export type BulkItemResult = {
  index: number
  translated_text: string
  hash: string
  from_cache: boolean
  source: TranslationCacheSource
}

type LruLike = { get: (k: string) => string | undefined; set: (k: string, v: string) => void }

async function redisSetAndPublish(redis: Redis, key: string, value: string) {
  await redis.set(key, value, 'EX', REDIS_TTL_SEC)
  await publishTranslationLruInvalidation(redis, key)
}

/**
 * Translate many strings in one request: shared LRU/Redis/DB resolution, batched Redis GET,
 * batched DB lookup, provider.translateMany in chunks (queued + optional debounce).
 */
export async function translateBulkWithCache(params: {
  texts: string[]
  targetLanguage: SupportedLanguage
  provider: TranslationProvider
  redis: Redis | null
  lru: LruLike | null
  userId?: string | null
}): Promise<BulkItemResult[]> {
  const { texts, targetLanguage, provider, redis, lru, userId } = params
  const persistDb = translationDbPersistEnabled()
  const n = texts.length

  const effectiveUserId = userId && userId.trim().length > 0 ? userId : null

  type Row = {
    index: number
    text: string
    hash: string
    key: string
    translatedText: string | null
    fromCache: boolean
    source: TranslationCacheSource
  }

  const rows: Row[] = texts.map((text, index) => {
    const providerText = normalizeForProvider(text)
    const keyText = normalizeForTranslationKey(text)
    // Note: we initially compute hash/key after detection to include source+target.
    // For now, initialize placeholders; filled below.
    const hash = sha256(keyText)
    const key = effectiveUserId ? `translation:${effectiveUserId}:${targetLanguage}:${hash}` : `translation:${targetLanguage}:${hash}`
    return {
      index,
      text: providerText,
      hash,
      key,
      translatedText: null as string | null,
      fromCache: false,
      source: 'provider' as TranslationCacheSource,
    }
  })

  // Fast-path skips (non-translatable, or already in target language) + v2 keying.
  const srcByIndex = new Map<number, SupportedLanguage>()
  for (const r of rows) {
    if (isNonTranslatable(r.text)) {
      r.translatedText = r.text
      r.fromCache = true
      r.source = 'memory'
      continue
    }
    const detected = detectSourceLanguage(r.text)
    const detectedSource = detected.reliable ? detected.sourceLanguageCode : null
    const src = detectedSource ?? defaultSourceLanguageForKey()
    srcByIndex.set(r.index, src)
    const keyText = normalizeForTranslationKey(r.text)
    r.hash = hashV2({ sourceText: keyText, sourceLanguageCode: src, targetLanguageCode: targetLanguage })
    r.key = effectiveUserId ? cacheKeyV2ForUser(effectiveUserId, r.hash, src, targetLanguage) : cacheKeyV2(r.hash, src, targetLanguage)
    if (detectedSource !== null && src === targetLanguage) {
      r.translatedText = r.text
      r.fromCache = true
      r.source = 'memory'
    }
  }

  for (const r of rows) {
    if (lru) {
      const hit = lru.get(r.key)
      if (hit !== undefined) {
        r.translatedText = hit
        r.fromCache = true
        r.source = 'memory'
      }
    }
  }

  const needRedis = rows.filter((r) => r.translatedText === null)
  if (redis && needRedis.length > 0) {
    const keys = needRedis.map((r) => r.key)
    const values = await redis.mget(...keys)
    for (let i = 0; i < needRedis.length; i++) {
      const row = needRedis[i]!
      const v = values[i]
      if (v) {
        row.translatedText = v
        row.fromCache = true
        row.source = 'redis'
        lru?.set(row.key, v)
      }
    }
  }

  const needDb = rows.filter((r) => r.translatedText === null)
  if (persistDb && needDb.length > 0) {
    const found = await prisma.translation.findMany({
      where: {
        OR: needDb.map((r) => {
          const src = srcByIndex.get(r.index) ?? targetLanguage
          return {
            userId: effectiveUserId ? effectiveUserId : 'global',
            hash: r.hash,
            sourceLanguageCode: src,
            targetLanguageCode: targetLanguage,
          }
        }),
      },
    })
    const byHash = new Map(found.map((t) => [t.hash, t.translatedText]))
    for (const r of needDb) {
      const t = byHash.get(r.hash)
      if (t) {
        r.translatedText = t
        r.fromCache = true
        r.source = 'db'
        lru?.set(r.key, t)
        if (redis) {
          await redisSetAndPublish(redis, r.key, t)
        }
      }
    }
  }

  const needProvider = rows.filter((r) => r.translatedText === null)
  if (needProvider.length > 0) {
    const rowsByHash = new Map<string, Row[]>()
    for (const r of needProvider) {
      const list = rowsByHash.get(r.hash)
      if (list) list.push(r)
      else rowsByHash.set(r.hash, [r])
    }
    const canonical = [...rowsByHash.values()].map((list) => list[0]!)
    const chunkSize = bulkChunkSize()

    const debounce = translationBulkDebounceMs()
    if (debounce > 0) {
      await new Promise((res) => setTimeout(res, debounce))
    }
    for (let off = 0; off < canonical.length; off += chunkSize) {
      const chunk = canonical.slice(off, off + chunkSize)
      const textsChunk = chunk.map((r) => r.text)
      const translated = await provider.translateMany(textsChunk, targetLanguage)
      for (let i = 0; i < chunk.length; i++) {
        const row = chunk[i]!
        const val = translated[i]
        if (val === undefined) {
          throw new Error(`translateMany: missing segment ${i} of ${chunk.length}`)
        }
        const group = rowsByHash.get(row.hash)
        if (!group) continue
        for (const r of group) {
          r.translatedText = val
          r.fromCache = false
          r.source = 'provider'
        }
      }
    }

    if (persistDb) {
      await prisma.translation.createMany({
        data: needProvider.map((r) => ({
          userId: effectiveUserId ? effectiveUserId : 'global',
          sourceText: normalizeForTranslationKey(r.text),
          sourceLanguageCode: srcByIndex.get(r.index) ?? targetLanguage,
          targetLanguageCode: targetLanguage,
          translatedText: r.translatedText!,
          hash: r.hash,
        })),
        skipDuplicates: true,
      })
    }

    for (const r of needProvider) {
      const t = r.translatedText!
      lru?.set(r.key, t)
      if (redis) {
        await redisSetAndPublish(redis, r.key, t)
      }
    }
  }

  return rows.map((r) => ({
    index: r.index,
    translated_text: r.translatedText!,
    hash: r.hash,
    from_cache: r.fromCache,
    source: r.source,
  }))
}
