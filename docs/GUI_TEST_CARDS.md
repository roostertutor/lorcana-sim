# GUI Mechanics Test Cards

Exhaustive list of cards to test every GUI mechanic. One card per feature,
inject via sandbox panel. Prefer lower-set cards where possible.

Mark `[x]` when verified working. Leave `[ ]` for untested/broken.

---

## Card Icons (left-side, vertically stacked)

| OK  | Feature | Card | Set |
|-----|---------|------|-----|
| [X] | Can't be dealt damage shield | Hercules - Mighty Leader | 10 |
| [X] | Can't be challenged lock | Captain Hook - Thinking a Happy Thought | 1 |
| [X] | Can't ready lock | Elsa's Ice Palace - Place of Solitude | 5 |
| [X] | Can't sing note | Ariel - On Human Legs | 1 |
| [X] | Once-per-turn clock | HeiHei - Accidental Explorer | 3 |
| [X] | Delayed trigger clock | Candy Drift | 8 |

## Keyword Badges (middle-right, vertically stacked, icon + optional value)

| OK  | Feature | Card                                | Set |
|-----|---------|-------------------------------------|-----|
| [X] | Rush | Flotsam - Ursula's Spy              | 1 |
| [X] | Evasive | Jetsam - Ursula's Spy               | 1 |
| [X] | Ward | Aladdin - Prince Ali                | 1 |
| [X] | Resist | Hercules - Divine Hero              | 2 |
| [X] | Bodyguard | Goofy - Musketeer                   | 1 |
| [X] | Alert | Sina - Vigilant Parent              | 11 |
| [X] | Challenger | Dr. Facilier - Charlatan            | 1 |
| [X] | Reckless | Felicia - Always Hungry             | 2 |
| [X] | Singer | Ariel - Spectacular Singer          | 1 |
| [X] | Boost | Bambi - Ethereal Fawn               | 10 |
| [X] | Multiple keywords | Maui - Hero to All (Reckless, Rush) | 1 |

## Other Badges (top-left vertically stacked; bottom-left for cards-under)

| OK  | Feature | Card | Set |
|-----|---------|------|-----|
| [X] | Dual-name (top-left) | Flotsam & Jetsam - Entangling Eels | 4 |
| [X] | Granted trait (top-left) | Chief Bogo - Calling the Shots | 5 |
| [X] | Universal shift (top-left) | Baymax - Giant Robot | 7 |
| [X] | Cards-under count (bottom-left, clickable) | Bambi - Ethereal Fawn | 10 |

## Active Effects Pill (scoreboard)

| OK  | Feature | Card                                     | Set |
|-----|---------|------------------------------------------|-----|
| [X] | Cost reduction static | Grandmother Willow - Ancient Advisor     | 11 |
| [X] | Enter-play-exerted | Jiminy Cricket - Level-Headed and Wise   | 4 |
| [X] | Inkwell enters exerted | Daisy Duck - Paranormal Investigator     | 10 |
| [X] | Prevent lore loss | Koda - Talkative Cub                     | 5 |
| [X] | Prevent lore gain | Peter Pan - Never Land Prankster         | 7 |
| [X] | One challenge per turn | Prince Charming - Protector of the Realm | 7 |
| [X] | Prevent discard from hand | Magica De Spell - Cruel Sorceress        | 10 |
| [X] | Skip draw step | Arthur - Determined Squire               | 8 |
| [X] | Deck top visible | Merlin's Cottage                         | 5 |
| [X] | Modify win threshold | Donald Duck - Flustered Sorcerer         | 8 |
| [X] | Extra ink plays | Belle - Strange but Special              | 1 |
| [X] | Ink from discard | Moana - Curious Explorer                 | 6 |
| [X] | Action restrictions | Ursula - Sea Witch Queen                 | 1 |
| [X] | Forced targets | John Smith - Undaunted Protector         | 8 |
| [X] | One-shot cost reduction | Imperial Proclamation                    | 4 |
| [X] | Play restrictions | Keep the Ancient Ways                    | 11 |
| [X] | Global timed effect | Restoring Atlantis                       | 7 |
| [X] | Delayed trigger | Candy Drift                              | 8 |
| [X] | Floating trigger (global) | Steal from the Rich                      | 1 |
| [X] | Floating trigger (attached) | Medallion Weights                        | 6 |
| [X] | Timed grant keyword | Tinker Bell - Most Helpful               | 5 |
| [X] | Timed cant action | Elsa - Spirit of Winter                  | 2 |
| [X] | Timed damage immunity | Nothing We Won't Do                      | 8 |
| [X] | Timed cant be challenged | Isabela Madrigal - In the Moment         | 7 |
| [X] | Timed stat buff | Good Job!                                | 1 |
| [X] | Timed must quest if able | Ariel - Curious Traveler                 | P3 |
| [X] | Timed sing cost bonus | Naveen's Ukulele                         | 6 |
| [X] | Timed challenge ready | Cinderella - Stouthearted                | D23 |

## PendingChoiceModal

| OK  | Feature | Card | Set |
|-----|---------|------|-----|
| [X] | Both-side grouping | Fire the Cannons | 1 |
| [X] | Revealed hand + discard | Ursula - Deceiver (any version) | 3/9 |
| [X] | Cross-player chooser | Tiana - Restaurant Owner | 5 |
| [X] | Multi-select discard | You Have Forgotten Me | 1 |
| [X] | "[A] or [B]" forced choice | Megara - Captivating Cynic | 4 |

## Popover Actions (click card → action buttons)

| OK  | Feature | Card | Set |
|-----|---------|------|-----|
| [X] | Play (normal) | Any hand card with enough ink | any |
| [X] | Ink | Any inkable hand card | any |
| [X] | Shift (ink-cost) | Hades - King of Olympus → click target | 1 |
| [X] | Shift (alt-cost discard) | Diablo - Devoted Herald → click target → click cost card | 4 |
| [X] | Sing | Any song → click singer | 1 |
| [X] | Challenge | Any ready character → click exerted opponent | any |
| [X] | Move | Any ready character → click location | 3+ |
| [X] | Quest | Any ready non-drying character | any |
| [X] | Boost | Bambi - Ethereal Fawn (pay ink, deck top → under) | 10 |
| [X] | Activate ability | Any card with activated ability | any |

## Drag-and-Drop Targets + Label

| OK  | Feature | Drag from → Drop on |
|-----|---------|---------------------|
| [X] | Play card | Hand card → play zone |
| [X] | Ink card | Hand card → inkwell |
| [X] | Shift (ink-cost) | Hand card → own character in play |
| [X] | Shift (alt-cost) | Hand card → own character → enters cost picker |
| [X] | Sing | Song from hand → ready character |
| [X] | Challenge | Own ready character → exerted opponent character |
| [X] | Move | Own ready character → own location |

## Visual Indicators

| OK  | Feature | Card                                | Set |
|-----|---------|-------------------------------------|-----|
| [X] | +S delta (bottom-right, orange) | Snow Fort                           | 11  |
| [X] | -S delta (bottom-right, red) | Painting the Roses Red              | 2   |
| [X] | +W delta (bottom-right, blue) | Rapunzel's Tower                    | 2   |
| [X] | +L delta (bottom-right, amber) | Eye of the Fates                    | 1   |
| [X] | -L delta (bottom-right, red) | Trust in Me                         | 10  |
| [X] | Drying overlay (cyan wash) | Any newly played character          | any |
| [X] | Exerted rotation | Any exerted character               | any |
| [X] | Damage counter (center) | Any damaged character               | any |
| [X] | Cost reduction glow | LeFou - Bumbler (in hand)           | 4   |
| [X] | Play restriction grey | Mirabel Madrigal - Family Gatherer  | 5   |
| [X] | Play-from-discard glow | Pride Lands - Jungle Oasis          | 6   |
| [X] | Reveal hand modal | Dolores Madrigal                    | 5   |

---

## TBD — Deferred GUI Decisions

- **Generic timed effect icon** — small clock for timed effects without a dedicated left-side icon (sing cost bonus, challenge ready, must quest, etc.). Currently only in the pill.
- **Hand card playability indicators** — highlight playable cards (green glow?) vs dim unplayable vs show inkable/non-inkable. Currently only play-restriction grey exists.
- **Discard tile glow for ink-from-discard** — Moana Curious Explorer enables inking from discard but the tile doesn't glow (only play-from-discard like Lilo triggers glow).
- **Floating ability pulse / animations** — removed indigo pulse border (too distracting without other animations). Revisit when adding animations generally (damage flying, card enter/exit, mill, etc.).
