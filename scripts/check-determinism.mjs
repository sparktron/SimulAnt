/*
    Determinism guard.

    AGENTS.md: "All randomness must go through SeededRng in src/sim/rng.js.
    Never use Math.random() in simulation code — it breaks reproducibility and
    test isolation."

    Several files legitimately *mention* Math.random() in doc comments warning
    against it, so a plain grep gives false positives. This strips comments and
    string literals before looking for real call sites.

    Usage: node scripts/check-determinism.mjs
*/

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN_DIR = join(ROOT, 'src');
const PATTERN = /\bMath\s*\.\s*random\s*\(/;

/* Remove block comments, line comments, and string/template literals so only
   executable code remains. Not a full parser — deliberately conservative. */
function stripNonCode(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ')
        .replace(/'(?:\\.|[^'\\])*'/g, "''")
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

function jsFilesIn(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...jsFilesIn(full));
        else if (/\.(js|mjs)$/.test(entry)) out.push(full);
    }
    return out;
}

const violations = [];
for (const file of jsFilesIn(SCAN_DIR)) {
    const stripped = stripNonCode(readFileSync(file, 'utf8'));
    stripped.split('\n').forEach((line, i) => {
        if (PATTERN.test(line)) {
            violations.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
    });
}

if (violations.length > 0) {
    console.error('Determinism violation — Math.random() in simulation code.');
    console.error('Use SeededRng from src/sim/rng.js instead.\n');
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
}

console.log('Determinism OK: no Math.random() call sites in src/');
