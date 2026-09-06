import { afterEach, describe, expect, test } from 'bun:test'
import { SUPPORTED_MODELS } from '../constants.js'
import {
  getContextWindowSize,
  openCodeIdForKiroModel,
  registerDiscoveredModel,
  resetDiscoveredModels,
  resolveKiroModel
} from '../plugin/models.js'

describe('resolveKiroModel', () => {
  test('resolves newly advertised model slugs', () => {
    expect(resolveKiroModel('auto')).toBe('auto')
    expect(resolveKiroModel('deepseek-3.2')).toBe('deepseek-3.2')
    expect(resolveKiroModel('minimax-m2.5')).toBe('minimax-m2.5')
    expect(resolveKiroModel('minimax-m2.1')).toBe('minimax-m2.1')
    expect(resolveKiroModel('qwen3-coder-next')).toBe('qwen3-coder-next')
  })

  test('keeps existing supported Claude slugs intact', () => {
    expect(resolveKiroModel('claude-sonnet-4-5')).toBe('claude-sonnet-4.5')
    expect(resolveKiroModel('claude-sonnet-4')).toBe('claude-sonnet-4')
    expect(resolveKiroModel('claude-opus-4-8')).toBe('claude-opus-4.8')
    expect(resolveKiroModel('claude-opus-4-8-thinking')).toBe('claude-opus-4.8')
  })

  test('resolves claude-sonnet-5 slugs', () => {
    expect(resolveKiroModel('claude-sonnet-5')).toBe('claude-sonnet-5')
    expect(resolveKiroModel('claude-sonnet-5-thinking')).toBe('claude-sonnet-5')
    expect(resolveKiroModel('claude-sonnet-5-1m')).toBe('claude-sonnet-5-1m')
    expect(resolveKiroModel('claude-sonnet-5-1m-thinking')).toBe('claude-sonnet-5-1m')
  })

  test('rejects removed qwen3-coder-480b slug', () => {
    expect(() => resolveKiroModel('qwen3-coder-480b')).toThrow(
      'Unsupported model: qwen3-coder-480b'
    )
  })

  test('supported model list excludes removed qwen3-coder-480b slug', () => {
    expect(SUPPORTED_MODELS).not.toContain('qwen3-coder-480b')
  })

  test('rejects unknown slugs', () => {
    expect(() => resolveKiroModel('this-model-does-not-exist')).toThrow(
      'Unsupported model: this-model-does-not-exist'
    )
  })

  test('maps Kiro wire IDs onto OpenCode slugs', () => {
    expect(openCodeIdForKiroModel('claude-sonnet-4.5')).toBe('claude-sonnet-4-5')
    expect(openCodeIdForKiroModel('claude-sonnet-4.5-1m')).toBe('claude-sonnet-4-5-1m')
    expect(openCodeIdForKiroModel('deepseek-3.2')).toBe('deepseek-3.2')
    expect(openCodeIdForKiroModel('claude-opus-5.1')).toBe('claude-opus-5-1')
  })

  describe('discovered mappings', () => {
    afterEach(() => {
      resetDiscoveredModels()
    })

    test('resolves and sizes newly registered models', () => {
      registerDiscoveredModel('claude-opus-5-1', 'claude-opus-5.1', 1000000)
      registerDiscoveredModel('claude-opus-5-1-thinking', 'claude-opus-5.1', 1000000)
      expect(resolveKiroModel('claude-opus-5-1')).toBe('claude-opus-5.1')
      expect(resolveKiroModel('claude-opus-5-1-thinking')).toBe('claude-opus-5.1')
      expect(getContextWindowSize('claude-opus-5-1')).toBe(1000000)
    })
  })
})
