/**
 * GitTrace Backend — Phantom Package Detector
 *
 * AI models sometimes hallucinate package names that do not exist.
 * These "phantom packages" are dangerous because:
 *   1. The code will fail at runtime with "module not found"
 *   2. Attackers can register the fake package name on npm/PyPI
 *      and put malicious code in it — "typosquatting supply chain attack"
 *
 * How we detect phantoms:
 *   - For each dependency, check if it exists on npm or PyPI registry
 *   - A 404 response = package does not exist = phantom
 *
 * Registries checked:
 *   - npm:  https://registry.npmjs.org/{name}
 *   - PyPI: https://pypi.org/pypi/{name}/json
 */

const fetch = require("node-fetch");

// ─── Constants ────────────────────────────────────────────────────────────────

const NPM_REGISTRY_URL = "https://registry.npmjs.org";
const PYPI_REGISTRY_URL = "https://pypi.org/pypi";
const REQUEST_TIMEOUT = 8000;
const MAX_CONCURRENT = 15;

// ─── Registry Checkers ────────────────────────────────────────────────────────

/**
 * Check if an npm package exists on the npm registry.
 *
 * @param {string} packageName
 * @returns {Promise<{ exists: boolean, downloads?: number }>}
 */
async function checkNpmPackage(packageName) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    // Scoped packages (@org/pkg) need URL encoding
    const encodedName = packageName.startsWith("@")
      ? packageName.replace("/", "%2F")
      : packageName;

    const response = await fetch(`${NPM_REGISTRY_URL}/${encodedName}`, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 404) {
      return { exists: false };
    }

    if (!response.ok) {
      // Non-404 error — assume it exists to avoid false positives
      return { exists: true };
    }

    const data = await response.json();

    return {
      exists: true,
      downloads: null, // Would need separate API call
      version: data["dist-tags"]?.latest || null,
      author: data.author?.name || null,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      console.warn(`[Phantom] npm check timed out for: ${packageName}`);
    }
    // On error assume package exists to avoid false positives
    return { exists: true };
  }
}

/**
 * Check if a Python package exists on PyPI.
 *
 * @param {string} packageName
 * @returns {Promise<{ exists: boolean }>}
 */
async function checkPyPIPackage(packageName) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(`${PYPI_REGISTRY_URL}/${packageName}/json`, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 404) {
      return { exists: false };
    }

    return { exists: true };
  } catch (err) {
    return { exists: true }; // Assume exists on error
  }
}

// ─── Package Name Validator ───────────────────────────────────────────────────

/**
 * Quick check for obviously invalid package names.
 * Saves API calls for clearly fake packages.
 *
 * @param {string} name
 * @param {string} ecosystem
 * @returns {boolean} true if the name looks valid
 */
function isValidPackageName(name, ecosystem) {
  if (!name || name.length < 1 || name.length > 214) return false;

  // Skip relative paths and local packages
  if (name.startsWith(".") || name.startsWith("/")) return false;
  if (name.startsWith("file:") || name.startsWith("git+")) return false;

  // npm: valid chars are letters, numbers, hyphens, underscores, dots, @
  if (ecosystem === "npm") {
    return /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name);
  }

  // PyPI: letters, numbers, hyphens, underscores, dots
  if (ecosystem === "PyPI") {
    return /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(name);
  }

  return true;
}

// ─── AI Hallucination Pattern Detector ────────────────────────────────────────

/**
 * Check if a package name looks like it was hallucinated by an AI.
 * These are heuristic checks — not definitive.
 *
 * Common AI hallucination patterns:
 *   - Real package name + "-utils", "-helper", "-pro", "-plus"
 *   - Combining two real package names: "express-mongoose-utils"
 *   - Very specific sounding but nonexistent: "react-form-validator-pro"
 *
 * @param {string} name
 * @returns {{ suspicious: boolean, reason: string | null }}
 */
function checkHallucinationPatterns(name) {
  const SUSPICIOUS_SUFFIXES = [
    "-utils-pro",
    "-helper-lib",
    "-toolkit-pro",
    "-utils-plus",
    "-advanced",
    "-enhanced",
    "-extended",
    "-premium",
    "-v2-utils",
    "-wrapper-utils",
  ];

  for (const suffix of SUSPICIOUS_SUFFIXES) {
    if (name.endsWith(suffix)) {
      return {
        suspicious: true,
        reason: `Name ends with "${suffix}" — common AI hallucination pattern`,
      };
    }
  }

  // Very long package names with many hyphens are suspicious
  const hyphenCount = (name.match(/-/g) || []).length;
  if (hyphenCount >= 4 && name.length > 30) {
    return {
      suspicious: true,
      reason: `Very long name with ${hyphenCount} hyphens — possible AI hallucination`,
    };
  }

  return { suspicious: false, reason: null };
}

// ─── Main Export Function ─────────────────────────────────────────────────────

/**
 * Check all parsed dependencies for phantom packages.
 *
 * @param {Array<{ name: string, version: string, ecosystem: string }>} packages
 * @returns {Promise<{
 *   phantoms:        object[],
 *   suspicious:      object[],
 *   checkedPackages: number,
 *   elapsedMs:       number,
 * }>}
 */
async function detectPhantomPackages(packages) {
  console.log(`\n[Phantom] Checking ${packages.length} packages for phantoms`);
  const startTime = Date.now();

  // Only check npm and PyPI for now
  const checkable = packages.filter(
    (p) =>
      (p.ecosystem === "npm" || p.ecosystem === "PyPI") &&
      isValidPackageName(p.name, p.ecosystem),
  );

  console.log(`[Phantom] ${checkable.length} packages are checkable`);

  const phantoms = [];
  const suspicious = [];

  // Process in batches of MAX_CONCURRENT
  for (let i = 0; i < checkable.length; i += MAX_CONCURRENT) {
    const batch = checkable.slice(i, i + MAX_CONCURRENT);

    await Promise.all(
      batch.map(async (pkg) => {
        // First check hallucination patterns (free — no API call)
        const patternCheck = checkHallucinationPatterns(pkg.name);

        // Check registry
        let registryResult;
        if (pkg.ecosystem === "npm") {
          registryResult = await checkNpmPackage(pkg.name);
        } else {
          registryResult = await checkPyPIPackage(pkg.name);
        }

        if (!registryResult.exists) {
          // Package does not exist — confirmed phantom
          phantoms.push({
            name: pkg.name,
            version: pkg.version,
            registry: pkg.ecosystem,
            reason:
              "Package not found in registry — possible AI hallucination or typo",
            dangerous: true,
          });
          console.warn(`[Phantom] ☠ PHANTOM: ${pkg.name} (${pkg.ecosystem})`);
        } else if (patternCheck.suspicious) {
          // Package exists but has suspicious name patterns
          suspicious.push({
            name: pkg.name,
            version: pkg.version,
            registry: pkg.ecosystem,
            reason: patternCheck.reason,
          });
        }
      }),
    );
  }

  const elapsed = Date.now() - startTime;
  console.log(
    `[Phantom] Found ${phantoms.length} phantoms, ${suspicious.length} suspicious in ${elapsed}ms`,
  );

  return {
    phantoms,
    suspicious,
    checkedPackages: checkable.length,
    elapsedMs: elapsed,
  };
}

module.exports = {
  detectPhantomPackages,
  checkNpmPackage,
  checkPyPIPackage,
  isValidPackageName,
};
