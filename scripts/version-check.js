'use strict';
// Fails a pull request that changes any file the app serves without raising
// the version. The service worker names its cache after the version, so a
// change shipped under the same version never reaches installed copies.
//
//   node scripts/version-check.js origin/main
//
// The checks are plain functions so they can be tested without git.

// Files that end up on the phone. version.js is left out on purpose: changing
// it is the bump itself.
const SERVED = [
  /^index\.html$/,
  /^app\.js$/,
  /^clip\.js$/,
  /^style\.css$/,
  /^sw\.js$/,
  /^manifest\.webmanifest$/,
  /^icons\//,
];

function isServed(file) {
  return SERVED.some((pattern) => pattern.test(file));
}

function parseVersion(text) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(text || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// Returns a negative number, zero or a positive number, like a sort callback.
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error('Not a version: ' + (x ? b : a));
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

// Pulls the version out of version.js without running it.
function readVersion(source) {
  const m = /MAGPIE_VERSION\s*=\s*'(\d+\.\d+\.\d+)'/.exec(String(source || ''));
  return m ? m[1] : null;
}

function checkBump(input) {
  const served = (input.changedFiles || []).filter(isServed);
  if (served.length === 0) {
    return { ok: true, message: 'No served files changed, so no version bump is needed.' };
  }
  if (!input.headVersion) {
    return { ok: false, message: 'version.js has no MAGPIE_VERSION in the form x.y.z.' };
  }
  if (!input.baseVersion) {
    return { ok: true, message: 'The base has no version yet, so there is nothing to bump from.' };
  }
  if (compareVersions(input.headVersion, input.baseVersion) > 0) {
    return {
      ok: true,
      message: 'Version raised from ' + input.baseVersion + ' to ' + input.headVersion + '.',
    };
  }
  const lowered = compareVersions(input.headVersion, input.baseVersion) < 0;
  return {
    ok: false,
    message:
      'This change touches files the app serves but ' +
      (lowered
        ? 'the version went down from ' + input.baseVersion + ' to ' + input.headVersion
        : 'the version is still ' + input.headVersion) +
      '. Raise it in version.js and package.json (patch for fixes, minor for features) so ' +
      'installed copies pick the change up.\nServed files changed:\n  ' +
      served.join('\n  '),
  };
}

function main(baseRef) {
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

  const changedFiles = git('diff', '--name-only', baseRef + '...HEAD').split('\n').filter(Boolean);
  let baseVersion = null;
  try {
    baseVersion = readVersion(git('show', baseRef + ':version.js'));
  } catch (e) {
    /* version.js did not exist on the base */
  }
  const headVersion = readVersion(fs.readFileSync('version.js', 'utf8'));

  const result = checkBump({ changedFiles, baseVersion, headVersion });
  console.log(result.message);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { isServed, parseVersion, compareVersions, readVersion, checkBump };

if (require.main === module) {
  const baseRef = process.argv[2];
  if (!baseRef) {
    console.error('Usage: node scripts/version-check.js <base ref>, for example origin/main');
    process.exit(2);
  }
  main(baseRef);
}
