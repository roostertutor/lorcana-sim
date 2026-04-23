# Product Strategy

Last updated: 2026-04-22. Supersedes the earlier "content-creation + data-collection pivot" framing once reviewed. Companion docs: `docs/COMPETITIVE.md`, `docs/BRAND.md`, `docs/ROADMAP.md`.

---

## The one-liner

> **Lorcana, actually built for your phone. Portrait-first, one-handed, no rotation — plus a bot that doesn't suck, sim-based deck analytics, and real tools for creators.**

Tagline candidate: **"Lorcana, on your phone, done right."**

---

## What we are

A **portrait-first mobile Lorcana play client, simulator, and creator toolkit**, built on a deterministic headless engine that powers three things no competitor offers:

1. **Monte Carlo sim-based deck analytics** (thousands of games per deck, per matchup).
2. **What-if branching replay** (rewind any game, change any decision, see what happens).
3. **Clone-trainer bot infrastructure** (train bots from real play, use as practice partners).

The engine is the moat. The mobile experience is the wedge. The creator toolkit and analytics are the proof points.

---

## Competitive positioning

**Primary target: duels.ink** — on the axis of mobile UX, via portrait-first design.

Rationale (see `docs/COMPETITIVE.md` for full map):

- duels.ink displaced Lorcanito.com by shipping meaningfully better mobile UX. The precedent says the Lorcana market migrates for mobile-UX wins.
- duels.ink is landscape-on-phone, which is a compromise inherited from the physical-game mental model, not an active design choice. Portrait-first is the move they didn't make.
- Portrait-first TCG-on-phone is genuinely untried in Lorcana. Marvel Snap is the cross-category proof that portrait-first TCGs can become signature identities.

**Secondary target: Inktable.net** — displacement via bot quality.

Solo practice is a real user need Inktable serves badly. Our RL pipeline + deterministic engine are aimed exactly at the gap. Head-to-head on bot quality is an empirical, demonstrable win.

**Not competing:**
- **Dreamborn.ink on deckbuilding** — utility, not a wedge. Our deckbuilder exists but we don't market against theirs.
- **Inkdecks.com on tournament deck hosting** — consume their data (if permissible), don't compete on the category.

---

## Three audiences, three pitches, one claim

All three unified under "Lorcana, done right on your phone."

| Audience | Pitch | Day-one proof point |
|---|---|---|
| **duels.ink users on mobile** | Better mobile experience. Portrait-first, one-handed, no rotation. | Side-by-side screenshot + 30-sec demo video. Portrait vs. landscape-on-phone is a visual gut-punch. |
| **Inktable users (solo practice)** | Good bot. Real analytics. Works on phone. | Bot head-to-head benchmark. Monte Carlo output. |
| **Creators (YT/Twitch/TikTok)** | Tools nobody else ships. Sandbox, branching replay, clip export, scenario URLs. | Demo video: creator goes from replay → annotated clip in under 2 minutes. |

The unified claim gives the brand coherence even as the three pitches target different surfaces: creators get their tool, Inktable converts get their bot, duels.ink users get the mobile experience.

---

## Explicit commitments

These are the decisions we're locking in so downstream work can align:

### 1. Portrait-first on phone
- Phone = portrait orientation. **No landscape mode on phone.** The signature choice forces consistent screenshots and identity.
- Tablet = responsive. Landscape allowed in hand, portrait acceptable standing.
- Desktop = landscape primary. Creator workflows and deep analysis are desktop-shaped.

This is a product decision at the strategy level, not a UI-specialist implementation detail. Implementation details (character grid layout, hand treatment, scrollable zones) belong to ui-specialist once the commitment is made.

### 2. Bot-first empty-lobby fallback
- The day-one user-acquisition funnel leads with **play immediately**, not with **wait for a match**.
- If MP lobby is empty (guaranteed on day one), the practice bot must be the default first-session experience. A mediocre-but-usable bot shipped immediately is worth more than a better bot shipped in three months.
- This makes the pre-trained baseline bot the single upstream blocker for the entire positioning. Without it, "better mobile Lorcana" collapses to "empty lobby" on first run.

### 3. duels.ink is the comparative benchmark, not the feature template
- Every UX decision gets evaluated against: *does this feel better than duels.ink on a phone?*
- We do NOT copy their feature set. Portrait-first means we inherit none of their landscape conventions by default; we reason from first principles about what a phone-native Lorcana game looks like.
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

2. **Portrait-first mobile gameboard.** The central competitive claim. This is a redesign, not a polish pass — character grid layout, hand treatment, scrollable/stacked zones, scoreboard placement, everything. Owned by ui-specialist once specced.
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
**Risk:** beating duels.ink on mobile UX is a real design-and-engineering project. Lorcana's wide board (up to ~8 characters per side, inkwell, discard, deck, locations) is structurally hostile to portrait layout. If we ship "portrait mode" that doesn't actually feel better than landscape-on-phone, the pitch inverts: *"they said better; I compared; not really."*
**Mitigation:** don't publicly claim "better than duels.ink" until mobile-UX testing with ≥10 real Lorcana players produces unprompted "this is noticeably better" feedback. Internal milestone, not a shipping gate.

### 2. Day-one empty-lobby problem
**Risk:** even with great mobile UX, first-session users who can't find a match exit unhappy.
**Mitigation:** P0 bot + default-to-solo first-run flow. MP presented as "play a real person" opt-in from within the app, not as the landing experience.

### 3. Portrait hypothesis may fail
**Risk:** users may prefer landscape for Lorcana because physical play is landscape. We may build portrait-first and find users want a landscape toggle, which undermines the signature-identity argument.
**Mitigation:** prototype + usability test before full redesign commitment. Specifically test: does a hypothetical portrait layout actually feel better on phone for a 10-minute Lorcana game, or does the wide-board compromise dominate? Accept the possibility of going back to the drawing board.

### 4. Incumbent response window
**Risk:** if portrait-first works and we grow visibly, duels.ink can copy it. Our moat window is the time between "visible growth" and "duels.ink ships portrait."
**Mitigation:** lock brand identity (name + wordmark + signature features) *before* growth is visible, so portrait-Lorcana gets associated with us, not with "a thing duels.ink also added." This is the BRAND.md work.

### 5. Engine-moat depends on continued engine investment
**Risk:** Monte Carlo + what-if + clone-training only matter if they're visibly better than what competitors have. If we stop investing in engine capability, the differentiation erodes.
**Mitigation:** protect engine work as first-class even while mobile UX is the visible pitch. Engine PRs don't block on UI deliverables.

---

## What this doc is not

- **Not a roadmap.** Feature sequencing and milestone dates belong in `docs/ROADMAP.md`.
- **Not a spec.** Implementation details belong in `docs/SPEC.md`, `docs/MULTIPLAYER.md`, UI specs when written.
- **Not a brand doc.** Name, wordmark, visual identity belong in `docs/BRAND.md`.

This doc answers *why* and *what for*. Everything else answers *how* and *when*.
