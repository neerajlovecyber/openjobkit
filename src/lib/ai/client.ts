// AI Provider abstraction layer
// All AI providers implement this interface so they are fully swappable.

import { GeminiProvider } from './providers/gemini'
import { OpenAIProvider } from './providers/openai'

import type { AISettings } from '@/types/settings'

export interface AIResponse {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export interface AIClient {
  /** Generate a single text completion */
  complete(systemPrompt: string, userPrompt: string): Promise<AIResponse>
}

// ────────────────────────────────────────────────────────────────────────────
// Factory: create an AI client based on user settings
// ────────────────────────────────────────────────────────────────────────────

export function createAIClient(settings: AISettings): AIClient {
  switch (settings.provider) {
    case 'openai':
      return new OpenAIProvider(settings)
    case 'gemini':
      return new GeminiProvider(settings)
    case 'anthropic':
      throw new Error('Anthropic provider not yet implemented')
    case 'ollama':
      throw new Error('Ollama provider not yet implemented')
  }
}
