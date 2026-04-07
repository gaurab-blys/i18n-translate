import Redis from 'ioredis'

/** Other services can `PUBLISH` this channel with the translation cache key as the message body. */
export const TRANSLATION_INVALIDATE_CHANNEL = 'translation:invalidate'

type EvictFn = (key: string) => void

let evictFn: EvictFn | null = null
let subscriber: Redis | null = null

export function registerTranslationLruEvict(fn: EvictFn) {
  evictFn = fn
}

export function startTranslationInvalidationSubscriber(redisUrl: string) {
  if (subscriber) return
  subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null })
  subscriber.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('translation invalidate subscriber:', err)
  })
  void subscriber.subscribe(TRANSLATION_INVALIDATE_CHANNEL, (err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error('translation invalidate subscribe failed:', err)
    }
  })
  subscriber.on('message', (channel, message: string | Buffer) => {
    if (channel !== TRANSLATION_INVALIDATE_CHANNEL || !evictFn) return
    const key = Buffer.isBuffer(message) ? message.toString('utf8') : message
    evictFn(key)
  })
}

export async function publishTranslationLruInvalidation(redis: Redis, key: string) {
  await redis.publish(TRANSLATION_INVALIDATE_CHANNEL, key)
}
