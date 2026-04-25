# Product Strategy

Last updated: 2026-04-22. Last reconciled: 2026-04-24 (portrait-first-as-signature framing dropped; replaced with chrome-craft-first per user empirical data on duels.ink — they ship both phone orientations). Supersedes the earlier "content-creation + data-collection pivot" framing once reviewed. Companion docs: `docs/COMPETITIVE.md`, `docs/BRAND.md`, `docs/ROADMAP.md`.

---

## The one-liner

> **Lorcana, with less chrome and more game — on every screen. Plus a bot that doesn't suck, sim-based deck analytics, and real tools for creators.**

Tagline: **"Lorcana, with less chrome and more game."**

---

## What we are

A **chrome-efficient Lorcana play client, simulator, and creator toolkit** — built on a deterministic headless engine that powers three things no competitor offers:

1. **Monte Carlo sim-based deck analytics** (thousands of games per deck, per matchup).
2. **What-if branching replay** (rewind any game, change any decision, see what happens).
3. **Clone-trainer bot infrastructure** (train bots from real play, use as practice partners).

The engine is the moat. The execution craft — visibly more game per screen, in any orientation — is the wedge. The creator toolkit and analytics are the proof points.

---

## Competitive positioning

**Primary target: duels.ink** — on the axis of execution craft, via chrome efficiency on phone (both orientations).

Rationale (see `docs/COMPETITIVE.md` for full map):

- duels.ink displaced Lorcanito.com by shipping meaningfully better mobile UX. The precedent says the Lorcana market migrates for visible execution wins.
- duels.ink ships both phone orientations: portrait is "okay," landscape is "not polished" (per user empirical comparison, 2026-04-24). Their desktop is good — desktop is parity territory, not a wedge.
- The visible-execution gap on duels is **chrome density**: bars, padding, and controls eat into the per-screen game state. Less chrome, more game is the headline craft claim, demonstrable side-by-side in any orientation.
- Phone-landscape is duels's weakest surface. We support it on top of the chrome-efficiency baseline as a defensible secondary wedge — not as the headline.

**Secondary target: Inktable.net** — displacement via bot quality.

Solo practice is a real user need Inktable serves badly. Our RL pipeline + deterministic engine are aimed exactly at the gap. Head-to-head on bot quality is an empirical, demonstrable win.

**Not competing:**
- **duels.ink on desktop** — they're already good there. Parity is fine; we don't market against it.
- **Dreamborn.ink on deckbuilding** — utility, not a wedge. Our deckbuilder exists but we don't market against theirs.
- **Inkdecks.com on tournament deck hosting** — consume their data (if permissible), don't compete on the category.

---

## Three audiences, three pitches, one claim

All three unified under "Lorcana, with less chrome and more game."

| Audience | Pitch | Day-one proof point |
|---|---|---|
| **duels.ink users on phone** | Less chrome, more game. Both orientations supported; landscape genuinely polished (their weakest surface). | Side-by-side same-situation comparison: how much of the screen is *game state* vs. chrome. Demonstrable in any orientation. |
| **Inktable users (solo practice)** | Good bot. Real analytics. Works on phone. | Bot head-to-head benchmark. Monte Carlo output. |
| **Creators (YT/Twitch/TikTok)** | Tools nobody else ships. Sandbox, branching replay, clip export, scenario URLs. | Demo video: creator goes from replay → annotated clip in under 2 minutes. Same clip-export workflow doubles as the proof surface for the chrome-craft claim against duels. |

The unified claim gives the brand coherence even as the three pitches target different surfaces: creators get their tool, Inktable converts get their bot, duels.ink users get the cleaner phone experience.

---

## Explicit commitments

These are the decisions we're locking in so downstream work can align:

### 1. Chrome-craft first; both phone orientations supported
- Phone = **both portrait and landscape**, because users hold phones both ways and our claim is craft, not orientation. Each orientation must out-execute duels on chrome density.
- Phone-landscape gets explicit polish investment because it's duels's weakest surface — defensible secondary wedge once the chrome-craft baseline is in.
- Tablet = responsive, same craft principle.
- Desktop = parity is the bar. duels is already good there; we don't market against duels on desktop. Creator workflows and deep analysis are desktop-shaped, but the wedge claim is phone.
- Measurable craft target: per-screen pixel-budget delta vs. duels in the same situation. "Less chrome, more game" needs to be demonstrable in screenshots, not asserted.

This is a product decision at the strategy level, not a UI-specialist implementation detail. Implementation details (character grid layout, hand treatment, scrollable zones, orientation-switch behavior) belong to ui-specialist once the commitment is made.

### 2. Bot-first empty-lobby fallback
- The day-one user-acquisition funnel leads with **play immediately**, not with **wait for a match**.
- If MP lobby is empty (guaranteed on day one), the practice bot must be the default first-session experience. A mediocre-but-usable bot shipped immediately is worth more than a better bot shipped in three months.
- This makes the pre-trained baseline bot the single upstream blocker for the entire positioning. Without it, "better mobile Lorcana" collapses to "empty lobby" on first run.

### 3. duels.ink is the comparative benchmark on phone, not the feature template
- Every phone UX decision gets evaluated against: *is there visibly more game and less chrome than duels in the same situation?*
- We do NOT copy their feature set. Reasoning from first principles about what a phone-native Lorcana game looks like is what produces the chrome-density delta.
- Desktop is excluded from the comparative benchmark — duels is already good there, parity is acceptable, don't market against it.
- The screenshot test (from `.claude/memory/feedback_visual_identity.md`) still applies: a duels.ink user should think *"this is [our app]"*, not *"this is a duels.ink clone."*

### 4. Creator tooling is the data flywheel, not ladder play
- Ladder-as-training-data is conceded to duels.ink (they have the network effect on competitive play).
- Our flywheel: **solo-practice play + creator uploads → bot training → better bot → more solo users + more creators.** Tied directly to the product surfaces we actually own.
- Creator tooling is therefore **first-tier strategic**, not secondary. It's the mechanism by which the data loop closes.

### 5. Engine + determinism stays the moat
- What-if branching, Monte Carlo sim, clone training all depend on deterministic headless engine.
- This is the thing duels.ink, Inktable, Lorcanito, Pixelborn don't have (as far as we know) and probably can't add without rewriting their engine. Protect it.

---

## Revised priority list

Replaces `project_near_term_priorities.md` memory entry from 2026-04-16.

### P0 — Blocks the whole pitch

1. **Pre-trained baseline RL policy shipped with the app.** Without it, the empty-lobby fallback doesn't exist and the mobile-UX pitch collapses on first open. Even a mediocre bot is enough for launch.

### P1 — Core product claim

2. **Phone gameboard chrome-density redesign — both orientations.** The central competitive claim. This is a redesign, not a polish pass — character grid layout, hand treatment, scrollable/stacked zones, scoreboard placement, every chrome element evaluated against pixel budget. Both portrait and landscape ship; landscape gets explicit polish because it's duels's weakest surface. Owned by ui-specialist once specced.
3. **Deploy MP to production (OAuth + Railway).** The lobby half of the pitch needs to actually function. Even if lobbies are empty on day one, the infrastructure must be ready so they can populate as users arrive.

### P2 — Differentiation proof points

4. **Creator tooling sweep.** Clip/GIF export first (highest viral surface), then scenario URLs, annotations, scripted opponents. This is now first-tier flywheel, not "nice to have."
5. **Verify ELO updates fire post-game.** Quiet correctness issue; important because leaderboards are part of the competitive-credibility narrative.
6. **Bot quality head-to-head benchmark vs. Inktable.** Empirical ammo for the Inktable-displacement pitch.

### P3 — Polish and compounding

7. Monte Carlo analytics surfaced in UI (pre-play deck analyzer, matchup breakdowns).
8. Deck versioning Phase 2 (game-linkage).
9. Scenario library / curated openings for creator content.

---

## Risks and mitigations

### 1. Execution-quality bar is high
**Risk:** beating duels.ink on chrome density is a real design-and-engineering project. Lorcana's wide board (up to ~8 characters per side, inkwell, discard, deck, locations) burns pixels just to display required state. If we ship a "less chrome" claim that doesn't actually demonstrate visibly more game per screen than duels in either orientation, the pitch inverts: *"they said cleaner; I compared; not really."*
**Mitigation:** don't publicly claim "less chrome, more game" until side-by-side same-situation comparisons in both orientations show a clear pixel-budget delta, *and* mobile-UX testing with ≥10 real Lorcana players produces unprompted "this is noticeably cleaner" feedback. Internal milestone, not a shipping gate.

### 2. Day-one empty-lobby problem
**Risk:** even with great mobile UX, first-session users who can't find a match exit unhappy.
**Mitigation:** P0 bot + default-to-solo first-run flow. MP presented as "play a real person" opt-in from within the app, not as the landing experience.

### 3. Chrome-craft claim is hard to communicate visually
**Risk:** "less chrome, more game" is a craft claim, not a billboard claim. There is no single screenshot gut-punch the way a portrait-vs-landscape comparison would have produced. Audiences may not register a pixel-budget delta from a static thumbnail; the win has to be demonstrated, not asserted.
**Mitigation:** lean on the creator-flywheel commitment (commitment #4). Same-situation side-by-side clip exports — same board state in our app vs duels — make the delta visible in motion, in context, with live commentary. The clip-export tooling is already P2 and is already needed for the creator pitch, so the marketing surface piggybacks on infrastructure we're building anyway. Plan a "comparison clip" content beat at the launch milestone; budget creator partnerships against that.

### 4. Incumbent response window
**Risk:** if chrome-density wins and we grow visibly, duels.ink can polish their chrome too — chrome efficiency is craft, but it's not architecturally hard for them. Our moat window is the time between "visible growth" and "duels.ink ships a tighter UI." Engine-backed features (Monte Carlo, branching replay, clone-training) are the harder-to-copy layer beneath the chrome wedge.
**Mitigation:** lock brand identity (name + wordmark + signature features) *before* growth is visible. Pair the chrome-craft pitch with engine-backed proof points (analytics, branching replay) early, so the surface claim doesn't have to carry the full differentiation weight alone. This is the BRAND.md + creator-flywheel work.

### 5. Engine-moat depends on continued engine investment
**Risk:** Monte Carlo + what-if + clone-training only matter if they're visibly better than what competitors have. If we stop investing in engine capability, the differentiation erodes.
**Mitigation:** protect engine work as first-class even while mobile UX is the visible pitch. Engine PRs don't block on UI deliverables.

---

## What this doc is not

- **Not a roadmap.** Feature sequencing and milestone dates belong in `docs/ROADMAP.md`.
- **Not a spec.** Implementation details belong in `docs/SPEC.md`, `docs/MULTIPLAYER.md`, UI specs when written.
- **Not a brand doc.** Name, wordmark, visual identity belong in `docs/BRAND.md`.

This doc answers *why* and *what for*. Everything else answers *how* and *when*.
