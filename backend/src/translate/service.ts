import crypto from 'node:crypto'
import { LRUCache } from 'lru-cache'
import type Redis from 'ioredis'
import { prisma } from '../prisma'
import type { SupportedLanguage, TranslationProvider } from './provider'
import { publishTranslationLruInvalidation } from './redis-invalidate-sub'
import { detectSourceLanguage, isNonTranslatable } from './detect'
import {
  batchingWaitTimeoutMs,
  enqueueGlobalBatchRequest,
  globalBatchingEnabled,
  waitForGlobalBatchResponse,
} from './global-batcher'

function defaultSourceLanguageForKey(): SupportedLanguage {
  // App default language; used only when detection is unknown.
  return 'en'
}

export function sha256(text: string) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

function hashV2(input: { sourceText: string; sourceLanguageCode: SupportedLanguage; targetLanguageCode: SupportedLanguage }) {
  return sha256(`${input.sourceText}|${input.sourceLanguageCode}|${input.targetLanguageCode}`)
}

function cacheKeyV2(hash: string, sourceLanguageCode: SupportedLanguage, targetLanguageCode: SupportedLanguage) {
  return `translation:${sourceLanguageCode}:${targetLanguageCode}:${hash}`
}

function translationDbPersistEnabled(): boolean {
  const v = process.env.TRANSLATION_DB_PERSIST
  if (v === undefined || v === '') return true
  return v !== 'false' && v !== '0'
}

let memoryLru: LRUCache<string, string> | null | undefined

function getMemoryLru(): LRUCache<string, string> | null {
  if (memoryLru !== undefined) return memoryLru
  const raw = process.env.TRANSLATION_LRU_MAX
  const max = raw === undefined || raw === '' ? 5000 : Number(raw)
  memoryLru = Number.isFinite(max) && max > 0 ? new LRUCache<string, string>({ max }) : null
  return memoryLru
}

/** For bulk translate: same LRU instance as single-item path. */
export function getTranslationLru(): LRUCache<string, string> | null {
  return getMemoryLru()
}

/** Drop one entry from the process LRU (used by Redis Pub/Sub invalidation). */
export function evictTranslationLruKey(key: string) {
  getMemoryLru()?.delete(key)
}

async function setTranslationRedisAndBroadcast(redis: Redis, key: string, value: string, ttlSec: number) {
  await redis.set(key, value, 'EX', ttlSec)
  await publishTranslationLruInvalidation(redis, key)
}

export type TranslationCacheSource = 'memory' | 'redis' | 'db' | 'provider' | 'skip'

export async function translateWithCache(params: {
  text: string
  targetLanguage: SupportedLanguage
  provider: TranslationProvider
  redis: Redis | null
  userId?: string | null
}) {
  const { text, targetLanguage, provider, redis, userId } = params
  const normalizedText = text.trim()

  if (isNonTranslatable(normalizedText)) {
    const hash = sha256(normalizedText)
    return { translatedText: normalizedText, hash, fromCache: true as const, source: 'skip' as const }
  }

  const detected = detectSourceLanguage(normalizedText)
  const detectedSource = detected.sourceLanguageCode
  const sourceLanguageCode = detectedSource ?? defaultSourceLanguageForKey()

  // Only skip when we are confident the source language equals the target.
  // If detection is unknown/null, do not skip (otherwise we'd fail to translate short English strings like "Goood").
  if (detectedSource !== null && sourceLanguageCode === targetLanguage) {
    const hash = sha256(normalizedText)
    return { translatedText: normalizedText, hash, fromCache: true as const, source: 'skip' as const }
  }

  const hash = hashV2({ sourceText: normalizedText, sourceLanguageCode, targetLanguageCode: targetLanguage })
  const key = cacheKeyV2(hash, sourceLanguageCode, targetLanguage)
  const persistDb = translationDbPersistEnabled()

  const lru = getMemoryLru()
  if (lru) {
    const hit = lru.get(key)
    if (hit !== undefined) {
      return { translatedText: hit, hash, fromCache: true as const, source: 'memory' as const }
    }
  }

  if (redis) {
    const cached = await redis.get(key)
    if (cached) {
      lru?.set(key, cached)
      return { translatedText: cached, hash, fromCache: true as const, source: 'redis' as const }
    }
  }

  if (persistDb) {
    const existing = await prisma.translation.findUnique({
      where: {
        hash_sourceLanguageCode_targetLanguageCode: {
          hash,
          sourceLanguageCode,
          targetLanguageCode: targetLanguage,
        },
      },
    })
    if (existing) {
      lru?.set(key, existing.translatedText)
      if (redis) {
        await setTranslationRedisAndBroadcast(redis, key, existing.translatedText, 60 * 60 * 24 * 30)
      }
      return {
        translatedText: existing.translatedText,
        hash,
        fromCache: true as const,
        source: 'db' as const,
      }
    }
  }

  // If Redis is available, try to batch provider calls across requests/processes.
  // Fallback to direct provider call on timeout or any Redis issues.
  const translatedText =
    redis && globalBatchingEnabled()
      ? await (async () => {
          try {
            const req = await enqueueGlobalBatchRequest(redis, { text: normalizedText, targetLanguage })
            const v = await waitForGlobalBatchResponse(redis, req.requestId, batchingWaitTimeoutMs())
            if (v !== null) return v
          } catch {
            // ignore and fall back
          }
          return await provider.translate({ text: normalizedText, targetLanguage })
        })()
      : await provider.translate({ text: normalizedText, targetLanguage })

  if (persistDb) {
    await prisma.translation.create({
      data: {
        sourceText: normalizedText,
        sourceLanguageCode,
        targetLanguageCode: targetLanguage,
        translatedText,
        hash,
      },
    })

    if (userId) {
      await prisma.translationRef.create({
        data: {
          userId,
          hash,
          sourceLanguageCode,
          targetLanguageCode: targetLanguage,
        },
      }).catch(() => {
        // ignore duplicates/races
      })
    }
  }

  lru?.set(key, translatedText)
  if (redis) {
    await setTranslationRedisAndBroadcast(redis, key, translatedText, 60 * 60 * 24 * 30)
  }

  return { translatedText, hash, fromCache: false as const, source: 'provider' as const }
}
