/**
 * Reads the JSON shapes a MongoDB export can take:
 *   - a plain array of documents
 *   - JSONL / NDJSON, one document per line (mongoexport's default)
 *   - an object of `{ collectionName: [...documents] }`
 *
 * Extended JSON (`{"$oid": ...}`, `{"$date": ...}`) is collapsed to plain
 * values, since mongoexport writes it by default and it would otherwise be
 * stored as nested objects rather than ids and dates.
 */

/** Recursively unwraps MongoDB Extended JSON wrappers. */
function plain(value) {
  if (Array.isArray(value)) return value.map(plain);
  if (!value || typeof value !== 'object') return value;

  const keys = Object.keys(value);
  if (keys.length === 1) {
    const [k] = keys;
    const inner = value[k];
    if (k === '$oid') return String(inner);
    if (k === '$date') {
      const d = typeof inner === 'object' && inner?.$numberLong
        ? new Date(Number(inner.$numberLong))
        : new Date(inner);
      return Number.isNaN(d.getTime()) ? inner : d;
    }
    if (k === '$numberInt' || k === '$numberDouble') return Number(inner);
    if (k === '$numberLong') return Number(inner);
    if (k === '$numberDecimal') return Number(inner);
    if (k === '$binary') return '[binary]';
    if (k === '$undefined') return null;
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = plain(v);
  return out;
}

const isDocument = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Returns `[{ name, columns, rows }]`, matching the SQL reader's shape. */
export function parseJsonExport(text, filename = 'import.json') {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('The file is empty');

  // Default collection name comes from the filename, as mongoexport does.
  const fallback = filename.replace(/\.[^.]+$/, '').replace(/[^\w.-]/g, '') || 'imported';

  const build = (name, docs) => {
    const rows = docs.filter(isDocument).map(plain);
    const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    return { name, columns, rows };
  };

  // Whole-file JSON first; fall back to line-delimited.
  let parsed = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const rows = [];
    const lines = trimmed.split(/\r?\n/);
    lines.forEach((line, idx) => {
      const t = line.trim();
      if (!t) return;
      try {
        rows.push(JSON.parse(t));
      } catch {
        throw new Error(`Line ${idx + 1} is not valid JSON — the file is neither a JSON document nor JSONL`);
      }
    });
    if (!rows.length) throw new Error('No documents found in the file');
    return [build(fallback, rows)];
  }

  if (Array.isArray(parsed)) {
    if (!parsed.some(isDocument)) throw new Error('The array contains no objects to import');
    return [build(fallback, parsed)];
  }

  if (isDocument(parsed)) {
    // `{ collection: [...] }` — one entry per collection.
    const grouped = Object.entries(parsed).filter(([, v]) => Array.isArray(v) && v.some(isDocument));
    if (grouped.length) return grouped.map(([name, docs]) => build(name, docs));
    // A single document on its own.
    return [build(fallback, [parsed])];
  }

  throw new Error('Unrecognised JSON — expected an array of documents, JSONL, or { collection: [...] }');
}
