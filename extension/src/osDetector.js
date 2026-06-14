/**
 * GitTrace — OS & Environment Detector
 *
 * Runs entirely in the browser (content script context).
 * Reads navigator APIs to determine the user's local environment.
 *
 * We compare this against what the REPO requires (from the backend)
 * to generate compatibility warnings.
 *
 * Limitations:
 *   - navigator.platform is deprecated but still works
 *   - navigator.userAgent can be spoofed
 *   - We cannot execute shell commands from a content script
 *   - Architecture detection is best-effort from UA string
 */

// ─── OS Detection ─────────────────────────────────────────────────────────────

/**
 * Detect the user's operating system.
 *
 * @returns {{
 *   os:       'macOS' | 'Windows' | 'Linux' | 'ChromeOS' | 'Unknown',
 *   arch:     'arm64' | 'x86_64' | 'Unknown',
 *   platform: string,
 *   rawUA:    string,
 * }}
 */
export function detectUserOS() {
  const ua       = navigator.userAgent.toLowerCase();
  const platform = (navigator.platform || '').toLowerCase();

  // ── OS Detection ──────────────────────────────────────────────
  let os = 'Unknown';

  if (ua.includes('mac os x') || ua.includes('macos') || platform.includes('mac')) {
    os = 'macOS';
  } else if (ua.includes('windows') || platform.includes('win')) {
    os = 'Windows';
  } else if (ua.includes('cros')) {
    os = 'ChromeOS';
  } else if (ua.includes('linux') || platform.includes('linux')) {
    os = 'Linux';
  }

  // ── Architecture Detection ────────────────────────────────────
  // Chrome on Apple Silicon reports arm in some UA strings
  // This is not 100% reliable but good enough for warnings
  let arch = 'Unknown';

  if (
    ua.includes('arm64')   ||
    ua.includes('aarch64') ||
    // macOS on M1/M2/M3 running Chrome native (not Rosetta)
    (os === 'macOS' && !ua.includes('intel'))
  ) {
    arch = 'arm64';
  } else if (
    ua.includes('x86_64') ||
    ua.includes('wow64')   ||
    ua.includes('win64')   ||
    ua.includes('amd64')
  ) {
    arch = 'x86_64';
  } else if (os === 'Windows') {
    // Most Windows machines are x86_64
    arch = 'x86_64';
  }

  return {
    os,
    arch,
    platform: navigator.platform || 'Unknown',
    rawUA:    navigator.userAgent,
  };
}

// ─── Runtime Version Stored by User ──────────────────────────────────────────

/**
 * Get user-provided runtime versions from chrome.storage.local.
 * User sets these once via the extension settings (Day 10 popup).
 * We store them and use them for comparison on every analysis.
 *
 * @returns {Promise<{
 *   nodeVersion:   string | null,
 *   pythonVersion: string | null,
 *   setByUser:     boolean,
 * }>}
 */
export async function getUserRuntimeVersions() {
  try {
    const data = await chrome.storage.local.get([
      'gittrace_user_node_version',
      'gittrace_user_python_version',
    ]);

    return {
      nodeVersion:   data.gittrace_user_node_version   || null,
      pythonVersion: data.gittrace_user_python_version || null,
      setByUser:     !!(
        data.gittrace_user_node_version ||
        data.gittrace_user_python_version
      ),
    };
  } catch {
    return { nodeVersion: null, pythonVersion: null, setByUser: false };
  }
}

/**
 * Save user's runtime versions to chrome.storage.local.
 * Called from the compat tab when user types their versions.
 *
 * @param {{ nodeVersion?: string, pythonVersion?: string }} versions
 */
export async function saveUserRuntimeVersions(versions) {
  try {
    const toSave = {};
    if (versions.nodeVersion !== undefined) {
      toSave.gittrace_user_node_version = versions.nodeVersion;
    }
    if (versions.pythonVersion !== undefined) {
      toSave.gittrace_user_python_version = versions.pythonVersion;
    }
    await chrome.storage.local.set(toSave);
    console.log('[GitTrace OS] Runtime versions saved:', toSave);
  } catch (err) {
    console.warn('[GitTrace OS] Failed to save runtime versions:', err.message);
  }
}

// ─── Version Comparator ───────────────────────────────────────────────────────

/**
 * Parse a semver-like version string into [major, minor, patch].
 *
 * @param {string} version - e.g. "18.17.0", ">=18", "lts/hydrogen", "20.x"
 * @returns {number[] | null}
 */
function parseVersion(version) {
  if (!version) return null;

  // Strip range operators and whitespace
  const cleaned = version
    .replace(/[^0-9.x*]/g, ' ')
    .trim()
    .split(/\s+/)[0];

  const parts = cleaned.split('.').map(p => {
    if (p === 'x' || p === '*') return 0;
    return parseInt(p, 10) || 0;
  });

  return parts.length > 0 ? parts : null;
}

/**
 * Compare user's version against the required version range.
 *
 * @param {string} userVersion     - e.g. "20.11.0"
 * @param {string} requiredVersion - e.g. ">=18.0.0" or "18.x" or "18"
 * @returns {{
 *   compatible: boolean | null,  // null = cannot determine
 *   reason:     string,
 *   status:     'ok' | 'warning' | 'error' | 'unknown'
 * }}
 */
export function compareVersions(userVersion, requiredVersion) {
  if (!userVersion || !requiredVersion) {
    return {
      compatible: null,
      reason:     'Cannot compare — one or both versions unknown',
      status:     'unknown',
    };
  }

  const userParts = parseVersion(userVersion);
  const reqStr    = requiredVersion.trim();

  if (!userParts) {
    return { compatible: null, reason: 'Could not parse your version', status: 'unknown' };
  }

  // Handle range operators
  const gtMatch  = reqStr.match(/^>=?([0-9.]+)/);
  const ltMatch  = reqStr.match(/^<=?([0-9.]+)/);
  const eqMatch  = reqStr.match(/^=?([0-9.x*]+)/);

  if (gtMatch) {
    const reqParts = parseVersion(gtMatch[1]);
    const isGTE    = compareArrays(userParts, reqParts) >= 0;
    return {
      compatible: isGTE,
      reason:     isGTE
        ? `Your version ${userVersion} meets requirement ${requiredVersion}`
        : `Your version ${userVersion} is below required ${requiredVersion}`,
      status: isGTE ? 'ok' : 'error',
    };
  }

  if (eqMatch) {
    const reqParts = parseVersion(eqMatch[1]);
    const diff     = compareArrays(userParts, reqParts);
    const compatible = diff >= 0;
    return {
      compatible,
      reason: compatible
        ? `Your version ${userVersion} is compatible with ${requiredVersion}`
        : `Your version ${userVersion} may be incompatible with ${requiredVersion}`,
      status: compatible ? 'ok' : 'warning',
    };
  }

  return {
    compatible: null,
    reason:     `Cannot parse requirement: "${requiredVersion}"`,
    status:     'unknown',
  };
}

/**
 * Compare two version arrays.
 * Returns: positive if a > b, 0 if equal, negative if a < b
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function compareArrays(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ─── OS Compatibility Checker ─────────────────────────────────────────────────

/**
 * Check if the user's OS is compatible with the repo's requirements.
 *
 * @param {string}   userOS       - e.g. "macOS"
 * @param {string[]} requiredOS   - e.g. ["linux", "darwin"] from package.json
 * @returns {{ compatible: boolean | null, reason: string, status: string }}
 */
export function checkOSCompatibility(userOS, requiredOS) {
  if (!requiredOS || requiredOS.length === 0) {
    return {
      compatible: null,
      reason:     'No OS restriction specified',
      status:     'ok',
    };
  }

  // Map our OS names to package.json os field values
  const OS_MAP = {
    'macOS':    ['darwin', 'mac', 'macos'],
    'Windows':  ['win32', 'windows', 'win'],
    'Linux':    ['linux'],
    'ChromeOS': ['linux'],
  };

  const userOSKeys = OS_MAP[userOS] || [];

  // Check if any of the required OS values match
  const compatible = requiredOS.some(req =>
    userOSKeys.some(key => req.toLowerCase().includes(key)) ||
    req === '!win32'  // negation — we handle exclusions too
  );

  return {
    compatible,
    reason: compatible
      ? `Your OS (${userOS}) is compatible`
      : `Your OS (${userOS}) may not be compatible. Required: ${requiredOS.join(', ')}`,
    status: compatible ? 'ok' : 'warning',
  };
}

/**
 * Check architecture compatibility.
 *
 * @param {string}   userArch     - 'arm64' | 'x86_64'
 * @param {string[]} archWarnings - Detected arch requirements from backend
 * @returns {{ warnings: string[] }}
 */
export function checkArchCompatibility(userArch, archWarnings) {
  const warnings = [];

  if (!archWarnings || archWarnings.length === 0) return { warnings };

  archWarnings.forEach(warning => {
    if (warning.arch === 'any') return;  // No arch restriction

    if (warning.arch !== userArch) {
      warnings.push(
        `Repo includes ${warning.os} ${warning.arch} binaries — ` +
        `your system is ${userArch}. ` +
        `These binaries may not run or may use Rosetta 2 emulation.`
      );
    }
  });

  return { warnings };
}

// ─── Full Environment Report ──────────────────────────────────────────────────

/**
 * Build a complete environment report from the user's browser context.
 * Called from content.js after receiving backend compat data.
 *
 * @param {object} backendCompatInfo - compatInfo from the backend
 * @returns {Promise<object>} Full compat report for the badge UI
 */
export async function buildCompatReport(backendCompatInfo) {
  const userEnv      = detectUserOS();
  const userVersions = await getUserRuntimeVersions();

  const compat = backendCompatInfo || {};

  // Node version comparison
  const nodeCheck = compareVersions(
    userVersions.nodeVersion,
    compat.runtime?.nodeVersion
  );

  // Python version comparison
  const pythonCheck = compareVersions(
    userVersions.pythonVersion,
    compat.runtime?.pythonVersion
  );

  // OS compatibility
  const osCheck = checkOSCompatibility(
    userEnv.os,
    compat.platform?.requiredOS
  );

  // Architecture compatibility
  const archCheck = checkArchCompatibility(
    userEnv.arch,
    compat.platform?.archWarnings
  );

  // Calculate overall compat status
  const hasErrors   = nodeCheck.status === 'error'   || osCheck.status === 'error';
  const hasWarnings = nodeCheck.status === 'warning'  ||
                      pythonCheck.status === 'warning' ||
                      archCheck.warnings.length > 0;
  const needsGPU    = compat.compute?.footprint?.needsGPU || false;

  let overallStatus = 'ok';
  if (hasErrors)   overallStatus = 'error';
  else if (hasWarnings || needsGPU) overallStatus = 'warning';

  return {
    userEnvironment: {
      os:            userEnv.os,
      arch:          userEnv.arch,
      platform:      userEnv.platform,
      nodeVersion:   userVersions.nodeVersion,
      pythonVersion: userVersions.pythonVersion,
      versionsSetByUser: userVersions.setByUser,
    },
    repoRequirements: {
      nodeVersion:   compat.runtime?.nodeVersion   || null,
      pythonVersion: compat.runtime?.pythonVersion || null,
      requiredOS:    compat.platform?.requiredOS   || null,
      requiredCPU:   compat.platform?.requiredCPU  || null,
      requiredTools: compat.tools?.required        || [],
    },
    checks: {
      node:   nodeCheck,
      python: pythonCheck,
      os:     osCheck,
      arch:   archCheck,
    },
    compute: {
      heavyDeps:   compat.compute?.heavyDeps   || [],
      footprint:   compat.compute?.footprint   || null,
      needsGPU,
    },
    overallStatus,
    configFilesScanned: compat.configFilesScanned || [],
  };
}
