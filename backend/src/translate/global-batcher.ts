import crypto from 'node:crypto'
import type Redis from 'ioredis'
import type { SupportedLanguage } from './provider'

export type GlobalBatchRequest = {
  requestId: string
  text: string
  targetLanguage: SupportedLanguage
  createdAtMs: number
}

export function globalBatchingEnabled(): boolean {
  return process.env.TRANSLATION_GLOBAL_BATCHING !== 'false'
}

export function batchingWindowMs(): number {
  const v = Number(process.env.TRANSLATION_GLOBAL_BATCH_WINDOW_MS ?? '10')
  if (!Number.isFinite(v) || v <= 0) return 10
  return Math.min(50, Math.max(1, Math.floor(v)))
}

export function batchingMaxBatchSize(): number {
  const v = Number(process.env.TRANSLATION_GLOBAL_BATCH_MAX ?? '200')
  if (!Number.isFinite(v) || v <= 0) return 200
  return Math.min(500, Math.max(1, Math.floor(v)))
}

export function batchingResponseTtlSec(): number {
  const v = Number(process.env.TRANSLATION_GLOBAL_BATCH_RESP_TTL_SEC ?? '120')
  if (!Number.isFinite(v) || v <= 0) return 120
  return Math.min(3600, Math.max(5, Math.floor(v)))
}

export function batchingWaitTimeoutMs(): number {
  const v = Number(process.env.TRANSLATION_GLOBAL_BATCH_WAIT_TIMEOUT_MS ?? '1500')
  if (!Number.isFinite(v) || v <= 0) return 1500
  return Math.min(10_000, Math.max(50, Math.floor(v)))
}

export function requestStreamKey(targetLanguage: SupportedLanguage) {
  return `itl:translation:req:${targetLanguage}`
}

export function responseKey(requestId: string) {
  return `itl:translation:resp:${requestId}`
}

export function newRequestId() {
  // crypto.randomUUID is available in modern Node; keep a fallback just in case.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return (crypto as any).randomUUID ? (crypto as any).randomUUID() : crypto.randomBytes(16).toString('hex')
}

export async function enqueueGlobalBatchRequest(
  redis: Redis,
  input: { text: string; targetLanguage: SupportedLanguage }
): Promise<GlobalBatchRequest> {
  const req: GlobalBatchRequest = {
    requestId: newRequestId(),
    text: input.text,
    targetLanguage: input.targetLanguage,
    createdAtMs: Date.now(),
  }
  const stream = requestStreamKey(req.targetLanguage)
  await redis.xadd(stream, '*', 'requestId', req.requestId, 'text', req.text, 'createdAtMs', String(req.createdAtMs))
  return req
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms))
}

export async function waitForGlobalBatchResponse(redis: Redis, reqId: string, timeoutMs: number): Promise<string | null> {
  const key = responseKey(reqId)
  const start = Date.now()
  let delay = 5
  while (Date.now() - start < timeoutMs) {
    const v = await redis.get(key)
    if (v !== null) return v
    await sleep(delay)
    delay = Math.min(50, Math.floor(delay * 1.5))
  }
  return null
}

