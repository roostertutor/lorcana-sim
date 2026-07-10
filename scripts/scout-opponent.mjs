#!/usr/bin/env node
// scout-opponent.mjs — reconstruct an opponent's revealed cards from a duels match replay.
//
// A `.match-replay.zip` is recorded from one player's perspective, so the
// opponent's hand and deck are hidden by the anti-cheat state filter. This script
// recovers every opponent card that BECAME visible across all games in the match
// (played, inked, quested, banished, or sitting in a visible zone) and prints a
// table sorted by how many copies were seen — a minimum-copy view of their deck.
//
// Usage:
//   node scripts/scout-opponent.mjs <path-to.match-replay.zip>
//   node scripts/scout-opponent.mjs <folder-with-.replay-files>
//   node scripts/scout-opponent.mjs <single.replay or .replay.gz>
//
// Zero dependencies: reads the ZIP and the gzipped replays with Node's built-in zlib.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ---------- minimal in-memory ZIP reader (stored + deflate entries) ----------
function readZipEntries(buf) {
  // locate End Of Central Directory record (sig 0x06054b50), scanning from the end
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid ZIP (no EOCD record found).');
  let cdOffset = buf.readUInt32LE(eocd + 16);
  const cdCount = buf.readUInt16LE(eocd + 10);
  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break; // central dir header
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    // jump to the local file header to find where the data actually starts
    const lhNameLen = buf.readUInt16LE(localOffset + 26);
    const lhExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    let data = method === 8 ? zlib.inflateRawSync(raw) : raw; // 8=deflate, 0=stored
    entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ---------- gather the raw replay JSON blobs from whatever path we were given ----------
function loadReplays(target) {
  const stat = fs.statSync(target);
  const blobs = []; // { name, buf }
  const pushFile = (name, buf) => {
    if (name.endsWith('.replay.gz')) blobs.push({ name, buf: zlib.gunzipSync(buf) });
    else if (name.endsWith('.replay')) blobs.push({ name, buf });
  };
  if (stat.isDirectory()) {
    for (const f of fs.readdirSync(target)) pushFile(f, fs.existsSync(path.join(target, f)) && !fs.statSync(path.join(target, f)).isDirectory() ? fs.readFileSync(path.join(target, f)) : Buffer.alloc(0));
  } else if (target.endsWith('.zip')) {
    for (const e of readZipEntries(fs.readFileSync(target))) pushFile(e.name, e.data);
  } else {
    pushFile(target, fs.readFileSync(target));
  }
  return blobs.filter(b => b.buf && b.buf.length).map(b => ({ name: b.name, replay: JSON.parse(b.buf.toString('utf8')) }));
}

// ---------- JSON Patch (RFC6902 subset: add / replace / remove) ----------
function applyPatch(doc, ops) {
  for (const op of ops) {
    const parts = op.path.split('/').slice(1).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
    let o = doc;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    const last = parts[parts.length - 1];
    if (op.op === 'remove') { if (Array.isArray(o)) o.splice(parseInt(last), 1); else delete o[last]; }
    else if (Array.isArray(o) && last === '-') o.push(op.value);
    else o[last] = op.value;
  }
}

// ---------- main ----------
const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/scout-opponent.mjs <path-to.match-replay.zip | folder | .replay[.gz]>');
  process.exit(1);
}

const games = loadReplays(target);
if (!games.length) { console.error('No .replay files found in: ' + target); process.exit(1); }

const meta = {}; // cardId -> { id, name, max }
let oppName = null;

for (const { replay } of games) {
  // perspective = the recording player; the opponent is the OTHER player number.
  const me = replay.perspective;
  if (!oppName && replay.playerNames) {
    const oppNum = String(me === 1 ? 2 : 1);
    oppName = replay.playerNames[oppNum] || oppName;
  }
  const perGameInst = {}; // id -> Set(instanceId)   (face-up zones)
  const perGameInk = {};  // id -> count             (ink reveals from logs)

  // Walk the game state, applying each frame's patch, harvesting the opponent's
  // visible zones (field / discard / items / inkwell) at every step.
  let snap = JSON.parse(JSON.stringify(replay.baseSnapshot));
  const harvest = z => {
    if (!Array.isArray(z)) return;
    for (const c of z) if (c && c.id && c.name !== undefined) {
      meta[c.id] = meta[c.id] || { id: c.id, name: c.fullName || c.name, max: 0 };
      (perGameInst[c.id] = perGameInst[c.id] || new Set()).add(c.instanceId || Symbol());
    }
  };
  for (const f of replay.frames || []) {
    try { applyPatch(snap, f.patch); } catch { /* tolerate any odd patch */ }
    const o = snap.opponent;
    if (o) { harvest(o.field); harvest(o.discard); harvest(o.items); harvest(o.inkwell); }
  }

  // Inkwell is usually face-down in state, but each "Opponent added X to ink"
  // log line reveals one inked card. Two such lines = two physical copies.
  for (const l of replay.logs || []) {
    if (!l.cardRefs || !l.cardRefs.length) continue;
    if (/^Opponent added .* to ink/.test(l.message || '')) {
      const c = l.cardRefs[0];
      meta[c.id] = meta[c.id] || { id: c.id, name: c.name, max: 0 };
      perGameInk[c.id] = (perGameInk[c.id] || 0) + 1;
    }
  }

  // Per-game copies = max(distinct face-up instances, ink reveals). Keep the
  // running max across games (so a 1-of seen once doesn't overwrite a 2-of).
  const ids = new Set([...Object.keys(perGameInst), ...Object.keys(perGameInk)]);
  for (const id of ids) {
    const n = Math.max(perGameInst[id] ? perGameInst[id].size : 0, perGameInk[id] || 0);
    if (n > meta[id].max) meta[id].max = n;
  }
}

const rows = Object.values(meta).sort((a, b) => b.max - a.max || a.name.localeCompare(b.name));
const total = rows.reduce((s, r) => s + r.max, 0);

console.log(`\nOpponent: ${oppName || '(unknown)'}   —   ${games.length} game(s) in this match`);
console.log(`${rows.length} distinct cards revealed, ${total} of 60 deck slots accounted for (minimum copies).\n`);
const w = Math.max(...rows.map(r => r.name.length));
console.log('copies  card');
console.log('------  ' + '-'.repeat(w));
for (const r of rows) console.log(String(r.max).padStart(4) + '    ' + r.name);
console.log(`\n(${60 - total} slots never seen — cards the opponent never drew, played, or inked.)`);
