/**
 * stateFilter — strip hidden information from GameState before sending to a player.
 *
 * The server stores the full authoritative GameState. Before sending it to a client,
 * this filter removes information the player shouldn't see:
 *   - Opponent's hand: keep card count, replace card data with stubs
 *   - Opponent's deck: keep card count, replace card data with stubs
 *   - Face-down cards under opponent's cards: replace with stubs
 *   - Action-log entries marked with `privateTo` for the opponent: redact `message`
 *     so card names that crossed hidden zones (draws, opening hand) don't leak
 *   - `lastResolvedTarget` / `lastResolvedSource` / `lastDiscarded` snapshots
 *     marked with `privateTo` for the opponent: drop the snapshot entirely so
 *     the typed `name` / `fullName` fields can't leak a tutored card's identity
 *
 * Public zones (play, inkwell, discard) are sent in full.
 */

import type { GameState, GameLogEntry, PlayerID, CardInstance, ResolvedRef, ZoneName } from "@lorcana-sim/engine"

/**
 * A `ResolvedRef` snapshot leaks a card's identity through its typed `name` +
 * `fullName` fields even when the card has moved to a hidden zone. Drop the
 * snapshot wholesale for non-audience viewers — the UI only consumes these
 * for "what was the last X?" tooltips and log entries; rendering nothing is
 * the correct UX when the viewer wasn't supposed to see it.
 *
 * Returns `true` if `viewerId` is the intended audience (or the snapshot is
 * public), in which case the caller should leave the field intact.
 */
function viewerCanSeeResolvedRef(
  ref: ResolvedRef | undefined,
  viewerId: PlayerID,
): boolean {
  if (!ref) return true
  const privateTo = ref.privateTo
  if (privateTo == null) return true
  return privateTo === viewerId
}

/** Minimal stub that lets the UI render a card back without crashing */
function hiddenStub(instanceId: string, zone: ZoneName, ownerId: PlayerID): CardInstance {
  return {
    instanceId,
    definitionId: "hidden",
    ownerId,
    zone,
    isExerted: false,
    damage: 0,
    isDrying: false,
    grantedKeywords: [],
    timedEffects: [],
    cardsUnder: [],
    rememberedTargetIds: [],
  } as CardInstance
}

/**
 * Replace a private-log message with a generic, lossy redaction. The redacted
 * form preserves player + timing (turn / timestamp / type stay verbatim) but
 * deliberately drops card names. We don't try to preserve the count — the
 * priority is name privacy, and a stable redacted shape avoids leaking via
 * format. If the engine eventually wants to surface count separately, it can
 * stamp a structured field on `GameLogEntry`; we stay conservative here.
 */
function redactPrivateMessage(entry: GameLogEntry): string {
  switch (entry.type) {
    case "card_drawn":
      // Covers both the per-turn "X drew Y." (reducer.ts:2078) and the
      // opening-hand "X drew: A, B, C." (initializer.ts:264). Both leak names.
      return `${entry.playerId} drew. (cards hidden)`
    case "mulligan":
      // Future-proofing — engine doesn't currently stamp privateTo on mulligan
      // logs, but they ALSO leak ("X mulliganed: A, B, C." names cards that
      // were in the hidden hand at the time). If engine stamps privateTo
      // here later, this branch picks it up automatically.
      return `${entry.playerId} mulliganed cards. (cards hidden)`
    case "card_put_into_inkwell":
      // Standard PLAY_INK log AND P1.11's effect-driven inkwell logs (Gramma
      // Tala self-ink, Fishbone Quill chosen-hand, Perdita "all", deck-source
      // ramps). CRD 4.1.4: inkwell is face-down. Opponent sees player +
      // timing only.
      return `${entry.playerId} added a card to their inkwell.`
    case "hand_revealed":
      // P1.11 — look_at_hand peeks the looker stamps privateTo on. Public
      // reveal_hand (Copper Hound Pup) doesn't stamp privateTo, so this
      // branch only fires for private peeks. Opponent sees that the peek
      // happened but not what was revealed.
      return `${entry.playerId} looked at a hand.`
    default:
      // Catch-all for any future GameLogEntryType that gets privateTo-stamped.
      // Keep player + type-shape; drop the message body.
      return `${entry.playerId}: action hidden.`
  }
}

export function filterStateForPlayer(state: GameState, playerId: PlayerID): GameState {
  const opponentId: PlayerID = playerId === "player1" ? "player2" : "player1"

  // Deep-clone cards map so we can replace entries without mutating the original
  const filteredCards: Record<string, CardInstance> = { ...state.cards }

  // Cards referenced by lastRevealedCards are public — don't stub them even if
  // they're in a hidden zone (the whole point of "reveal" is both players see it).
  const revealedSet = new Set(state.lastRevealedCards?.instanceIds ?? [])

  // Cards referenced by lastRevealedHand are visible to the audience the reveal
  // was scoped to: public reveals (privateTo == null — both players see it) and
  // private peeks where the viewer is the one who peeked (privateTo === viewer).
  // Same principle as lastRevealedCards above: reveals preserve info for the
  // audience that was meant to receive it. Without this, set 12's look_at_hand
  // effects (and any future public reveal_hand ability) silently stub out in
  // the peeker's filtered state — they'd see card backs for cards they just
  // revealed.
  const revealedHand = state.lastRevealedHand
  if (revealedHand && (revealedHand.privateTo == null || revealedHand.privateTo === playerId)) {
    for (const id of revealedHand.cardIds) revealedSet.add(id)
  }

  // Hidden zones: opponent's hand and deck
  const hiddenZones: ZoneName[] = ["hand", "deck"]
  for (const zoneName of hiddenZones) {
    const instanceIds = state.zones[opponentId]?.[zoneName] ?? []
    for (const id of instanceIds) {
      if (revealedSet.has(id)) continue
      filteredCards[id] = hiddenStub(id, zoneName, opponentId)
    }
  }

  // Face-down cards under opponent's cards
  const opponentPlay = state.zones[opponentId]?.play ?? []
  for (const id of opponentPlay) {
    const card = state.cards[id]
    if (!card?.cardsUnder) continue
    for (const underId of card.cardsUnder) {
      const underCard = state.cards[underId]
      if (underCard?.isFaceDown) {
        filteredCards[underId] = hiddenStub(underId, "under", opponentId)
      }
    }
  }

  // Action log: redact entries marked private to the opponent (engine stamps
  // `privateTo` on draw entries that name cards which crossed hidden zones).
  // Public entries (privateTo undefined) and entries marked private to this
  // viewer pass through unchanged. Only the `message` string is sensitive —
  // playerId / turn / timestamp / type stay verbatim so the UI can still group
  // and timestamp the line, just without the card names.
  const filteredActionLog = state.actionLog.map((entry) => {
    if (entry.privateTo == null) return entry
    if (entry.privateTo === playerId) return entry
    return { ...entry, message: redactPrivateMessage(entry) }
  })

  // ResolvedRef snapshots: `lastResolvedTarget` / `lastResolvedSource` /
  // `lastDiscarded` carry typed `name` + `fullName` fields. A tutor that
  // resolves a card from deck → hand leaves the searched card's identity
  // exposed in the unfiltered state; the engine stamps `privateTo` on these
  // writers when the post-resolution zone is hidden. Drop the snapshot
  // wholesale for non-audience viewers — partial scrub (null name/fullName
  // while preserving instanceId/zone) leaks structure (e.g. "the opponent
  // tutored *something* into their hand"), and the UI's only consumer is
  // tooltip / log strings that render to nothing when null. Keep "they
  // tutored a card" inferable from the action log line, not the snapshot.
  //
  // We must not assign `undefined` to optional fields under
  // `exactOptionalPropertyTypes` — instead, build the result via spread and
  // delete the field when redaction strips it. Mutating the spread copy is
  // safe; `state` isn't touched.
  const filtered: GameState = {
    ...state,
    cards: filteredCards,
    actionLog: filteredActionLog,
  }

  if (!viewerCanSeeResolvedRef(state.lastResolvedTarget, playerId)) {
    delete filtered.lastResolvedTarget
  }

  if (!viewerCanSeeResolvedRef(state.lastResolvedSource, playerId)) {
    delete filtered.lastResolvedSource
  }

  // `lastDiscarded` is an array — filter per-element. A multi-card discard
  // could have heterogeneous privacy (rare in practice; engine currently
  // sets all elements with the same scope, but the per-element filter is
  // future-proof and adds zero overhead). If every element is filtered out,
  // drop the array entirely so the UI doesn't render an empty "discarded:"
  // tooltip — equivalent to the wholesale-drop above.
  if (state.lastDiscarded) {
    const visible = state.lastDiscarded.filter((ref) =>
      viewerCanSeeResolvedRef(ref, playerId),
    )
    if (visible.length === 0) {
      delete filtered.lastDiscarded
    } else if (visible.length !== state.lastDiscarded.length) {
      filtered.lastDiscarded = visible
    }
    // else: all elements visible → leave the spread copy intact.
  }

  return filtered
}
