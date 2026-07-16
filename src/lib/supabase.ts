import { createClient } from '@supabase/supabase-js'

import type { JobApplication } from '@/types/job'
import type { UserProfile } from '@/types/profile'

// Helper to instantiate the client dynamically
function getSupabaseClient(url: string, key: string) {
  return createClient(url, key, {
    auth: {
      persistSession: false, // Running in extension service worker, don't persist sessions
    },
  })
}

/**
 * Tests connection to Supabase and checks if database is reachable.
 */
export async function testSupabaseConnection(
  url: string,
  key: string,
): Promise<boolean> {
  if (!url || !key) return false
  try {
    const supabase = getSupabaseClient(url, key)

    // Attempt a basic select on the profiles table
    const { error } = await supabase.from('ojk_profile').select('id').limit(1)

    // If connection succeeds, we might get:
    // 1. Success (0 rows or 1 row)
    // 2. Relation not found (42P01 / PGRST116) - this means connected but table needs creation!
    // Any authentication or domain resolution issue will return connection/API key errors.
    if (error) {
      // 42P01 is PostgreSQL "relation does not exist" code
      const isTableMissing =
        error.code === '42P01' ||
        error.message?.includes('relation "ojk_profile" does not exist')
      if (isTableMissing) {
        console.log(
          '[OpenJobKit] Connected to Supabase, but ojk_profile table does not exist.',
        )
        return true
      }
      console.error('[OpenJobKit] Supabase connection test error:', error)
      return false
    }

    return true
  } catch (error) {
    console.error('[OpenJobKit] Supabase test connection failed:', error)
    return false
  }
}

/**
 * Syncs the user's profile to Supabase.
 */
export async function pushProfileToSupabase(
  url: string,
  key: string,
  profile: UserProfile,
): Promise<void> {
  if (!url || !key) return
  try {
    const supabase = getSupabaseClient(url, key)
    const { error } = await supabase.from('ojk_profile').upsert({
      id: 'default',
      data: profile,
      updated_at: new Date().toISOString(),
    })

    if (error) throw error
    console.log('[OpenJobKit] Profile successfully backed up to Supabase.')
  } catch (error) {
    console.error('[OpenJobKit] Failed to push profile to Supabase:', error)
  }
}

/**
 * Syncs a single job application to Supabase.
 */
export async function pushApplicationToSupabase(
  url: string,
  key: string,
  app: JobApplication,
): Promise<void> {
  if (!url || !key) return
  try {
    const supabase = getSupabaseClient(url, key)
    const { error } = await supabase.from('ojk_applications').upsert({
      id: app.id,
      job: app.job,
      status: app.status,
      applied_at: app.appliedAt || null,
      notes: app.notes || null,
      cover_letter: app.coverLetter || null,
      ai_generated_answers: app.aiGeneratedAnswers || null,
      error: app.error || null,
      updated_at: new Date().toISOString(),
    })

    if (error) throw error
    console.log('[OpenJobKit] Application synced to Supabase:', app.id)
  } catch (error) {
    console.error('[OpenJobKit] Failed to push application to Supabase:', error)
  }
}

/**
 * Deletes an application from Supabase.
 */
export async function deleteApplicationFromSupabase(
  url: string,
  key: string,
  id: string,
): Promise<void> {
  if (!url || !key) return
  try {
    const supabase = getSupabaseClient(url, key)
    const { error } = await supabase
      .from('ojk_applications')
      .delete()
      .eq('id', id)

    if (error) throw error
    console.log('[OpenJobKit] Application deleted from Supabase:', id)
  } catch (error) {
    console.error(
      '[OpenJobKit] Failed to delete application from Supabase:',
      error,
    )
  }
}

/**
 * Pulls profile and application records from Supabase cloud storage.
 */
export async function pullSupabaseData(
  url: string,
  key: string,
): Promise<{
  profile: UserProfile | null
  applications: Array<JobApplication>
}> {
  if (!url || !key) {
    return { profile: null, applications: [] }
  }
  try {
    const supabase = getSupabaseClient(url, key)

    const [profileRes, appsRes] = await Promise.all([
      supabase
        .from('ojk_profile')
        .select('data')
        .eq('id', 'default')
        .maybeSingle(),
      supabase
        .from('ojk_applications')
        .select('*')
        .order('updated_at', { ascending: false }),
    ])

    if (profileRes.error) throw profileRes.error
    if (appsRes.error) throw appsRes.error

    const profile = profileRes.data?.data as UserProfile | null
    const applications = (appsRes.data || []).map((row) => ({
      id: row.id,
      job: row.job,
      status: row.status as JobApplication['status'],
      appliedAt: row.applied_at || undefined,
      notes: row.notes || undefined,
      coverLetter: row.cover_letter || undefined,
      aiGeneratedAnswers: row.ai_generated_answers || undefined,
      error: row.error || undefined,
    }))

    return { profile, applications }
  } catch (error) {
    console.error('[OpenJobKit] Failed to pull data from Supabase:', error)
    throw error
  }
}
