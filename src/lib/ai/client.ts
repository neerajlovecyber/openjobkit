import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { generateObject, generateText } from 'ai'
import { z } from 'zod'

import type { AISettings } from '@/types/settings'

// ────────────────────────────────────────────────────────────────────────────
// Helper: get the correct Vercel AI SDK model instance
// ────────────────────────────────────────────────────────────────────────────

function getModel(settings: AISettings) {
  if (!settings.apiKey) {
    throw new Error(
      `API key for ${settings.provider} is not configured. Please configure it in extension settings.`,
    )
  }

  const modelName =
    settings.model ||
    (settings.provider === 'openai' ? 'gpt-4o-mini' : 'gemini-1.5-flash')
  const temp = settings.temperature ?? 0.3
  const maxTokens = settings.maxTokens ?? 2000

  // 1. OpenAI / OpenRouter
  if (settings.provider === 'openai') {
    // If the key starts with 'sk-or-' or the model name has a slash, use OpenRouter
    const isOpenRouter =
      settings.apiKey.startsWith('sk-or-') || modelName.includes('/')

    const openai = createOpenAI({
      apiKey: settings.apiKey,
      baseURL: isOpenRouter ? 'https://openrouter.ai/api/v1' : undefined,
      headers: isOpenRouter
        ? {
            'HTTP-Referer': 'https://github.com/nsp/openjobkit',
            'X-Title': 'OpenJobKit',
          }
        : undefined,
    })

    return openai(modelName)
  }

  // 2. Google Gemini
  if (settings.provider === 'gemini') {
    const google = createGoogleGenerativeAI({
      apiKey: settings.apiKey,
    })
    return google(modelName)
  }

  throw new Error(`AI Provider "${settings.provider}" is not supported.`)
}

// ────────────────────────────────────────────────────────────────────────────
// Standardized Generation Methods
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generates field answers using structured JSON schema.
 * Guaranteed to return a clean key-value object (fieldId -> answer).
 */
export async function generateFormAnswers(
  settings: AISettings,
  systemPrompt: string,
  userPrompt: string,
): Promise<Record<string, string>> {
  const model = getModel(settings)

  const { object } = await generateObject({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    schema: z.record(z.string(), z.string()), // Key is string, value is string
    temperature: settings.temperature ?? 0.3,
    maxOutputTokens: settings.maxTokens ?? 2000,
  })

  return object
}

/**
 * Generates plain text (e.g. for cover letters).
 */
export async function generateCoverLetter(
  settings: AISettings,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const model = getModel(settings)

  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    temperature: settings.temperature ?? 0.3,
    maxOutputTokens: settings.maxTokens ?? 2000,
  })

  return text
}
