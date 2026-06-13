/**
 * GitTrace Backend — License Classifier Service
 *
 * Classifies a repository's license into risk levels.
 *
 * Risk Levels:
 *   SAFE        — Permissive licenses. Use freely.
 *   REVIEW      — Weak copyleft. Usually fine but needs attention.
 *   HIGH_RISK   — Strong copyleft. AI generated code here = legal liability.
 *   UNKNOWN     — No license found. Legally = All Rights Reserved.
 *
 * Why AI + copyleft is a problem:
 *   If AI generates code that closely mirrors GPL code,
 *   and you use it in your project, you may be forced to
 *   open source your entire codebase under GPL terms.
 */

// ─── License Database ─────────────────────────────────────────────────────────

/**
 * Map of SPDX license identifiers to their risk classification.
 * SPDX is the standard identifier format used by GitHub.
 * Full list: https://spdx.org/licenses/
 */
const LICENSE_DATABASE = {
  // ── SAFE — Permissive Licenses ────────────────────────────────────
  // You can use, modify and distribute with minimal restrictions.
  // Commercial use is fine. No obligation to open source your code.
  'MIT': {
    risk:        'SAFE',
    colour:      'green',
    label:       'Safe',
    shortName:   'MIT License',
    explanation: 'Very permissive. Use freely in any project. Just keep the copyright notice.',
    canUseAI:    true,
  },
  'Apache-2.0': {
    risk:        'SAFE',
    colour:      'green',
    label:       'Safe',
    shortName:   'Apache 2.0',
    explanation: 'Permissive with patent protection. Good for commercial use.',
    canUseAI:    true,
  },
  'BSD-2-Clause': {
    risk:        'SAFE',
    colour:      'green',
    label:       'Safe',
    shortName:   'BSD 2-Clause',
    explanation: 'Simple permissive license. Keep the copyright notice.',
    canUseAI:    true,
  },
  'BSD-3-Clause': {
    risk:        'SAFE',
    colour:      'green',
    label:       'Safe',
    shortName:   'BSD 3-Clause',
    explanation: 'Permissive. Cannot use the author\'s name for promotion.',
    canUseAI:    true,
  },
  'ISC': {
    risk:        'SAFE',
    colour:      'green',
    label:       'Safe',
    shortName:   'ISC License',
    explanation: 'Functionally equivalent to MIT. Very permissive.',
    canUseAI:    true,
  },
  'Unlicense': {
    risk:        'SAFE',
    colour:      'green',
    label:       'Safe',
    shortName:   'The Unlicense',
    explanation: 'Public domain. No restrictions whatsoever.',
    canUseAI:    true,
  },
  'CC0-1.0': {
    risk:        'SAFE',
    colour:      'green',
    label:       'Safe',
    shortName:   'CC0 1.0 Universal',
    explanation: 'Public domain dedication. No restrictions.',
    canUseAI:    true,
  },
  'WTFPL': {
    risk:        'SAFE',
    colour:      'green',
    label:       'Safe',
    shortName:   'WTFPL',
    explanation: 'Do What The F*** You Want To Public License. No restrictions.',
    canUseAI:    true,
  },
  '0BSD': {
    risk:        'SAFE',
    colour:      'green',
    label:       'Safe',
    shortName:   'Zero-Clause BSD',
    explanation: 'Public domain equivalent. No restrictions.',
    canUseAI:    true,
  },

  // ── REVIEW — Weak Copyleft Licenses ──────────────────────────────
  // Copyleft applies only to modified versions of the original files.
  // You can usually use these in larger projects without issue.
  // But review carefully before using AI-generated code from these repos.
  'LGPL-2.0': {
    risk:        'REVIEW',
    colour:      'amber',
    label:       'Review Required',
    shortName:   'LGPL 2.0',
    explanation: 'Weak copyleft. Modifications to LGPL files must stay LGPL. Can link from proprietary code.',
    canUseAI:    false,
  },
  'LGPL-2.1': {
    risk:        'REVIEW',
    colour:      'amber',
    label:       'Review Required',
    shortName:   'LGPL 2.1',
    explanation: 'Weak copyleft. Widely used for libraries. Review before using AI code from this repo.',
    canUseAI:    false,
  },
  'LGPL-3.0': {
    risk:        'REVIEW',
    colour:      'amber',
    label:       'Review Required',
    shortName:   'LGPL 3.0',
    explanation: 'Weak copyleft. Like LGPL 2.1 but with anti-tivoization clause.',
    canUseAI:    false,
  },
  'MPL-2.0': {
    risk:        'REVIEW',
    colour:      'amber',
    label:       'Review Required',
    shortName:   'Mozilla Public License 2.0',
    explanation: 'File-level copyleft. Modified files must stay MPL but you can combine with proprietary code.',
    canUseAI:    false,
  },
  'CDDL-1.0': {
    risk:        'REVIEW',
    colour:      'amber',
    label:       'Review Required',
    shortName:   'CDDL 1.0',
    explanation: 'File-level copyleft. Similar to MPL. Review before using.',
    canUseAI:    false,
  },
  'EPL-1.0': {
    risk:        'REVIEW',
    colour:      'amber',
    label:       'Review Required',
    shortName:   'Eclipse Public License 1.0',
    explanation: 'Weak copyleft used in Java ecosystem. Review before using.',
    canUseAI:    false,
  },
  'EPL-2.0': {
    risk:        'REVIEW',
    colour:      'amber',
    label:       'Review Required',
    shortName:   'Eclipse Public License 2.0',
    explanation: 'Updated EPL. Compatible with GPL v2 secondary license.',
    canUseAI:    false,
  },

  // ── HIGH RISK — Strong Copyleft Licenses ──────────────────────────
  // Using AI-generated code from these repos could force you to
  // open source your ENTIRE project under the same license.
  // This is a serious legal risk for commercial products.
  'GPL-2.0': {
    risk:        'HIGH_RISK',
    colour:      'red',
    label:       'High Risk',
    shortName:   'GNU GPL 2.0',
    explanation: 'Strong copyleft. Any project using this code must also be GPL 2.0. AI code from this repo is dangerous.',
    canUseAI:    false,
    warning:     'Using AI-generated code from a GPL-2.0 repo may force you to release your entire codebase as GPL.',
  },
  'GPL-3.0': {
    risk:        'HIGH_RISK',
    colour:      'red',
    label:       'High Risk',
    shortName:   'GNU GPL 3.0',
    explanation: 'Strong copyleft with patent termination clause. Using this code = your project must be GPL 3.0.',
    canUseAI:    false,
    warning:     'Using AI-generated code from a GPL-3.0 repo may force you to release your entire codebase as GPL.',
  },
  'AGPL-3.0': {
    risk:        'HIGH_RISK',
    colour:      'red',
    label:       'High Risk ⚠',
    shortName:   'GNU AGPL 3.0',
    explanation: 'Strongest copyleft. GPL 3.0 PLUS network use = distribution. SaaS apps must open source everything.',
    canUseAI:    false,
    warning:     'AGPL is the most dangerous license for commercial SaaS. Even offering the app over a network triggers copyleft.',
  },
  'GPL-2.0-only': {
    risk:        'HIGH_RISK',
    colour:      'red',
    label:       'High Risk',
    shortName:   'GNU GPL 2.0 Only',
    explanation: 'Like GPL 2.0 but explicitly disallows GPL 3.0.',
    canUseAI:    false,
    warning:     'Strong copyleft. Incompatible with many other licenses.',
  },
  'GPL-3.0-only': {
    risk:        'HIGH_RISK',
    colour:      'red',
    label:       'High Risk',
    shortName:   'GNU GPL 3.0 Only',
    explanation: 'GPL 3.0 without the "or any later version" clause.',
    canUseAI:    false,
    warning:     'Strong copyleft.',
  },
  'SSPL-1.0': {
    risk:        'HIGH_RISK',
    colour:      'red',
    label:       'High Risk',
    shortName:   'Server Side Public License 1.0',
    explanation: 'MongoDB license. Even more restrictive than AGPL in some interpretations.',
    canUseAI:    false,
    warning:     'Extremely restrictive. Avoid for commercial projects.',
  },
  'OSL-3.0': {
    risk:        'HIGH_RISK',
    colour:      'red',
    label:       'High Risk',
    shortName:   'Open Software License 3.0',
    explanation: 'Strong copyleft with network use provision. Similar to AGPL.',
    canUseAI:    false,
    warning:     'Network use triggers copyleft obligations.',
  },
};

// ─── Unknown License ──────────────────────────────────────────────────────────

const UNKNOWN_LICENSE = {
  risk:        'UNKNOWN',
  colour:      'amber',
  label:       'Unknown',
  shortName:   'No License / Unknown',
  explanation: 'No license file found. Legally this means All Rights Reserved. Do not use AI-generated code from unlicensed repos.',
  canUseAI:    false,
  warning:     'No license = All Rights Reserved by default. Using this code without permission could be copyright infringement.',
};

// ─── Classifier Function ──────────────────────────────────────────────────────

/**
 * Classify a license by its SPDX identifier.
 *
 * @param {string | null} spdxId - SPDX identifier e.g. "MIT", "GPL-3.0", null
 * @returns {object} Full license classification object
 */
function classifyLicense(spdxId) {
  if (!spdxId || spdxId === 'NOASSERTION' || spdxId === 'NONE') {
    return { ...UNKNOWN_LICENSE, spdxId: spdxId || 'NONE' };
  }

  // Direct lookup
  if (LICENSE_DATABASE[spdxId]) {
    return { ...LICENSE_DATABASE[spdxId], spdxId };
  }

  // Try case-insensitive lookup
  const upperSpdx = spdxId.toUpperCase();
  const foundKey  = Object.keys(LICENSE_DATABASE)
    .find(k => k.toUpperCase() === upperSpdx);
  if (foundKey) {
    return { ...LICENSE_DATABASE[foundKey], spdxId };
  }

  // Partial match — e.g. "GPL-2.0-or-later" matches "GPL-2.0"
  const partialKey = Object.keys(LICENSE_DATABASE)
    .find(k => spdxId.startsWith(k) || k.startsWith(spdxId.split('-or-')[0]));
  if (partialKey) {
    return { ...LICENSE_DATABASE[partialKey], spdxId };
  }

  // Truly unknown license
  return {
    ...UNKNOWN_LICENSE,
    spdxId,
    shortName:   spdxId,
    explanation: `License "${spdxId}" is not in the GitTrace database. Manual review recommended.`,
  };
}

/**
 * Get a combined risk assessment when BOTH AI score AND license are known.
 * High AI score + restrictive license = combined risk warning.
 *
 * @param {object} licenseInfo   - Result of classifyLicense()
 * @param {number} aiScore       - 0 to 100 AI probability score
 * @returns {{ combinedRisk: string, warning: string | null }}
 */
function getCombinedRisk(licenseInfo, aiScore) {
  // Only warn if both conditions are true
  if (licenseInfo.risk === 'HIGH_RISK' && aiScore > 60) {
    return {
      combinedRisk: 'CRITICAL',
      warning: `⚠ CRITICAL: This repo scores ${aiScore}% AI-generated AND uses ${licenseInfo.shortName}. ` +
               `AI-generated code that mirrors GPL-licensed code could force you to open source ` +
               `your entire project. Legal review strongly recommended before using any code from this repo.`,
    };
  }

  if (licenseInfo.risk === 'REVIEW' && aiScore > 70) {
    return {
      combinedRisk: 'ELEVATED',
      warning: `⚡ ELEVATED: High AI score (${aiScore}%) with a copyleft license (${licenseInfo.shortName}). ` +
               `Review carefully before using code from this repo in commercial projects.`,
    };
  }

  return {
    combinedRisk: licenseInfo.risk,
    warning:      licenseInfo.warning || null,
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  classifyLicense,
  getCombinedRisk,
  LICENSE_DATABASE,
};
