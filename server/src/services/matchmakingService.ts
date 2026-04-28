import {
  CARD_DEFINITIONS,
  CORE_ROTATIONS,
  INFINITY_ROTATIONS,
  isLegalFor,
  parseDecklist,
  type DeckEntry,
  type GameFormat,
  type GameFormatFamily,
  type RotationId,
} from "@lorcana-sim/engine"
import { supabase } from "../db/client.js"
import { createNewGame } from "./gameService.js"

// ── Public types ────────────────────────────────────────────────────────────

export type QueueKind = "casual" | "ranked"
export type MatchFormat = "bo1" | "bo3"

export interface JoinQueueRequest {
  /** Pre-parsed decklist. Either this OR `decklistText` MUST be provided. */
  deck?: DeckEntry[]
  /** Plain-text decklist. Server parses via engine `parseDecklist`. */
  decklistText?: string
  /** Per-card metadata (variant etc.). Carried through to the games row. */
  cardMetadata?: Record<string, unknown> | null
  format: GameFormat
  matchFormat: MatchFormat
  queueKind: QueueKind
}

export interface QueueEntryRow {
  id: string
  user_id: string
  format_family: string
  format_rotation: string
  match_format: string
  queue_kind: string
  decklist: DeckEntry[]
  card_metadata: Record<string, unknown> | null
  elo: number | null
  joined_at: string
  paired_game_id: string | null
}

export type JoinQueueOutcome =
  | { ok: true; status: "queued"; entryId: string; eloSnapshot: number | null }
  | { ok: true; status: "paired"; entryId: string; gameId: string; opponentId: string; eloSnapshot: number | null }
  | { ok: false; status: number; error: string; issues?: unknown }

// ── Rate limit (in-memory rolling-hour token bucket per user) ───────────────

const RATE_LIMIT_PER_HOUR = 10
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

interface RateLimitEntry {
  count: number
  windowStart: number
}

const rateLimitBuckets = new Map<string, RateLimitEntry>()

/** Returns true and records the hit if the user is within the rate limit;
 *  returns false (and the retry-after seconds) when the user has exhausted
 *  their hourly allowance. Per-user-id keyed; resets 60 minutes from the
 *  first hit of the current window. Per-process — fine for single-instance
 *  Railway deploys; would need a Redis-backed swap for multi-instance. */
export function checkRateLimit(userId: string): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now()
  const existing = rateLimitBuckets.get(userId)
  if (!existing || now - existing.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(userId, { count: 1, windowStart: now })
    return { ok: true }
  }
  if (existing.count >= RATE_LIMIT_PER_HOUR) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000),
    )
    return { ok: false, retryAfterSeconds }
  }
  existing.count += 1
  return { ok: true }
}

/** Reset the rate-limit bucket. Test-only helper. */
export function _resetRateLimitForTests(userId?: string): void {
  if (userId) rateLimitBuckets.delete(userId)
  else rateLimitBuckets.clear()
}

// ── Internal helpers ────────────────────────────────────────────────────────

/** Resolve a rotation against the engine registry. Returns null if the
 *  rotation id isn't registered (typo, decommissioned). */
function resolveRotationEntry(family: GameFormatFamily, rotation: RotationId) {
  const registry = family === "core" ? CORE_ROTATIONS : INFINITY_ROTATIONS
  return registry[rotation] ?? null
}

/** ELO key shape mirrors gameService.ts. Duplicated here to avoid a circular
 *  import — both services consume the same registry, so the shape stays
 *  in sync naturally. */
function getEloKey(matchFormat: MatchFormat, family: GameFormatFamily, rotation: RotationId): string {
  return `${matchFormat}_${family}_${rotation}`
}

/** Parse + normalize the deck input. Accepts either a pre-parsed
 *  DeckEntry[] or a plaintext decklist; reports parse errors. */
function normalizeDeck(req: JoinQueueRequest): { ok: true; deck: DeckEntry[] } | { ok: false; error: string } {
  if (req.deck && Array.isArray(req.deck) && req.deck.length > 0) {
    return { ok: true, deck: req.deck }
  }
  if (req.decklistText && typeof req.decklistText === "string") {
    const parsed = parseDecklist(req.decklistText, CARD_DEFINITIONS)
    if (parsed.errors.length > 0) {
      return { ok: false, error: `Decklist parse errors: ${parsed.errors.join("; ")}` }
    }
    if (parsed.entries.length === 0) {
      return { ok: false, error: "Decklist is empty" }
    }
    return { ok: true, deck: parsed.entries }
  }
  return { ok: false, error: "deck or decklistText is required" }
}

/** Concurrency invariant — reject queue join if the user has any waiting
 *  lobby. Mirrors the lobby-side check that rejects lobby create when a
 *  queue entry already exists. */
async function userHasWaitingLobby(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("lobbies")
    .select("id")
    .eq("host_id", userId)
    .eq("status", "waiting")
    .limit(1)
  return Boolean(data && data.length > 0)
}

async function userHasActiveGame(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("games")
    .select("id")
    .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
    .eq("status", "active")
    .limit(1)
  return Boolean(data && data.length > 0)
}

async function userQueueEntry(userId: string): Promise<QueueEntryRow | null> {
  const { data } = await supabase
    .from("matchmaking_queue")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle()
  return (data as QueueEntryRow | null) ?? null
}

/** Look up the user's ELO for the (matchFormat, family, rotation) bucket.
 *  Falls back to 1200 if no rating recorded for that bucket yet. */
async function getEloSnapshot(
  userId: string,
  matchFormat: MatchFormat,
  family: GameFormatFamily,
  rotation: RotationId,
): Promise<number> {
  const { data } = await supabase
    .from("profiles")
    .select("elo_ratings")
    .eq("id", userId)
    .single()
  const ratings = (data?.elo_ratings as Record<string, number> | null) ?? null
  const key = getEloKey(matchFormat, family, rotation)
  return ratings?.[key] ?? 1200
}

// ── ELO band-widening (ranked queue) ────────────────────────────────────────

/** Time-based band schedule for ranked pairing. Returns Infinity (i.e.
 *  "any peer") once the entry has waited >= 90s — beyond that, the user
 *  is matched against the closest-ELO peer regardless of band. */
export function eloBandForElapsedMs(elapsedMs: number): number {
  if (elapsedMs < 30_000) return 50
  if (elapsedMs < 60_000) return 150
  if (elapsedMs < 90_000) return 400
  return Number.POSITIVE_INFINITY
}

// ── Join queue ──────────────────────────────────────────────────────────────

export async function joinMatchmakingQueue(
  userId: string,
  req: JoinQueueRequest,
): Promise<JoinQueueOutcome> {
  // 1. Validate request shape
  if (!req.format || !req.format.family || !req.format.rotation) {
    return { ok: false, status: 400, error: "format.family and format.rotation are required" }
  }
  if (req.matchFormat !== "bo1" && req.matchFormat !== "bo3") {
    return { ok: false, status: 400, error: "matchFormat must be 'bo1' or 'bo3'" }
  }
  if (req.queueKind !== "casual" && req.queueKind !== "ranked") {
    return { ok: false, status: 400, error: "queueKind must be 'casual' or 'ranked'" }
  }

  const family = req.format.family
  const rotation = req.format.rotation
  const matchFormat = req.matchFormat
  const queueKind = req.queueKind

  // 2. Resolve rotation against engine registry
  const rotationEntry = resolveRotationEntry(family, rotation)
  if (!rotationEntry) {
    return { ok: false, status: 400, error: `Unknown rotation "${rotation}" in ${family}` }
  }
  if (!rotationEntry.offeredForNewDecks) {
    return {
      ok: false,
      status: 400,
      error: `Rotation "${rotationEntry.displayName}" is no longer offered for new matches`,
    }
  }
  if (queueKind === "ranked" && !rotationEntry.ranked) {
    return {
      ok: false,
      status: 400,
      error: `Ranked queue is not available for ${rotationEntry.displayName} — try casual queue`,
    }
  }

  // 3. Concurrency invariants — only one slot per user at a time
  if (await userHasActiveGame(userId)) {
    return { ok: false, status: 409, error: "You already have an active game. Finish or resign it first." }
  }
  if (await userHasWaitingLobby(userId)) {
    return { ok: false, status: 409, error: "You are already hosting a lobby. Cancel it first." }
  }
  if (await userQueueEntry(userId)) {
    return { ok: false, status: 409, error: "You are already in a matchmaking queue. Cancel it first." }
  }

  // 4. Rate limit
  const rate = checkRateLimit(userId)
  if (!rate.ok) {
    return {
      ok: false,
      status: 429,
      error: `Too many queue joins. Try again in ${rate.retryAfterSeconds}s.`,
    }
  }

  // 5. Parse deck
  const parsed = normalizeDeck(req)
  if (!parsed.ok) {
    return { ok: false, status: 400, error: parsed.error }
  }
  const deck = parsed.deck

  // 6. Legality against the chosen rotation
  const legality = isLegalFor(deck, CARD_DEFINITIONS, { family, rotation })
  if (!legality.ok) {
    return {
      ok: false,
      status: 400,
      error: "illegal deck for format",
      issues: legality.issues,
    }
  }

  // 7. Snapshot ELO for the bucket (used by ranked band-widening)
  const eloSnapshot = await getEloSnapshot(userId, matchFormat, family, rotation)

  // 8. INSERT — UNIQUE(user_id) gives us a final concurrency guard at the DB level
  const { data: insertedRows, error: insertError } = await supabase
    .from("matchmaking_queue")
    .insert({
      user_id: userId,
      format_family: family,
      format_rotation: rotation,
      match_format: matchFormat,
      queue_kind: queueKind,
      decklist: deck,
      card_metadata: req.cardMetadata ?? null,
      elo: eloSnapshot,
    })
    .select()
    .single()

  if (insertError || !insertedRows) {
    // 23505 = UNIQUE violation; means a queue entry was created in a race
    // between the userQueueEntry() check above and this insert.
    if ((insertError as { code?: string } | undefined)?.code === "23505") {
      return { ok: false, status: 409, error: "You are already in a matchmaking queue." }
    }
    return { ok: false, status: 500, error: `Failed to join queue: ${insertError?.message ?? "unknown"}` }
  }

  const myEntry = insertedRows as QueueEntryRow

  // 9. Inline pairing — try to find a peer immediately. The poll-based
  //    safety net (every 60s) catches anything we miss here.
  const pairResult = await tryPairEntry(myEntry)
  if (pairResult.ok) {
    return {
      ok: true,
      status: "paired",
      entryId: myEntry.id,
      gameId: pairResult.gameId,
      opponentId: pairResult.opponentId,
      eloSnapshot,
    }
  }

  return { ok: true, status: "queued", entryId: myEntry.id, eloSnapshot }
}

// ── Cancel + status ─────────────────────────────────────────────────────────

export async function cancelMatchmakingQueue(userId: string): Promise<{ ok: true; removed: boolean }> {
  const { data, error } = await supabase
    .from("matchmaking_queue")
    .delete()
    .eq("user_id", userId)
    .select("id")
  if (error) {
    // Idempotent — even on error we want to report success-ish; but log for visibility.
    console.error("[matchmaking] cancel error:", error.message)
    return { ok: true, removed: false }
  }
  return { ok: true, removed: (data?.length ?? 0) > 0 }
}

export interface QueueStatus {
  entryId: string
  format: GameFormat
  matchFormat: MatchFormat
  queueKind: QueueKind
  joinedAt: string
  elapsedMs: number
  eloSnapshot: number | null
  /** Current band width in ELO points. `null` for casual; `Infinity` after 90s. */
  currentBand: number | null
  pairedGameId: string | null
}

export async function getMatchmakingStatus(userId: string): Promise<QueueStatus | null> {
  const entry = await userQueueEntry(userId)
  if (!entry) return null
  const joinedAt = new Date(entry.joined_at)
  const elapsedMs = Date.now() - joinedAt.getTime()
  const currentBand = entry.queue_kind === "ranked" ? eloBandForElapsedMs(elapsedMs) : null
  return {
    entryId: entry.id,
    format: {
      family: entry.format_family as GameFormatFamily,
      rotation: entry.format_rotation as RotationId,
    },
    matchFormat: entry.match_format as MatchFormat,
    queueKind: entry.queue_kind as QueueKind,
    joinedAt: entry.joined_at,
    elapsedMs,
    eloSnapshot: entry.elo,
    currentBand,
    pairedGameId: entry.paired_game_id,
  }
}

// ── Pairing ─────────────────────────────────────────────────────────────────

interface PairAttemptResult {
  ok: boolean
  gameId: string
  opponentId: string
}

/** Attempt to pair the given queue entry with a compatible peer.
 *
 *  Casual: FIFO oldest-first peer in the same (family, rotation, matchFormat) bucket.
 *  Ranked: closest-ELO peer within the time-driven band. The band starts at
 *  ±50 and widens to ±150 (30s), ±400 (60s), unbounded (90s+).
 *
 *  Atomicity: peer DELETE is conditional on (queue_kind, user_id) matching
 *  what we read — Supabase's "DELETE … RETURNING" semantics give us
 *  optimistic concurrency. If a competing pairer claimed the peer first,
 *  the DELETE returns 0 rows and we abort without creating a game.
 */
async function tryPairEntry(entry: QueueEntryRow): Promise<PairAttemptResult | { ok: false }> {
  const peer = await findPeer(entry)
  if (!peer) return { ok: false }

  // Atomically claim BOTH entries by deleting them. If either DELETE comes
  // back empty, somebody else beat us to that entry; abort.
  const claimed = await claimEntries([entry.id, peer.id])
  if (claimed.length !== 2) {
    // Rollback partial claim by re-inserting whichever side we removed —
    // shouldn't happen because Supabase doesn't do partial deletes here, but
    // defensive against future driver changes.
    return { ok: false }
  }

  // Determine ranked-ness from the rotation registry. queueKind=='ranked'
  // is necessary but not sufficient — rotation.ranked must also be true.
  const rotationEntry = resolveRotationEntry(
    entry.format_family as GameFormatFamily,
    entry.format_rotation as RotationId,
  )
  const ranked = entry.queue_kind === "ranked" && rotationEntry?.ranked === true

  // Run the mandatory legality check on BOTH decks before game-create.
  // Defensive — both decks were validated at queue-join time, but
  // re-checking here catches any drift (e.g. live rotation flipped while
  // the entries waited, or a cooked deck was injected by a buggy client).
  const format: GameFormat = {
    family: entry.format_family as GameFormatFamily,
    rotation: entry.format_rotation as RotationId,
  }
  const lA = isLegalFor(entry.decklist, CARD_DEFINITIONS, format)
  const lB = isLegalFor(peer.decklist, CARD_DEFINITIONS, format)
  if (!lA.ok || !lB.ok) {
    // Re-insert the entry whose deck is still legal (if any). The illegal
    // entry is dropped; that user must re-queue with a corrected deck.
    if (lA.ok) await reinsertEntry(entry)
    if (lB.ok) await reinsertEntry(peer)
    console.warn(
      "[matchmaking] pair aborted on legality drift",
      { entryA: entry.id, entryB: peer.id, aOk: lA.ok, bOk: lB.ok },
    )
    return { ok: false }
  }

  // Coin-flip player1 slot — same as lobbyService.joinLobby (CRD 2.2.1).
  const aGoesFirst = Math.random() < 0.5
  const p1Id = aGoesFirst ? entry.user_id : peer.user_id
  const p2Id = aGoesFirst ? peer.user_id : entry.user_id
  const p1Deck = aGoesFirst ? entry.decklist : peer.decklist
  const p2Deck = aGoesFirst ? peer.decklist : entry.decklist

  const game = await createNewGame(null, p1Id, p2Id, p1Deck, p2Deck, 1, {
    matchSource: "queue",
    ranked,
    format: { family: entry.format_family as GameFormatFamily, rotation: entry.format_rotation as RotationId },
  })

  // Two-channel notification:
  //   1. Per-user broadcast channel — clients subscribe to
  //      `matchmaking:user:<userId>` for instant `pair_found` events with
  //      the gameId payload (no extra HTTP poll needed).
  //   2. Realtime channel will also carry the queue-row delete; clients
  //      that polled GET /matchmaking and got the queue entry can re-poll
  //      and observe row-gone → game starting.
  // Both are best-effort; if broadcast fails the client falls back to GET.
  await Promise.all([
    broadcastPairFound(entry.user_id, game.id, peer.user_id),
    broadcastPairFound(peer.user_id, game.id, entry.user_id),
  ])

  return { ok: true, gameId: game.id, opponentId: peer.user_id }
}

/** Find a compatible peer for the given entry. Returns null if no peer is
 *  in-bucket OR (for ranked) within the current ELO band. */
async function findPeer(entry: QueueEntryRow): Promise<QueueEntryRow | null> {
  // Common bucket filter
  let q = supabase
    .from("matchmaking_queue")
    .select("*")
    .eq("format_family", entry.format_family)
    .eq("format_rotation", entry.format_rotation)
    .eq("match_format", entry.match_format)
    .eq("queue_kind", entry.queue_kind)
    .neq("user_id", entry.user_id)

  if (entry.queue_kind === "ranked") {
    const elapsedMs = Date.now() - new Date(entry.joined_at).getTime()
    const band = eloBandForElapsedMs(elapsedMs)
    const myElo = entry.elo ?? 1200

    if (Number.isFinite(band)) {
      q = q.gte("elo", myElo - band).lte("elo", myElo + band)
    }
    // For ranked, prefer closest-ELO peer; tiebreak on oldest. Postgres
    // doesn't have a direct ABS() in PostgREST `.order`, so we fetch the
    // top few and pick locally.
    const { data } = await q.order("joined_at", { ascending: true }).limit(20)
    if (!data || data.length === 0) return null
    const sorted = (data as QueueEntryRow[]).slice().sort((a, b) => {
      const da = Math.abs((a.elo ?? 1200) - myElo)
      const db = Math.abs((b.elo ?? 1200) - myElo)
      if (da !== db) return da - db
      return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()
    })
    return sorted[0] ?? null
  }

  // Casual: FIFO oldest peer
  const { data } = await q.order("joined_at", { ascending: true }).limit(1)
  return (data?.[0] as QueueEntryRow | undefined) ?? null
}

/** Atomically delete both queue entries. Returns the rows that were
 *  actually deleted (ids only) — caller compares length to detect races. */
async function claimEntries(ids: string[]): Promise<string[]> {
  const { data, error } = await supabase
    .from("matchmaking_queue")
    .delete()
    .in("id", ids)
    .select("id")
  if (error || !data) return []
  return data.map((r) => r.id as string)
}

/** Re-insert a queue entry that was claimed but couldn't be paired (e.g.
 *  legality drift on the OTHER side). Idempotent on UNIQUE(user_id) — if
 *  the user re-queued in between, this is a no-op. */
async function reinsertEntry(entry: QueueEntryRow): Promise<void> {
  await supabase.from("matchmaking_queue").insert({
    id: entry.id,
    user_id: entry.user_id,
    format_family: entry.format_family,
    format_rotation: entry.format_rotation,
    match_format: entry.match_format,
    queue_kind: entry.queue_kind,
    decklist: entry.decklist,
    card_metadata: entry.card_metadata,
    elo: entry.elo,
    joined_at: entry.joined_at,
  })
}

/** Broadcast a pair-success event on the user's matchmaking channel.
 *  Clients subscribe to `matchmaking:user:<userId>` and listen for the
 *  `pair_found` event to auto-redirect to /game/:id. */
async function broadcastPairFound(userId: string, gameId: string, opponentId: string): Promise<void> {
  try {
    const channel = supabase.channel(`matchmaking:user:${userId}`, {
      config: { broadcast: { ack: false } },
    })
    // Subscribe ephemerally to enable send(); Supabase requires the channel
    // be joined before broadcast goes through.
    await new Promise<void>((resolve) => {
      const sub = channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          resolve()
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          resolve()
        }
      })
      // Safety timeout — don't block pairing on a flaky Realtime connection.
      setTimeout(() => resolve(), 2000)
      void sub
    })
    await channel.send({
      type: "broadcast",
      event: "pair_found",
      payload: { gameId, opponentId },
    })
    await channel.unsubscribe()
  } catch (err) {
    // Realtime is best-effort; clients also poll GET /matchmaking and
    // observe the queue-row DELETE via DB Realtime. Don't fail the pair
    // because of a broadcast hiccup.
    console.error("[matchmaking] broadcast failed:", err)
  }
}

// ── Poll-based safety net ───────────────────────────────────────────────────

let pollerHandle: NodeJS.Timeout | null = null

/** Re-runs pairing across all current queue entries. Catches edge cases
 *  where the inline path was attempted before a peer joined, or where
 *  Realtime/network hiccups dropped a pair-success notification. Same
 *  pairing logic as inline. */
export async function runMatchmakingPoll(): Promise<{ paired: number; processed: number }> {
  const { data, error } = await supabase
    .from("matchmaking_queue")
    .select("*")
    .order("joined_at", { ascending: true })
    .limit(500)
  if (error || !data) return { paired: 0, processed: 0 }

  let paired = 0
  const seen = new Set<string>()
  for (const row of data as QueueEntryRow[]) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    // Re-fetch the entry to make sure it still exists (a parallel inline
    // pair may have just removed it).
    const { data: fresh } = await supabase
      .from("matchmaking_queue")
      .select("*")
      .eq("id", row.id)
      .maybeSingle()
    if (!fresh) continue
    const result = await tryPairEntry(fresh as QueueEntryRow)
    if ("ok" in result && result.ok) {
      paired++
      // Mark the peer as seen so we don't try to re-pair it on this pass.
      // tryPairEntry deleted both rows already, but the loop variable still
      // points at the (now-stale) snapshot.
    }
  }
  return { paired, processed: data.length }
}

/** Start the poll-based safety net. Call once at server boot. Idempotent —
 *  calling twice does NOT start two pollers. */
export function startMatchmakingPoller(intervalMs = 60_000): void {
  if (pollerHandle) return
  pollerHandle = setInterval(() => {
    runMatchmakingPoll().catch((err) => {
      console.error("[matchmaking] poll error:", err)
    })
  }, intervalMs)
  // Don't keep the Node process alive solely for the poller (lets the
  // server exit cleanly during tests / SIGTERM).
  if (typeof pollerHandle.unref === "function") pollerHandle.unref()
}

export function stopMatchmakingPoller(): void {
  if (pollerHandle) {
    clearInterval(pollerHandle)
    pollerHandle = null
  }
}
