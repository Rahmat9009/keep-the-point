// Fails the build if anything secret-looking ended up in dist/.
// Never prints the key itself, only which file it was found in.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const PLACEHOLDER = 'paste-your-key-here';

function keyFromEnvLocal() {
  if (!existsSync('.env.local')) return null;
  const line = readFileSync('.env.local', 'utf8').split(/\r?\n/).find((l) => l.startsWith('GEMINI_API_KEY='));
  return line ? line.slice('GEMINI_API_KEY='.length).trim().replace(/^["']|["']$/g, '') : null;
}

const keys = [process.env.GEMINI_API_KEY?.trim(), keyFromEnvLocal()].filter((k) => k && k !== PLACEHOLDER && k.length >= 8);
const checks = [
  { name: 'the text "GEMINI_API_KEY"', test: (s) => s.includes('GEMINI_API_KEY') },
  { name: 'a Google API key (AIza...)', test: (s) => /AIza[0-9A-Za-z_-]{30,}/.test(s) },
  { name: 'the Gemini API key value', test: (s) => keys.some((k) => s.includes(k)) },
];

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

if (!existsSync(DIST)) {
  console.error('check-dist-secrets: dist/ not found. Run the build first.');
  process.exit(1);
}
const all = files(DIST);
const problems = [];
for (const file of all) {
  const text = readFileSync(file, 'latin1');
  for (const c of checks) if (c.test(text)) problems.push(`${file}: contains ${c.name}`);
}
if (problems.length) {
  console.error('check-dist-secrets: FAILED\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`check-dist-secrets: OK — ${all.length} files in dist/ contain no API key and no "GEMINI_API_KEY"${keys.length ? ' (checked against the real key value too)' : ''}.`);
