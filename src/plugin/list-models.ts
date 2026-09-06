import { buildUrl, extractRegionFromArn, KIRO_CONSTANTS } from '../constants.js'
import type { KiroAuthDetails } from './types'

export interface DiscoveredKiroModel {
  modelId: string
  displayName?: string
  maxInputTokens?: number
  maxOutputTokens?: number
}

const LIST_MODELS_TIMEOUT_MS = 10000

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined
}

export function parseAvailableModels(data: unknown): DiscoveredKiroModel[] {
  if (!data || typeof data !== 'object') return []
  const models = (data as { models?: unknown }).models
  if (!Array.isArray(models)) return []

  const parsed: DiscoveredKiroModel[] = []
  for (const raw of models) {
    if (!raw || typeof raw !== 'object') continue
    const model = raw as {
      modelId?: unknown
      displayName?: unknown
      tokenLimits?: { maxInputTokens?: unknown; maxOutputTokens?: unknown }
    }
    if (typeof model.modelId !== 'string' || !model.modelId.trim()) continue
    parsed.push({
      modelId: model.modelId.trim(),
      displayName: typeof model.displayName === 'string' ? model.displayName : undefined,
      maxInputTokens: asPositiveInt(model.tokenLimits?.maxInputTokens),
      maxOutputTokens: asPositiveInt(model.tokenLimits?.maxOutputTokens)
    })
  }
  return parsed
}

/**
 * GET q.{region}.amazonaws.com/ListAvailableModels — the host that still
 * implements this API. runtime.kiro.dev does not.
 */
export async function fetchAvailableModels(auth: KiroAuthDetails): Promise<DiscoveredKiroModel[]> {
  const region = extractRegionFromArn(auth.profileArn) ?? auth.region
  const url = new URL(buildUrl(KIRO_CONSTANTS.LIST_MODELS_URL, region))
  url.searchParams.set('origin', KIRO_CONSTANTS.ORIGIN_AI_EDITOR)
  if (auth.profileArn) url.searchParams.set('profileArn', auth.profileArn)

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${auth.access}`,
      'Content-Type': 'application/json',
      'x-amzn-kiro-agent-mode': 'vibe',
      'amz-sdk-request': 'attempt=1; max=1'
    },
    signal: AbortSignal.timeout(LIST_MODELS_TIMEOUT_MS)
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`ListAvailableModels failed: HTTP ${res.status} ${body.slice(0, 200)}`.trim())
  }

  return parseAvailableModels(await res.json())
}
