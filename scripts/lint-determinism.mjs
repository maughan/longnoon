// Invariant 1: determinism. Math.random() is banned from the engine and content
// layers — the RNG cursor lives in GameState so that seed + command list
// reconstructs any game. The simulator is held to the same rule: a bot that
// rolls its own dice makes every measurement irreproducible.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const ROOTS = ['engine', 'content', 'sim', 'server'];

// The transport boundary is the one place wall-clock time and I/O belong:
// everything beneath it takes `now` as a parameter, which is exactly what makes
// the lobby timers testable without waiting for them. Keep this list at one.
const ALLOW = new Set(['server/ws.ts', 'server/serve.ts']);
const BANNED = [
  { re: /Math\.random\s*\(/, msg: 'Math.random() — use engine/rng.ts with a seed' },
  { re: /\bnew Date\b/, msg: 'new Date — not JSON-serializable, breaks replay' },
  { re: /Date\.now\s*\(/, msg: 'Date.now() — nondeterministic' },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

const violations = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (ALLOW.has(file.split(sep).join('/'))) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.trimStart().startsWith('//')) return;
      for (const { re, msg } of BANNED) {
        if (re.test(line)) violations.push(`${file}:${i + 1}  ${msg}`);
      }
    });
  }
}

if (violations.length) {
  console.error('Determinism violations:\n' + violations.map((v) => '  ' + v).join('\n'));
  process.exit(1);
}
console.log(`determinism ok — ${ROOTS.join(', ')} clean`);
