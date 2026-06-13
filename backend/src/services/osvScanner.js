/**
 * GitTrace Backend — OSV Vulnerability Scanner
 *
 * Uses the Google OSV (Open Source Vulnerabilities) API to check
 * every dependency in a repo for known CVEs.
 *
 * OSV API:
 *   - Free, no API key needed
 *   - Covers: npm, PyPI, Go, Maven, RubyGems, Cargo, NuGet
 *   - Endpoint: POST https://api.osv.dev/v1/query
 *   - Docs: https://google.github.io/osv.dev/post-v1-query/
 *
 * What we scan:
 *   - package.json  (npm)
 *   - requirements.txt (PyPI)
 *   - Gemfile (RubyGems)
 *   - go.mod (Go)
 *   - Cargo.toml (Rust/Cargo)
 */

const fetch = require("node-fetch");

// ─── Constants ────────────────────────────────────────────────────────────────

const OSV_API_URL = "https://api.osv.dev/v1/query";
const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
const REQUEST_TIMEOUT = 10000;
const MAX_CONCURRENT = 20; // Max parallel OSV requests

// ─── Ecosystem Map ────────────────────────────────────────────────────────────

/**
 * Map of config file names to OSV ecosystem identifiers.
 * OSV uses specific strings to identify package registries.
 */
const FILE_TO_ECOSYSTEM = {
  "package.json": "npm",
  "requirements.txt": "PyPI",
  Gemfile: "RubyGems",
  "go.mod": "Go",
  "Cargo.toml": "crates.io",
  Pipfile: "PyPI",
};

// ─── Dependency Parsers ───────────────────────────────────────────────────────

/**
 * Parse package.json and extract all dependencies.
 * Includes: dependencies, devDependencies, peerDependencies.
 *
 * @param {string} content - Raw package.json file content
 * @returns {Array<{ name: string, version: string, ecosystem: string }>}
 */
function parsePackageJson(content) {
  try {
    const pkg = JSON.parse(content);
    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };

    return Object.entries(deps).map(([name, version]) => ({
      name,
      // Strip semver range characters: ^1.2.3 → 1.2.3
      version: version.replace(/^[\^~>=<]/, "").split(" ")[0],
      ecosystem: "npm",
    }));
  } catch (err) {
    console.warn("[OSV] Failed to parse package.json:", err.message);
    return [];
  }
}

/**
 * Parse requirements.txt and extract Python packages.
 * Handles formats: package==1.0.0, package>=1.0.0, package
 *
 * @param {string} content
 * @returns {Array<{ name: string, version: string, ecosystem: string }>}
 */
function parseRequirementsTxt(content) {
  const results = [];
  const lines = content.split("\n");

  lines.forEach((line) => {
    // Skip comments and empty lines
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) return;

    // Match: package==1.0.0 or package>=1.0.0 or just package
    const match = trimmed.match(
      /^([a-zA-Z0-9_.-]+)(?:[>=<!]+([0-9][a-zA-Z0-9._-]*))?/,
    );
    if (!match) return;

    results.push({
      name: match[1],
      version: match[2] || "",
      ecosystem: "PyPI",
    });
  });

  return results;
}

/**
 * Parse go.mod and extract Go module dependencies.
 *
 * @param {string} content
 * @returns {Array<{ name: string, version: string, ecosystem: string }>}
 */
function parseGoMod(content) {
  const results = [];
  const lines = content.split("\n");
  let inRequire = false;

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (trimmed === "require (") {
      inRequire = true;
      return;
    }
    if (trimmed === ")") {
      inRequire = false;
      return;
    }

    if (inRequire || trimmed.startsWith("require ")) {
      // Format: module/path v1.2.3
      const match = trimmed
        .replace("require ", "")
        .trim()
        .match(/^([^\s]+)\s+(v[^\s]+)/);

      if (match) {
        results.push({
          name: match[1],
          version: match[2].replace(/^v/, ""),
          ecosystem: "Go",
        });
      }
    }
  });

  return results;
}

/**
 * Parse Cargo.toml and extract Rust crate dependencies.
 *
 * @param {string} content
 * @returns {Array<{ name: string, version: string, ecosystem: string }>}
 */
function parseCargoToml(content) {
  const results = [];
  const lines = content.split("\n");
  let inDeps = false;

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (
      trimmed === "[dependencies]" ||
      trimmed === "[dev-dependencies]" ||
      trimmed === "[build-dependencies]"
    ) {
      inDeps = true;
      return;
    }

    // A new section header ends the deps block
    if (trimmed.startsWith("[") && inDeps) {
      inDeps = false;
      return;
    }

    if (!inDeps) return;

    // Format: name = "1.0" or name = { version = "1.0" }
    const simple = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
    const complex = trimmed.match(
      /^([a-zA-Z0-9_-]+)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/,
    );

    const match = simple || complex;
    if (match) {
      results.push({
        name: match[1],
        version: match[2].replace(/^[\^~>=]/, ""),
        ecosystem: "crates.io",
      });
    }
  });

  return results;
}

/**
 * Route to the correct parser based on file name.
 *
 * @param {string} fileName
 * @param {string} content
 * @returns {Array<{ name: string, version: string, ecosystem: string }>}
 */
function parseDependencies(fileName, content) {
  const baseName = fileName.split("/").pop();

  switch (baseName) {
    case "package.json":
      return parsePackageJson(content);
    case "requirements.txt":
      return parseRequirementsTxt(content);
    case "go.mod":
      return parseGoMod(content);
    case "Cargo.toml":
      return parseCargoToml(content);
    default:
      return [];
  }
}

// ─── OSV API Caller ───────────────────────────────────────────────────────────

/**
 * Query the OSV API for one package.
 * Returns array of vulnerabilities or empty array.
 *
 * @param {{ name: string, version: string, ecosystem: string }} pkg
 * @returns {Promise<object[]>} Array of OSV vulnerability objects
 */
async function queryOSV(pkg) {
  try {
    const body = {
      package: {
        name: pkg.name,
        ecosystem: pkg.ecosystem,
      },
    };

    // Include version if we have one — more precise results
    if (pkg.version) {
      body.version = pkg.version;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(OSV_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) return [];

    const data = await response.json();
    return data.vulns || [];
  } catch (err) {
    // Non-fatal — skip this package if OSV fails
    if (err.name !== "AbortError") {
      console.warn(`[OSV] Query failed for ${pkg.name}: ${err.message}`);
    }
    return [];
  }
}

/**
 * Run OSV queries for multiple packages with concurrency limiting.
 * We batch them to avoid hammering the OSV API.
 *
 * @param {Array<{ name, version, ecosystem }>} packages
 * @returns {Promise<Array<{ package: object, vulns: object[] }>>}
 */
async function batchQueryOSV(packages) {
  const results = [];

  // Process in batches of MAX_CONCURRENT
  for (let i = 0; i < packages.length; i += MAX_CONCURRENT) {
    const batch = packages.slice(i, i + MAX_CONCURRENT);

    const batchResults = await Promise.all(
      batch.map(async (pkg) => ({
        package: pkg,
        vulns: await queryOSV(pkg),
      })),
    );

    results.push(...batchResults);
  }

  return results;
}

// ─── CVE Formatter ────────────────────────────────────────────────────────────

/**
 * Map OSV severity string to our display format.
 * @param {string} severity
 * @returns {{ label: string, colour: string }}
 */
function formatSeverity(severity) {
  const map = {
    CRITICAL: { label: "Critical", colour: "red" },
    HIGH: { label: "High", colour: "red" },
    MEDIUM: { label: "Medium", colour: "orange" },
    LOW: { label: "Low", colour: "amber" },
  };
  return (
    map[severity?.toUpperCase()] || {
      label: severity || "Unknown",
      colour: "amber",
    }
  );
}

/**
 * Format raw OSV vulnerability into a clean display object.
 *
 * @param {object} vuln       - Raw OSV vulnerability object
 * @param {string} pkgName    - Package name
 * @param {string} pkgVersion - Package version
 * @returns {object}
 */
function formatCVE(vuln, pkgName, pkgVersion) {
  // Get the highest severity score
  const severityRating =
    vuln.severity?.[0]?.rating || vuln.database_specific?.severity || "UNKNOWN";

  const { label, colour } = formatSeverity(severityRating);

  // Get affected versions range
  const affected = vuln.affected?.[0]?.ranges?.[0];
  const fixedIn =
    affected?.events?.find((e) => e.fixed)?.fixed || "No fix available";

  return {
    id: vuln.id || "UNKNOWN",
    package: pkgName,
    version: pkgVersion,
    severity: label,
    colour,
    summary: vuln.summary || "No description available",
    fixedIn,
    url: `https://osv.dev/vulnerability/${vuln.id}`,
    published: vuln.published,
  };
}

// ─── Main Export Function ─────────────────────────────────────────────────────

/**
 * Scan all dependency files for vulnerabilities.
 *
 * @param {Array<{ path: string, content: string }>} files
 *   Array of config files with their content
 *
 * @returns {Promise<{
 *   cves:          object[],
 *   scannedPackages: number,
 *   filesScanned:  string[],
 *   elapsedMs:     number,
 * }>}
 */
async function scanDependencies(files) {
  console.log(
    `\n[OSV] Starting dependency scan on ${files.length} config files`,
  );
  const startTime = Date.now();

  // Step 1: Parse all dependency files into package lists
  const allPackages = [];
  const filesScanned = [];

  files.forEach((file) => {
    const baseName = file.path.split("/").pop();

    // Only process files we know how to parse
    if (!FILE_TO_ECOSYSTEM[baseName]) return;

    const parsed = parseDependencies(file.path, file.content);
    if (parsed.length > 0) {
      allPackages.push(...parsed);
      filesScanned.push(file.path);
      console.log(`[OSV] Parsed ${parsed.length} packages from ${baseName}`);
    }
  });

  if (allPackages.length === 0) {
    console.log("[OSV] No parseable dependency files found");
    return {
      cves: [],
      scannedPackages: 0,
      filesScanned: [],
      elapsedMs: Date.now() - startTime,
    };
  }

  console.log(`[OSV] Querying OSV for ${allPackages.length} packages...`);

  // Step 2: Query OSV for all packages
  const osvResults = await batchQueryOSV(allPackages);

  // Step 3: Filter and format results with vulnerabilities
  const cves = [];

  osvResults.forEach((result) => {
    if (result.vulns.length === 0) return;

    result.vulns.forEach((vuln) => {
      cves.push(formatCVE(vuln, result.package.name, result.package.version));
    });
  });

  // Sort by severity: Critical first
  const severityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3, Unknown: 4 };
  cves.sort(
    (a, b) =>
      (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4),
  );

  const elapsed = Date.now() - startTime;
  console.log(`[OSV] Found ${cves.length} vulnerabilities in ${elapsed}ms`);

  return {
    cves,
    scannedPackages: allPackages.length,
    filesScanned,
    elapsedMs: elapsed,
  };
}

module.exports = {
  scanDependencies,
  parseDependencies,
  parsePackageJson,
  parseRequirementsTxt,
};
