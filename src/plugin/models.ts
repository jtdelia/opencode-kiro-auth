import { MODEL_MAPPING, SUPPORTED_MODELS, isLongContextModel } from '../constants'

const discoveredMappings: Record<string, string> = {}
const discoveredContextWindows: Record<string, number> = {}

export function isGptKiroModel(modelId: string): boolean {
  return /^gpt-/i.test(modelId)
}

/**
 * Map a Kiro wire ID (`claude-sonnet-4.5`) to the OpenCode-facing slug
 * (`claude-sonnet-4-5`). Open-weight IDs keep their dots.
 */
export function openCodeIdForKiroModel(kiroId: string): string {
  let longContextId: string | undefined
  for (const [openCodeId, mapped] of Object.entries(MODEL_MAPPING)) {
    if (mapped !== kiroId || openCodeId.endsWith('-thinking')) continue
    if (!openCodeId.includes('-1m')) return openCodeId
    longContextId ??= openCodeId
  }
  if (longContextId) return longContextId
  if (kiroId.startsWith('claude-') && kiroId.includes('.')) {
    return kiroId.replace(/\./g, '-')
  }
  return kiroId
}

export function registerDiscoveredModel(
  openCodeId: string,
  kiroId: string,
  contextWindow?: number
): void {
  discoveredMappings[openCodeId] = kiroId
  if (contextWindow && contextWindow > 0) {
    discoveredContextWindows[openCodeId] = contextWindow
  }
}

export function resetDiscoveredModels(): void {
  for (const key of Object.keys(discoveredMappings)) delete discoveredMappings[key]
  for (const key of Object.keys(discoveredContextWindows)) delete discoveredContextWindows[key]
}

export function resolveKiroModel(model: string): string {
  const resolved = MODEL_MAPPING[model] ?? discoveredMappings[model]
  if (!resolved) {
    const known = [...SUPPORTED_MODELS, ...Object.keys(discoveredMappings)]
    throw new Error(`Unsupported model: ${model}. Supported models: ${known.join(', ')}`)
  }
  return resolved
}

export function getContextWindowSize(model: string): number {
  const discovered = discoveredContextWindows[model]
  if (discovered) return discovered
  return isLongContextModel(model) ? 1000000 : 200000
}
