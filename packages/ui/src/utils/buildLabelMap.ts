// Returns a label map for a list of IDs.
// Appends (1), (2)… only when the same name appears more than once.
export function buildLabelMap(
  ids: string[],
  getName: (id: string) => string,
): Map<string, string> {
  const names = ids.map((id) => getName(id));
  const counts: Record<string, number> = {};
  for (const n of names) counts[n] = (counts[n] ?? 0) + 1;
  const seen: Record<string, number> = {};
  const map = new Map<string, string>();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const name = names[i]!;
    if (counts[name]! > 1) {
      seen[name] = (seen[name] ?? 0) + 1;
      map.set(id, `${name} (${seen[name]})`);
    } else {
      map.set(id, name);
    }
  }
  return map;
}
