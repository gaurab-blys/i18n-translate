import Redis from 'ioredis'

export function createRedis() {
  const url = process.env.REDIS_URL
  if (!url) return null
  const client = new Redis(url, { maxRetriesPerRequest: 2 })
  // Prevent Node from crashing on connection issues when Redis is optional.
  client.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.warn('redis error', err?.message ?? err)
  })
  return client
}

