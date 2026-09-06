import { afterEach, describe, expect, test } from 'bun:test'
import { SUPPORTED_MODELS } from '../constants.js'
import type { Effort } from '../plugin/config/schema.js'
import { budgetToEffort, THINKING_BUDGETS } from '../plugin/effort.js'
import { buildModelRegistry } from '../plugin/model-registry.js'
import { resetDiscoveredModels, resolveKiroModel } from '../plugin/models.js'

const registry = buildModelRegistry() as Record<string, any>

const thinkingIDs = Object.keys(registry).filter((id) => id.endsWith('-thinking'))
const XHIGH_MODELS = [
  'claude-opus-4-7-thinking',
  'claude-opus-4-8-thinking',
  'claude-opus-5-thinking',
  'claude-sonnet-5-thinking'
]

describe('model registry', () => {
  test('every advertised model is resolvable to a Kiro model ID', () => {
    for (const modelID of Object.keys(registry)) {
      expect(SUPPORTED_MODELS).toContain(modelID)
    }
  })

  test('advertises a thinking companion for each effort-capable Claude model', () => {
    expect(thinkingIDs.sort()).toEqual(
      [
        'claude-opus-4-5-thinking',
        'claude-opus-4-6-thinking',
        'claude-opus-4-7-thinking',
        'claude-opus-4-8-thinking',
        'claude-opus-5-thinking',
        'claude-sonnet-4-5-thinking',
        'claude-sonnet-4-6-thinking',
        'claude-sonnet-5-thinking'
      ].sort()
    )
  })

  test('advertises GPT-5.6 tiers with an effort ladder on the base model', () => {
    for (const id of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const) {
      expect(registry[id].name).toContain('GPT-5.6')
      expect(registry[id].limit).toEqual({ context: 272000, output: 64000 })
      expect(registry[`${id}-thinking`]).toBeUndefined()
      expect(Object.keys(registry[id].variants)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    }
    expect(registry['gpt-5.6-sol'].name).toBe('GPT-5.6 Sol (2.4x)')
    expect(registry['gpt-5.6-terra'].name).toBe('GPT-5.6 Terra (1.0x)')
    expect(registry['gpt-5.6-luna'].name).toBe('GPT-5.6 Luna (0.1x)')
  })

  describe('reasoning capability flags', () => {
    // Both are required: `reasoning` declares the capability, `interleaved.field`
    // tells OpenCode reasoning arrives as `reasoning_content` deltas. Missing
    // either one means reasoning chunks are silently dropped.
    test('every thinking model declares reasoning and the reasoning_content field', () => {
      for (const id of thinkingIDs) {
        expect(registry[id].reasoning).toBe(true)
        expect(registry[id].interleaved).toEqual({ field: 'reasoning_content' })
      }
    })

    test('non-thinking models declare neither', () => {
      for (const [id, model] of Object.entries(registry)) {
        if (id.endsWith('-thinking')) continue
        expect(model.reasoning).toBeUndefined()
        expect(model.interleaved).toBeUndefined()
      }
    })
  })

  describe('thinking variants', () => {
    test('offers xhigh only on models Kiro documents as xhigh-capable', () => {
      for (const id of thinkingIDs) {
        const hasXHigh = Object.keys(registry[id].variants).includes('xhigh')
        expect(hasXHigh).toBe(XHIGH_MODELS.includes(id))
      }
    })

    test('variant budgets map back to the effort level they are named for', () => {
      for (const id of thinkingIDs) {
        const kiroModel = resolveKiroModel(id)
        for (const [name, variant] of Object.entries<any>(registry[id].variants)) {
          const level = name as Effort
          const budget = variant.thinkingConfig.thinkingBudget
          expect(budget).toBe(THINKING_BUDGETS[level])
          expect(budgetToEffort(budget, kiroModel)).toBe(level)
        }
      }
    })

    test('variants are ordered low to max', () => {
      for (const id of thinkingIDs) {
        const budgets = Object.values<any>(registry[id].variants).map(
          (v) => v.thinkingConfig.thinkingBudget
        )
        expect(budgets).toEqual([...budgets].sort((a, b) => a - b))
      }
    })
  })

  test('carries limit and modalities through to both entries', () => {
    expect(registry['claude-opus-5'].limit).toEqual({ context: 1000000, output: 64000 })
    expect(registry['claude-opus-5-thinking'].limit).toEqual(registry['claude-opus-5'].limit)
    expect(registry['claude-opus-5-thinking'].modalities).toEqual(
      registry['claude-opus-5'].modalities
    )
  })

  describe('discovered catalog', () => {
    afterEach(() => {
      resetDiscoveredModels()
    })

    test('advertises only discovered IDs plus thinking companions', () => {
      const discovered = buildModelRegistry([
        { modelId: 'claude-sonnet-4.5', displayName: 'Claude Sonnet 4.5', maxInputTokens: 200000 },
        { modelId: 'glm-5' }
      ]) as Record<string, any>

      expect(Object.keys(discovered).sort()).toEqual(
        ['claude-sonnet-4-5', 'claude-sonnet-4-5-thinking', 'glm-5'].sort()
      )
      expect(discovered['claude-sonnet-4-5'].name).toBe('Claude Sonnet 4.5 (1.3x)')
      expect(discovered['claude-opus-5']).toBeUndefined()
    })

    test('advertises discovered GPT IDs and registers unknown Claude models with thinking', () => {
      const discovered = buildModelRegistry([
        { modelId: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol' },
        { modelId: 'claude-opus-5.1', displayName: 'Claude Opus 5.1', maxInputTokens: 1000000 }
      ]) as Record<string, any>

      expect(discovered['gpt-5.6-sol'].name).toBe('GPT-5.6 Sol (2.4x)')
      expect(discovered['gpt-5.6-sol-thinking']).toBeUndefined()
      expect(Object.keys(discovered['gpt-5.6-sol'].variants)).toEqual([
        'low',
        'medium',
        'high',
        'xhigh',
        'max'
      ])
      expect(discovered['claude-opus-5-1'].name).toBe('Claude Opus 5.1')
      expect(discovered['claude-opus-5-1-thinking']).toMatchObject({
        reasoning: true,
        interleaved: { field: 'reasoning_content' }
      })
      expect(Object.keys(discovered['claude-opus-5-1-thinking'].variants)).toContain('xhigh')
      expect(resolveKiroModel('claude-opus-5-1-thinking')).toBe('claude-opus-5.1')
    })

    test('prefers discovered context size while keeping known output limits', () => {
      const discovered = buildModelRegistry([
        { modelId: 'claude-opus-5', maxInputTokens: 500000, maxOutputTokens: 8192 }
      ]) as Record<string, any>
      expect(discovered['claude-opus-5'].limit).toEqual({ context: 500000, output: 64000 })
    })
  })
})
