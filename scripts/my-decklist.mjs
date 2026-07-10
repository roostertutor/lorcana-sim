#!/usr/bin/env node
// my-decklist.mjs — print the RECORDING player's own decklist from a duels replay.
//
// Unlike scout-opponent.mjs (which reconstructs the *opponent's* hidden deck from
// what became visible), your own deck isn't hidden: a `.replay` stores it directly
// in the top-level `decklist` field (a flat array of "SET-NUM" card ids). This
// script just counts those ids and resolves them to names via the engine card JSON.
//
// Falls back to reconstructing from baseSnapshot.myPlayer (hand + deckOrder) for
// older replays that predate the `decklist` field.
//
// Usage:
//   node scripts/my-decklist.mjs <single.replay | .replay.gz | .match-replay.zip | folder>
//
// Zero external deps: built-in zlib for the ZIP/gzip, reads card JSON from the repo.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = path.join(__dirname, '..', 'packages', 'engine', 'src', 'cards');

// ---------- minimal in-memory ZIP reader (stored + deflate entries) ----------
function readZipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid ZIP (no EOCD record found).');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdCount = buf.readUInt16LE(eocd + 10);
  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lhNameLen = buf.readUInt16LE(localOffset + 26);
    const lhExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ---------- gather raw replay JSON blobs from whatever path we were given ----------
function loadReplays(target) {
  const stat = fs.statSync(target);
  const blobs = [];
  const pushFile = (name, buf) => {
    if (name.endsWith('.replay.gz')) blobs.push({ name, buf: zlib.gunzipSync(buf) });
    else if (name.endsWith('.replay')) blobs.push({ name, buf });
  };
  if (stat.isDirectory()) {
    for (const f of fs.readdirSync(target)) {
      const full = path.join(target, f);
      if (!fs.statSync(full).isDirectory()) pushFile(f, fs.readFileSync(full));
    }
  } else if (target.endsWith('.zip')) {
    for (const e of readZipEntries(fs.readFileSync(target))) pushFile(e.name, e.data);
  } else if (target.endsWith('.gz')) {
    pushFile(target, fs.readFileSync(target)); // handles a bare *.replay.gz path
  } else {
    pushFile(target, fs.readFileSync(target));
  }
  return blobs
    .filter(b => b.buf && b.buf.length)
    .map(b => ({ name: b.name, replay: JSON.parse(b.buf.toString('utf8')) }));
}

// ---------- id ("SET-NUM") -> full card name, from the engine card JSON ----------
function buildNameIndex() {
  const id2name = {};
  for (const f of fs.readdirSync(CARDS_DIR)) {
    if (!/^card-set-.+\.json$/.test(f)) continue;
    let arr;
    try { arr = JSON.parse(fs.readFileSync(path.join(CARDS_DIR, f), 'utf8')); }
    catch { continue; }
    for (const c of (Array.isArray(arr) ? arr : Object.values(arr))) {
      if (c && c.setId != null && c.number != null) {
        id2name[`${c.setId}-${c.number}`] = c.fullName || c.name;
      }
    }
  }
  return id2name;
}

// ---------- pull the flat id list for the recording player ----------
function deckIdsFromReplay(replay) {
  // Preferred: the top-level `decklist` field is the recording player's deck,
  // stored directly as a flat array of "SET-NUM" ids.
  if (Array.isArray(replay.decklist) && replay.decklist.length) return replay.decklist;

  // Fallback for older replays: reconstruct from the recording player's own
  // zones in the base snapshot. Every physical card lives in exactly one zone,
  // so hand + field + items + inkwell + discard + deckOrder == the whole deck.
  const mp = replay.baseSnapshot?.myPlayer;
  if (!mp) return [];
  const ids = [];
  for (const zone of ['hand', 'field', 'items', 'inkwell', 'discard']) {
    for (const c of (mp[zone] || [])) if (c && c.id) ids.push(c.id);
  }
  for (const id of (mp.deckOrder || [])) ids.push(id);
  return ids;
}

// ---------- main ----------
const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/my-decklist.mjs <.replay | .replay.gz | .match-replay.zip | folder>');
  process.exit(1);
}

const games = loadReplays(target);
if (!games.length) { console.error('No .replay files found in: ' + target); process.exit(1); }

// A deck is constant across a match, so just use the first game.
const { replay } = games[0];
const me = String(replay.perspective);
const myName = (replay.playerNames && (replay.playerNames[me] ?? replay.playerNames['player' + me])) || '(you)';

const id2name = buildNameIndex();
const deckIds = deckIdsFromReplay(replay);
if (!deckIds.length) { console.error('No decklist found in this replay.'); process.exit(1); }

const counts = {};
const unresolved = new Set();
for (const id of deckIds) {
  const name = id2name[id];
  if (!name) unresolved.add(id);
  const key = name || `??? ${id}`;
  counts[key] = (counts[key] || 0) + 1;
}

const rows = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const total = rows.reduce((s, [, c]) => s + c, 0);

console.log(`\n${myName} — decklist   (${total} cards, ${rows.length} distinct)\n`);
const w = Math.max(...rows.map(([n]) => n.length));
console.log('copies  card');
console.log('------  ' + '-'.repeat(w));
for (const [n, c] of rows) console.log(String(c).padStart(4) + '    ' + n);
if (unresolved.size) {
  console.log(`\n(${unresolved.size} id(s) not found in card JSON: ${[...unresolved].join(', ')})`);
}
console.log('');
