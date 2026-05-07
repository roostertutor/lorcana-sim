import { supabase } from "../db/client.js"

export async function getOrCreateProfile(userId: string, username?: string) {
  const { data: existing } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single()

  if (existing) return existing

  // First login — create profile with provided username or generated one.
  // `display_name` is seeded equal to `username` so new accounts have a
  // mutable label that matches their stable handle until they edit it
  // (Discord-style split, see docs/HANDOFF.md → username / display_name).
  const name = username ?? `player_${userId.slice(0, 8)}`
  const { data, error } = await supabase
    .from("profiles")
    .insert({ id: userId, username: name, display_name: name })
    .select()
    .single()

  if (error) throw new Error(`Failed to create profile: ${error.message}`)
  return data
}

/** Update the caller's mutable display_name (Discord-style split — separate
 *  from the stable `username` handle). Trims, validates 1-32 chars after
 *  trim, rejects all-whitespace. Returns the updated profile row, or a
 *  rejection object the route can surface as a 400. */
export async function updateDisplayName(
  userId: string,
  rawDisplayName: unknown,
): Promise<
  | { ok: true; profile: Record<string, unknown> }
  | { ok: false; status: 400 | 500; error: string }
> {
  if (typeof rawDisplayName !== "string") {
    return { ok: false, status: 400, error: "display_name must be a string" }
  }
  const trimmed = rawDisplayName.trim()
  if (trimmed.length < 1) {
    return { ok: false, status: 400, error: "display_name cannot be empty or whitespace-only" }
  }
  if (trimmed.length > 32) {
    return { ok: false, status: 400, error: "display_name must be 32 characters or fewer" }
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: trimmed })
    .eq("id", userId)
    .select()
    .single()

  if (error) return { ok: false, status: 500, error: error.message }
  if (!data) return { ok: false, status: 500, error: "Profile not found after update" }
  return { ok: true, profile: data as Record<string, unknown> }
}

export async function getProfile(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single()

  if (error) return null
  return data
}
