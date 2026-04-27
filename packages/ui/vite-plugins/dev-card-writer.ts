// =============================================================================
// DEV-ONLY CARD WRITER MIDDLEWARE
// Registered by vite.config.ts; runs only during `pnpm dev`. Accepts POST of
// a single card definition and appends/replaces it in the appropriate
// packages/engine/src/cards/card-set-{setId}.json file. Stamps
// `_source: "manual"` on writes so the hierarchy in import-cards-rav.ts /
// import-cards-lorcast.ts can upgrade the card later when an official API
// publishes it.
//
// Routes exposed:
//   POST /api/dev/add-card   body: { card: {...}, overwrite?: boolean }
//   GET  /api/dev/list-sets  → { sets: string[] } (discovered card-set-*.json)
//
// Guards: Vite's `configureServer` hook only runs in dev. Additionally, the
// plugin checks `server.config.command === "serve"` before wiring the hook, so
// `vite build` wouldn't ship the handler even if the plugin were misused.
// =============================================================================

import type { Plugin, ViteDevServer } from "vite";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { IncomingMessage, ServerResponse } from "http";
// Shared normalization — same golden-shape logic as scripts/import-cards-rav.ts
// and scripts/import-cards-lorcast.ts, so manually-entered cards match the
// same rulesText conventions (`<Keyword>` wrapping, curly apostrophes,
// en-dash stat modifiers, etc.) as API-imported cards.
import { normalizeRulesText, stripStraySeparators } from "../../../scripts/lib/normalize-rules-text.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "..", "..", "engine", "src", "cards");

// Mirrors the CardDefinitionOut shape used by the importers. Keep minimal —
// only validate what we need for a useful placeholder entry.
interface CardPost {
  id?: string;
  name: string;
  subtitle?: string;
  fullName?: string;
  cardType: "character" | "action" | "item" | "location";
  inkColors: ("amber" | "amethyst" | "emerald" | "ruby" | "sapphire" | "steel")[];
  cost: number;
  inkable: boolean;
  traits?: string[];
  strength?: number;
  willpower?: number;
  lore?: number;
  shiftCost?: number;
  moveCost?: number;
  abilities?: unknown[];
  rulesText?: string;
  flavorText?: string;
  setId: string;
  number: number;
  rarity:
    | "common" | "uncommon" | "rare" | "super_rare"
    | "legendary" | "enchanted" | "iconic" | "epic"
    | "promo" | "challenge" | "D23" | "D100";
  imageUrl?: string;
  foilImageUrl?: string;
  actionEffects?: unknown[];
  _source?: "ravensburger" | "lorcast" | "manual";
  _sourceLock?: boolean;
}

const VALID_INK_COLORS = new Set(["amber", "amethyst", "emerald", "ruby", "sapphire", "steel"]);
const VALID_CARD_TYPES = new Set(["character", "action", "item", "location"]);
const VALID_RARITIES = new Set([
  "common", "uncommon", "rare", "super_rare", "legendary",
  "enchanted", "iconic", "epic",
  "promo", "challenge", "D23", "D100",
]);

function slugify(name: string, subtitle?: string): string {
  const raw = subtitle ? `${name} ${subtitle}` : name;
  return raw
    .toLowerCase()
    .replace(/[\u0027\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function validate(card: CardPost): string[] {
  const errors: string[] = [];
  if (!card.name || typeof card.name !== "string") errors.push("name is required (string)");
  if (!VALID_CARD_TYPES.has(card.cardType)) errors.push(`cardType must be one of ${[...VALID_CARD_TYPES].join("|")}`);
  if (!Array.isArray(card.inkColors) || card.inkColors.length === 0) {
    errors.push("inkColors required (non-empty array)");
  } else {
    for (const c of card.inkColors) {
      if (!VALID_INK_COLORS.has(c)) errors.push(`inkColors contains invalid color: ${c}`);
    }
  }
  if (typeof card.cost !== "number" || card.cost < 0) errors.push("cost must be a non-negative number");
  if (typeof card.inkable !== "boolean") errors.push("inkable must be boolean");
  if (!card.setId || typeof card.setId !== "string") errors.push("setId required (string)");
  if (typeof card.number !== "number" || card.number < 0) errors.push("number must be a non-negative number");
  if (!VALID_RARITIES.has(card.rarity)) errors.push(`rarity must be one of ${[...VALID_RARITIES].join("|")}`);
  if (card.cardType === "character") {
    if (card.strength === undefined) errors.push("character requires strength");
    if (card.willpower === undefined) errors.push("character requires willpower");
    if (card.lore === undefined) errors.push("character requires lore");
  }
  return errors;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf-8");
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function handleAddCard(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let parsed: { card: CardPost; overwrite?: boolean };
  try {
    const raw = await readBody(req);
    parsed = JSON.parse(raw);
  } catch (err) {
    return json(res, 400, { error: "invalid JSON body", details: String(err) });
  }

  const card = parsed.card;
  if (!card || typeof card !== "object") return json(res, 400, { error: "missing 'card' object in body" });

  const errors = validate(card);
  if (errors.length > 0) return json(res, 400, { error: "validation failed", details: errors });

  // Normalize fields the UI might omit.
  card.id = card.id || slugify(card.name, card.subtitle);
  card.fullName = card.fullName || (card.subtitle ? `${card.name} - ${card.subtitle}` : card.name);
  card.traits = card.traits ?? [];
  card.abilities = card.abilities ?? [];
  card._source = "manual";
  // Apply shared golden-shape normalization so manual entries can't drift
  // away from what importers produce. `<Keyword>` wrapping (line-start and
  // inline, outside reminder parens), curly apostrophes, en-dash stat
  // modifiers, curly double quotes, trailing-whitespace strip.
  if (typeof card.rulesText === "string" && card.rulesText.length > 0) {
    card.rulesText = normalizeRulesText(card.rulesText);
  }
  if (typeof card.flavorText === "string") {
    // Flavor text only needs apostrophe + double-quote fidelity; don't apply
    // keyword wrapping since it's prose, not rules. Using the apostrophe and
    // dash helpers would risk false-positives; just normalize quotes.
    card.flavorText = stripStraySeparators(card.flavorText.replace(/'/g, "\u2019"));
  }

  const path = join(CARDS_DIR, `card-set-${card.setId}.json`);
  let cards: CardPost[] = [];
  if (existsSync(path)) {
    try {
      cards = JSON.parse(readFileSync(path, "utf-8"));
    } catch (err) {
      return json(res, 500, { error: "could not read existing set file", details: String(err) });
    }
  }

  // Collision check: (setId, number) or id. If an entry exists from a higher
  // tier (ravensburger/lorcast) or is locked, require overwrite=true and refuse
  // to downgrade silently.
  const byId = cards.find((c) => c.id === card.id);
  const byNumber = cards.find((c) => c.number === card.number);
  const collision = byId ?? byNumber;
  if (collision) {
    const tier = collision._source ?? "ravensburger";
    if (!parsed.overwrite) {
      return json(res, 409, {
        error: "collision",
        message: `A card already exists at (setId=${card.setId}, number=${card.number}) or id=${card.id}. Pass overwrite=true to replace.`,
        existing: { id: collision.id, number: collision.number, fullName: collision.fullName, _source: tier, _sourceLock: collision._sourceLock },
      });
    }
    if (collision._sourceLock) {
      return json(res, 409, {
        error: "source-locked",
        message: `The existing card is _sourceLock:true and cannot be overwritten via the manual form. Clear the lock in the JSON file first.`,
        existing: { id: collision.id, number: collision.number, fullName: collision.fullName },
      });
    }
    if (tier === "ravensburger" || tier === "lorcast") {
      return json(res, 409, {
        error: "would-downgrade",
        message: `The existing card is _source:"${tier}" — manual entry would be a downgrade. Pass overwrite=true only if you're intentionally replacing API data with manual.`,
        existing: { id: collision.id, number: collision.number, fullName: collision.fullName, _source: tier },
      });
    }
    // Overwrite a manual entry: remove it so the new one replaces it.
    cards = cards.filter((c) => c !== collision);
  }

  cards.push(card);
  cards.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  try {
    writeFileSync(path, JSON.stringify(cards, null, 2), "utf-8");
  } catch (err) {
    return json(res, 500, { error: "write failed", details: String(err) });
  }

  return json(res, 200, { ok: true, path, card });
}

function handleListSets(_req: IncomingMessage, res: ServerResponse): void {
  try {
    const files = readdirSync(CARDS_DIR)
      .filter((f) => f.startsWith("card-set-") && f.endsWith(".json"))
      .map((f) => f.replace(/^card-set-/, "").replace(/\.json$/, ""));
    return json(res, 200, { sets: files });
  } catch (err) {
    return json(res, 500, { error: "list failed", details: String(err) });
  }
}

export function devCardWriter(): Plugin {
  return {
    name: "lorcana:dev-card-writer",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/dev/add-card", async (req, res, next) => {
        if (req.method !== "POST") return next();
        try {
          await handleAddCard(req, res);
        } catch (err) {
          json(res, 500, { error: "handler threw", details: String(err) });
        }
      });
      server.middlewares.use("/api/dev/list-sets", (req, res, next) => {
        if (req.method !== "GET") return next();
        handleListSets(req, res);
      });
    },
  };
}
