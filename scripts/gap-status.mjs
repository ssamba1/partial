// Prints progress from docs/gaps/status.json. Usage: node scripts/gap-status.mjs [prefix]
import { readFileSync } from 'node:fs';
const rows = JSON.parse(readFileSync(new URL('../docs/gaps/status.json', import.meta.url), 'utf8'));
const prefix = process.argv[2];
const pick = prefix ? rows.filter((r) => r.id.startsWith(prefix)) : rows;
const count = {};
for (const r of pick) count[r.status] = (count[r.status] || 0) + 1;
console.log(`${pick.length} items`, count);
if (prefix) for (const r of pick) console.log(`${r.id}\t${r.status}\t${r.title}${r.note ? `\t(${r.note})` : ''}`);
