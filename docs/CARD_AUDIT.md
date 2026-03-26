# Card Implementation Audit — Set 1 (2026-03-26)

216 cards analyzed. ~185 match perfectly. Findings below.

## Critical Bugs — ALL FIXED (2026-03-26)

### 1. Marshmallow - Persistent Guardian (`marshmallow-persistent-guardian`)
- **Card text:** "When this character is banished **in a challenge**, you may return this card to your hand."
- **Bug:** Trigger was `is_banished` — fired on ANY banish (Dragon Fire, Be Prepared, etc.)
- **Fixed:** Changed trigger to `banished_in_challenge`

### 2. Simba - Future King (`simba-future-king`)
- **Card text:** "draw a card, **then choose and discard a card**"
- **Bug:** Only implemented `draw 1`; the discard part was missing.
- **Fixed:** Added `discard_from_hand` effect (amount: 1, target: self, chooser: target_player) after draw

### 3. Moana - Of Motunui (`moana-of-motunui`)
- **Card text:** "ready your **other** Princess characters"
- **Bug:** Filter targeted all Princess characters including Moana herself.
- **Fixed:** Added `excludeSelf: true` to filter. Also added `excludeSelf` as a reusable `CardFilter` field, threaded `sourceInstanceId` through all `findValidTargets` calls.

### 4. Mulan - Imperial Soldier (`mulan-imperial-soldier`)
- **Card text:** "your **other** characters get +1 Lore this turn"
- **Bug:** Filter targeted all your characters including Mulan herself.
- **Fixed:** Added `excludeSelf: true` to filter

### 5. Maleficent - Sorceress (`maleficent-sorceress`)
- **Card text:** "you **may** draw a card"
- **Bug:** Draw effect had no `isMay` flag — draw was mandatory.
- **Fixed:** Added `isMay: true` to draw effect

### 6. Elsa - Spirit of Winter (`elsa-spirit-of-winter`)
- **Card text:** "exert up to **2** chosen characters. They can't ready at the start of their next turn."
- **Bug:** `chosen` target only allowed picking 1 character (no multi-target support).
- **Fixed:** Added `count` field to `CardTarget` "chosen" type. Elsa now uses `count: 2` with `isUpTo: true`. Validator enforces 0..count for optional, 1..count for required. Resolver applies effect + followUpEffects to each chosen target.

## Missing Secondary Abilities (partial implementations)

These cards have one ability implemented (usually a keyword) but are missing a named ability.

| Card | Implemented | Missing |
|------|------------|---------|
| Flotsam - Ursula's Spy | Rush | DEXTEROUS LUNGE: grants Rush to characters named Jetsam |
| Jetsam - Ursula's Spy | Evasive | SINISTER SLITHER: grants Evasive to characters named Flotsam |
| Tinker Bell - Peter Pan's Ally | Evasive | LOYAL AND DEVOTED: grants Challenger +1 to characters named Peter Pan |
| Captain Hook - Ruthless Pirate | Rush | YOU COWARD!: while exerted, opposing Evasive characters gain Reckless |
| Aurora - Dreaming Guardian | Shift 3 | PROTECTIVE EMBRACE: your other characters gain Ward |
| Donald Duck - Musketeer | Bodyguard | STAY ALERT!: during your turn, your Musketeer characters gain Evasive |
| Simba - Returned King | Challenger 4 | POUNCE: during your turn, this character gains Evasive |
| Tinker Bell - Giant Fairy | Shift 4 + enters_play damage | PUNY PIRATE!: when banishes another in challenge, deal 2 to chosen opposing char |
| Tamatoa - So Shiny! | Static +1 Lore per item | WHAT HAVE WE HERE?: when played/quests, return item from discard to hand |

## Cards With Unimplemented Named Abilities (stubs with keywords only)

These 11 cards have `_namedAbilityStubs` still present — their keywords work but the named ability is not yet in the engine.

| Card | Keywords | Stub Ability |
|------|----------|-------------|
| Cinderella - Gentle and Kind | Singer 5 | A WONDERFUL DREAM: ↷ — Remove up to 3 damage from chosen Princess |
| Goofy - Musketeer | Bodyguard | AND TWO FOR TEA!: When played, may remove up to 2 damage from each Musketeer |
| Hades - King of Olympus | Shift 6 | SINISTER PLOT: +1 Lore per other Villain in play |
| Stitch - Rock Star | Shift 4 | ADORING FANS: When you play a cost ≤2 character, may exert them to draw |
| Dr. Facilier - Agent Provocateur | Shift 5 | INTO THE SHADOWS: When your other character banished in challenge, may return to hand |
| Genie - Powers Unleashed | Evasive, Shift 6 | PHENOMENAL COSMIC POWER!: When quests, may play action cost ≤5 for free |
| Mickey Mouse - Artful Rogue | Shift 5 | MISDIRECTION: When you play an action, chosen opposing char can't quest next turn |
| Aladdin - Heroic Outlaw | Shift 5 | DARING EXPLOIT: During your turn, when banishes another in challenge, gain 2 lore + opponent loses 2 |
| Jasmine - Queen of Agrabah | Shift 3 | CARETAKER: When played + quests, may remove up to 2 damage from each of your chars |
| Captain Hook - Thinking a Happy Thought | Challenger 3, Shift 3 | STOLEN DUST: Cost ≤3 can't challenge this character |
| Mickey Mouse - Musketeer | Bodyguard | ALL FOR ONE: Your other Musketeer characters get +1 Str |
