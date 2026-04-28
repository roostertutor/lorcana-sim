import type { GameFormatFamily } from "@lorcana-sim/engine"
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
  /** Format family the deck is built for. `format_rotation` was dropped
   *  2026-04-27 — rotation is now chosen per-game (host pick at lobby
   *  creation, queue request param at matchmaking join). The deck's
   *  legality re-evaluates against whichever rotation is live (or selected)
   *  at play time. See docs/HANDOFF.md → "Server agent: casual + ranked
   *  matchmaking queues" for the rationale. */
  format_family: GameFormatFamily
  created_at: string
  updated_at: string
}

export interface DeckVersion {
  id: string
  deck_id: string
  decklist_text: string
  created_at: string
}

const DECK_SELECT = "id, name, decklist_text, box_card_id, card_metadata, format_family, created_at, updated_at"

export async function listDecks(): Promise<SavedDeck[]> {
  const { data, error } = await supabase
    .from("decks")
    .select(DECK_SELECT)
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

export async function saveDeck(
  name: string,
  decklistText: string,
  family?: GameFormatFamily,
): Promise<SavedDeck> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  // When family is provided, stamp it on insert. Otherwise the DB DEFAULT
  // ('core') applies — matches the blanket-backfill policy for existing rows.
  const payload: Record<string, unknown> = {
    user_id: user.id,
    name,
    decklist_text: decklistText,
  }
  if (family) {
    payload.format_family = family
  }

  const { data, error } = await supabase
    .from("decks")
    .upsert(payload, { onConflict: "user_id,name" })
    .select(DECK_SELECT)
    .single()

  if (error) throw new Error(error.message)

  await snapshotVersion(data.id, decklistText)
  return data as SavedDeck
}

export async function updateDeck(id: string, updates: { name?: string; decklist_text?: string; box_card_id?: string | null; card_metadata?: Record<string, CardMetadata>; format_family?: GameFormatFamily }): Promise<SavedDeck> {
  const { data, error } = await supabase
    .from("decks")
    .update(updates)
    .eq("id", id)
    .select(DECK_SELECT)
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
