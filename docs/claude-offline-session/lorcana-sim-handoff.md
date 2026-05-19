# Lorcana TCG Simulator — Brainstorm Handoff Doc

> **Purpose of this doc:** Output of a brainstorm session for an in-progress Lorcana sim. Use this in Claude Code to compare against what's already built and decide what to keep, refactor, or defer. No code in this doc — it's all priorities, architecture concepts, and product decisions.

---

## TL;DR

A solo-dev, no-timeline, quality-first online Lorcana sim targeting **competitive players** on **mobile + desktop** with **full rules enforcement**, **server-authoritative networking**, **ranked ladder**, **event-sourced engine** (for replays and future RL), and **modest cost-covering monetization** via Patreon/cosmetics. Differentiation rests on engine correctness, mobile quality, replay/scouting tools, meta dashboard, and being a trustworthy operator.

---

## Project Profile (decisions locked in this session)

| Dimension | Decision |
| --- | --- |
| Audience | Public — competitive players testing decks |
| Play modes | Online multiplayer 1v1 (server-authoritative). **Hot-seat dropped.** AI opponent is post-v1. |
| Rules enforcement | Fully enforced — engine blocks illegal plays |
| Platforms | Mobile + desktop + tablet (responsive, single codebase) |
| Ranked play | Yes — ladder + seasons |
| Dev situation | Solo, no timeline pressure, quality first |
| Monetization | Tentative: Patreon + cosmetic-only perks (revisit once T2 is live) |
| Card art | Host real art; architect for swap-to-user-supplied if IP pressure comes |
| Replay system | Priority — captured day one, viewer in T2 |
| Tournaments | In-app Swiss/single-elim eventually (T3) |
| Stats / meta dashboard | Priority differentiator (T2) |
| Push notifications | Nice-to-have, low priority |

---

## Tier Structure (build order)

### Tier 0 — Foundation
*Architectural choices that everything else depends on. Get these wrong and refactoring later is painful.*

- **Event-sourced game engine**, headless, deterministic
  - Every action is an immutable event; game state is a fold over the event stream
  - Same events → same state (enables replays, dispute resolution, AI training, time-travel debugging)
  - Engine has no UI coupling — pure `(state, action) → new state`
- **Card effect system**
  - Effect primitives + composition (Draw, Banish, DealDamage, GainLore, Ready, MoveToInkwell, Search, ReturnToHand, etc.)
  - Conditions and modifiers as first-class queries over game state, not stringly-typed
  - Targeting prompts as separate awaitable primitives (multi-target, restrictions, replacement if invalid)
  - Choice points (modal abilities, X costs, "you may" optional triggers) handled uniformly
  - Code escape hatch for special snowflakes (~5% of cards won't fit pure data)
- **Server-authoritative networking**
  - Server runs the engine; clients render and send intents
  - All randomness (shuffles, etc.) generated and stored server-side as events
  - Versioned protocol from day one (WebSocket + JSON is fine; binary later if bandwidth bites)
- **Card data model**
  - Schema includes inks, cost, type, stats, classifications, keywords with params, structured abilities, format legality flags, errata version, localization, art URL (swappable)
  - Errata: cards get reworded; old replays resolve against rules as they were at the time
- **Format system as data**
  - Format = set list + ban list + min/max deck size + sideboard rules + special constraints
  - Don't hardcode "60 cards" — limited formats use 40-card pools
- **Auth + accounts**
  - Email/OAuth. Display name + handle (`@ryan`). Profanity-filtered. Rate-limited name changes.
  - 2FA optional but encouraged for ranked
- **IP risk posture baked into architecture**
  - Art URL is a property of the card record; supports fallback chain (user-supplied → official → text-only)
  - Card data and gameplay logic independent of art assets

### Tier 1 — v1 Launch
*Minimum viable competitive sim.*

- Full rules enforcement for current Lorcana card pool
- 1v1 networked play (server-authoritative)
- Minimal deckbuilder with **Dreamborn / Inkdecks import** (don't compete with them — integrate)
- Core Constructed format
- Reconnect handling (2–3 min window; opponent sees countdown; server holds state)
- Mobile-friendly responsive UX (phone, tablet, desktop — different presets per form factor)
- Game log (human-readable + machine-readable event stream from same source)
- **Replay capture** (event stream stored; viewer minimal — playback start to finish, no scrub yet)
- Basic profile (handle, display name, W/L stats)
- Friends list (mutual), block list (absolute)
- Predefined emote chat (~10–20 phrases, no free text, rate-limited, mutable)
- Concede + turn timer + chess-clock (e.g., 25-min total bank + 75s per-turn)
- Anti-abuse basics:
  - Username profanity filter + protected name reservations (Mod, Admin, Official, etc.)
  - Queue-dodge rate limits
  - Per-action rate limits
- Scrim/private match via invite code (covers 80% of "play a specific friend" needs)
- Bug report flow with replay attached automatically

### Tier 2 — Competitive Credibility
*What makes this **the** sim competitive players prefer.*

- Ranked ladder + seasons + matchmaking (Glicko or similar)
- Placement matches for new accounts; accelerated MMR for high win-rate accounts (anti-smurf)
- Replay viewer with timeline scrub, key-moment auto-tagging, annotations, share via link
- Replay branching ("what if I'd played differently from turn 5?" — runs sandbox from state)
- Public replay browser (with delay + privacy tier)
- Spectator mode, tiered:
  - **Streamer mode**: enforced delay, anti-stream-snipe, OBS-friendly overlay output
  - **Friend spectate**: live, with permission
  - **Public ranked spectate**: 30–60s delay, no hand visibility for non-privileged spectators
- Meta dashboard (aggregated anonymous stats: archetype win rates, ink-pair distributions, turn metrics, opening hand analysis)
- Infinity format support
- New-set pipeline (target 48-hour turnaround on new releases)
- Streamer/OBS-friendly mode (chroma-key, decklist showcase, hide-hand toggle)
- Push notifications on mobile (your turn, match found, reconnect window closing)
- Cross-device session handoff (start match on desktop, finish on phone)

### Tier 3 — Platform Features
*Turns the sim into a community hub.*

- In-app tournament tooling
  - Single-elim → Swiss → cuts (8-player single-elim first; Swiss + cuts later within T3)
  - Round timer, slow-play warnings, auto-extension
  - Judge tooling: flag a moment, judge spectator with both hands visible
  - Pre-tournament decklist registration with lock at deadline
  - Substitution / late-reg / drop handling
  - Tiebreakers (opponent match-win % etc.)
- Teams / guilds
  - Tag prefix on display name (`[BOLT] @ryan`)
  - Team page (roster, aggregate stats, recent tournament results)
  - Team tournaments
  - Team rivalry stats dashboard
- Patreon integration + cosmetic shop
  - Card backs, playmats, avatars, profile frames, UI themes, emote packs, titles
  - **All original/non-Disney art** — IP-safe surface
- In-game currency (earned; cosmetic-only; never gates gameplay or cards)
  - Optional dual-currency model (earned + premium) if Patreon proves out
- Tournament history, trophy room, season titles
- Internationalization
  - EN first; then FR, DE, IT, JP per Lorcana market priority
  - Card text in user's language; UI strings; timezone handling
- Accessibility pass
  - Colorblind-friendly ink indicators (shape/pattern, not just color)
  - Text size scaling
  - Screen reader support for log and game state
  - Reduced motion option

### Tier 4 — Advanced & Speculative
*High-value, high-effort. Earn the right to build these via T1–T3 success.*

- **Limited formats**: Sealed, Booster Draft, Pack Rush, Phantom Draft
  - Pack-opening simulation with rarity-weighted random
  - Async/sync draft session management
  - Ephemeral card pools
  - Tight tournament integration (draft → 3 rounds Swiss pattern)
- **RL training pipeline**
  - Anonymized event streams → training database (opt-out, GDPR-compliant)
  - Canonical state + action encoding for ML consumption
  - Headless engine must run thousands of games/sec/core (T0 architecture decision pays off here)
  - Hybrid approach (imitation learning on human games → self-play fine-tune) most pragmatic
- **AI opponent** (powered by RL)
  - Practice modes, training wheels, "recommended play" hints in casual
- **Solver-style position evaluation** in replay viewer ("this state is +3 lore-equivalent for player A")
- **Public dataset release** for Lorcana ML research — community goodwill + marketing
- **Public API** for third-party tools (deck analyzers, stat trackers, content creators)
- **Premium subscription tier** if Patreon model demonstrates demand

---

## Cross-Cutting Concerns (every tier)

- **Performance budget**
  - Mobile cold start under 3s
  - 30fps stable floor for animations; 60fps target
  - Re-establish connection after backgrounding under 2s
  - Lazy-load card images; never ship full set at install
- **Telemetry & ops**
  - Crash reporting (Sentry or equivalent)
  - Opt-out analytics
  - Server health dashboard
  - Automated alerts on engine errors during ranked games (five-alarm fire)
- **Test suite**
  - Engine unit tests — every triggered ability gets at least one scripted scenario
  - Property tests over the event stream (state determinism, no negative lore, etc.)
  - Regression test corpus grows with every reported engine bug
- **IP risk readiness**
  - Art URL swap-pathway can be activated in <1 week
  - Takedown-on-request policy stated in TOS
  - No Disney IP in any cosmetic/monetized assets
- **Privacy / GDPR**
  - Account deletion / right-to-erasure flow
  - Opt-out for analytics, replay data, RL training data
  - Data export on user request
- **Disaster recovery**
  - DB backups (ranked players will riot if a season's matches disappear)
  - Event log is the source of truth — even if state is corrupted, replay from events reconstructs it
- **Legal hygiene**
  - LLC or equivalent entity for receiving donations
  - Clear TOS with no prize-money language, no endorsement of third-party events

---

## Non-Goals (things we're **not** doing)

Explicit non-goals exist so you can say "no" later without re-litigating.

- **Hot-seat single-device mode.** Cut from scope.
- **Free-text chat in matches.** Predefined emotes only — moderation nightmare otherwise.
- **In-app DMs between users.** Discord exists. Solo-dev moderation load is unsupportable.
- **Deck database / community deck-sharing platform.** Dreamborn and Inkdecks own this; integrate with them, don't compete.
- **Best-in-class deckbuilder.** Build a *functional* one; the flagship is the simulator.
- **Real-money prize tournaments.** Gambling regulation, tax reporting, IP risk all increase. Third parties may run their own events using the platform; we don't endorse.
- **Loot boxes or any randomized monetization.** Regulatory and IP risk.
- **Ads.** Hostile to competitive experience; signals "real business" to Disney legal.
- **Pay-to-win or pay-to-grind-skip.** Two queued players must be equal in capability; only skill and deck choice differ.
- **Cards gated behind grinding or purchases.** All cards available to all players.
- **Collection management.** Competitive sims don't have "collections" — players test decks freely.
- **Ravensburger official endorsement.** This is a fan project. Don't seek formal partnership; don't claim it.
- **Selling user data.**
- **Native iOS/Android apps in v1.** Mobile web (PWA) is sufficient. Native is a T2/T3 question if PWA limits hurt.
- **AI opponent at launch.** T4 feature.
- **Limited formats at launch.** T4 feature; architect format system to accept them.
- **Best chat experience.** Functional and non-toxic is the bar.
- **Social feed / activity stream.** Not building a social network.

---

## Architectural Principles

These are the load-bearing decisions worth defending against scope creep and "quick fix" temptations.

1. **The engine is the product.** Every other feature derives value from a correct engine. Bugs here cost user trust faster than anywhere else.
2. **Event sourcing is foundational, not optional.** Replays, dispute resolution, RL data, server reconnect, time-travel debugging all depend on it.
3. **Server is authoritative; clients are renderers.** Never trust client state for game decisions. Never expose hidden info to the wrong client.
4. **Card effects are data where possible, code where necessary.** A small effect-primitive vocabulary + composition handles ~75% of cards. The remaining 25% need richer expression (conditionals, queries, references) or code escape hatches. Don't pretend the 5% snowflakes fit pure data.
5. **Format is data, not hardcoded.** Deck size, legality, ban list, sideboard rules all configurable. Future formats slot in without engine changes.
6. **The headless engine runs games at thousands per second per core.** Not for v1, but the architecture must permit it — for RL, for replays, for engine testing, for "what if" branching.
7. **Mobile is a first-class platform, not a port.** Different UX preset, same codebase, responsive design.
8. **Errata versioning matters.** Replays must resolve against the rules as they were when the game was played.
9. **Opt-out, not opt-in, for data collection** — but transparently disclosed. Competitive players want benefits of aggregation but expect honesty.
10. **Don't build moderation tools you can't afford to staff.** Predefined chat, automated filters, async report queue. No live moderation, no real-time intervention.

---

## Competitive Differentiation Strategy

Where to invest energy to stand out in the existing fan-sim landscape (Lorcana-Tabletop, Pixelborn, Inkdecks ecosystem):

1. **Bug-free engine** — the single most important reputation factor for competitive sims.
2. **Native-feeling mobile** — gap in the current market; competitive players want to grind ranked on the go.
3. **Replay system + scouting** — competitive players live in tools like this (cf. HSReplay, Untapped).
4. **Meta dashboard** — real, current, anonymized data from your own user base.
5. **First-party tournament tooling** — even basic single-elim with judge tools beats Discord+Challonge+screenshots.
6. **48-hour new-set turnaround** — sets ship, you're playing them; competitors take weeks.
7. **Open data** — publish anonymized aggregates and datasets. Content creators and theorycrafters use you; that's free marketing.
8. **One-click deck import from Dreamborn/Inkdecks** — friction kills adoption.
9. **Streamer-friendly out of the box** — OBS overlays, hide-hand mode, custom playmats. Streamers are unpaid marketing.
10. **Trustworthy operator stance** — public roadmap, open changelog, honest comms, no aggressive monetization pivots.

What *not* to differentiate on: flashy animations, deep cosmetics, heavy social features. Sinks for solo-dev time with low competitive-player payoff.

---

## Open Questions to Revisit

Decisions deferred during brainstorm; surface again when relevant.

- **Engine implementation language** — not discussed. Server perf for RL matters here.
- **Frontend stack** — not discussed. React Native vs PWA vs Flutter for mobile + desktop is its own decision tree.
- **Database choice** — event store + read models. Postgres with JSONB is the boring-good default; specialized event stores (EventStoreDB) optional.
- **Hosting** — solo dev means platform-as-a-service (Fly.io, Railway, Render) likely beats self-managed Kubernetes.
- **Replay scouting policy** — public-during-season vs public-after-season. Affects tournament tech surprise.
- **Anti-cheat depth** — win-trade detection, IP fingerprinting, device hashing. Scope grows with user count.
- **Monetization activation timing** — Patreon donations from day one (low effort) vs after T2 with cosmetic perks (higher trust). Pick based on actual cost burn rate.
- **Entity structure** — when to form LLC. Probably before accepting any monetary inflow, even donations.
- **Card art source** — host yourself, link to Dreamborn's CDN, or fully user-supplied. Lower-risk paths exist; pick a stance.
- **Premium currency** — only revisit if Patreon model proves out and there's clear demand for more cosmetics.
- **Internationalization timing** — EN-first is obvious, but FR/DE/IT/JP each ~3–6 weeks of work and cards are released in those markets simultaneously.

---

## Handoff Suggestions for Claude Code Session

When you bring this to your existing codebase, useful framings:

- **Map each Tier 0 item against current implementation.** Is the engine event-sourced? Is it headless? Is the card effect system primitive + composition, or one function per card? Is networking server-authoritative? These are the load-bearing pieces — if any of them are wrong, prioritize refactor over new features.
- **Audit format hardcoding.** Search for "60" — if deck size is a magic number anywhere, that's a leak.
- **Audit art coupling.** Card data should reference art URLs, not embed them or assume a specific source.
- **Look for engine/UI entanglement.** Engine code that imports rendering libraries is a problem for replays, tests, and RL.
- **Confirm hidden-info handling.** Anywhere the server sends game state to clients, verify per-player filtering.
- **Check randomness sourcing.** All shuffles, coin flips, etc. should be server-generated and logged in the event stream.
- **Identify what's already T1 vs T2 vs T3.** Some implemented features may be premature (T3-tier features built before T0 is solid). Decide whether to keep, freeze, or roll back.
- **Test coverage on triggered abilities.** Every card with a trigger should have at least one test. If this is missing, it's a near-term priority.

The pattern to use with Claude Code: feed it this doc, ask it to audit the codebase against Tier 0 specifically, then walk forward through the tiers asking "what's done, what's partial, what's not started" for each item.
