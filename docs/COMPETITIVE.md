# Competitive Landscape

Last updated: 2026-04-22. Drafted from a session briefing — sections marked **[needs briefing]** are my guesses and should be corrected by the user before anything downstream depends on them.

---

## The six tools

### duels.ink
**Positioning:** the incumbent Lorcana play client. Casual *and* competitive ELO-matched ranked play. Mobile-optimized but **landscape-on-phone**.
**Strength:** network effects — it's where players are. Execution quality on mobile is the strongest in the category right now.
**Weakness:** landscape orientation on phone is a UX compromise inherited from the physical-game mental model, not an active design choice. No sim-based analytics, no branching replay, no creator tooling. Play client only.
**Origin story worth remembering:** displaced Lorcanito.com (below) by being meaningfully better on mobile. Precedent says the market migrates fast when the mobile-UX delta is large enough.

### Lorcanito.com
**Positioning:** the original "full-featured" Lorcana simulator. Had ELO matchmaking, multiplayer, most of the feature surface before duels.ink existed.
**Strength (historical):** first-mover completeness.
**Weakness:** poor mobile execution. Users left fast when duels.ink shipped a better phone experience.
**Why it matters to us:** it's the cautionary precedent *and* the playbook. Lorcanito shows that (a) feature parity is not a moat, (b) the market will migrate for better mobile UX, (c) network effects transfer faster than incumbent assumptions predict. The same move can be run against duels.ink.

### Inktable.net
**Positioning:** solo simulator. No real-player multiplayer.
**Strength:** exists and fills a gap duels.ink doesn't (solo practice).
**Weakness:** "very bad bot" (per user briefing). Users are on Inktable because they *want* solo practice, not because Inktable serves them well.
**Why it matters to us:** Inktable is the tool the "I want to drill openings / test a deck / practice without pressure" segment reaches for, and it's serving them poorly. This is an addressable user pain our engine + RL pipeline are specifically aimed at. Secondary wedge under our main pitch.

### Inkdecks.com
**Positioning:** tournament-winning decklist database.
**Strength:** owns the "what are the winning decks" category. Reference destination for competitive players.
**Weakness:** database only — no play, no sim, no analytics beyond "people who won played this."
**Why it matters to us:** closes off the "tournament deck data" flywheel direction. We don't compete on tournament decklist hosting. Can potentially *consume* Inkdecks data (their deck archetypes → our Monte Carlo sim → deeper analytics than they can produce) — if their licensing allows.

### Dreamborn.ink **[needs briefing]**
**Positioning (guess):** deckbuilder + collection tracker. Strong SEO presence for Lorcana card lookups.
**Open questions:** current feature set beyond deckbuilding? Does it do any play / sim / analytics? How large is the active user base?
**Why it matters to us (if guess is right):** it's the deckbuilder surface. Our own deckbuilder exists but is not a wedge — Dreamborn probably dominates that category. We should not position as "better deckbuilder"; our deckbuilder is a utility, not a product.

### Pixelborn **[needs briefing]**
**Positioning (guess):** open-source Lorcana simulator / play client. Technical audience.
**Open questions:** how active is it? Who actually uses it — devs, cheaters, analysts, casual players? Does it offer anything duels.ink doesn't?
**Why it matters to us (if guess is right):** probably a small community, doesn't threaten our positioning directly, but worth tracking because it's the closest "open engine" cousin to what we're building. If their engine is strong, we should know.

---

## Namespace map

Pattern usage in the Lorcana third-party tool space:

- `.ink` TLD → duels.ink, Dreamborn.ink (the "play client" TLD signal)
- `.com` → Lorcanito.com, Inkdecks.com (the "serious/adult" signal — analytics/database tools)
- `.net` → Inktable.net (uncommon; weaker signal)
- `Ink-<noun>` prefix → Inktable, Inkdecks (plus Inkline/Inklab if we used them — we shouldn't)
- `<word>-born` suffix → Dreamborn, Floodborn (adjacent)
- `Lorcan-<diminutive>` → Lorcanito

**Takeaway for brand/naming:**
1. `.ink` TLD reads as "play client, expect duels.ink comparison." Avoid.
2. `Ink-` prefix is a saturated namespace. Avoid — we'd read as "another ink tool" even if the content is different.
3. `-born` suffix is a Dreamborn-adjacent cluster. Avoid.
4. Spanish/diminutive plays are Lorcanito's territory. Avoid.
5. **Open territory:** music/theater/manuscript vocabulary (reprise, refrain, gloss, folio, codex-variants), abstract one-syllable names, non-ink-coded metaphors generally.

---

## Where the gaps are

Mapping the six tools against plausible product categories:

| Category | Tool(s) that occupy it | Gap? |
|---|---|---|
| Mobile-first play client | duels.ink (landscape-on-phone) | **Yes — portrait-first is untried in Lorcana.** |
| Solo practice with a good bot | Inktable (bad bot) | **Yes — Inktable is addressable.** |
| Deterministic engine / Monte Carlo sim | nobody | **Yes — unique to us.** |
| What-if branching replay | nobody | **Yes — unique to us.** |
| Creator tooling (clip export, scenario URLs, annotations, scripted opponents) | nobody | **Yes — unique to us.** |
| Deckbuilder + collection | Dreamborn (probably) | No — utility, don't compete. |
| Tournament deck database | Inkdecks | No — consume, don't compete. |
| Casual ranked MP | duels.ink | Partial — we contest via better mobile UX, but network effects are real. |
| Competitive ELO MP | duels.ink | Partial — same as above. |

Five genuinely open categories is a strong position. The competitive claim is not "we have one thing nobody has" — it's "we occupy five categories nobody occupies, united by engine + mobile-UX differentiation."

---

## What to do about it

See `docs/STRATEGY.md` for the positioning + priority implications of this map.
