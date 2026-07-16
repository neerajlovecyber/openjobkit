// OpenAI provider implementation

import type { AIClient, AIResponse } from '../client'
import type { AISettings } from '@/types/settings'

export class OpenAIProvider implements AIClient {
  private apiKey: string
  private model: string
  private temperature: number
  private maxTokens: number

  constructor(settings: AISettings) {
    this.apiKey = settings.apiKey
    this.model = settings.model || 'gpt-4o-mini'
    this.temperature = settings.temperature ?? 0.3
    this.maxTokens = settings.maxTokens ?? 2000
  }

  async complete(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<AIResponse> {
    if (!this.apiKey) {
      throw new Error(
        'OpenAI API key is not configured. Please add your API key in Settings.',
      )
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`OpenAI API error ${response.status}: ${errorBody}`)
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>
      usage?: {
        prompt_tokens: number
        completion_tokens: number
        total_tokens: number
      }
    }

    const content = data.choices[0]?.message?.content ?? ''

    return {
      content,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    }
  }
}
