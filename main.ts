// Token Radar entry, radar-3 (Node 22, standard library only).
//
// The program runs in five steps, in order:
//   1. read its arguments (where the snapshot is, where /output goes),
//   2. load and score the sealed snapshot with lib/model.ts,
//   3. refuse a board the gate would refuse, before writing anything,
//   4. write board.json and data.js, and copy dashboard/ and screenshots/,
//   5. write dossier.json last — the scorer rebuilds it from this /output
//      and compares bytes, so it must be written after everything it covers.
//
// The model: TVL, seven-day growth at full weight, a hump-shaped age
// factor, chain breadth, category, and standing within the category — one
// transparent formula, no protocol name special-cased. Deterministic: no
// clock, no randomness, no network. Change the model, the page or the plan;
// keep the gate's shape.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import type { Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };

// ---------------------------------------------------------------------------
// Step 1 — arguments.
// ---------------------------------------------------------------------------

/** `--name <value>` or `--name=<value>` out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** Fail with a message on stderr and the given exit code. */
function fail(message: string, code: number): never {
  process.stderr.write(message);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Step 2 — the snapshot, scored.
// ---------------------------------------------------------------------------

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(
    `token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`,
    2,
  );
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot: Snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);

// ---------------------------------------------------------------------------
// Step 3 — refuse a board the gate would refuse, before writing anything.
// ---------------------------------------------------------------------------

const issue = boardIssue(board, snapshot);
if (issue !== null) {
  fail(`token radar: the model wrote a board the gate refuses: ${issue}\n`, 1);
}

// ---------------------------------------------------------------------------
// Step 4 — board, data, and the static files.
// ---------------------------------------------------------------------------

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  fail(
    `token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`,
    1,
  );
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    fail(
      `token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`,
      1,
    );
  }
}

// ---------------------------------------------------------------------------
// Step 5 — the dossier, written last, and the run's summary.
//
// The dossier covers everything in /output — board, data, dashboard files,
// screenshots — so it must be written after all of them: the scorer
// rebuilds it from this /output and compares bytes.
// ---------------------------------------------------------------------------

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: DASHBOARD_CAPS,
  }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
