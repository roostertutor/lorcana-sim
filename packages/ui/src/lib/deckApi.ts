import { supabase } from "./supabase.js"

/** Per-card enrichment for a single CardDefinition. Does not round-trip through
 *  the vanilla decklist_text (which stays compatible with external Lorcana
 *  tools — Inkable, Dreamborn, etc.). Intentionally open-shaped so future
 *  fields (foil preference, notes, tags) can nest under the same key without
 *  another DB migration. */
export interface CardMetadata {
  /** CardVariantType — kept as a plain string in this layer to keep deckApi
   *  engine-agnostic. Undefined = default (regular). */
  variant?: string
  // Future: foil?: boolean, note?: string, tags?: string[] …
}

export interface SavedDeck {
  id: string
  name: string
  decklist_text: string
  /** User-chosen box art: CardDefinition.id. Null = derive from first entry. */
  box_card_id: string | null
  /** Per-card enrichment keyed by CardDefinition.id. Empty object = no
   *  per-card overrides (every card uses its default variant). */
  card_metadata: Record<string, CardMetadata>
  created_at: string
  updated_at: string
}

export interface DeckVersion {
  id: string
  deck_id: string
  decklist_text: string
  created_at: string
}

export async function listDecks(): Promise<SavedDeck[]> {
  const { data, error } = await supabase
    .from("decks")
    .select("id, name, decklist_text, box_card_id, card_metadata, created_at, updated_at")
    .order("updated_at", { ascending: false })

  if (error) throw new Error(error.message)
  return data as SavedDeck[]
}

/** Insert a version row if the latest version has different text (dedupe). */
async function snapshotVersion(deckId: string, decklistText: string): Promise<void> {
  const { data: latest } = await supabase
    .from("deck_versions")
    .select("decklist_text")
    .eq("deck_id", deckId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latest && latest.decklist_text === decklistText) return // no change, skip

  const { error } = await supabase
    .from("deck_versions")
    .insert({ deck_id: deckId, decklist_text: decklistText })

  if (error) throw new Error(error.message)
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
    .select("id, name, decklist_text, box_card_id, card_metadata, created_at, updated_at")
    .single()

  if (error) throw new Error(error.message)

  await snapshotVersion(data.id, decklistText)
  return data as SavedDeck
}

export async function updateDeck(id: string, updates: { name?: string; decklist_text?: string; box_card_id?: string | null; card_metadata?: Record<string, CardMetadata> }): Promise<SavedDeck> {
  const { data, error } = await supabase
    .from("decks")
    .update(updates)
    .eq("id", id)
    .select("id, name, decklist_text, box_card_id, card_metadata, created_at, updated_at")
    .single()

  if (error) throw new Error(error.message)

  if (updates.decklist_text !== undefined) {
    await snapshotVersion(id, updates.decklist_text)
  }
  return data as SavedDeck
}

export async function deleteDeck(id: string): Promise<void> {
  const { error } = await supabase
    .from("decks")
    .delete()
    .eq("id", id)

  if (error) throw new Error(error.message)
}

export async function listDeckVersions(deckId: string): Promise<DeckVersion[]> {
  const { data, error } = await supabase
    .from("deck_versions")
    .select("id, deck_id, decklist_text, created_at")
    .eq("deck_id", deckId)
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)
  return data as DeckVersion[]
}
