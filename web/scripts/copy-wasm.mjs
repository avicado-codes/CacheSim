// Copies the Emscripten build of the engine into public/engine/, where the worker loads it.
// Usage: npm run wasm:copy [-- <build-dir>]   (default: ../build-wasm)
// Build the module first, from the repository root:
//   emcmake cmake -S . -B build-wasm -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build build-wasm --target ccsim_wasm

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = resolve(web, process.argv[2] ?? '../build-wasm');
const from = join(build, 'src', 'wasm');
const to = join(web, 'public', 'engine');

const files = ['ccsim.mjs', 'ccsim.wasm'];
const missing = files.filter((f) => !existsSync(join(from, f)));
if (missing.length) {
  console.error(`missing ${missing.join(', ')} in ${from}; build the ccsim_wasm target first (see this file's header)`);
  process.exit(1);
}
mkdirSync(to, { recursive: true });
for (const f of files) copyFileSync(join(from, f), join(to, f));
console.log(`copied ${files.join(' + ')} to ${to}`);
