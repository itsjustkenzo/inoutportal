/**
 * A small MySQL dump reader: enough of the grammar to pull CREATE TABLE column
 * names and INSERT rows out of a mysqldump file.
 *
 * It is a scanner, not a full SQL parser — it understands quoting well enough
 * not to be fooled by semicolons, commas and parentheses inside string values,
 * which is where naive regex splitting falls apart.
 */

/** Walks the dump and yields one statement at a time, quoting-aware. */
function* statements(sql) {
  let buf = '';
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // -- line comment  (only when followed by whitespace, per MySQL)
    if (ch === '-' && next === '-' && /\s|$/.test(sql[i + 2] ?? '')) {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      continue;
    }
    // # line comment
    if (ch === '#') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      continue;
    }
    // /* block comment */ — including /*!40101 conditional */ blocks, whose
    // contents we deliberately skip rather than execute.
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }

    // Quoted runs are copied verbatim so their contents never end a statement.
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      buf += ch;
      i += 1;
      while (i < sql.length) {
        const c = sql[i];
        if (c === '\\' && quote !== '`') {
          buf += c + (sql[i + 1] ?? '');
          i += 2;
          continue;
        }
        if (c === quote) {
          // A doubled quote is an escaped quote, not the end of the run.
          if (sql[i + 1] === quote) {
            buf += c + c;
            i += 2;
            continue;
          }
          buf += c;
          i += 1;
          break;
        }
        buf += c;
        i += 1;
      }
      continue;
    }

    if (ch === ';') {
      if (buf.trim()) yield buf.trim();
      buf = '';
      i += 1;
      continue;
    }

    buf += ch;
    i += 1;
  }

  if (buf.trim()) yield buf.trim();
}

const unquoteIdent = (raw) => raw.trim().replace(/^[`"[]|[`"\]]$/g, '');

/** Column names from a CREATE TABLE body, ignoring KEY/CONSTRAINT clauses. */
function createTableColumns(body) {
  const columns = [];
  let depth = 0;
  let current = '';

  const flush = () => {
    const def = current.trim();
    current = '';
    if (!def) return;
    // Skip index and constraint definitions — they are not columns.
    if (/^(primary\s+key|unique\s+key|unique|key|index|constraint|fulltext|spatial|foreign\s+key|check)\b/i.test(def)) {
      return;
    }
    const m = def.match(/^[`"[]?([^`"\]\s]+)[`"\]]?/);
    if (m) columns.push(m[1]);
  };

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      current += ch;
      i += 1;
      while (i < body.length) {
        if (body[i] === '\\' && quote !== '`') { current += body[i] + (body[i + 1] ?? ''); i += 2; continue; }
        current += body[i];
        if (body[i] === quote) break;
        i += 1;
      }
      continue;
    }
    if (ch === '(') { depth += 1; current += ch; continue; }
    if (ch === ')') { depth -= 1; current += ch; continue; }
    if (ch === ',' && depth === 0) { flush(); continue; }
    current += ch;
  }
  flush();
  return columns;
}

/** Decodes one SQL literal into a JS value. */
function literal(raw) {
  const text = raw.trim();
  if (!text) return null;
  if (/^null$/i.test(text)) return null;
  if (/^true$/i.test(text)) return true;
  if (/^false$/i.test(text)) return false;

  if (text.startsWith("'") || text.startsWith('"')) {
    const quote = text[0];
    const inner = text.slice(1, -1);
    let out = '';
    for (let i = 0; i < inner.length; i += 1) {
      const c = inner[i];
      if (c === '\\') {
        const n = inner[i + 1];
        // mysqldump's escape set.
        out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r'
          : n === '0' ? '\0' : n === 'b' ? '\b' : n === 'Z' ? '\x1a' : n;
        i += 1;
        continue;
      }
      if (c === quote && inner[i + 1] === quote) { out += quote; i += 1; continue; }
      out += c;
    }
    return out;
  }

  if (/^0x[0-9a-f]+$/i.test(text)) return text; // keep binary literals as text
  const num = Number(text);
  return Number.isFinite(num) && text !== '' ? num : text;
}

/** Splits the VALUES section into tuples, then tuples into literals. */
function parseValues(section) {
  const rows = [];
  let i = 0;

  while (i < section.length) {
    while (i < section.length && section[i] !== '(') i += 1;
    if (i >= section.length) break;
    i += 1; // past '('

    const values = [];
    let current = '';
    let depth = 0;

    while (i < section.length) {
      const ch = section[i];

      if (ch === "'" || ch === '"') {
        const quote = ch;
        current += ch;
        i += 1;
        while (i < section.length) {
          if (section[i] === '\\') { current += section[i] + (section[i + 1] ?? ''); i += 2; continue; }
          if (section[i] === quote && section[i + 1] === quote) { current += quote + quote; i += 2; continue; }
          current += section[i];
          if (section[i] === quote) { i += 1; break; }
          i += 1;
        }
        continue;
      }

      if (ch === '(') { depth += 1; current += ch; i += 1; continue; }
      if (ch === ')') {
        if (depth === 0) { values.push(literal(current)); i += 1; break; }
        depth -= 1;
        current += ch;
        i += 1;
        continue;
      }
      if (ch === ',' && depth === 0) { values.push(literal(current)); current = ''; i += 1; continue; }

      current += ch;
      i += 1;
    }

    rows.push(values);
  }

  return rows;
}

/**
 * Reads a dump into `[{ name, columns, rows }]`, where each row is a plain
 * object keyed by column name.
 */
export function parseSqlDump(text) {
  const tables = new Map();

  const table = (name) => {
    if (!tables.has(name)) tables.set(name, { name, columns: [], rows: [] });
    return tables.get(name);
  };

  for (const stmt of statements(text)) {
    const create = stmt.match(/^create\s+table\s+(?:if\s+not\s+exists\s+)?([`"[]?[\w$]+[`"\]]?(?:\.[`"[]?[\w$]+[`"\]]?)?)\s*\(/is);
    if (create) {
      const name = unquoteIdent(create[1].split('.').pop());
      const open = stmt.indexOf('(', create.index + create[0].length - 1);
      const body = stmt.slice(open + 1, stmt.lastIndexOf(')'));
      table(name).columns = createTableColumns(body);
      continue;
    }

    const insert = stmt.match(/^insert\s+(?:low_priority\s+|delayed\s+|high_priority\s+|ignore\s+)*into\s+([`"[]?[\w$]+[`"\]]?(?:\.[`"[]?[\w$]+[`"\]]?)?)\s*(\(([^)]*)\))?\s*values\s*/is);
    if (!insert) continue;

    const name = unquoteIdent(insert[1].split('.').pop());
    const target = table(name);
    // An explicit column list overrides the CREATE TABLE order.
    const columns = insert[3]
      ? insert[3].split(',').map((c) => unquoteIdent(c))
      : target.columns;

    for (const values of parseValues(stmt.slice(insert[0].length))) {
      const row = {};
      values.forEach((v, idx) => {
        const key = columns[idx] ?? `column_${idx + 1}`;
        row[key] = v;
      });
      if (Object.keys(row).length) target.rows.push(row);
    }

    if (!target.columns.length && columns.length) target.columns = columns;
  }

  return [...tables.values()].filter((t) => t.rows.length);
}
