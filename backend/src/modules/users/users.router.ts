import { Router } from 'express'
import { z } from 'zod'
import type Redis from 'ioredis'
import type { TranslationProvider, SupportedLanguage } from '../translate/translate.provider'
import { runTranslateBulk } from '../translate/translate.bullmq'
import { getTranslationLru, sha256 } from '../translate/translate.service'
import { prisma } from '../../infra/prisma/client'
import { detectSourceLanguage, isNonTranslatable } from '../../translate/detect'
import { publishTranslationLruInvalidation } from '../../translate/redis-invalidate-sub'
import { normalizeForTranslationKey } from '../../translate/normalize'

function translationKeyForUser(userId: string, sourceLanguageCode: SupportedLanguage, targetLanguageCode: SupportedLanguage, hash: string) {
  return `translation:${userId}:${sourceLanguageCode}:${targetLanguageCode}:${hash}`
}

const upsertSchema = z.object({
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

const updateLanguageSchema = z.object({
  languageCode: z.enum(['en', 'fr', 'gr']),
})

export function createUsersRouter(params: { redis: Redis | null; provider: TranslationProvider }) {
  const router = Router()

  function getTranslatableUserFields(): string[] {
    const raw = process.env.TRANSLATABLE_USER_FIELDS
    if (!raw || raw.trim().length === 0) return ['address', 'notes']
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  async function translateUserFieldsForResponse<T extends Record<string, unknown>>(input: {
    user: T
    preferredLanguage: SupportedLanguage | null
  }): Promise<T | (T & { localized: { translatedObject: Record<string, string>; language: SupportedLanguage } })> {
    const { user, preferredLanguage } = input
    if (!preferredLanguage) return user

    const whitelist = getTranslatableUserFields()
    const toTranslate: Array<{ field: string; value: string; index: number }> = []

    for (let i = 0; i < whitelist.length; i++) {
      const field = whitelist[i]!
      const v = (user as any)[field]
      if (typeof v === 'string' && v.trim().length > 0) {
        toTranslate.push({ field, value: v, index: i })
      }
    }

    if (toTranslate.length === 0) return user

    const results = await runTranslateBulk({
      texts: toTranslate.map((f) => f.value),
      targetLanguage: preferredLanguage,
      provider: params.provider,
      redis: params.redis,
      lru: getTranslationLru(),
      userId: (user as any).userId ?? null,
    })

    const translatedByField = new Map<string, string>()
    let anyChanged = false
    for (const r of results) {
      const original = toTranslate[r.index]
      if (!original) continue
      translatedByField.set(original.field, r.translated_text)
      if (r.translated_text !== original.value) anyChanged = true
    }

    const translatedObject: Record<string, string> = {}
    for (const [field, translated] of translatedByField) {
      translatedObject[field] = translated
    }

    // If translation produced no changes (e.g. the text was already in the preferred language),
    // don't attach `localized` so the frontend won't show the "show translated" toggle.
    if (!anyChanged) return user

    return {
      ...(user as any),
      localized: {
        language: preferredLanguage,
        translatedObject,
      },
    }
  }

  router.get('/', async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { userId: 'asc' },
      include: { language: true },
    })
    return res.json(users)
  })

  router.get('/:userId', async (req, res) => {
    const userId = req.params.userId
    const user = await prisma.user.findUnique({
      where: { userId },
      include: { language: true },
    })
    if (!user) return res.status(404).json({ error: 'Not found' })
    const preferred = (user.language?.code ?? null) as SupportedLanguage | null
    const translated = await translateUserFieldsForResponse({ user, preferredLanguage: preferred })
    return res.json(translated)
  })

  router.put('/:userId/language', async (req, res) => {
    const userId = req.params.userId
    const parsed = updateLanguageSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() })
    }

    const language = await prisma.language.findUnique({
      where: { code: parsed.data.languageCode },
    })
    if (!language) return res.status(404).json({ error: 'Language not found' })

    const existing = await prisma.user.findUnique({ where: { userId } })
    if (!existing) return res.status(404).json({ error: 'Not found' })

    const user = await prisma.user.update({
      where: { userId },
      data: {
        languageId: language.id,
      },
      include: { language: true },
    })

    const preferred = (user.language?.code ?? parsed.data.languageCode) as SupportedLanguage
    const translated = await translateUserFieldsForResponse({ user, preferredLanguage: preferred })
    return res.json(translated)
  })

  router.put('/:userId', async (req, res) => {
    const userId = req.params.userId
    if (!userId) return res.status(400).json({ error: 'userId is required' })

    const parsed = upsertSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() })
    }

    let { address, notes } = parsed.data

    // Language priority: store user-entered fields in the user's preferred language when possible.
    // If a field is reliably detected as a different language, translate it into the preferred language before persisting.
    const existing = await prisma.user.findUnique({
      where: { userId },
      include: { language: true },
    })
    const preferredLanguage = (existing?.language?.code ?? 'en') as SupportedLanguage
    const oldAddress = existing?.address ?? null
    const oldNotes = existing?.notes ?? null

    const toNormalizeToPreferred: Array<{ field: 'address' | 'notes'; value: string; index: number }> = []
    if (typeof address === 'string' && address.trim().length > 0 && !isNonTranslatable(address)) {
      const d = detectSourceLanguage(address)
      if (d.sourceLanguageCode && d.sourceLanguageCode !== preferredLanguage) {
        toNormalizeToPreferred.push({ field: 'address', value: address, index: 0 })
      }
    }
    if (typeof notes === 'string' && notes.trim().length > 0 && !isNonTranslatable(notes)) {
      const d = detectSourceLanguage(notes)
      if (d.sourceLanguageCode && d.sourceLanguageCode !== preferredLanguage) {
        toNormalizeToPreferred.push({ field: 'notes', value: notes, index: 1 })
      }
    }

    if (toNormalizeToPreferred.length > 0) {
      const results = await runTranslateBulk({
        texts: toNormalizeToPreferred.map((x) => x.value),
        targetLanguage: preferredLanguage,
        provider: params.provider,
        redis: params.redis,
        lru: getTranslationLru(),
        userId,
      })
      for (const r of results) {
        const original = toNormalizeToPreferred[r.index]
        if (!original) continue
        if (original.field === 'address') address = r.translated_text
        if (original.field === 'notes') notes = r.translated_text
      }
    }

    const user = await prisma.user.upsert({
      where: { userId },
      create: {
        userId,
        address: address ?? null,
        notes: notes ?? null,
      },
      update: {
        address: address ?? null,
        notes: notes ?? null,
      },
      include: { language: true },
    })

    // Cleanup: remove translation rows (and Redis keys) related to the previous stored text.
    // This is a demo app; we delete aggressively when user text changes.
    if (existing) {
      const cleanupFields: Array<{ oldText: string; newText: string | null }> = []
      if (typeof oldAddress === 'string' && oldAddress.trim().length > 0 && oldAddress !== user.address) {
        cleanupFields.push({ oldText: oldAddress, newText: user.address ?? null })
      }
      if (typeof oldNotes === 'string' && oldNotes.trim().length > 0 && oldNotes !== user.notes) {
        cleanupFields.push({ oldText: oldNotes, newText: user.notes ?? null })
      }

      for (const f of cleanupFields) {
        const oldKeyText = normalizeForTranslationKey(f.oldText)
        const rows = (await prisma.$queryRaw<
          Array<{ id: bigint; hash: string; sourceLanguageCode: string; targetLanguageCode: string }>
        >`SELECT id, hash, "sourceLanguageCode", "targetLanguageCode"
          FROM translations
          WHERE "userId" = ${userId} AND "sourceText" = ${oldKeyText}`) as Array<{
          id: bigint
          hash: string
          sourceLanguageCode: string
          targetLanguageCode: string
        }>

        if (params.redis) {
          for (const r of rows) {
            const key = translationKeyForUser(
              userId,
              r.sourceLanguageCode as SupportedLanguage,
              r.targetLanguageCode as SupportedLanguage,
              r.hash
            )
            await params.redis.del(key)
            await publishTranslationLruInvalidation(params.redis, key)
          }
        }

        const ids = rows.map((r) => r.id)
        if (ids.length > 0) {
          await prisma.translation.deleteMany({ where: { id: { in: ids as any } } })
        }
      }
    }

    const preferred = (user.language?.code ?? null) as SupportedLanguage | null
    const translated = await translateUserFieldsForResponse({ user, preferredLanguage: preferred })
    return res.json(translated)
  })

  return router
}

