// tokenlint — minimal git helpers for the "new hardcoded colors in this PR" delta.
// Zero-dependency: shells out to git via child_process (array args, no shell). No git = feature disabled.

import { execFileSync } from 'node:child_process';
import { isSupported, isIgnoredPath } from './scan.mjs';

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 128 * 1024 * 1024,
  });
}

export function isGitRepo() {
  try { git(['rev-parse', '--is-inside-work-tree']); return true; } catch { return false; }
}

/** Resolve a ref/sha to a commit sha, or null if it can't be resolved. */
export function resolveRef(ref) {
  try { return git(['rev-parse', '--verify', `${ref}^{commit}`]).trim(); } catch { return null; }
}

/** Merge-base (common ancestor) of two refs, or null. Used for three-dot "new this PR". */
export function mergeBase(a, b) {
  try { return git(['merge-base', a, b]).trim(); } catch { return null; }
}

/** Supported, non-ignored files tracked at a given ref (repo-relative posix paths). */
export function filesAtRef(ref) {
  let out;
  try { out = git(['ls-tree', '-r', '--name-only', ref]); } catch { return []; }
  return out.split('\n').map((s) => s.trim())
    .filter((s) => s && isSupported(s) && !isIgnoredPath(s)); // mirror collectFiles so base == head scope
}

/** File contents at a ref, or null if the file did not exist there. */
export function readAtRef(ref, path) {
  try { return git(['show', `${ref}:${path}`]); } catch { return null; }
}

/** Build scan inputs [{path,text}] for every supported file at a ref. */
export function inputsAtRef(ref) {
  const out = [];
  for (const path of filesAtRef(ref)) {
    const text = readAtRef(ref, path);
    if (text != null) out.push({ path, text });
  }
  return out;
}
