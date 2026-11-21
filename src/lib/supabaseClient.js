import { createClient } from '@supabase/supabase-js'

/*
 * Backend configuration.
 *
 * Normally this comes from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, set on
 * the deployment. On 2026-11-21 the original Supabase project
 * (qvyoiovlblorahqkatlj) was restricted for exceeding the free-tier egress
 * quota and then paused, and everything moved to a new project. The Vercel
 * environment variables live in a separate account and still point at the dead
 * project, so a build picks up a backend that answers HTTP 402 to everything -
 * including /auth/v1, which is why the app cannot even reach its login.
 *
 * So: the environment is trusted unless it names a project known to be dead,
 * in which case the current project below is used instead. Once the deployment
 * env vars are corrected this falls back to them automatically with no code
 * change - and RETIRED_PROJECT_REFS plus the defaults can then be deleted.
 *
 * The publishable key is safe in client code by design; it is what the browser
 * sends on every request, and RLS is what actually protects the data.
 */
const CURRENT_URL = 'https://qsqaqyvblvqzwfsruajz.supabase.co'
const CURRENT_PUBLISHABLE_KEY = 'sb_publishable_o6gSjws8eXZF4XVUJUw1Lg_60jgMnry'

const RETIRED_PROJECT_REFS = ['qvyoiovlblorahqkatlj']

const envUrl = import.meta.env.VITE_SUPABASE_URL
const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const envPointsAtRetiredProject =
  Boolean(envUrl) && RETIRED_PROJECT_REFS.some((ref) => envUrl.includes(ref))

const useEnv = Boolean(envUrl && envKey) && !envPointsAtRetiredProject

if (envPointsAtRetiredProject) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL points at a retired project (' + envUrl +
    '); using ' + CURRENT_URL + ' instead. Update the deployment env vars.',
  )
}

const url = useEnv ? envUrl : CURRENT_URL
const anonKey = useEnv ? envKey : CURRENT_PUBLISHABLE_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

// When env vars are missing we still export a client-shaped object so the app
// can render a friendly "configure Supabase" message instead of crashing.
export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey)
  : null
