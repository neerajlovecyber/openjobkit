// Gemini provider implementation

import type { AIClient, AIResponse } from '../client'
import type { AISettings } from '@/types/settings'

export class GeminiProvider implements AIClient {
  private apiKey: string
  private model: string
  private temperature: number
  private maxTokens: number

  constructor(settings: AISettings) {
    this.apiKey = settings.apiKey
    this.model = settings.model || 'gemini-1.5-flash'
    this.temperature = settings.temperature ?? 0.3
    this.maxTokens = settings.maxTokens ?? 2000
  }

  async complete(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<AIResponse> {
    if (!this.apiKey) {
      throw new Error(
        'Gemini API key is not configured. Please add your API key in Settings.',
      )
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: this.temperature,
          maxOutputTokens: this.maxTokens,
        },
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Gemini API error ${response.status}: ${errorBody}`)
    }

    const data = (await response.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>
      usageMetadata?: {
        promptTokenCount: number
        candidatesTokenCount: number
        totalTokenCount: number
      }
    }

    const content = data.candidates[0]?.content?.parts?.[0]?.text ?? ''

    return {
      content,
      usage: data.usageMetadata
        ? {
            promptTokens: data.usageMetadata.promptTokenCount,
            completionTokens: data.usageMetadata.candidatesTokenCount,
            totalTokens: data.usageMetadata.totalTokenCount,
          }
        : undefined,
    }
  }
}
