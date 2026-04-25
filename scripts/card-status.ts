#!/usr/bin/env node
// =============================================================================
// CARD IMPLEMENTATION STATUS
// Live tracker for named ability stub progress across all sets.
//
// Usage:
//   pnpm card-status                         summary table for all sets
//   pnpm card-status --set 2                 filter to set 2 only
//   pnpm card-status --category unknown      list all unknown-category cards
//   pnpm card-status --category fits-grammar list all implementable cards
//   pnpm card-status --verbose               show rules text for listed cards
//
// Categories:
//   implemented        abilities/actionEffects filled in (named ability done)
//   vanilla            no named abilities to implement (keywords-only or blank)
//   fits-grammar       stubs exist, maps to existing Effect/Condition/Cost types
//   needs-new-type     stubs exist, needs a new Effect/StaticEffect/Cost/Condition type
//   needs-new-mechanic stubs exist, needs a new game system (Locations, Sing Together)
//   unknown            stubs exist, pattern unclear — needs manual review
// =============================================================================

import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");
const TYPES_PATH = join(__dirname, "../packages/engine/src/types/index.ts");

// =============================================================================
// FIELD VALIDATION — Extract valid discriminator values from types/index.ts
// =============================================================================

function extractUnionBlock(source: string, unionName: string): string {
  const lines = source.split("\n");
  const startIdx = lines.findIndex(l => l.match(new RegExp(`(?:export )?type ${unionName}\\s*=`)));
  if (startIdx === -1) return "";
  const parts: string[] = [lines[startIdx]!];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^export\s|^\/\/\s*={5,}/.test(l)) break;
    parts.push(l);
  }
  return parts.join("\n");
}

/** Extract discriminator string literals from a types file.
 *  Finds all `type: "something"` and `on: "something"` in interface bodies. */
function extractAllDiscriminators(source: string, field: string): Set<string> {
  const literals = new Set<string>();
  for (const m of source.matchAll(new RegExp(`${field}:\\s*"([a-z_]+)"`, "g"))) {
    literals.add(m[1]!);
  }
  return literals;
}

/** Extract bare string literal union members: | "foo" | "bar" */
function extractStringUnion(source: string, unionName: string): Set<string> {
  const block = extractUnionBlock(source, unionName);
  if (!block) return new Set();
  const literals = new Set<string>();
  for (const m of block.matchAll(/\|\s*"([a-z_]+)"/g)) {
    literals.add(m[1]!);
  }
  return literals;
}

const typesSource = readFileSync(TYPES_PATH, "utf-8");
// Extract all `type: "xxx"` discriminators from every interface in the file
const ALL_TYPE_DISCRIMINATORS = extractAllDiscriminators(typesSource, "type");
// Extract all `on: "xxx"` trigger event names
const ALL_ON_DISCRIMINATORS = extractAllDiscriminators(typesSource, "on");
// EffectDuration is a bare string union
const VALID_DURATIONS = extractStringUnion(typesSource, "EffectDuration");
// Add common duration values not in the union but used in card JSON
VALID_DURATIONS.add("this_turn");
VALID_DURATIONS.add("permanent");
// Target types are inline — add known values manually
const VALID_TARGET_TYPES = new Set([
  "self", "opponent", "both", "this", "triggering_card", "last_resolved_target",
  "from_last_discarded", "chosen", "all", "random", "target_owner",
]);

/** Extract the field names declared inside an interface body. Handles the
 *  common shapes we care about (property name followed by `?:` or `:`). */
function extractInterfaceFields(source: string, interfaceName: string): Set<string> {
  const re = new RegExp(`export interface ${interfaceName}\\s*\\{([\\s\\S]*?)\\n\\}`, "m");
  const match = source.match(re);
  if (!match) return new Set();
  const fields = new Set<string>();
  // Match `fieldName?: ` or `fieldName: ` at line starts (after whitespace/indent)
  for (const m of match[1]!.matchAll(/^\s+([a-zA-Z_][a-zA-Z0-9_]*)\??:\s/gm)) {
    fields.add(m[1]!);
  }
  return fields;
}

// CardFilter field names — catches silent wiring bugs like `maxStrength`
// vs `strengthAtMost`, `inkColor` vs `inkColors`, `hasCardsUnder` vs
// `hasCardUnder`, `notId` vs `excludeSelf`, etc.
const VALID_CARDFILTER_FIELDS = extractInterfaceFields(typesSource, "CardFilter");

/** Per-effect-type field whitelist. Walks every `export interface XxxEffect {
 *  type: "yyy"; ... }` definition in types/index.ts and maps the type literal
 *  to the set of allowed field names. Catches typos like `mayPlay` instead of
 *  `isMay`, or fields applied to the wrong effect type (e.g. `filter` on
 *  effects that don't accept filters). Doesn't catch documented-but-unused
 *  fields (e.g. `isMay` on reveal_top_conditional is in the interface but
 *  ignored at the effect layer — caught by decompiler tail instead). */
function buildEffectFieldMap(source: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const interfaceRe = /export interface (\w+)\s*\{([\s\S]*?)\n\}/g;
  for (const m of source.matchAll(interfaceRe)) {
    const body = m[2]!;
    // Find the `type: "literal"` discriminator inside this interface.
    const typeLitMatch = body.match(/\btype:\s*"([a-z_]+)"/);
    if (!typeLitMatch) continue;
    const typeLit = typeLitMatch[1]!;
    // Extract field names declared in the interface body. Same shape as
    // extractInterfaceFields. Skip the `type` discriminator itself.
    const fields = new Set<string>();
    for (const fm of body.matchAll(/^\s+([a-zA-Z_][a-zA-Z0-9_]*)\??:\s/gm)) {
      fields.add(fm[1]!);
    }
    // If the literal already maps to a field set (multiple interfaces sharing
    // a discriminator), UNION the fields. This handles the BanishEffect /
    // BanishOtherEffect / etc. pattern if any exist.
    const existing = map.get(typeLit);
    if (existing) {
      for (const f of fields) existing.add(f);
    } else {
      map.set(typeLit, fields);
    }
  }
  return map;
}
const EFFECT_FIELD_MAP = buildEffectFieldMap(typesSource);

/**
 * Whitelist of valid static-ability `effect.type` discriminators.
 *
 * Derived from the `StaticEffect` union in types/index.ts — each union member
 * `XxxStatic` has a `type: "yyy"` discriminator. A static ability's `effect.type`
 * MUST be in this set; anything else silently no-ops because the static-ability
 * processor in gameModifiers.ts has no case handler for it.
 *
 * Catches the `cant_action` misuse class — `cant_action` is a TimedEffect
 * (applied per-instance by triggered/activated abilities), NOT a static effect.
 * Using it as a static `effect.type` is a silent bug (Mor'du Savage Cursed
 * Prince ROOTED BY FEAR, Captain Hook Underhanded INSPIRES DREAD, Moana
 * Self-Taught Sailor LEARNING THE ROPES, King of Hearts Picky Ruler
 * OBJECTIONABLE STATE all shipped broken this way before the 2026-04-22 sweep).
 *
 * Use `action_restriction` for board-level ("opposing items can't ready") or
 * `cant_action_self` for per-instance ("THIS character can't challenge unless…").
 */
function buildStaticEffectTypes(source: string): Set<string> {
  const block = extractUnionBlock(source, "StaticEffect");
  if (!block) return new Set();
  const memberNames = new Set<string>();
  for (const m of block.matchAll(/\|\s*([A-Z][A-Za-z0-9_]*)\b/g)) {
    memberNames.add(m[1]!);
  }
  const types = new Set<string>();
  for (const name of memberNames) {
    // Find the interface body for this member and pull its `type: "..."` literal.
    const iRe = new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`, "m");
    const iMatch = source.match(iRe);
    if (!iMatch) continue;
    const tMatch = iMatch[1]!.match(/\btype:\s*"([a-z_]+)"/);
    if (tMatch) types.add(tMatch[1]!);
  }
  return types;
}
const VALID_STATIC_EFFECT_TYPES = buildStaticEffectTypes(typesSource);

// Cost types that the runtime actually processes — either via payCosts()
// directly (exert / pay_ink / banish_self) or via applyActivateAbility's
// cost-as-effect prepend (discard / banish_chosen, which surface a
// pendingChoice for the player to pick which card / target). Keep this list
// in sync with both. Additions to the Cost union must come with a runtime
// case OR be added here as "intentionally unimplemented" with a reason —
// the audit forces the conversation.
const HANDLED_COST_TYPES = new Set(["exert", "pay_ink", "banish_self", "discard", "banish_chosen"]);

interface FieldError {
  path: string;
  field: string;
  value: string;
  validValues: string;
}

function validateCardFields(card: any): FieldError[] {
  const errors: FieldError[] = [];

  function checkType(obj: any, path: string) {
    const val = obj?.type;
    if (val && typeof val === "string" && !ALL_TYPE_DISCRIMINATORS.has(val)
        && val !== "keyword" && val !== "deck_rule") {
      errors.push({ path, field: "type", value: val, validValues: "types/index.ts" });
    }
  }

  function checkOn(obj: any, path: string) {
    const val = obj?.on;
    if (val && typeof val === "string" && !ALL_ON_DISCRIMINATORS.has(val)) {
      errors.push({ path, field: "on", value: val, validValues: "TriggerEvent" });
    }
  }

  function walkEffect(e: any, path: string) {
    if (!e || typeof e !== "object") return;
    checkType(e, path);
    // Per-effect-type field whitelist — catches typos / wrong-effect-type
    // fields. The Effect interface for `e.type` declares which fields are
    // valid; anything else is a silent no-op at the runtime handler.
    if (typeof e.type === "string") {
      const allowed = EFFECT_FIELD_MAP.get(e.type);
      if (allowed && allowed.size > 0) {
        for (const key of Object.keys(e)) {
          if (!allowed.has(key)) {
            errors.push({
              path,
              field: key,
              value: typeof e[key] === "object" ? JSON.stringify(e[key]) : String(e[key]),
              validValues: `field not in ${e.type}'s interface — silent no-op (allowed: ${[...allowed].join(", ")})`,
            });
          }
        }
      }
    }
    if (e.duration && typeof e.duration === "string" && !VALID_DURATIONS.has(e.duration)) {
      errors.push({ path, field: "duration", value: e.duration, validValues: `[${[...VALID_DURATIONS].join(", ")}]` });
    }
    // Catch deprecated field names
    if (e.modifier !== undefined && e.type !== "challenge_damage_prevention") {
      errors.push({ path, field: "modifier", value: e.modifier, validValues: "use 'amount' instead of 'modifier'" });
    }
    if (e.keywordValue !== undefined) {
      errors.push({ path, field: "keywordValue", value: e.keywordValue, validValues: "use 'value' instead of 'keywordValue'" });
    }
    // Check filters for unknown field names — catches silent wiring bugs
    // (maxStrength vs strengthAtMost, inkColor vs inkColors, hasCardsUnder
    // vs hasCardUnder, notId vs excludeSelf, hasNoTrait typos, etc.). The
    // reducer reads the canonical field name only; unknown fields are
    // silent no-ops and the filter predicate is skipped.
    const checkFilter = (f: any, fp: string) => {
      if (!f || typeof f !== "object") return;
      for (const key of Object.keys(f)) {
        if (!VALID_CARDFILTER_FIELDS.has(key)) {
          errors.push({
            path: fp,
            field: key,
            value: JSON.stringify(f[key]),
            validValues: "not a CardFilter field — likely a typo (check types/index.ts)",
          });
        }
      }
      // Recurse into anyOf sub-filters.
      if (Array.isArray(f.anyOf)) {
        f.anyOf.forEach((sub: any, i: number) => checkFilter(sub, `${fp}.anyOf[${i}]`));
      }
    };
    // each_player's `filter` field is a PlayerFilter (different union:
    // player_vs_caster / player_is_group_extreme / player_metric), not a
    // CardFilter. Skip CardFilter validation for it.
    if (e.filter && e.type !== "each_player") checkFilter(e.filter, path + ".filter");
    if (e.target?.filter) checkFilter(e.target.filter, path + ".target.filter");
    if (e.source?.filter) checkFilter(e.source.filter, path + ".source.filter");
    if (e.destination?.filter) checkFilter(e.destination.filter, path + ".destination.filter");
    if (e.character?.filter) checkFilter(e.character.filter, path + ".character.filter");
    if (e.location?.filter) checkFilter(e.location.filter, path + ".location.filter");
    if (e.conditionFilter) checkFilter(e.conditionFilter, path + ".conditionFilter");
    if (e.targetFilter) checkFilter(e.targetFilter, path + ".targetFilter");
    if (e.countFilter) checkFilter(e.countFilter, path + ".countFilter");
    if (e.bonusFilter) checkFilter(e.bonusFilter, path + ".bonusFilter");
    // DynamicAmount-shaped amount field can carry a filter.
    if (typeof e.amount === "object" && e.amount?.filter) checkFilter(e.amount.filter, path + ".amount.filter");
    // Trigger filters also live on triggers.
    if (e.trigger?.filter) checkFilter(e.trigger.filter, path + ".trigger.filter");
    // Check targets
    if (e.target) checkType(e.target, path + ".target");
    if (e.from) checkType(e.from, path + ".from");
    if (e.to) checkType(e.to, path + ".to");
    // Recurse into nested effects
    for (const key of ["effects", "costEffects", "rewardEffects", "ifMatchEffects", "defaultEffects",
                        "matchExtraEffects", "followUpEffects", "then", "otherwise"]) {
      if (Array.isArray(e[key])) {
        e[key].forEach((sub: any, i: number) => walkEffect(sub, `${path}.${key}[${i}]`));
      }
    }
    // Nested condition
    if (e.condition) walkCondition(e.condition, path + ".condition");
  }

  function walkCondition(c: any, path: string) {
    if (!c || typeof c !== "object") return;
    checkType(c, path);
    // Validate CardFilter fields embedded in condition types like
    // you_control_matching / opponent_controls_matching (they carry a
    // `filter` keyed to CardFilter). Without this check, a typo like
    // `willpowerAtLeast` in a condition filter silently made the predicate
    // match everything — caught by this rule during the set 12 sweep.
    if (c.filter && typeof c.filter === "object") {
      for (const key of Object.keys(c.filter)) {
        if (!VALID_CARDFILTER_FIELDS.has(key)) {
          errors.push({
            path: `${path}.filter`,
            field: key,
            value: JSON.stringify(c.filter[key]),
            validValues: "not a CardFilter field — likely a typo (check types/index.ts)",
          });
        }
      }
      if (Array.isArray(c.filter.anyOf)) {
        c.filter.anyOf.forEach((sub: any, i: number) => {
          if (!sub || typeof sub !== "object") return;
          for (const key of Object.keys(sub)) {
            if (!VALID_CARDFILTER_FIELDS.has(key)) {
              errors.push({
                path: `${path}.filter.anyOf[${i}]`,
                field: key,
                value: JSON.stringify(sub[key]),
                validValues: "not a CardFilter field — likely a typo (check types/index.ts)",
              });
            }
          }
        });
      }
    }
    if (c.condition) walkCondition(c.condition, path + ".condition");
    if (Array.isArray(c.conditions)) {
      c.conditions.forEach((sub: any, i: number) => walkCondition(sub, `${path}.conditions[${i}]`));
    }
  }

  function walkAbility(ab: any, path: string) {
    if (!ab || typeof ab !== "object") return;
    // Check trigger event name
    if (ab.trigger?.on) {
      checkOn(ab.trigger, path + ".trigger");
    }
    // Validate fields on the trigger's CardFilter (if any). Triggers carry
    // their filter at ab.trigger.filter (not under an effect), so the
    // walkEffect checks don't see it.
    if (ab.trigger?.filter) {
      const tf = ab.trigger.filter;
      for (const key of Object.keys(tf)) {
        if (!VALID_CARDFILTER_FIELDS.has(key)) {
          errors.push({
            path: `${path}.trigger.filter`,
            field: key,
            value: JSON.stringify(tf[key]),
            validValues: "not a CardFilter field — likely a typo (check types/index.ts)",
          });
        }
      }
      // "this character" trigger-clause check (Bug 3 pattern). When the trigger
      // wording references THIS character/item/location AND the filter is just
      // `{ owner: { type: "self" } }` (broad — matches any owned card), the
      // cross-card trigger path fires the trigger on every owned card matching
      // the event, not just the source. Add `isSelf: true` to scope to source.
      // Caught Simba King in the Making's dual-trigger bug originally; this
      // rule re-detects siblings.
      if (ab.type === "triggered" && ab.rulesText) {
        const keys = Object.keys(tf).filter(k => k !== "isSelf");
        const filterIsBroad = keys.length === 1 && keys[0] === "owner" && tf.owner?.type === "self";
        if (filterIsBroad && !tf.isSelf && !tf.excludeSelf) {
          // Trigger clause: text before the first comma. "this character" in
          // the EFFECT clause (e.g. "ready this character") is normal.
          const triggerClause = (ab.rulesText.toLowerCase().split(/,\s/)[0] ?? "");
          if (/\bthis (character|item|location)\b/.test(triggerClause)) {
            errors.push({
              path: `${path}.trigger.filter`,
              field: "isSelf",
              value: "missing",
              validValues: `"this character" wording but filter is broad ({owner:self}) — add isSelf:true to restrict to source instance`,
            });
          }
        }
      }
      // "Whenever you play another X" wording on a card_played trigger needs
      // excludeSelf:true on the filter — without it, the source's own card_played
      // event matches the filter and self-triggers. Caught Pluto Steel Champion
      // MAKE ROOM, Rama Vigilant Father PROTECTION OF THE PACK, and Basil
      // Tenacious Mouse HOLD YOUR GROUND in the 2026-04-24 sweep.
      // Skip "this character or another X" wording (Sneezy AH-CHOO!) which
      // explicitly self-triggers in addition to firing on others.
      if (
        ab.type === "triggered" &&
        ab.trigger?.on === "card_played" &&
        ab.rulesText &&
        !tf.excludeSelf
      ) {
        const oracle = String(ab.rulesText).toLowerCase();
        const triggerClause = oracle.split(/,\s/)[0] ?? "";
        const hasAnother = /\bplay another\b/.test(triggerClause);
        const hasThisOrAnother = /\bplay this character or another\b/.test(triggerClause);
        if (hasAnother && !hasThisOrAnother) {
          errors.push({
            path: `${path}.trigger.filter`,
            field: "excludeSelf",
            value: "missing",
            validValues: `"play another" wording on card_played trigger needs excludeSelf:true — without it, the source self-triggers when played`,
          });
        }
      }
    }
    // Check condition on ability
    if (ab.condition) walkCondition(ab.condition, path + ".condition");
    // Keywords that require a numeric value (shift exempt when altShiftCost exists — alt-cost-only cards)
    if (ab.type === "keyword" && ["boost", "challenger", "resist", "singer", "shift"].includes(ab.keyword)) {
      const isAltShiftOnly = ab.keyword === "shift" && card.altShiftCost && !card.shiftCost;
      if (!isAltShiftOnly && (ab.value === undefined || ab.value === null)) {
        errors.push({ path, field: "value", value: "undefined", validValues: "numeric value required for " + ab.keyword });
      }
    }
    // Check costs: discriminator validity (covered by checkType) AND that
    // the cost type has a runtime handler in payCosts(). The latter catches
    // silent no-ops like Angel Experiment 624's `discard` cost (declared in
    // the Cost union but never implemented in the reducer).
    if (Array.isArray(ab.costs)) {
      ab.costs.forEach((c: any, i: number) => {
        checkType(c, `${path}.costs[${i}]`);
        if (c?.type && typeof c.type === "string" && !HANDLED_COST_TYPES.has(c.type)) {
          errors.push({
            path: `${path}.costs[${i}]`,
            field: "type",
            value: c.type,
            validValues: `cost type has no payCosts() handler — silent no-op (handled: ${[...HANDLED_COST_TYPES].join(", ")})`,
          });
        }
      });
    }
    // Check effects
    if (Array.isArray(ab.effects)) {
      ab.effects.forEach((e: any, i: number) => walkEffect(e, `${path}.effects[${i}]`));
    }
    // Static ability: check the effect field
    if (ab.effect) {
      walkEffect(ab.effect, path + ".effect");
      // Static-effect discriminator must be in the StaticEffect union.
      // Catches `cant_action` as static.effect.type (silent no-op; use
      // `action_restriction` or `cant_action_self` instead).
      if (ab.type === "static" && typeof ab.effect.type === "string"
          && VALID_STATIC_EFFECT_TYPES.size > 0
          && !VALID_STATIC_EFFECT_TYPES.has(ab.effect.type)) {
        errors.push({
          path: `${path}.effect`,
          field: "type",
          value: ab.effect.type,
          validValues: `not a StaticEffect union member — static-ability processor has no case handler, silent no-op (valid: ${[...VALID_STATIC_EFFECT_TYPES].sort().join(", ")})`,
        });
      }
    }
  }

  // Walk all abilities
  (card.abilities ?? []).forEach((ab: any, i: number) => walkAbility(ab, `abilities[${i}]`));
  // Walk actionEffects
  (card.actionEffects ?? []).forEach((e: any, i: number) => walkEffect(e, `actionEffects[${i}]`));

  // actionEffects on non-action cards is silently ignored — flag as invalid.
  // Items / characters / locations should use `abilities` (activated/triggered/static)
  // instead. The runtime only consumes actionEffects when the card moves through
  // the action play path. Caught Darkwing's Gas Device + 10 other latent bugs in
  // commit 5420889. Some cards (Lantern, Magic Mirror) had BOTH abilities AND
  // actionEffects — the actionEffects portion was dead data and is now caught.
  if (card.actionEffects?.length && card.cardType !== "action") {
    errors.push({
      path: "actionEffects",
      field: "actionEffects",
      value: `present on ${card.cardType}`,
      validValues: "actionEffects only fires for cardType: 'action' — use abilities[] instead",
    });
  }

  // Check for old-format fields (trigger.event instead of trigger.on, name instead of storyName)
  (card.abilities ?? []).forEach((ab: any, i: number) => {
    if (ab.trigger?.event) {
      errors.push({ path: `abilities[${i}].trigger`, field: "event", value: ab.trigger.event, validValues: "use 'on' not 'event'" });
    }
    if (ab.name && !ab.storyName) {
      errors.push({ path: `abilities[${i}]`, field: "name", value: ab.name, validValues: "use 'storyName' not 'name'" });
    }
    // Missing player filter on turn_start / turn_end triggers whose oracle
    // scopes to "your turn" or "an opponent's turn". Without the filter,
    // queueTriggersByEvent fires the trigger on BOTH players' turn
    // transitions (the player check at reducer.ts:5977 is skipped when
    // trigger.player is undefined). Caught 6 cards in the 2026-04-21 sweep
    // (Jack-jack Parr, Mrs. Incredible, Julieta's Arepas, Remote Inklands
    // Desert Ruins ERODING WINDS, Treasure Mountain Azurite Sea Island ×2).
    if (
      ab.type === "triggered" &&
      (ab.trigger?.on === "turn_start" || ab.trigger?.on === "turn_end") &&
      !ab.trigger?.player
    ) {
      const oracle = String(ab.rulesText ?? "");
      const scopedToYour = /\bat the (?:start|end) of your\b/i.test(oracle);
      const scopedToOpponent = /\bat the (?:start|end) of an opponent'?s?\b/i.test(oracle);
      if (scopedToYour || scopedToOpponent) {
        const expected = scopedToYour ? '{ type: "self" }' : '{ type: "opponent" }';
        errors.push({
          path: `abilities[${i}].trigger`,
          field: "player",
          value: "(missing)",
          validValues: `oracle scopes to ${scopedToYour ? "your" : "opponent's"} turn — add player: ${expected} to prevent firing on the wrong player's turn transition`,
        });
      }
    }
  });

  // Check story names against stubs — catch fabricated ability names.
  // Only flag when stub count covers all named abilities (the importer
  // sometimes omits stubs for multi-ability cards like Anna Soothing Sister).
  const stubs: any[] = (card._namedAbilityStubs ?? []).filter((s: any) => s.storyName);
  const namedAbilities = (card.abilities ?? []).filter((ab: any) => ab.type !== "keyword" && ab.storyName && ab.storyName !== "");
  if (stubs.length > 0 && stubs.length >= namedAbilities.length) {
    const validStoryNames = new Set(stubs.map((s: any) => s.storyName));
    for (let i = 0; i < (card.abilities ?? []).length; i++) {
      const ab = card.abilities[i];
      if (ab.type === "keyword" || !ab.storyName || ab.storyName === "") continue;
      if (!validStoryNames.has(ab.storyName)) {
        errors.push({
          path: `abilities[${i}]`,
          field: "storyName",
          value: ab.storyName,
          validValues: [...validStoryNames].join(", "),
        });
      }
    }
  }

  return errors;
}

// --- CLI args -----------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}
const filterSet = getArg("--set");
const filterCategory = getArg("--category");
const verbose = args.includes("--verbose");

// --- Types -------------------------------------------------------------------

type StubCategory =
  | "fits-grammar"
  | "needs-new-type"
  | "needs-new-mechanic"
  | "unknown";

type CardCategory = "implemented" | "partial" | "invalid-field" | "vanilla" | StubCategory;

interface CardEntry {
  id: string;
  fullName: string;
  cardType: string;
  setId: string;
  number: number;
  fieldErrors?: FieldError[];
  category: CardCategory;
  stubs: { storyName: string; rulesText: string; category: StubCategory }[];
}

// --- Pattern matching --------------------------------------------------------

// Each rule: [pattern, category, label]
// Applied in order — first match wins. More specific patterns come first.
const NEW_MECHANIC_PATTERNS: [RegExp, string][] = [
  // (sing-together removed: implemented in Phase A.1 via singTogetherCost on CardDefinition)
  // (move-for-free / play-location-for-free removed: move_character effect implemented in Phase A.3
  //  (Magic Carpet, Jim Hawkins TAKE THE HELM); play_for_free with location filter implemented
  //  (Jim Hawkins ASTRO NAVIGATOR — Set 3).)
  // Win threshold modification (Donald Duck)
  [/\b\d+ lore to win\b/i, "win-threshold"],
  [/\bneed \d+ lore to win\b/i, "win-threshold"],
  // (boost-subzone, card-under-trigger, card-under-static, put-facedown-under-effect,
  //  cards-under-count, cards-under-to-hand removed: boost primitives implemented
  //  (CRD 8.4.2). card_put_under TriggerEvent, hasCardUnder CardFilter,
  //  cards_under_count DynamicAmount, put_top_card_under (this OR chosen),
  //  put_cards_under_into_hand effect, you_control_matching condition all live.
  //  Matched by FITS_GRAMMAR_PATTERNS targeting put_top_card_under,
  //  put_cards_under_into_hand, modify_stat_per_count, condition_this_has_cards_under
  //  capabilities below.)
  // CRD 6.5 Replacement effects — "would ... instead"
  [/\bwould be dealt damage.{0,80}instead\b/i, "replacement-effect"],
  [/\bwould take damage.{0,80}instead\b/i, "replacement-effect"],
  // Skip Draw step — turn structure modification
  [/\bskip .{0,20}draw step\b/i, "turn-structure"],
  // Global challenge limiter
  [/\bonly one character can challenge\b/i, "challenge-limiter"],
  // Super-Bodyguard — must choose this for actions AND abilities
  [/\bmust choose this character for actions and abilities\b/i, "super-bodyguard"],
  // Conditional lore lock — "can't gain lore unless"
  [/\bcan'?t gain lore unless\b/i, "conditional-lore-lock"],
  // Phase B — gaps surfaced by Set 4 wiring (regex used to false-positive into fits-grammar):
  // (for-each-opponent-who-didnt removed: each_opponent_may_discard_then_reward
  //  Effect implemented — Sign the Scroll, Ursula's Trickery. 2P-only;
  //  generalize when 3+P support lands. Matched as fits-grammar below.)
  // "Chosen character gains "<quoted floating triggered ability>" this turn"
  // create_floating_trigger applies to source, not chosen target (Bruno Madrigal).
  // (grant-floating-trigger-to-target removed: create_floating_trigger_attached
  //  primitive already supported (Bruno Madrigal). Compound cards using it remain
  //  unwired pending sequential targeting plumbing — see Mother Gothel.)
  // (above)
  // "Whenever they challenge another character this turn" — floating trigger attached to chosen target
  // (above)
  // "if no other character has quested this turn" — historical event-count condition
  [/\bif no other character has quested this turn\b/i, "no-other-quested-condition"],
  // "your other characters can't quest for the rest of this turn"
  [/\byour other characters can'?t (quest|challenge)\b/i, "group-cant-action-this-turn"],
  // "Play a character with the same name as the banished character" — dynamic same-name play_for_free
  [/\bplay a .{0,30}with the same name as\b/i, "play-same-name-as-banished"],
  // "Move him and one of your other characters to the same location" — multi-character move
  [/\bmove .{0,20}and one of your other .{0,30}to the same location\b/i, "multi-character-move"],
  // "Whenever one of your characters is chosen for Support" — chosen_for_support trigger event
  [/\bis chosen for support\b/i, "chosen-for-support-trigger"],
  // (pay-extra-cost-mid-effect removed: SequentialEffect with isMay + pay_ink
  //  cost effect already supports the "you may pay N {I} to <effect>" pattern.
  //  Matched by FITS_GRAMMAR_PATTERNS targeting `sequential` capability.)
  // ── Compound false positives surfaced by cherry-pick pass ──
  // Vanish keyword — "when an opponent chooses this character for an action, banish them"
  // Needs a new "opponent-chose-for-action" trigger event.
  // (vanish-keyword removed: implemented as a hardcoded check at choose_target resolve.)
  // "You don't discard" — discard replacement effect (Magica De Spell, Kronk)
  [/\byou don'?t discard\b/i, "discard-replacement"],
  // "If this is your first turn" — Underdog keyword condition (set 11)
  // (underdog-condition removed: your_first_turn_as_underdog Condition implemented.)
  // "Twice during your turn, whenever" — twice-per-turn trigger flag
  [/\btwice during your turn, whenever\b/i, "twice-per-turn-trigger"],
  // Bulk move cards from discard → inkwell (Perdita, Rolly-bulk variants)
  [/\bput all .{0,40}cards? from your discard into your inkwell\b/i, "bulk-discard-to-inkwell"],
  // "Whenever one or more of your characters sings a song" — batched sings trigger
  [/\bwhenever one or more of your characters sings?\b/i, "batched-sings-trigger"],
  // "If none of your characters challenged this turn" — event-tracking condition
  // (no-challenges-this-turn-condition removed: no_challenges_this_turn Condition implemented.)
  // "If you've played a song this turn" — event-tracking condition
  // (song-played-this-turn-condition removed: songs_played_this_turn_gte already supported.)
  // "If you didn't put any cards into your inkwell this turn" — event-tracking condition
  [/\bif you didn'?t put any cards into your inkwell this turn\b/i, "no-ink-put-this-turn-condition"],
  // "If you've put a card under [this] this turn" — per-instance card-under event tracking
  // (card-under-event-condition removed: this_had_card_put_under_this_turn Condition implemented.)
  // "Unless you put a card under [this] this turn" — same gap
  // (above)
  // "For the rest of this turn, whenever" — floating player-scoped trigger
  // (player-floating-trigger removed: create_floating_trigger Effect already supported.)
  // "If you have a card named X in your discard" — discard-name condition
  [/\bif you have a card named .{0,40}in your discard\b/i, "discard-name-condition"],
  // "If an opponent has more cards in their hand than you" — hand-count compare condition
  [/\b(an? )?opponent has more cards in their hand than you\b/i, "hand-count-compare-condition"],
  // "Play X from [inkwell|there] for free" — Pongo: play from inkwell
  [/\bplay a .{0,40}from there for free\b/i, "play-from-inkwell"],
  [/\bplay .{0,30}character from .{0,20}inkwell\b/i, "play-from-inkwell"],
  // "Put [self] facedown under one of your characters" — put-self-under effect (Roo)
  [/\bput this character facedown under\b/i, "put-self-under-effect"],
  // "Put any number of cards from under [your chars] into your inkwell" (Visiting Christmas Past)
  [/\bcards? from under .{0,40}into your inkwell\b/i, "cards-under-to-inkwell"],
  // "Play an action from your discard for free, then put that action card on the bottom"
  [/\bplay an? .{0,30}from your discard for free,? then put\b/i, "play-from-discard-then-bottom"],
  // "Cost up to N more than the banished character" — dynamic cost filter from banished name
  [/\bcost up to \d+ more than the banished\b/i, "dynamic-cost-from-banished"],
  // "Reveal cards from the top of your deck until you reveal a [X]" — reveal-until effect
  [/\breveal cards? from the top of your deck until you reveal\b/i, "reveal-until-effect"],
  // "Choose N cards from [opponent's] discard" — multi-card choose from opponent discard
  [/\bchoose \d+ cards? from chosen opponent'?s discard\b/i, "choose-from-opponent-discard"],
  // "Return all character cards with that name from your discard" — name-a-card + bulk return-from-discard
  [/\breturn all character cards with that name from your discard\b/i, "name-then-bulk-return-from-discard"],
  // "Whenever [card type] is returned to their hand from play" — return-to-hand trigger (opponent)
  // (trigger-opponent-returned-to-hand removed: returned_to_hand + owner:opponent already supported.)
  // "Whenever you play a [second|third] [card type]" — Nth-card-played counter trigger
  [/\bwhenever you play a (second|third|fourth) (action|character|item|song)\b/i, "nth-card-played-trigger"],
  // "Whenever a character is challenged while here" — location challenged trigger
  [/\bwhenever a character is challenged while here\b/i, "location-challenged-trigger"],
  // "Whenever an opposing character is exerted" — opponent-exerts trigger
  [/\bwhenever an opposing character is exerted\b/i, "opponent-exerts-trigger"],
  // "Whenever an opposing character is damaged" — opponent-damaged trigger (distinct from "dealt damage")
  // (opponent-damaged-trigger removed: damage_dealt_to with owner:opponent filter already supported.)
  // "When this character is banished, choose one" — banished + modal choose sequential
  [/\bwhen this character is banished, choose one\b/i, "banished-modal-choose"],
  // "Whenever an opponent chooses this character for an action or ability" — chosen-by-opponent trigger
  [/\bwhenever an opponent chooses this character for an action\b/i, "chosen-by-opponent-trigger"],
  // Dinner Bell: "Draw cards equal to the damage on chosen character" — draw-with-dynamic-amount-from-target
  [/\bdraw cards? equal to the damage on\b/i, "dynamic-draw-from-target-damage"],
  // "When you put a card into your inkwell, if it's the [second|third|fourth] card" — inkwell-count trigger
  // (inkwell-count-trigger removed: card_put_into_inkwell trigger + ink_plays_this_turn_eq Condition implemented.)
  // "For each opposing character banished in a challenge this turn, you pay N less"
  [/\bfor each opposing character banished in a challenge this turn, you pay\b/i, "event-tracking-cost-reduction"],
  // Other-at-location static ("While one of your X characters is at a location, that character gains")
  [/\bwhile one of your .{0,40}is at a location, that character\b/i, "other-at-location-static"],
  // "If this card is in your discard, you may play her" — self play-from-discard trigger
  // (self-play-from-discard removed: TriggeredAbility activeZones + play_for_free target:this implemented.)
  // Location "whenever a character is banished here" trigger
  // (location-banished-here-trigger removed: is_banished + atLocation:"this" filter already supported.)
  // "Whenever a character is banished in a challenge while here"
  [/\bwhenever a character is banished in a challenge while here\b/i, "location-banished-here-trigger"],
  // Location "when you move a character here from another location"
  // (location-moves-here-trigger removed: moves_to_location + atLocation:"this" filter already supported.)
  // Lore transfer ("all opponents lose 1 lore and you gain lore equal to the lore lost")
  [/\byou gain lore equal to the lore lost\b/i, "lore-transfer"],
  // Grant activated ability to own chars this turn ("Your X characters gain \"{E}...\" this turn")
  // (grant-activated-to-own-timed removed: grant_activated_ability_timed Effect implemented.)
  // Exert one of your X to deal damage equal to their {S}
  [/\{E\} one of your characters to deal damage equal to (their|its|his|her)\b/i, "exert-one-dynamic-damage"],
  // "play characters using their Shift ability" — Shift-scoped cost reduction
  // (shift-scoped-cost-reduction removed: cost_reduction.appliesTo:"shift_only" implemented.)
  // "Each player may reveal a character card from their hand and play it for free"
  [/\beach player may reveal a .{0,30}from their hand and play\b/i, "symmetric-reveal-play"],
  // "Banish chosen item of yours to play this character for free" — alternate play cost
  [/\bbanish chosen item of yours to play this character for free\b/i, "alt-play-cost-banish-item"],
  // Kida: "Put one into your ink supply, face down and exerted, and the other on top"
  [/\bput one into your ink supply.{0,40}(and )?(the )?other\b/i, "look-top-split"],
  // Goofy - Groundbreaking Chef: remove damage from each of your others + ready each one
  [/\bremove up to \d+ damage from each of your other characters\. ready each character\b/i, "compound-remove-then-ready"],
  // Singular "whenever one of your characters sings a song"
  [/\bwhenever one of your characters sings a song\b/i, "other-sings-trigger"],
  // Reveal-from-hand as cost ("reveal a X card in your hand to ...")
  // (reveal-from-hand-as-cost removed: model as triggered may + you_control_matching condition on hand.)
  // Banish-self OR return-another modal on ETB (Madam Mim - Rhino)
  // (self-banish-or-return-modal removed: ChooseEffect with options already supported.)
  // "Give that character X and \"<quoted trigger>\" this turn" — grant floating trigger to target via "give"
  // (above)
  // Jafar High Sultan: "If an Illusion character card is discarded this way, you may play that character"
  [/\bif a[n]? .{0,30}is discarded this way, you may play\b/i, "play-from-discard-result"],
  // "For each character that sang this song" — per-singer dynamic in Sing Together
  [/\bfor each character that sang this song\b/i, "per-singer-dynamic"],
  // "If you used Shift to play (them|her)" referencing the triggering played card (not self)
  // (shift-condition-on-trigger-source removed: played_via_shift +
  //  triggering_card_played_via_shift Conditions already supported.)
  // Tinker Bell: exert the triggering card (not self)
  [/\bwhenever you play a character .{0,40}you may exert them\b/i, "exert-triggering-card"],
  // Geppetto-style: discard any number of [type] cards to gain N per discarded
  // (discard-any-number-dynamic removed: discard_from_hand amount:"any" + sequential cost_result implemented.)
  // Dusk to Dawn: fill-hand ("they draw until they have N")
  // (fill-hand removed: fill_hand_to Effect implemented.)
  // Reuben: per-damage-removed cost reduction
  [/\bfor each \d+ damage removed this way, you pay\b/i, "dynamic-cost-reduction-from-effect"],
  // "Draw X unless that character's player puts" — inverse unless branch
  [/\bunless that character'?s player puts\b/i, "inverse-unless-opponent-choice"],
  // Cruella: "When this character is challenged and banished" — combo trigger
  [/\bwhen this character is challenged and banished\b/i, "challenged-and-banished-trigger"],
  // Goliath "Stone by Day": "this character can't ready" gated by hand size — static cant_ready
  [/\bif you have \d+ or more cards in your hand, this character can'?t ready\b/i, "conditional-cant-ready-static"],
  // Mr. Litwak: ready self + "can't quest or challenge for the rest of this turn" compound
  // (ready-then-cant-act-compound removed: ready + cant_action timed already supported.)
  // Darkwing Tower: ready-here compound with cant_quest_rest_of_turn
  [/\bready a character here\..{0,40}can'?t quest\b/i, "ready-then-cant-act-compound"],
  // Mulan: "character in play with damage" — damage-existence condition
  [/\bif you have a character in play with damage\b/i, "has-damaged-character-condition"],
  // Fantastical etc.: Sing Together dynamic-per-singer also caught above via per-singer-dynamic
  // "If you played another character this turn" — event-tracking condition (set P3 Travelers)
  // (played-another-this-turn-condition removed: played_another_character_this_turn Condition implemented.)
  // "You may pay N {I} to choose one" on ETB — pay-then-modal sequential
  [/\byou may pay \d+ \{I\} to choose one\b/i, "pay-then-modal"],
  // "Draw a card for each character you have in play" — dynamic draw from count
  [/\bdraw (a |\d+ )cards? for each .{0,40}you have in play\b/i, "dynamic-draw-from-count"],
  // "While this character is being challenged" — static effect gated by being-challenged state
  // (being-challenged-static removed: gets_stat_while_being_challenged + affects:attacker implemented.)
  // "Reveal up to N X character cards and up to N Y" (Family Madrigal) — multi-filter search/look
  [/\breveal up to \d+ .{0,40}and up to \d+ .{0,30}cards?\b/i, "multi-filter-look-reveal"],
  // "Whenever you play a Floodborn character on this card" — shift-onto-self trigger
  // (shift-onto-self-trigger removed: shifted_onto trigger event implemented.)
  // Desperate Plan: "choose and discard any number of cards, then draw that many"
  [/\bdiscard any number of cards,? then draw that many\b/i, "discard-any-number-dynamic"],
  // Akela / Baloo — stubbed modals ("— This character gets +1 {S} this turn.") are modal inner options
  // and render as lone stubs. These are genuinely wireable as part of a choose_one; leave as-is.
];

const NEW_TYPE_PATTERNS: [RegExp, string][] = [
  // (alert-keyword removed: "alert" is in the Keyword union and handled by
  //  the validator — CRD 10.x. Matched by the keyword-grant regex in
  //  FITS_GRAMMAR_PATTERNS.)
  // (dynamic-amount entries moved to FITS_GRAMMAR_PATTERNS — DynamicAmount
  // target_*/source_* variants + max cap implemented in the engine.)
  // (count-based-effect removed: gain_stats gained strengthDynamic +
  //  strengthDynamicNegate fields backed by DynamicAmount count variant.)
  // (per-count-cost-reduction removed: self_cost_reduction.amount accepts
  //  `{ type: "count", filter }` with perMatch multiplier. Matched as
  //  fits-grammar via the "pay .{0,10} less" entry in FITS_GRAMMAR_PATTERNS.)
  [/\bpay .{0,20}equal to the number\b/i, "pay-equal-to-count"],
  // Mass inkwell manipulation
  [/\beach player.{0,60}inkwell/i, "mass-inkwell"],
  [/\ball (the )?cards? in .{0,30}inkwell/i, "mass-inkwell"],
  [/\buntil (you|they|each player) have \d+ cards? in .{0,20}inkwell/i, "trim-inkwell"],
  // Inkwell static that affects entering
  // (inkwell-static removed: inkwell_enters_exerted StaticEffect implemented —
  //  Daisy Duck Paranormal Investigator. Matched as fits-grammar below.)
  // Ink from discard / play from non-hand zone (Moana, Black Cauldron)
  // (play-from-discard removed: play_for_free has `sourceZone` since set 3 — matches
  //  via FITS_GRAMMAR_PATTERNS below. The two remaining patterns are genuinely new.)
  [/\bink .{0,30}from .{0,20}discard/i, "ink-from-discard"],
  // "Enters play exerted" for opposing cards (static)
  // (enter-play-exerted-static removed: EnterPlayExertedStatic implemented;
  //  Jiminy Cricket Level-Headed and Wise + Figaro Tuxedo Cat wired.)
  // (move-damage removed: move_damage Effect already exists — Belle Untrained Mystic,
  //  Belle Accomplished Mystic, Rose Lantern. Regex was over-broad, shunting real
  //  fits-grammar cards into needs-new-type. Fits-grammar patterns below handle it.)
  // (reveal-hand removed: reveal_hand Effect implemented. Matched as
  //  fits-grammar below.)
  // (timed-cant-be-challenged removed: cant_be_challenged_timed Effect already
  //  implemented. Matched as fits-grammar below.)
  // Conditional "can't be challenged" with filter (Nick Wilde, Kenai, Iago)
  [/while .{0,60}can'?t be challenged\b/i, "conditional-cant-be-challenged"],
  // (damage-immunity removed: damage_prevention_timed Effect +
  //  damage_prevention_static StaticEffect implemented. Regex now lives in
  //  FITS_GRAMMAR_PATTERNS and points at the `damage_prevention` capability.)
  [/\bprevent .{0,30}damage\b/i, "damage-prevention"],
  // Damage removal prevention (Vision Slab: "damage counters can't be removed")
  [/\bdamage counters can'?t be removed\b/i, "damage-removal-prevention"],
  // "Discard until they have N" / "draw until you have N" — trim hand
  // (trim-hand removed: fill_hand_to.trimOnly implemented.)
  // (draw-to-n removed: DrawEffect.untilHandSize implemented — matched as
  //  fits-grammar via the "draw..until" pattern below.)
  // (put-top-cards-into-discard removed: implemented; matched as fits-grammar below.)
  // (put-on-bottom removed: put_card_on_bottom_of_deck Effect implemented; matched
  //  by FITS_GRAMMAR_PATTERNS below.)
  // Opponent-chosen banish ("each opponent chooses and banishes one of their characters")
  [/\beach opponent chooses and banishes\b/i, "opponent-chosen-banish"],
  // Opponent-chosen return to hand ("each opponent chooses one of their characters and returns")
  [/\beach opponent chooses .{0,40}returns?\b/i, "opponent-chosen-return"],
  // (exert-filtered-cost removed: "{E} one of your X" is modeled as a leading
  //  exert effect on an activated ability — always supported. Matched by the
  //  generic `exert` regex in FITS_GRAMMAR_PATTERNS.)
  // Shift variants — classification shift, universal shift, name aliases
  [/\buniversal shift\b/i, "shift-variant"],
  [/\b[A-Z][a-z]+ shift \d+\b/i, "shift-variant"],
  [/\bcounts as being named (both|any)\b/i, "shift-variant"],
  [/\bcounts as .{0,30}named .{0,30}for shift\b/i, "shift-variant"],
  [/\bMIMICRY\b/i, "shift-variant"],
  [/\bas if this character had any name\b/i, "shift-variant"],
  // Opposing can't sing / exert to sing
  [/can'?t .{0,30}(exert to )?sing\b/i, "restrict-sing"],
  // "If they don't" — inverse sequential (no matching branch in SequentialEffect)
  [/\bif they don'?t\b/i, "inverse-sequential"],
  [/\bif (he|she|it|they) doesn'?t\b/i, "inverse-sequential"],
  // (random-discard removed: discard_from_hand chooser:"random" already handles
  //  this. Cards wired in this batch.)
  // "Gains the [Trait] classification" — trait granting
  [/\bgain.{0,10}classification\b/i, "grant-classification"],
  // (remove-ability removed: remove_named_ability StaticEffect implemented.)
  // (stat-floor removed: stat_floor_printed StaticEffect implemented — Elisa Maza
  //  Transformed Gargoyle. Matched as fits-grammar below.)
  // "Can't lose lore" (during opponents' turns)
  // (prevent-lore-loss removed: prevent_lore_loss StaticEffect implemented.)
  // "Count as having +N cost" (virtual cost for singer threshold)
  // (virtual-cost-modifier removed: sing_cost_bonus_here StaticEffect implemented —
  //  Atlantica Concert Hall. Matched as fits-grammar below.)
  // "Plays X again from discard, put on bottom" — replay from discard
  [/\bplay .{0,40}again from your discard\b/i, "replay-from-discard"],
  // "All cards in your hand count as having [ink color]" — dual ink grant
  [/\bcount as having \{I/i, "virtual-ink-color"],
  // New trigger events: "when this character exerts" / "deals damage in challenge" / "is dealt damage"
  [/whenever this character exerts\b/i, "new-trigger-exerts"],
  [/whenever this character deals damage\b/i, "new-trigger-deals-damage"],
  [/whenever this character is dealt damage\b/i, "new-trigger-is-dealt-damage"],
  // (song-trigger removed: "Whenever you play a song" → card_played with hasTrait Song filter
  //  works today; "Whenever this character sings a song" → sings trigger event implemented in
  //  Phase A.1.)
  // Condition based on character strength threshold ("if you have a character with 5 {S}")
  // (stat-threshold-condition removed: you_control_matching + strengthAtLeast filter already supported.)
  // (self-stat-condition removed: self_stat_gte exists.)
  // (new-trigger-sings removed: sings trigger event implemented in Phase A.1.)
  // "Can't play actions/items" scoped to card type (Pete, Keep the Ancient Ways)
  // (restricted-play-by-type removed: restrict_play Effect implemented — Pete Games
  //  Referee, Keep the Ancient Ways. Matched as fits-grammar below.)
  // "Can't play this character unless" — play restriction condition
  // (play-restriction removed: CardDefinition.playRestrictions implemented +
  //  consulted by validatePlayCard. Mirabel x2 wired; Nathaniel Flint deferred
  //  with event-tracking-condition.)
  // "Was damaged this turn" — event-tracking condition
  [/was damaged this turn\b/i, "event-tracking-condition"],
  // (name-a-card removed: name_a_card_then_reveal effect implemented in Phase A.0.)
  // "Reveal top card... if it's a [type] card... put into hand. Otherwise, top/bottom"
  [/\breveal the top card.{0,60}(if it'?s?|put).{0,40}(into (your|their) hand|on the (top|bottom))/i, "reveal-top-conditional"],
  // (conditional-keyword-by-turn removed: grant_keyword static + is_your_turn condition both exist.)
  // (filtered-cant-be-challenged removed: cant_be_challenged static accepts
  //  attackerFilter with strengthAtLeast/hasTrait. Cards wired this batch.)
  // (both-players-effect removed: target { type: "both" } works for draw,
  //  discard_from_hand, and (as of this batch) gain_lore.)
  // (put-damage-counter removed: deal_damage gained `asPutDamage: true`
  //  flag — bypasses Resist + damage_dealt_to triggers per CRD 8.8.3 / 1.9.1.2.)
  // Dynamic filter based on card's own stat ("cost equal to or less than this character's {S}")
  [/cost equal to or less than .{0,30}\{S\}/i, "dynamic-filter"],
  // (broader timed-cant-be-challenged entries also removed — see above.)
  // "Reveal top card, if matching type put in hand, otherwise top/bottom of deck"
  [/\breveal the top card of your deck\b/i, "reveal-top-conditional"],
  // Compound condition (exerted + named character in play, etc.)
  [/\bwhile .{0,30}exerted.{0,30}(if you have|you have)\b/i, "compound-condition"],
  // "play it as if it were in your hand" — play-from-revealed
  [/\bplay it as if it were in your hand\b/i, "play-from-revealed"],
  // "lose the [ability name] ability" — ability removal static
  [/\blose the .{0,30} ability\b/i, "remove-ability"],
  // (cards-under-to-hand removed: put_cards_under_into_hand Effect implemented;
  //  matched by FITS_GRAMMAR_PATTERNS below.)
  // "gets +{S} equal to the {S} of chosen character" — dynamic stat gain from another card
  [/gets? \+\{S\} equal to\b/i, "dynamic-stat-gain"],
  // (final timed-cant-be-challenged entries also removed — see above.)
  // (timed-cant-action removed: cant_action effect with end_of_owner_next_turn duration works today.)
  // "was banished in a challenge this turn" — event tracking condition
  [/was banished in a challenge this turn\b/i, "event-tracking-condition"],
];

// Patterns that strongly suggest the card fits existing grammar.
// Each entry pairs a regex with a capability_id. A regex match only counts as
// fits-grammar if its capability_id is listed in CAPABILITIES below — otherwise
// the card falls through to needs-new-mechanic. This prevents the categorizer
// from lying when a regex matches text whose underlying primitive isn't actually
// implemented (e.g. "chosen char gains \"...\" this turn" matches a return-to-hand
// regex via the inner quoted text, but the engine can't grant a floating trigger
// to a target character).
//
// Capability IDs are derived from the actual Effect/StaticEffect/Condition/
// TriggerEvent/Cost union members in packages/engine/src/types/index.ts. When
// you implement a new primitive, add its capability_id to CAPABILITIES.
const CAPABILITIES = new Set<string>([
  // Effects (Effect union)
  "draw", "deal_damage", "remove_damage", "banish", "return_to_hand",
  "gain_lore", "lose_lore", "gain_stats", "grant_cost_reduction",
  "move_damage", "put_top_card_under", "return_all_to_bottom_in_order",
  "drain_cards_under", "cant_be_challenged_timed",
  "reveal_top_conditional", "name_a_card_then_reveal", "move_character",
  "gets_stat_while_challenging", "create_card", "search", "choose",
  "exert", "ready", "grant_keyword", "cant_action", "look_at_top",
  "discard_from_hand", "self_replacement", "play_for_free", "play-from-under",
  "shuffle_into_deck", "put_into_inkwell", "grant_extra_ink_play",
  "put_card_on_bottom_of_deck", "pay_ink",
  "sequential", "create_floating_trigger_on_self",
  "put_top_cards_into_discard",
  "mass_inkwell",
  "create_floating_trigger_attached",
  "dynamic-amount",
  "reveal_hand", "draw_until_hand_size", "per_count_self_cost_reduction",
  // Static effects
  "stat_static", "cant_be_challenged_static", "cost_reduction_static",
  "action_restriction_static", "grant_activated_ability_static",
  "damage_prevention", "stat_floor_printed", "restrict_play", "sing_cost_bonus_here",
  "inkwell_enters_exerted", "each_opponent_may_discard_then_reward",
  // Triggers (TriggerEvent.on)
  "trigger_enters_play", "trigger_leaves_play", "trigger_quests",
  "trigger_sings", "trigger_challenges", "trigger_is_challenged",
  "trigger_is_banished", "trigger_banished_in_challenge",
  "trigger_turn_start", "trigger_turn_end", "trigger_card_played",
  "trigger_item_played", "trigger_banished_other_in_challenge",
  "trigger_damage_dealt_to", "trigger_moves_to_location",
  "trigger_damage_removed_from", "trigger_readied",
  "trigger_returned_to_hand", "trigger_cards_discarded",
  "trigger_deals_damage_in_challenge",
  "trigger_card_put_under",
  // Conditions
  "condition_is_your_turn", "condition_self_stat_gte",
  "condition_played_via_shift", "condition_cards_in_zone_gte",
  "condition_has_character_named",
  "condition_this_has_cards_under", "condition_you_control_matching",
  "condition_characters_here_gte",
  "condition_your_first_turn_as_underdog",
  "modify_stat_per_count",
  // Locations / location-related
  "location_at_location_filter",
  // Misc grammars
  "vanilla_reminder_text", "deck_construction_rule",
  "sing_together_reminder",
]);

const FITS_GRAMMAR_PATTERNS: [RegExp, string][] = [
  [/\bwhile here\b/i, "location_at_location_filter"],
  [/\bwhile .{0,20}is at a location\b/i, "location_at_location_filter"],
  [/\bat the start of your turn,? for each character .{0,20}here\b/i, "location_at_location_filter"],
  [/\bwhenever .{0,30}moves to a location\b/i, "trigger_moves_to_location"],
  [/\bdraws? (a|\d+) cards?\b/i, "draw"],
  [/\bdraws? a card\b/i, "draw"],
  [/\bdeal \d+ damage\b/i, "deal_damage"],
  [/\bdeals? \d+ damage\b/i, "deal_damage"],
  [/\bput \d+ damage (counter|on)\b/i, "deal_damage"],
  [/\bremove .{0,15}damage\b/i, "remove_damage"],
  [/\breturn .{0,60}to .{0,25}(their|your|a player'?s?) hand\b/i, "return_to_hand"],
  [/\breturn .{0,30}(character|item|card).{0,30}to .{0,20}hand\b/i, "return_to_hand"],
  [/\bgain \d+ lore\b/i, "gain_lore"],
  [/\bgains? \d+ lore\b/i, "gain_lore"],
  [/\blose[s]? \d+ lore\b/i, "lose_lore"],
  [/\bgets? [+-]\d+ \{[SWL]\}/i, "gain_stats"],
  [/\bgives? .{0,30}[+-]\d+ \{[SWL]\}/i, "gain_stats"],
  [/\bgets? [+-]\d+ (strength|willpower|lore)\b/i, "gain_stats"],
  [/\b[+-]\d+\/[+-]?\d+\b/i, "gain_stats"],
  [/\bgets? \+\d+ this turn\b/i, "gain_stats"],
  [/\bgets? -\d+ this turn\b/i, "gain_stats"],
  [/\bgets? -\d+ until\b/i, "gain_stats"],
  [/\bbanish\b/i, "banish"],
  [/\bready\b/i, "ready"],
  [/\bexert\b/i, "exert"],
  [/\bsearch (your|their|a|chosen) (player'?s? )?deck\b/i, "search"],
  [/\blook at the top \d+/i, "look_at_top"],
  [/\blook at the top (card|of)\b/i, "look_at_top"],
  [/\blook at .{0,20}top card\b/i, "look_at_top"],
  // put_top_cards_into_discard: Lorcana canonical wording
  [/\bputs? the top \d+ cards? .{0,30}into .{0,20}discard\b/i, "put_top_cards_into_discard"],
  [/\bputs? the top card .{0,30}into .{0,20}discard\b/i, "put_top_cards_into_discard"],
  [/\bdiscard (a|one|chosen|\d+)/i, "discard_from_hand"],
  [/\bchoose and discard\b/i, "discard_from_hand"],
  [/\bchooses? and discards?\b/i, "discard_from_hand"],
  [/\bdiscard your hand\b/i, "discard_from_hand"],
  [/\bshuffle\b/i, "shuffle_into_deck"],
  [/\bpay .{0,10}less\b/i, "cost_reduction_static"],
  [/\bcosts? .{0,10}less\b/i, "cost_reduction_static"],
  // reveal-hand: pure reveal + reveal-and-discard-X grammars
  [/\breveal.{0,30}(their|opponent'?s?|your) hand\b/i, "reveal_hand"],
  [/\blook at each opponent'?s? hand\b/i, "reveal_hand"],
  // draw-to-n: "draw until you have N" / "draw until you have the same number"
  [/\bdraw (cards? )?until you have\b/i, "draw_until_hand_size"],
  // per-count self cost reduction: "For each X, you pay N {I} less"
  [/for each .{0,60}you pay .{0,10}(\{i\}|less)/i, "per_count_self_cost_reduction"],
  [/\b(gains?|have|get|give) .{0,20}(evasive|rush|bodyguard|ward|reckless|resist|challenger|support|singer|shift|alert)\b/i, "grant_keyword"],
  // Alert keyword reminder text or standalone keyword line.
  [/\balert\b/i, "grant_keyword"],
  // Timed cant-be-challenged — cant_be_challenged_timed Effect already exists.
  [/can'?t be challenged until\b/i, "cant_be_challenged_timed"],
  [/chosen .{0,40}can'?t be challenged until\b/i, "cant_be_challenged_timed"],
  [/\bcan'?t quest\b/i, "cant_action"],
  [/\bcan'?t challenge\b/i, "cant_action"],
  [/\bcan'?t ready\b/i, "cant_action"],
  [/\bthis character can'?t be challenged\b/i, "cant_be_challenged_static"],
  [/\binto .{0,30}inkwell\b/i, "put_into_inkwell"],
  [/\bplay .{0,50}for free\b/i, "play_for_free"],
  [/\bwithout paying .{0,20}(ink )?cost\b/i, "play_for_free"],
  [/\byou may play .{0,40}from under\b/i, "play-from-under"],
  [/\bcreate .{0,30}token\b/i, "create_card"],
  [/\benter[s]? play exerted\b/i, "exert"],
  [/^\(?A character with cost \d+ or more can/i, "vanilla_reminder_text"],
  [/\bput it on (either the )?(top|bottom)/i, "look_at_top"],
  [/if you have a character named .{0,40}(pay|less)\b/i, "condition_has_character_named"],
  [/\bat the (start|end) of (your|each opponent'?s?) turn\b/i, "trigger_turn_start"],
  [/\bgets? \+\d+ \{[SWL]\}/i, "stat_static"],
  [/\benter[s]? play with \d+ damage\b/i, "deal_damage"],
  [/\bdiscards? all (the )?cards? in (their|your|a) hand\b/i, "discard_from_hand"],
  [/\bdiscard all\b/i, "discard_from_hand"],
  [/\bfrom .{0,20}discard on the top of .{0,20}deck\b/i, "shuffle_into_deck"],
  [/\bdeal \d+ damage to each (opposing|opponent'?s?)\b/i, "deal_damage"],
  [/^choose one:$/i, "choose"],
  [/\bchoose one:\s*$/i, "choose"],
  [/\bif .{0,40}(is chosen|character is chosen|is named).{0,40}instead\b/i, "self_replacement"],
  [/\bgets? \+\d+ \{S\}.{0,40}instead\b/i, "self_replacement"],
  [/\byou may have up to \d+ copies\b/i, "deck_construction_rule"],
  [/\beach opponent chooses one .{0,40}returns?\b/i, "return_to_hand"],
  [/\breturn all opposing characters\b/i, "return_to_hand"],
  [/\bgive .{0,40}(resist|challenger) \+\d+ until\b/i, "grant_keyword"],
  [/\bcan'?t (quest|challenge) during (their|your) next turn\b/i, "cant_action"],
  [/\bchosen opposing character can'?t (quest|challenge)\b/i, "cant_action"],
  [/\bthis character can'?t (challenge|quest)\b/i, "action_restriction_static"],
  [/\btakes? no damage from the challenge\b/i, "stat_static"],
  // damage-immunity family — damage_prevention_timed / damage_prevention_static.
  [/\btakes? no damage from challenges\b/i, "damage_prevention"],
  [/\bcan'?t be dealt damage\b/i, "damage_prevention"],
  // stat-floor — Elisa Maza Transformed Gargoyle "can't be reduced below their printed value".
  [/\bcan'?t be reduced below .{0,20}printed\b/i, "stat_floor_printed"],
  // restricted-play-by-type — Pete Games Referee, Keep the Ancient Ways.
  [/\bcan'?t play (actions|items|actions or items)\b/i, "restrict_play"],
  // virtual-cost-modifier — Atlantica Concert Hall ("count as having +N cost ... while here").
  [/\bcount as having .{0,10}cost .{0,30}while here\b/i, "sing_cost_bonus_here"],
  // inkwell-static — Daisy Duck Paranormal Investigator ("cards enter opponents' inkwells exerted").
  [/\benter.{0,10}opponents'.{0,20}inkwell.{0,20}exerted\b/i, "inkwell_enters_exerted"],
  // for-each-opponent-who-didnt — Sign the Scroll, Ursula's Trickery (2P only for now).
  [/\bfor each opponent who (doesn'?t|does not)\b/i, "each_opponent_may_discard_then_reward"],
  [/\bcan'?t be challenged by .{0,30}characters\b/i, "cant_be_challenged_static"],
  [/\bwhile being challenged\b/i, "trigger_is_challenged"],
  [/during your turn.{0,40}(has|gains?) (evasive|rush|bodyguard|ward|reckless|resist|challenger|support)/i, "grant_keyword"],
  [/\bmove .{0,15}damage counter/i, "move_damage"],
  [/\bmove (a |all |\d+ )?damage from\b/i, "move_damage"],
  [/\bmove up to \d+ damage\b/i, "move_damage"],
  [/\bmove \d+ damage from\b/i, "move_damage"],
  [/\beach opponent chooses .{0,40}(banishes?|exerts?|returns?|deals?)\b/i, "choose"],
  [/gets? \+\{S\} equal to this character'?s? \{S\}/i, "gain_stats"],
  [/\+\d+ \{S\}.{0,20}for each card in your hand/i, "gain_stats"],
  [/\byou pay \d+ \{I\} less for the next\b/i, "grant_cost_reduction"],
  [/banish one of your\b/i, "banish"],
  [/whenever (you|this character) (play|sing)s? a song\b/i, "trigger_card_played"],
  [/while .{0,20}has? \d+ \{S\} or more\b/i, "condition_self_stat_gte"],
  [/\bif you used shift\b/i, "condition_played_via_shift"],
  [/while .{0,10}(you|they) have .{0,40}in (your|their) (play|hand|discard|inkwell)\b/i, "condition_cards_in_zone_gte"],
  [/can'?t (challenge|quest) during their next turn\b/i, "cant_action"],
  [/\bname a card\b/i, "name_a_card_then_reveal"],
  // reveal-top-conditional family (sets 5-11): wired via RevealTopConditionalEffect
  // with noMatchDestination top/bottom/hand/discard + optional matchExtraEffects.
  [/\breveal the top card of your deck\b/i, "reveal_top_conditional"],
  [/^sing together \d/i, "sing_together_reminder"],
  // Put card on bottom of deck (no shuffle — different from shuffle_into_deck)
  [/\bput .{0,40}on the bottom of .{0,20}deck\b/i, "put_card_on_bottom_of_deck"],
  // "you may pay N {I} to <effect>" — sequential w/ isMay + pay_ink cost effect.
  [/\bmay pay \d+ \{I\} to\b/i, "sequential"],
  // Dynamic amount: damage/lore/draw/lose-lore tied to a stat, count, or cost.
  [/deal .{0,40}damage equal to\b/i, "dynamic-amount"],
  [/\bgain lore equal to\b/i, "dynamic-amount"],
  [/\blose[s]? lore equal to\b/i, "dynamic-amount"],
  [/equal to (their|this character'?s?|chosen|the number|the cost|her \{|his \{|its \{)\b/i, "dynamic-amount"],
  [/\bgain lore equal to (another|a|chosen|her|his)\b/i, "dynamic-amount"],
  // Boost family — CRD 8.4.2 (post-c6aa811 + 975d3f5 wiring).
  [/\bboost \d+ \{I\}/i, "put_top_card_under"],
  [/\bboost ability\b/i, "put_top_card_under"],
  // "Whenever you put a card under [this/them/one of your]" → card_put_under trigger
  [/\bwhenever you put a card .{0,40}under\b/i, "trigger_card_put_under"],
  // "While there's a card under [this/her/him]" → this_has_cards_under condition
  [/\bwhile (there'?s? a card|.{0,30}has.{0,15}card) under\b/i, "condition_this_has_cards_under"],
  // "with a card under (this/them/him/her/one of)" — hasCardUnder filter on chosen target
  [/\bwith a card under (this|them|him|her|one of|a)\b/i, "condition_this_has_cards_under"],
  // "While you have a character or location in play with a card under" → you_control_matching
  [/\bwhile you have .{0,40}with a card under\b/i, "condition_you_control_matching"],
  // "if you have a character or location in play with a card under" → you_control_matching
  [/\bif you have .{0,40}with a card under\b/i, "condition_you_control_matching"],
  // "put the top card of your deck (facedown )?under" → put_top_card_under effect
  [/\bput the top card .{0,30}under\b/i, "put_top_card_under"],
  [/\bput .{0,30}facedown under\b/i, "put_top_card_under"],
  // "for each card under" / "number of cards under" → cards_under_count dynamic amount
  // Engine resolves via modify_stat_per_count.countCardsUnderSelf for statics, or
  // cards_under_count DynamicAmount variant for effects.
  [/\bfor each card under\b/i, "modify_stat_per_count"],
  [/\bnumber of cards under\b/i, "modify_stat_per_count"],
  // "Put all cards from under [this/her] into your hand" → drain_cards_under
  [/\bput all cards from under\b/i, "drain_cards_under"],
  [/\bcards from under .{0,20}into .{0,15}hand\b/i, "drain_cards_under"],
];

function categorizeStub(rulesText: string, cardType: string): StubCategory {
  // Normalize curly quotes/apostrophes to straight — card data uses both
  const normalized = rulesText.replace(/[\u2018\u2019\u2032]/g, "'").replace(/[\u2013\u2014]/g, "-");
  for (const [pattern, _label] of NEW_MECHANIC_PATTERNS) {
    if (pattern.test(normalized)) return "needs-new-mechanic";
  }
  for (const [pattern, _label] of NEW_TYPE_PATTERNS) {
    if (pattern.test(normalized)) return "needs-new-type";
  }
  for (const [pattern, capabilityId] of FITS_GRAMMAR_PATTERNS) {
    if (pattern.test(normalized)) {
      // Honest check: regex match alone isn't enough — the underlying engine
      // primitive must actually exist. Otherwise this is a hidden new-mechanic.
      if (CAPABILITIES.has(capabilityId)) return "fits-grammar";
      return "needs-new-mechanic";
    }
  }
  return "unknown";
}

function worstCategory(categories: StubCategory[]): StubCategory {
  if (categories.includes("needs-new-mechanic")) return "needs-new-mechanic";
  if (categories.includes("needs-new-type")) return "needs-new-type";
  if (categories.includes("unknown")) return "unknown";
  return "fits-grammar";
}

// --- Load and categorize cards -----------------------------------------------

function loadSetFile(filename: string): any[] {
  const raw = readFileSync(join(CARDS_DIR, filename), "utf-8");
  return JSON.parse(raw);
}

function isImplemented(card: any): boolean {
  const hasNamedAbility = card.abilities?.some((a: any) =>
    ["triggered", "activated", "static"].includes(a.type)
  );
  const hasActionEffects = card.actionEffects?.length > 0;
  // alternateNames satisfies the only "named ability" of dual-name cards
  // (e.g. Flotsam & Jetsam Entangling Eels — CRD §10.6 reminder text).
  const hasAlternateNames = Array.isArray(card.alternateNames) && card.alternateNames.length > 0;
  const hasPlayRestrictions = Array.isArray(card.playRestrictions) && card.playRestrictions.length > 0;
  const hasAltPlayCost = card.altPlayCost !== undefined;
  return hasNamedAbility || hasActionEffects || hasAlternateNames || hasPlayRestrictions || hasAltPlayCost;
}

/**
 * Count STORY_NAME headers in the card's rulesText field. Story names appear as
 * ALL-CAPS words at the start of a line or after \n, followed by the ability text.
 * Examples: "SMOOTH THE WAY Once during your turn..." / "BONK! 1 {I}..."
 * This catches abilities that the stub parser missed (e.g. Angel's GOOD AIM).
 */
function countRulesTextAbilities(card: any): number {
  const text: string = card.rulesText ?? "";
  if (!text) return 0;
  // Split on \n to handle multi-ability cards
  const lines = text.split("\n").map((l: string) => l.trim()).filter(Boolean);
  let count = 0;
  for (const line of lines) {
    // A story-name header: starts with 1+ ALL-CAPS words (may include apostrophes,
    // hyphens, commas, exclamation/question marks), followed by ability text.
    // Exclude keyword reminder lines: "(Damage dealt to them is reduced by N.)"
    // Exclude Sing Together cost lines: "(A character with cost N or more can...)"
    if (line.startsWith("(")) continue;
    // Match: STORY NAME followed by space and lowercase/mixed text, or
    //        STORY NAME {E}/1{I} (activated ability cost prefix)
    if (/^[A-Z][A-Z' ,!?-]+(?:\s|{|$)/.test(line)) {
      count++;
    }
  }
  return count;
}

/**
 * Count wired non-keyword abilities (triggered, activated, static) plus
 * actionEffects entries. This is what the card actually has implemented.
 */
function countWiredAbilities(card: any): number {
  const namedAbilities = (card.abilities ?? []).filter((a: any) =>
    ["triggered", "activated", "static"].includes(a.type)
  ).length;
  const actionEffects = card.actionEffects?.length ?? 0;
  // playRestrictions count as a wired "ability" for cards whose only named
  // ability is the restriction itself (Mirabel, Nathaniel Flint).
  const playRestrictions = card.playRestrictions?.length ?? 0;
  // alternateNames represents an "also counts as <Name> for Shift" ability
  // (Incrediboy SPOILER ALERT) — a top-level card field, not an abilities[]
  // entry. Count it as one wired ability if present.
  const altNames = card.alternateNames?.length ? 1 : 0;
  return namedAbilities + actionEffects + playRestrictions + altNames;
}

/**
 * Detect partially wired cards: isImplemented() returns true (at least one
 * ability wired), but the rulesText has more story-name headers than wired
 * abilities — meaning one or more abilities are missing.
 */
function isPartiallyWired(card: any): boolean {
  if (!isImplemented(card)) return false;
  const expected = countRulesTextAbilities(card);
  const actual = countWiredAbilities(card);
  // Only flag if the rulesText clearly has MORE named abilities than what's wired
  return expected > 0 && actual > 0 && expected > actual;
}

function hasNamedStubs(card: any): boolean {
  // Filter out stubs whose entire text is just keyword reminder text for a
  // keyword the card already has wired (e.g. Cri-Kee with only "Alert (...)").
  const cardKeywords: string[] = (card.abilities ?? [])
    .filter((a: any) => a.type === "keyword")
    .map((a: any) => String(a.keyword || "").toLowerCase());
  return card._namedAbilityStubs?.some((s: any) => {
    const text = s.rulesText?.trim();
    if (!text) return false;
    // Stub is "just a keyword reminder" if its first word is one of the card's keywords.
    const firstWord = text.split(/[\s(]/)[0]?.toLowerCase() ?? "";
    if (cardKeywords.includes(firstWord)) return false;
    // Pure deckbuild rules (e.g. Dalmatian Puppy "you may have up to 99 copies in your deck")
    // affect deck construction only, not in-play behavior.
    if (/\byou may have up to \d+ copies\b/i.test(text)) return false;
    return true;
  });
}

const SET_FILES = readdirSync(CARDS_DIR)
  .filter((f) => f.startsWith("card-set-") && f.endsWith(".json"))
  .sort();

const allCards: CardEntry[] = [];

for (const filename of SET_FILES) {
  const rawCards = loadSetFile(filename);

  for (const card of rawCards) {
    // Apply set filter
    const setNum = card.setId?.toString();
    if (filterSet && setNum !== filterSet) continue;

    let category: CardCategory;
    const categorizedStubs: CardEntry["stubs"] = [];
    const fieldErrors = validateCardFields(card);

    if (fieldErrors.length > 0) {
      category = "invalid-field";
    } else if (isPartiallyWired(card)) {
      category = "partial";
    } else if (isImplemented(card)) {
      category = "implemented";
    } else if (card.cardType === "location") {
      // Unimplemented locations: vanilla locations have no stubs, otherwise stubs use existing categorization
      if (!hasNamedStubs(card)) {
        category = "vanilla";
      } else {
        for (const stub of card._namedAbilityStubs ?? []) {
          if (!stub.rulesText?.trim()) continue;
          const stubCat = categorizeStub(stub.rulesText, card.cardType);
          categorizedStubs.push({
            storyName: stub.storyName ?? "",
            rulesText: stub.rulesText,
            category: stubCat,
          });
        }
        category = worstCategory(categorizedStubs.map((s) => s.category));
      }
    } else if (isImplemented(card)) {
      category = "implemented";
    } else if (
      card.cardType === "action" &&
      !(card.actionEffects?.length > 0) &&
      typeof card.rulesText === "string" &&
      card.rulesText.trim().length > 0
    ) {
      // An action with non-empty rulesText but no actionEffects is a stub, not
      // vanilla — actions without effects do nothing when played. Ravensburger
      // and Lorcast emit `_namedAbilityStubs` only for text inside `\Name\`
      // banners; plain-text actions (no banner) fall through without stubs.
      // Synthesize a single stub from the card's rulesText so the normal
      // categorization path runs. Strip leading song-keyword reminder text
      // ("(A character with cost N or more can {E} to sing this song for free.)")
      // so the categorizer sees the actual effect, not the keyword paren.
      const text = card.rulesText
        .replace(/^\(A character with cost \d+ or more can[^)]*\)\s*/i, "")
        .trim();
      if (text.length > 0) {
        const stubCat = categorizeStub(text, card.cardType);
        categorizedStubs.push({
          storyName: "",
          rulesText: text,
          category: stubCat,
        });
        category = stubCat;
      } else {
        category = "vanilla";
      }
    } else if (!hasNamedStubs(card)) {
      category = "vanilla";
    } else {
      // Categorize each stub individually
      for (const stub of card._namedAbilityStubs ?? []) {
        if (!stub.rulesText?.trim()) continue;
        const stubCat = categorizeStub(stub.rulesText, card.cardType);
        categorizedStubs.push({
          storyName: stub.storyName ?? "",
          rulesText: stub.rulesText,
          category: stubCat,
        });
      }
      category = worstCategory(categorizedStubs.map((s) => s.category));
    }

    allCards.push({
      id: card.id,
      fullName: card.fullName,
      cardType: card.cardType,
      setId: setNum ?? "?",
      number: card.number ?? 0,
      category,
      stubs: categorizedStubs,
      fieldErrors: fieldErrors.length > 0 ? fieldErrors : undefined,
    });
  }
}

// --- Output ------------------------------------------------------------------

const CATEGORY_ORDER: CardCategory[] = [
  "implemented",
  "partial",
  "invalid-field",
  "vanilla",
  "fits-grammar",
  "needs-new-type",
  "needs-new-mechanic",
  "unknown",
];

const CATEGORY_LABELS: Record<CardCategory, string> = {
  implemented: "done",
  partial: "partial",
  "invalid-field": "invalid",
  vanilla: "vanilla",
  "fits-grammar": "fits-grammar",
  "needs-new-type": "needs-new-type",
  "needs-new-mechanic": "needs-new-mechanic",
  unknown: "unknown",
};

function count(cards: CardEntry[], cat: CardCategory): number {
  return cards.filter((c) => c.category === cat).length;
}

// Group cards by set for the summary table
const bySet = new Map<string, CardEntry[]>();
for (const card of allCards) {
  const list = bySet.get(card.setId) ?? [];
  list.push(card);
  bySet.set(card.setId, list);
}

// --- Summary table -----------------------------------------------------------

if (!filterCategory) {
  const COL = 7;
  const pad = (s: string | number, w: number) => String(s).padStart(w);
  const padr = (s: string | number, w: number) => String(s).padEnd(w);

  console.log("\n" + padr("SET", 5) + pad("TOTAL", 6) + pad("DONE", 6) +
    pad("PARTIAL", 8) + pad("INVALID", 8) + pad("VANILLA", 8) + pad("FITS", 6) + pad("NEW-TYPE", 10) +
    pad("NEW-MECH", 10) + pad("UNKNOWN", 9));
  console.log("─".repeat(76));

  const setIds = [...bySet.keys()].sort((a, b) =>
    a.replace(/\D/g, "").padStart(5, "0").localeCompare(b.replace(/\D/g, "").padStart(5, "0"))
  );

  for (const setId of setIds) {
    const cards = bySet.get(setId)!;
    console.log(
      padr("  " + setId, 5) +
        pad(cards.length, 6) +
        pad(count(cards, "implemented"), 6) +
        pad(count(cards, "partial"), 8) +
        pad(count(cards, "invalid-field"), 8) +
        pad(count(cards, "vanilla"), 8) +
        pad(count(cards, "fits-grammar"), 6) +
        pad(count(cards, "needs-new-type"), 10) +
        pad(count(cards, "needs-new-mechanic"), 10) +
        pad(count(cards, "unknown"), 9)
    );
  }

  console.log("─".repeat(76));
  // Totals
  console.log(
    padr("  ALL", 5) +
      pad(allCards.length, 6) +
      pad(count(allCards, "implemented"), 6) +
      pad(count(allCards, "partial"), 8) +
      pad(count(allCards, "invalid-field"), 8) +
      pad(count(allCards, "vanilla"), 8) +
      pad(count(allCards, "fits-grammar"), 6) +
      pad(count(allCards, "needs-new-type"), 10) +
      pad(count(allCards, "needs-new-mechanic"), 10) +
      pad(count(allCards, "unknown"), 9)
  );

  const stubs = allCards.filter((c) =>
    ["fits-grammar", "needs-new-type", "needs-new-mechanic", "unknown"].includes(c.category)
  );
  const partialCount = count(allCards, "partial");
  const invalidCount = count(allCards, "invalid-field");
  const implCount = count(allCards, "implemented");
  console.log(`\n  ${implCount} implemented / ${partialCount} partial / ${invalidCount} invalid / ${stubs.length} stubs remaining`);
  if (invalidCount > 0) {
    console.log(`  ✗ ${invalidCount} cards have invalid JSON fields (wrong trigger/effect/condition/cost/duration names).`);
    console.log(`    Run: pnpm card-status --category invalid-field --verbose`);
  }
  if (partialCount > 0) {
    console.log(`  ⚠ ${partialCount} cards have missing abilities (rulesText has more named abilities than wired).`);
    console.log(`    Run: pnpm card-status --category partial --verbose`);
  }
  console.log("\n  Run with --category <name> to list cards in a category.");
  console.log("  Categories: implemented | partial | invalid-field | vanilla | fits-grammar | needs-new-type | needs-new-mechanic | unknown\n");
}

// --- Category detail listing -------------------------------------------------

if (filterCategory) {
  const catMap: Record<string, CardCategory> = {
    implemented: "implemented",
    partial: "partial",
    "invalid-field": "invalid-field",
    vanilla: "vanilla",
    "fits-grammar": "fits-grammar",
    "needs-new-type": "needs-new-type",
    "needs-new-mechanic": "needs-new-mechanic",
    unknown: "unknown",
  };
  const cat = catMap[filterCategory];
  if (!cat) {
    console.error(`Unknown category "${filterCategory}". Valid: ${Object.keys(catMap).join(", ")}`);
    process.exit(1);
  }

  const matching = allCards.filter((c) => c.category === cat);
  console.log(`\n=== ${cat.toUpperCase()} (${matching.length} cards) ===\n`);

  for (const card of matching) {
    const prefix = `  [set-${card.setId}/${card.cardType} #${card.number}]`;
    console.log(`${prefix} ${card.fullName}`);
    if (verbose) {
      if (cat === "invalid-field" && card.fieldErrors) {
        for (const err of card.fieldErrors) {
          console.log(`    ✗ ${err.path}.${err.field} = "${err.value}" — not in ${err.validValues}`);
        }
      } else if (cat === "partial") {
        // For partial cards, show the rulesText and ability count mismatch
        const rawCard = loadSetFile(
          SET_FILES.find(f => f.includes(`set-${card.setId}`)) ?? ""
        ).find((c: any) => c.id === card.id);
        if (rawCard) {
          const expected = countRulesTextAbilities(rawCard);
          const actual = countWiredAbilities(rawCard);
          console.log(`    ⚠ ${actual} wired / ${expected} in rulesText`);
          console.log(`    rulesText: ${rawCard.rulesText}`);
        }
      } else if (card.stubs.length > 0) {
        for (const stub of card.stubs) {
          const tag = stub.category !== cat ? ` [${stub.category}]` : "";
          console.log(`    → ${stub.rulesText}${tag}`);
        }
      }
    }
  }
  console.log();
}

// --- Auto-show details for high-priority categories when no filter ----------

if (!filterCategory && !filterSet) {
  // Always show new-mechanic and unknown details (these need the most attention)
  for (const cat of ["needs-new-mechanic", "unknown"] as CardCategory[]) {
    const matching = allCards.filter((c) => c.category === cat);
    if (matching.length === 0) continue;
    console.log(`=== ${cat.toUpperCase()} (${matching.length} cards — need design before implementation) ===\n`);
    for (const card of matching.slice(0, 20)) {
      console.log(`  [set-${card.setId}/${card.cardType} #${card.number}] ${card.fullName}`);
      for (const stub of card.stubs.filter((s) => s.category === cat)) {
        console.log(`    → ${stub.rulesText}`);
      }
    }
    if (matching.length > 20) {
      console.log(`  ... and ${matching.length - 20} more. Use --category ${cat} to see all.\n`);
    } else {
      console.log();
    }
  }
}
