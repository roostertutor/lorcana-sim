// =============================================================================
// /dev/add-card — hand-entry form for cards not yet in Ravensburger/Lorcast.
//
// Shipping preconditions (verified before building this page):
//   - Vite middleware `packages/ui/vite-plugins/dev-card-writer.ts` exposes:
//       GET  /api/dev/list-sets   → { sets: string[] }
//       POST /api/dev/add-card    → writes to card-set-{setId}.json, stamps
//                                    _source:"manual", runs shared rulesText
//                                    normalizer, refuses to downgrade ravensburger/
//                                    lorcast tiers without overwrite=true.
//   - CardPlaceholder component provides the live preview AND the run-time
//     fallback for cards with no imageUrl (Ravensburger hasn't published yet).
//
// Out of scope here (HANDOFF explicitly says UI only, no engine/card-JSON edits):
//   - Wiring abilities[] — that's hand-edited in the JSON after this form
//     creates the entry. This form only writes the card shell.
//   - Importer logic. The middleware already handles tier checks.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CardType, InkColor } from "@lorcana-sim/engine";
import CardPlaceholder from "../components/CardPlaceholder.js";

type Rarity =
  | "common"
  | "uncommon"
  | "rare"
  | "super_rare"
  | "legendary"
  | "enchanted"
  | "special"
  | "iconic"
  | "epic";

const INK_COLORS: InkColor[] = ["amber", "amethyst", "emerald", "ruby", "sapphire", "steel"];
const CARD_TYPES: CardType[] = ["character", "action", "item", "location"];
const RARITIES: Rarity[] = [
  "common",
  "uncommon",
  "rare",
  "super_rare",
  "legendary",
  "enchanted",
  "special",
  "iconic",
  "epic",
];

interface AddCardResponse {
  ok?: boolean;
  error?: string;
  message?: string;
  details?: string[] | string;
  path?: string;
  existing?: {
    id?: string;
    number?: number;
    fullName?: string;
    _source?: string;
    _sourceLock?: boolean;
  };
}

export default function DevAddCardPage() {
  const navigate = useNavigate();

  // ── Identity ──
  const [name, setName] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [cardType, setCardType] = useState<CardType>("character");
  const [setId, setSetId] = useState("12");
  const [cardNumber, setCardNumber] = useState(1);
  const [rarity, setRarity] = useState<Rarity>("common");

  // ── Ink + cost ──
  const [cost, setCost] = useState(1);
  const [inkable, setInkable] = useState(true);
  const [inkColors, setInkColors] = useState<InkColor[]>(["amber"]);

  // ── Character-only stats ──
  const [strength, setStrength] = useState(1);
  const [willpower, setWillpower] = useState(1);
  const [lore, setLore] = useState(1);

  // ── Optional ──
  const [shiftCost, setShiftCost] = useState<string>("");
  const [moveCost, setMoveCost] = useState<string>("");
  const [traitsInput, setTraitsInput] = useState("");
  const [rulesText, setRulesText] = useState("");
  const [flavorText, setFlavorText] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  // ── Submit state ──
  const [submitting, setSubmitting] = useState(false);
  const [response, setResponse] = useState<AddCardResponse | null>(null);
  const [overwrite, setOverwrite] = useState(false);

  // ── Known sets (for datalist autocomplete on setId) ──
  const [knownSets, setKnownSets] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/dev/list-sets")
      .then((r) => r.json())
      .then((d) => setKnownSets(Array.isArray(d?.sets) ? d.sets : []))
      .catch(() => setKnownSets([]));
  }, []);

  // Parse comma-separated traits on each render — small enough to not memoize
  const traits = useMemo(
    () =>
      traitsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    [traitsInput],
  );

  // ── Client-side validation (mirror of dev-card-writer.ts#validate) ──
  const errors = useMemo(() => {
    const e: string[] = [];
    if (!name.trim()) e.push("Name is required.");
    if (inkColors.length === 0) e.push("Pick at least one ink color.");
    if (cost < 0) e.push("Cost must be ≥ 0.");
    if (!setId.trim()) e.push("Set ID is required (e.g. 12, P1, DIS).");
    if (cardNumber < 0) e.push("Card number must be ≥ 0.");
    if (cardType === "character") {
      if (strength < 0) e.push("Character strength must be ≥ 0.");
      if (willpower < 1) e.push("Character willpower must be ≥ 1.");
      if (lore < 0) e.push("Character lore must be ≥ 0.");
    }
    if (shiftCost.trim() && isNaN(Number(shiftCost))) e.push("Shift cost must be a number or blank.");
    if (moveCost.trim() && isNaN(Number(moveCost))) e.push("Move cost must be a number or blank.");
    return e;
  }, [name, inkColors, cost, setId, cardNumber, cardType, strength, willpower, lore, shiftCost, moveCost]);

  function toggleInk(color: InkColor) {
    setInkColors((prev) =>
      prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color],
    );
  }

  async function handleSubmit() {
    if (errors.length > 0) return;
    setSubmitting(true);
    setResponse(null);

    const body: { card: Record<string, unknown>; overwrite?: boolean } = {
      card: {
        name: name.trim(),
        ...(subtitle.trim() && { subtitle: subtitle.trim() }),
        cardType,
        inkColors,
        cost,
        inkable,
        traits,
        ...(cardType === "character" && { strength, willpower, lore }),
        ...(shiftCost.trim() && { shiftCost: Number(shiftCost) }),
        ...(moveCost.trim() && { moveCost: Number(moveCost) }),
        ...(rulesText.trim() && { rulesText }),
        ...(flavorText.trim() && { flavorText }),
        setId: setId.trim(),
        number: cardNumber,
        rarity,
        ...(imageUrl.trim() && { imageUrl: imageUrl.trim() }),
      },
    };
    if (overwrite) body.overwrite = true;

    try {
      const res = await fetch("/api/dev/add-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as AddCardResponse;
      data.ok = res.ok;
      setResponse(data);
    } catch (err) {
      setResponse({ ok: false, error: "network error", message: String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setName("");
    setSubtitle("");
    setCardNumber((n) => n + 1); // auto-advance for quick sequential entry
    setRulesText("");
    setFlavorText("");
    setTraitsInput("");
    setImageUrl("");
    setShiftCost("");
    setMoveCost("");
    setResponse(null);
    setOverwrite(false);
  }

  const canSubmit = errors.length === 0 && !submitting;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-amber-400 font-bold">⬡ Dev — Add Card</div>
            <div className="text-[10px] text-gray-500">
              Hand-enter a card shell. Writes with{" "}
              <code className="text-gray-400">_source:&quot;manual&quot;</code> — auto-upgrades when
              Ravensburger publishes.
            </div>
          </div>
          <button
            onClick={() => navigate(-1)}
            className="text-xs px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-colors"
          >
            Back
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid lg:grid-cols-[1fr_320px] gap-6">
          {/* ═══════════════════════ FORM ═══════════════════════ */}
          <div className="space-y-5">
            {/* Identity */}
            <Section title="Identity">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name *">
                  <input
                    className={inputCls}
                    placeholder="Mickey Mouse"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Field label="Subtitle">
                  <input
                    className={inputCls}
                    placeholder="Brave Little Tailor"
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Type *">
                  <select className={inputCls} value={cardType} onChange={(e) => setCardType(e.target.value as CardType)}>
                    {CARD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Set *">
                  <input
                    className={inputCls}
                    placeholder="12"
                    value={setId}
                    onChange={(e) => setSetId(e.target.value)}
                    list="known-sets"
                  />
                  <datalist id="known-sets">
                    {knownSets.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Number *">
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={cardNumber}
                    onChange={(e) => setCardNumber(Number(e.target.value))}
                  />
                </Field>
              </div>
              <Field label="Rarity *">
                <select className={inputCls} value={rarity} onChange={(e) => setRarity(e.target.value as Rarity)}>
                  {RARITIES.map((r) => (
                    <option key={r} value={r}>
                      {r.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </Field>
            </Section>

            {/* Ink + cost */}
            <Section title="Ink & Cost">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Cost *">
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={cost}
                    onChange={(e) => setCost(Number(e.target.value))}
                  />
                </Field>
                <Field label="Inkable">
                  <label className="flex items-center gap-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={inkable}
                      onChange={(e) => setInkable(e.target.checked)}
                      className="accent-amber-500"
                    />
                    <span className="text-sm text-gray-400">Can be put in inkwell</span>
                  </label>
                </Field>
              </div>
              <Field label="Ink colors * (pick one or two)">
                <div className="flex flex-wrap gap-2">
                  {INK_COLORS.map((c) => {
                    const selected = inkColors.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggleInk(c)}
                        className={`px-3 py-1 rounded-full text-xs font-bold uppercase transition-colors border ${
                          selected
                            ? INK_BG_SELECTED[c]
                            : "bg-gray-800 text-gray-500 border-gray-700 hover:border-gray-600"
                        }`}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </Section>

            {/* Character stats */}
            {cardType === "character" && (
              <Section title="Character Stats">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Strength *">
                    <input
                      type="number"
                      min={0}
                      className={inputCls}
                      value={strength}
                      onChange={(e) => setStrength(Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Willpower *">
                    <input
                      type="number"
                      min={1}
                      className={inputCls}
                      value={willpower}
                      onChange={(e) => setWillpower(Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Lore *">
                    <input
                      type="number"
                      min={0}
                      className={inputCls}
                      value={lore}
                      onChange={(e) => setLore(Number(e.target.value))}
                    />
                  </Field>
                </div>
              </Section>
            )}

            {/* Optional costs + traits */}
            <Section title="Optional">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Shift cost">
                  <input
                    className={inputCls}
                    placeholder="(blank if no Shift)"
                    value={shiftCost}
                    onChange={(e) => setShiftCost(e.target.value)}
                  />
                </Field>
                <Field label="Move cost (locations)">
                  <input
                    className={inputCls}
                    placeholder="(blank if not a location)"
                    value={moveCost}
                    onChange={(e) => setMoveCost(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Traits (comma-separated)">
                <input
                  className={inputCls}
                  placeholder="Hero, Princess, Storyborn"
                  value={traitsInput}
                  onChange={(e) => setTraitsInput(e.target.value)}
                />
                {traits.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {traits.map((t) => (
                      <span key={t} className="px-2 py-0.5 rounded bg-gray-800 text-[10px] text-gray-400 border border-gray-700">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </Field>
            </Section>

            {/* Text */}
            <Section title="Text">
              <Field label="Rules text">
                <textarea
                  className={`${inputCls} h-24 font-mono text-xs`}
                  placeholder="Keyword abilities + card text. Server auto-wraps <Keyword> tokens."
                  value={rulesText}
                  onChange={(e) => setRulesText(e.target.value)}
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  Server normalizes apostrophes, en-dashes, and wraps{" "}
                  <code className="text-gray-400">&lt;Keyword&gt;</code> tokens to match imported cards.
                </p>
              </Field>
              <Field label="Flavor text">
                <textarea
                  className={`${inputCls} h-16`}
                  placeholder="(optional)"
                  value={flavorText}
                  onChange={(e) => setFlavorText(e.target.value)}
                />
              </Field>
            </Section>

            {/* Image */}
            <Section title="Image (optional)">
              <Field label="Image URL">
                <input
                  className={inputCls}
                  placeholder="https://... (leave empty — placeholder renders until Ravensburger publishes)"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                />
              </Field>
            </Section>

            {/* Validation */}
            {errors.length > 0 && (
              <div className="rounded-lg bg-red-950/40 border border-red-800/40 p-3 space-y-1">
                <div className="text-red-400 text-xs font-bold uppercase tracking-wider">Fix before submitting</div>
                <ul className="text-xs text-red-300 space-y-0.5 list-disc list-inside">
                  {errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Overwrite toggle surfaces after a 409 */}
            {response?.error === "collision" || response?.error === "would-downgrade" ? (
              <label className="flex items-center gap-2 rounded-lg bg-yellow-950/40 border border-yellow-800/40 p-3">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(e) => setOverwrite(e.target.checked)}
                  className="accent-amber-500"
                />
                <span className="text-xs text-yellow-300">
                  Overwrite existing entry{" "}
                  {response.existing?.fullName && (
                    <code className="ml-1 text-yellow-400">{response.existing.fullName}</code>
                  )}
                  {response.existing?._source && (
                    <span className="ml-1 text-yellow-500/80">
                      (was {response.existing._source})
                    </span>
                  )}
                </span>
              </label>
            ) : null}

            {/* Submit bar */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={`px-5 py-2 rounded-lg font-bold text-sm transition-colors ${
                  canSubmit
                    ? "bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20"
                    : "bg-gray-800 text-gray-500 cursor-not-allowed"
                }`}
              >
                {submitting ? "Submitting…" : overwrite ? "Overwrite & Save" : "Create Card"}
              </button>
              <button
                onClick={resetForm}
                disabled={submitting}
                className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
              >
                Reset
              </button>
              {response?.ok && (
                <span className="text-xs text-emerald-400">
                  ✓ Saved to{" "}
                  <code className="text-emerald-300">
                    {response.path?.split(/[\\/]/).slice(-1)[0] ?? "card-set-*.json"}
                  </code>
                </span>
              )}
            </div>

            {/* Server error */}
            {response && !response.ok && (
              <div className="rounded-lg bg-red-950/40 border border-red-800/40 p-3 space-y-1">
                <div className="text-red-400 text-xs font-bold uppercase tracking-wider">
                  Server: {response.error ?? "error"}
                </div>
                {response.message && <div className="text-xs text-red-300">{response.message}</div>}
                {Array.isArray(response.details) && (
                  <ul className="text-xs text-red-300 space-y-0.5 list-disc list-inside">
                    {response.details.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* ═══════════════════════ LIVE PREVIEW ═══════════════════════ */}
          <div className="space-y-3 lg:sticky lg:top-20 lg:self-start">
            <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">Live Preview</div>
            <CardPlaceholder
              data={{
                name,
                subtitle,
                cardType,
                inkColors,
                cost,
                inkable,
                traits,
                strength: cardType === "character" ? strength : undefined,
                willpower: cardType === "character" ? willpower : undefined,
                lore: cardType === "character" || cardType === "location" ? lore : undefined,
                rulesText,
                rarity,
                setId,
                number: cardNumber,
              }}
              className="w-full aspect-[5/7] max-w-[280px]"
            />
            <div className="text-[10px] text-gray-500 leading-relaxed">
              Render matches the fallback shown in the deckbuilder + card inspect modal when{" "}
              <code className="text-gray-400">imageUrl</code> is empty. Ravensburger images
              will replace this automatically on re-import.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──

const inputCls =
  "w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:border-amber-500/60 focus:outline-none";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-gray-900/40 border border-gray-800 p-4 space-y-3">
      <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-gray-400">{label}</span>
      {children}
    </label>
  );
}

const INK_BG_SELECTED: Record<InkColor, string> = {
  amber: "bg-[#f4b223] text-amber-950 border-amber-400",
  amethyst: "bg-[#7c4182] text-purple-100 border-purple-400",
  emerald: "bg-[#329044] text-emerald-50 border-emerald-400",
  ruby: "bg-[#d50037] text-red-50 border-red-400",
  sapphire: "bg-[#0093c9] text-sky-50 border-sky-400",
  steel: "bg-[#97a3ae] text-gray-950 border-gray-400",
};
