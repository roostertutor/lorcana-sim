import { supabase } from "./supabase.js"

export interface SavedDeck {
  id: string
  name: string
  decklist_text: string
  created_at: string
  updated_at: string
}

export async function listDecks(): Promise<SavedDeck[]> {
  const { data, error } = await supabase
    .from("decks")
    .select("id, name, decklist_text, created_at, updated_at")
    .order("updated_at", { ascending: false })

  if (error) throw new Error(error.message)
  return data as SavedDeck[]
}

export async function saveDeck(name: string, decklistText: string): Promise<SavedDeck> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const { data, error } = await supabase
    .from("decks")
    .upsert(
      { user_id: user.id, name, decklist_text: decklistText },
      { onConflict: "user_id,name" },
    )
    .select("id, name, decklist_text, created_at, updated_at")
    .single()

  if (error) throw new Error(error.message)
  return data as SavedDeck
}

export async function updateDeck(id: string, updates: { name?: string; decklist_text?: string }): Promise<SavedDeck> {
  const { data, error } = await supabase
    .from("decks")
    .update(updates)
    .eq("id", id)
    .select("id, name, decklist_text, created_at, updated_at")
    .single()

  if (error) throw new Error(error.message)
  return data as SavedDeck
}

export async function deleteDeck(id: string): Promise<void> {
  const { error } = await supabase
    .from("decks")
    .delete()
    .eq("id", id)

  if (error) throw new Error(error.message)
}
