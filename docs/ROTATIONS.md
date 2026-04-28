# Format Rotations — Runbook

What to do when Ravensburger announces a new rotation, drops a set, or
changes a banlist. The engine, server, and UI all carry rotation state;
this doc keeps them in sync.

> Read alongside `packages/engine/src/formats/legality.ts` (registries) and
> `server/src/db/schema.sql` (stored stamps + ELO keys).

---

## ⚠️ Pending refactor — matchmaking ship 2026-04-27

**Several runbook steps below are slated to simplify** when the matchmaking
ship lands (see `docs/HANDOFF.md` → "Engine agent: rotation registry
refactor" + "Server agent: casual + ranked matchmaking queues" entries).
Specifically:

1. **`decks.format_rotation` will be dropped entirely.** Decks will only
   carry `format_family`. Rotation becomes a per-game choice (server
   default = current live; per-game opt-in for staged rotation when one
   exists). This eliminates the per-set deck-restamp chore — runbook 2's
   "every existing deck needs migration" implication goes away.

2. **`RotationEntry` gains a `ranked: boolean` field.** Rotations now have
   2 explicit playable states: **staged** (offeredForNewDecks=true,
   ranked=false — test queue) and **live** (offeredForNewDecks=true,
   ranked=true). A retired rotation has offeredForNewDecks=false; no live
   games of any kind allowed (private OR queue), only historical reads.

3. **Infinity legalSets become per-rotation snapshots.** Today both
   `INFINITY_ROTATIONS.s11` and `INFINITY_ROTATIONS.s12` point at the same
   `INFINITY_ALL_SETS` constant — meaning an Infinity-s11 deck CAN run a
   set 12 card today, which is wrong. Post-refactor: s11 frozen at sets
   1-11, s12 frozen at sets 1-12, etc.

4. **Private lobbies become unconditionally unranked** (anti-collusion).
   Only the future Ranked queue updates ELO. Runbook 2's ELO-bucket
   coordination still matters but only for ranked-queue games.

The runbooks below describe the CURRENT shipped state. The matchmaking
ship will rewrite Runbook 2 (release day) significantly — see notes inline
below. Other runbooks (banlist, rotation-cut audit) are largely unchanged.

---

## Current state (as of 2026-04-21)

| Rotation | Family | Legal sets | Banlist | Offered for new decks | Status |
|---|---|---|---|---|---|
| `s11` | core | {5,6,7,8,9,10,11} | — | yes | live pre-Set-12 |
| `s12` | core | {5,6,7,8,9,10,11,12} | — | yes | Set 12 preview |
| `s11` | infinity | all sets + promos | hiram-flaversham-toymaker | yes | live |
| `s12` | infinity | all sets + promos | hiram-flaversham-toymaker | yes | Set 12 preview |

**Server defaults:** `'s11'` everywhere. **Planned switchover:** 2026-05-08
when Set 12 releases — bump defaults to `'s12'` (see runbook 2 below).

---

## The cadence

> Every 4 sets, the oldest 4 drop. Between cuts, new sets are additive.

So rotations evolve in a repeating pattern:

- **Additive step** (between cuts): new set Σ ships → rotation grows from
  `{N..Σ-1}` to `{N..Σ}`. s11→s12 is an additive step (added set 12).
- **Cut step** (every 4th set): new set Σ ships AND oldest 4 sets leave →
  rotation shrinks from `{N..Σ-1}` to `{N+4..Σ}`. s12→s13 will be a cut
  step (drops sets 5-8, adds set 13, yielding {9,10,11,12,13}).

Rotation ids are shared across families — `s11` means the same time window
in Core and Infinity. Only the `legalSets` / `banlist` differ.

**Rotations never leave the registry.** Decks stamped with `s11` keep
validating against `s11` forever, even after `s11.offeredForNewDecks` flips
to `false`. Removing a rotation entry would break stored decks.

---

## Runbook 1: Pre-release (new rotation appears alongside live)

**When:** Ravensburger announces the next set's official card list and it
stops being speculative. This is the window where both the live rotation
AND the upcoming rotation offer themselves for new deck creation so
players can start building for the new format before release day.

### Engine changes

1. **Add registry entries** at `packages/engine/src/formats/legality.ts`:

   ```ts
   // Extend the union:
   export type RotationId = "s11" | "s12" | "s13";  // add new id

   // Extend CORE_ROTATIONS:
   s13: {
     legalSets: new Set(["9", "10", "11", "12", "13"]),  // cut step example
     banlist: new Set<string>([]),
     offeredForNewDecks: true,
     displayName: "Set 13 Core",
   },

   // Extend INFINITY_ROTATIONS similarly — INFINITY_ALL_SETS only needs the
   // new set id added ("13"), then point both rotations at the same constant.
   ```

2. **Update tests** at `packages/engine/tests/legality.test.ts` — add cases
   exercising the new rotation: a card legal only in the new set gets
   accepted in the new rotation and rejected in the prior one.

3. **Verify**: `pnpm --filter engine test` (all tests pass), `pnpm card-status`
   (0 invalid).

### Server + UI

No server changes required during pre-release — the engine registry is the
single source of truth and the server auto-picks up new rotations via
`buildDefaultRatings()` in `gameService.ts`. Existing SQL defaults (`'s11'`)
stay correct because the LIVE rotation hasn't moved yet.

UI picker (once ui-specialist lands it) reads from `listOfferedRotations()`
and shows the new rotation alongside the live one automatically.

---

## Runbook 2 (post-refactor): Release day after matchmaking ship lands

> **Use this version once the matchmaking ship lands** (see HANDOFF entries:
> "Engine agent: rotation registry refactor" + "Server agent: casual +
> ranked matchmaking queues"). Until then, use Runbook 2 (current) below.

After the refactor, release day becomes ~10 minutes of work:

```ts
// packages/engine/src/formats/legality.ts
// ON 2026-05-08:
CORE_ROTATIONS = {
  s11: { ..., offeredForNewDecks: false, ranked: false },  // RETIRED — no new games
  s12: { ..., offeredForNewDecks: true,  ranked: true  },  // LIVE — was staged
};
INFINITY_ROTATIONS = {
  s11: { ..., offeredForNewDecks: false, ranked: false },  // RETIRED
  s12: { ..., offeredForNewDecks: true,  ranked: true  },  // LIVE
};
```

That's it. Two flag flips per registry. No per-deck migration (decks no
longer carry `format_rotation`). No SQL DEFAULT changes (rotation is
selected per-game, not stored on deck records).

UI auto-updates: deckbuilder shows Core-s12 as the only live Core rotation;
ranked queue dropdown filters to s12 only; stale s11 decks get the legality
drift indicator (`⚠️ N cards illegal`) with `[Edit deck]` / `[Migrate to
Infinity]` actions.

### Verification

```bash
# Engine
pnpm --filter engine test           # rotation tests pass with new flag values
```

```sql
-- Confirm no game records were created for retired rotations after the cut
SELECT COUNT(*) FROM games
WHERE format_rotation = 's11' AND created_at > '2026-05-08 00:00:00';
-- Should be 0 — server rejects new games on offeredForNewDecks=false

-- Active queue should have no entries for retired rotations
SELECT COUNT(*) FROM matchmaking_queue WHERE format_rotation = 's11';
-- Should be 0 — server rejected the join attempts
```

That's the whole runbook post-refactor.

---

## Runbook 2 (current — pre-matchmaking-ship): Release day (switch the live Core default)

**When:** the new set actually releases. Prior rotation stops being offered
for new decks (but remains in the registry for stored-deck validation).

**Concrete: 2026-05-08 for s11 → s12 switchover.**

### Step 1 — Engine

At `packages/engine/src/formats/legality.ts`, flip the prior rotation:

```ts
s11: {
  legalSets: new Set([...]),
  banlist: new Set<string>([]),
  offeredForNewDecks: false,   // was true
  displayName: "Set 11 Core",
},
```

Do this for BOTH `CORE_ROTATIONS.s11` AND `INFINITY_ROTATIONS.s11`.

Run `pnpm --filter engine test` to confirm nothing regresses.

### Step 2 — Server SQL defaults

In `server/src/db/schema.sql`, bump three DEFAULT clauses from `'s11'` to
`'s12'`:

```sql
ALTER TABLE decks ADD COLUMN IF NOT EXISTS format_rotation TEXT NOT NULL DEFAULT 's12';  -- was 's11'
ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS game_rotation TEXT NOT NULL DEFAULT 's12';  -- was 's11'
```

Then run against live Supabase to update the column defaults for FUTURE
rows (existing rows keep their stamps):

```sql
ALTER TABLE decks   ALTER COLUMN format_rotation SET DEFAULT 's12';
ALTER TABLE lobbies ALTER COLUMN game_rotation   SET DEFAULT 's12';
```

### Step 3 — Server code

In `server/src/routes/lobby.ts`, bump the fallback constant:

```ts
const DEFAULT_ROTATION: RotationId = "s12";  // was "s11"
```

This is the rotation assigned when a client creates a lobby without
explicitly sending `gameRotation` in the body.

### Step 4 — Verify

```sql
-- New decks/lobbies should stamp with s12
SELECT column_default FROM information_schema.columns
WHERE (table_name, column_name) IN
  (('decks','format_rotation'),('lobbies','game_rotation'));
-- Both should read: 's12'::text

-- Stored s11 decks still validate against s11 (untouched)
SELECT format_rotation, COUNT(*) FROM decks GROUP BY format_rotation;
```

Create a new deck through the UI — `SELECT format_rotation FROM decks ORDER
BY created_at DESC LIMIT 1` should return `s12`.

### Step 5 — GUI (coordinate with ui-specialist)

Format dropdown should already hide s11 automatically via
`listOfferedRotations("core")`. If a user opens an s11-stamped deck, it
should still render — but newly-created decks can't pick s11.

---

## Runbook 3: Rotation cut (oldest 4 sets drop)

**When:** every 4th set. Differs from a normal release because the new
rotation's legal-set list shrinks instead of grows.

Same steps as runbook 2, but with one extra consideration.

### Legacy-deck audit

When s12 → s13 cuts sets 5-8, existing s12-stamped decks that contain sets
5-8 cards are still legal *against their s12 stamp*. Users will need to
restamp them to s13 if they want to bring them to s13 events, and the
restamp will fail legality for any set 5-8 cards in the list.

Audit query to run post-cut:

```sql
-- How many stored decks will need restamping if owner wants s13 legal
SELECT COUNT(*) FROM decks
WHERE format_family = 'core' AND format_rotation = 's12';
```

GUI-side: the legality chip on `DecksPage` will light up if a user
restamps an old deck to the new rotation. Expected outcome — users
explicitly opt into the restamp, see issues, rebuild.

### Infinity is unaffected by cuts

Cuts only affect Core. Infinity rotations all point at the same
`INFINITY_ALL_SETS` constant; only the banlist progresses between them.

---

## Runbook 4: Adding or removing a banlist entry

### Adding a ban

At `packages/engine/src/formats/legality.ts`, add the card's `definitionId`
to `banlist` in the affected rotation(s). Then:

- `pnpm --filter engine test` (tests should fail on the banlist contents
  assertion — update the test to match).
- No server or SQL changes needed. `isLegalFor` on next `createLobby`
  rejects stored decks containing the newly-banned card.
- Players with the banned card already in a saved deck will see the
  legality chip turn red on next load (once GUI ships it).

### Removing a ban

Delete the `definitionId` from `banlist`. Tests pass. No SQL.

### Mid-rotation bans

If Ravensburger bans a card mid-rotation (not aligned with a rotation
release), decide: update the CURRENT rotation's banlist only, or all
active rotations. The CRD doesn't specify; treat it case-by-case. Document
the decision in `docs/DECISIONS.md`.

---

## Verification checklist (copy-paste for every rotation change)

```bash
# Engine
pnpm --filter engine test
pnpm card-status              # 0 invalid
```

```sql
-- Supabase SQL editor: check current defaults and backfill
SELECT table_name, column_name, column_default
FROM information_schema.columns
WHERE table_name IN ('decks','lobbies','profiles')
  AND (column_name LIKE '%format%' OR column_name LIKE '%rotation%' OR column_name = 'elo_ratings')
ORDER BY table_name, column_name;

-- Every row got backfilled (should all be 0)
SELECT COUNT(*) FROM decks    WHERE format_family IS NULL OR format_rotation IS NULL;
SELECT COUNT(*) FROM lobbies  WHERE game_format    IS NULL OR game_rotation   IS NULL;
SELECT COUNT(*) FROM profiles WHERE NOT (elo_ratings ? 'bo1_core_s11');

-- Distribution of stamps (sanity check)
SELECT format_family, format_rotation, COUNT(*) FROM decks
GROUP BY format_family, format_rotation;
```

---

## Troubleshooting

**Symptom:** server 400s on every `createLobby` with `Unknown rotation "sN"`.
**Cause:** server default or client sends a rotation id that isn't in the
engine registry. **Fix:** add the rotation entry to `CORE_ROTATIONS` /
`INFINITY_ROTATIONS` (runbook 1) before flipping the SQL default.

**Symptom:** stored deck throws "Unknown rotation" when loaded.
**Cause:** a rotation entry was deleted from the registry (don't do this).
**Fix:** restore the entry with `offeredForNewDecks: false`. Rotations
never leave the registry; only their "offered" flag changes.

**Symptom:** new deck stamps as the wrong rotation.
**Cause:** server SQL default not updated in step 2 above, OR
`DEFAULT_ROTATION` constant in `routes/lobby.ts` still points at the prior.
**Fix:** audit step 2 and step 3 together — both have to flip.

**Symptom:** ELO ratings "reset" after a rotation is added.
**Not a bug.** New rotations get new ELO keys (`bo1_core_s13` etc.)
initialized to 1200. Prior rotation's ratings stay under their key. This
is by design — players span rotations and their per-rotation skill can
differ.

**Symptom:** UI shows a rotation that shouldn't be offered.
**Cause:** `offeredForNewDecks` not flipped in runbook 2 step 1, or UI
cached the list. **Fix:** flip the flag, restart the UI dev server.

---

## Files touched by rotations (index)

| Change | File |
|---|---|
| Add/remove rotation, update banlist, flip `offeredForNewDecks` | `packages/engine/src/formats/legality.ts` |
| Tests for rotation behavior | `packages/engine/tests/legality.test.ts` |
| SQL column defaults (future rows) | `server/src/db/schema.sql` |
| Server fallback for clients not sending `gameRotation` | `server/src/routes/lobby.ts` (`DEFAULT_ROTATION`) |
| Card-data imports for a new set | `scripts/import-cards-rav.ts` (`pnpm import-cards --sets setN`) |
| Legacy-deck audit queries | run ad-hoc in Supabase SQL editor (see runbook 3) |

The engine is the single source of truth for what rotations exist; the
server stores which rotation a deck/match is stamped with; the UI reads
the registry for pickers and filters. If those three stay consistent, no
rotation change breaks anything.
