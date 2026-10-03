import type { Effort } from './config/schema'

/**
 * Effort levels ordered from lowest to highest reasoning depth.
 */
export const EFFORT_LEVELS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * Reference thinking budget for each effort level.
 *
 * Scaled to Kiro's real thinking range (1024–128000 on opus-4.8/opus-5) rather
 * than OpenCode's conventional 32768 cap, so every effort level is reachable
 * from a budget alone. These double as the upper bound of each mapping band in
 * budgetToEffort, and as the variant budgets the plugin advertises, so the two
 * cannot drift apart.
 */
export const THINKING_BUDGETS: Readonly<Record<Effort, number>> = {
  low: 16384,
  medium: 32768,
  high: 65536,
  xhigh: 98304,
  max: 128000
}

/**
 * Models that support the 5-value effort enum (including xhigh).
 * Per Kiro's effort docs, this is opus-4.7/4.8/5/5.5 and sonnet-5/5.5.
 */
const XHIGH_CAPABLE_MODELS = new Set([
  'claude-opus-4.7',
  'claude-opus-4.8',
  'claude-opus-5',
  'claude-opus-5.5',
  'claude-sonnet-5',
  'claude-sonnet-5-1m',
  'claude-sonnet-5.5'
])

/**
 * Models that support the 4-value effort enum (no xhigh).
 * xhigh requests on these models are clamped to max.
 */
const EFFORT_CAPABLE_MODELS = new Set([
  'claude-opus-4.5',
  'claude-opus-4.6',
  'claude-opus-4.6-1m',
  'claude-sonnet-4.5',
  'claude-sonnet-4.5-1m',
  'claude-sonnet-4.6',
  'claude-sonnet-4.6-1m',
  ...XHIGH_CAPABLE_MODELS
])

interface ClaudeVersion {
  family: 'opus' | 'sonnet' | 'haiku'
  major: number
  minor: number
}

function parseClaudeKiroId(kiroModel: string): ClaudeVersion | null {
  const match = kiroModel.match(/^claude-(opus|sonnet|haiku)-(\d+)(?:\.(\d+))?(?:-1m)?$/)
  if (!match) return null
  return {
    family: match[1] as ClaudeVersion['family'],
    major: Number(match[2]),
    minor: Number(match[3] ?? 0)
  }
}

/**
 * Future Claude IDs returned by ListAvailableModels are not in the static sets
 * yet. Infer from family + version so discovery can advertise thinking without
 * a plugin bump. Matches the current catalog: opus/sonnet 4.5+, not haiku or
 * plain sonnet-4.
 */
function inferEffortSupport(kiroModel: string): { effort: boolean; xhigh: boolean } {
  const parsed = parseClaudeKiroId(kiroModel)
  if (!parsed || parsed.family === 'haiku') return { effort: false, xhigh: false }

  const effort = parsed.major > 4 || (parsed.major === 4 && parsed.minor >= 5)
  const xhigh =
    parsed.family === 'opus'
      ? parsed.major > 4 || (parsed.major === 4 && parsed.minor >= 7)
      : parsed.major >= 5

  return { effort, xhigh }
}

/**
 * Check if a model supports the effort parameter.
 */
export function supportsEffort(kiroModel: string): boolean {
  if (usesReasoningEffort(kiroModel)) return true
  if (EFFORT_CAPABLE_MODELS.has(kiroModel)) return true
  return inferEffortSupport(kiroModel).effort
}

/**
 * Check if a model supports xhigh effort level.
 */
export function supportsXHighEffort(kiroModel: string): boolean {
  if (usesReasoningEffort(kiroModel)) return true
  if (XHIGH_CAPABLE_MODELS.has(kiroModel)) return true
  return inferEffortSupport(kiroModel).xhigh
}

/**
 * Resolve effort level for a given model.
 * - Returns undefined if model doesn't support effort
 * - Clamps xhigh to max for models that don't support it
 */
export function resolveEffort(kiroModel: string, requested: Effort): Effort | undefined {
  if (!supportsEffort(kiroModel)) {
    return undefined
  }

  // xhigh is only supported on the models in XHIGH_CAPABLE_MODELS
  if (requested === 'xhigh' && !supportsXHighEffort(kiroModel)) {
    return 'max'
  }

  return requested
}

/**
 * Map OpenCode thinking budget to Kiro effort level.
 *
 * Budget bands are scaled to Kiro's real thinking ceiling (1024–128000 for
 * opus-4.8/opus-5), not OpenCode's conventional 32768 cap, so the full effort
 * enum is reachable. Reference budgets:
 * - low:    16384
 * - medium: 32768
 * - high:   65536
 * - xhigh:  98304
 * - max:    128000
 *
 * Each THINKING_BUDGETS value is the inclusive upper bound of its band, so a
 * variant configured with a reference budget maps back to the same level:
 * - ≤16384  → low
 * - ≤32768  → medium
 * - ≤65536  → high
 * - ≤98304  → xhigh (clamped to max on models without xhigh support)
 * - >98304  → max
 */
export function budgetToEffort(budget: number, kiroModel: string): Effort | undefined {
  if (!supportsEffort(kiroModel)) {
    return undefined
  }

  // EFFORT_LEVELS is ordered low→max, so the first band the budget fits wins.
  const effort =
    EFFORT_LEVELS.find((level) => budget <= THINKING_BUDGETS[level]) ??
    EFFORT_LEVELS[EFFORT_LEVELS.length - 1]!

  return resolveEffort(kiroModel, effort)
}

/**
 * GPT-5.6 models send effort as `reasoning.effort`. Claude uses
 * `output_config.effort`.
 */
export function usesReasoningEffort(kiroModel: string): boolean {
  return /^gpt-5\.6(?:-|$)/.test(kiroModel)
}

export function additionalModelRequestFields(
  kiroModel: string,
  effort?: Effort
): Record<string, unknown> | undefined {
  if (!effort) return undefined
  return usesReasoningEffort(kiroModel) ? { reasoning: { effort } } : { output_config: { effort } }
}

/**
 * Get the effective effort level based on config and model.
 *
 * Priority:
 * 1. Explicit effort config (if set) - always applied regardless of thinking state
 * 2. Budget-to-effort mapping (if auto_effort_mapping enabled and thinking)
 * 3. 'medium' default (if thinking enabled)
 * 4. undefined (if not thinking)
 *
 * GPT-5.6 uses the same budget bands; the wire field is `reasoning.effort`.
 */
export function getEffectiveEffort(
  kiroModel: string,
  thinking: boolean,
  budget: number,
  configEffort?: Effort,
  autoEffortMapping = true
): Effort | undefined {
  if (!supportsEffort(kiroModel)) {
    return undefined
  }

  // Explicit config takes precedence - always applied even without thinking
  if (configEffort) {
    return resolveEffort(kiroModel, configEffort)
  }

  // If not thinking, no effort needed
  if (!thinking) {
    return undefined
  }

  // Auto-map budget to effort
  if (autoEffortMapping) {
    return budgetToEffort(budget, kiroModel)
  }

  // Default to medium when thinking without auto-mapping
  return 'medium'
}
