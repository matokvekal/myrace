/**
 * Rapid Entry — which rider a partly typed bib can still become.
 *
 * A digit trie over the bibs the keypad accepts (the riders of the current wave).
 * `classify` answers, for what the judge has typed so far:
 *   complete  — a bib, and no other bib starts with it          → accept at once
 *   ambiguous — a bib, but longer bibs start with it (1 / 18)   → wait for Enter
 *   prefix    — not a bib yet, but some bib starts with it (34) → wait for a digit
 *   none      — no bib starts with it                           → invalid entry
 *
 * Never auto-accept anything but `complete`: an ambiguous prefix must never be
 * recorded as the wrong rider.
 */

export type BibMatch = "complete" | "ambiguous" | "prefix" | "none";

interface Node {
  children: Map<string, Node>;
  terminal: boolean;
}

const newNode = (): Node => ({ children: new Map(), terminal: false });

/** A bib as the keypad types it: digits, no leading zeros. Anything else is not a bib. */
export function bibKey(bib: number | string | null | undefined): string | null {
  if (bib == null) return null;
  const s = String(bib).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? String(n) : null;
}

export interface BibIndex {
  classify(input: string): BibMatch;
  /** Bibs that start with `input` and are longer than it, shortest first. */
  continuations(input: string, limit?: number): string[];
}

export function buildBibIndex(bibs: Iterable<number | string | null | undefined>): BibIndex {
  const root = newNode();
  for (const bib of bibs) {
    const key = bibKey(bib);
    if (!key) continue;
    let node = root;
    for (const d of key) {
      let next = node.children.get(d);
      if (!next) node.children.set(d, (next = newNode()));
      node = next;
    }
    node.terminal = true;
  }

  const find = (input: string): Node | null => {
    if (!input || !/^\d+$/.test(input)) return null;
    let node: Node | undefined = root;
    for (const d of input) {
      node = node.children.get(d);
      if (!node) return null;
    }
    return node;
  };

  return {
    classify(input) {
      const node = find(input);
      if (!node) return "none";
      if (node.terminal) return node.children.size > 0 ? "ambiguous" : "complete";
      return "prefix";
    },
    continuations(input, limit = 5) {
      const node = find(input);
      if (!node) return [];
      const out: string[] = [];
      // Breadth-first, so the shortest (most likely next) bibs come first.
      let level: Array<[string, Node]> = [[input, node]];
      while (level.length && out.length < limit) {
        const next: Array<[string, Node]> = [];
        for (const [prefix, n] of level) {
          for (const [d, child] of [...n.children.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            const s = prefix + d;
            if (child.terminal) out.push(s);
            next.push([s, child]);
          }
        }
        level = next;
      }
      return out.slice(0, limit);
    },
  };
}
