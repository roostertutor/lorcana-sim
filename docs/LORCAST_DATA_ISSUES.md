# Lorcast Upstream Data Issues

This file tracks known data drift in the Lorcast API (https://api.lorcast.com/v0) — places where the upstream data is missing or wrong relative to the printed cards. We don't control any of this; the file exists so we can:

1. Detect when our local JSON drifts from upstream on a re-import.
2. Manually patch the local JSON when an upstream pull would silently regress us.
3. File upstream issues with concrete examples.

The importer's union-merge (`scripts/import-cards.ts`) defends against these issues — once a card has been corrected locally, a re-import will not blow the correction away. The audit script (`scripts/audit-lorcast-data.ts`) is the regression check; it covers three families:

1. **Upstream data drift** — keyword reminder lines in `rulesText` with no matching ability, or numeric keyword values missing from the API.
2. **Missing required scalars** — `singTogetherCost` or `shiftCost` not populated when the rules text specifies a value.
3. **Static effect-type mismatches** — `self_cost_reduction` wiping the full cost on a "you can play for free" card (should be `grant_play_for_free_self`), or "gains Shift N" wording without a `grant_shift_self` static.

```bash
pnpm audit-lorcast          # human-readable
pnpm audit-lorcast --json   # machine-readable
```

The audit is currently **clean**. The findings below are the historical drift we've already corrected in local data.

## Pattern A — keyword present in `text` but missing from `keywords[]`

Lorcast's API returns the rules text correctly but omits the keyword from the `keywords` array on certain cards. The importer reads the `keywords` array, so the keyword is silently dropped on import.

| Card | Set | Keyword | Notes |
|---|---|---|---|
| Cri-Kee — Good Luck Charm | 10 | alert | Discovered when re-importing set 10 mid-session. Lorcast returns `text: "Alert (...)"` and `keywords: []`. Manually corrected before importer hardening landed. |
| Gigi — Best in Snow | 11 | alert | Same shape as Cri-Kee. Manually corrected as part of the audit script's first run. |

The importer's union-merge now keeps any keyword that was previously present even if the new import omits it.

## Pattern B — keyword present but `value` field missing

Lorcast returns the keyword in `keywords[]` but doesn't supply a numeric value, so the importer's switch (which extracts `Boost N`, `Sing Together N`, etc. from text) doesn't get a chance to run unless we add explicit cases. Even when we do, the merge step needs to backfill the value from previous data so re-imports don't regress.

| Pattern | Cards affected (at last audit) | Notes |
|---|---|---|
| `boost N` value missing | ~16 across sets 10/11 (Wreck-it Ralph Raging Wrecker, Simba King in the Making, Lady Tremaine Sinister Socialite, Bambi Ethereal Fawn, Alice Well-Read Whisper, Goofy Ghost of Jacob Marley, Scrooge McDuck Ghostly Ebenezer, …) | The importer rescues these via `keywordsRescued` on union-merge. |
| `sing together N` value missing | ~20 across sets 4, 8, 9 | Tracked as scalar `singTogetherCost` field, not as a keyword ability. The audit treats the scalar as a satisfied source and stays quiet when it's set. |
| `shift N` value missing | (none currently) | Tracked as scalar `shiftCost` field. Treated like Sing Together. |

## Pattern C — `singTogetherCost` scalar field missing

The audit script now flags this case as `missing_scalar:sing together`. The check covers Sing Together (singTogetherCost) and Shift (shiftCost), since the engine reads those scalar fields directly when validating those actions.

The audit currently reports **0 missing scalars** — every Sing Together song and every Shift character in the local data has the correct scalar field. (Initially I expected ~6 missing songs based on a partial read of the JSON; verified after running the tightened audit that all songs were already populated.)

A future divergence — e.g. Lorcana errata that decouples Sing Together cost from the song's normal cost — would surface here as soon as the new card is imported.

## Pattern D — story name typos in API data

Lorcast occasionally returns ability story names with typos that don't match the printed card.

| Card | Set | API returns | Printed card says | Notes |
|---|---|---|---|---|
| Tinker Bell - Giant Fairy | P3 | PUN PIRATE! | PUNY PIRATE! | Every other printing (Set 1, Set 9) has "PUNY PIRATE!" correctly. Manually corrected in local data. |

The `pnpm card-status` story name validator catches these by comparing `abilities[].storyName` against `_namedAbilityStubs[].storyName`. If the promo stub has a typo, the validator flags the mismatch after the reprint sync copies the correct name from the main set.

## How to file upstream

Lorcast doesn't have a public issue tracker that we know of. If we accumulate enough patterns, we can DM the maintainer with an issue list referencing this doc.

## When to re-run the audit

- After every `pnpm import-cards` run (it's not part of the import script yet — could be wired in as a final step).
- Before tagging a release.
- When investigating "this card behaves wrong" reports — the audit may surface a missing keyword that's the actual root cause.
