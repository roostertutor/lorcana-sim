import { supabase } from "../db/client.js"

export async function getOrCreateProfile(userId: string, username?: string) {
  const { data: existing } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single()

  if (existing) return existing

  // First login — create profile with provided username or generated one
  const name = username ?? `player_${userId.slice(0, 8)}`
  const { data, error } = await supabase
    .from("profiles")
    .insert({ id: userId, username: name })
    .select()
    .single()

  if (error) throw new Error(`Failed to create profile: ${error.message}`)
  return data
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
