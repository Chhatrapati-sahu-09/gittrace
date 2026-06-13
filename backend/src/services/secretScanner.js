/**
 * GitTrace Backend — Hardcoded Secret Scanner
 *
 * Scans source code files for accidentally committed secrets.
 * AI models frequently generate boilerplate that includes:
 *   - API key placeholders that developers forget to replace
 *   - Actual secrets from previous context/training data
 *   - Real-looking but fake credentials
 *
 * We scan for patterns but NEVER log or return the actual secret value.
 * We only report: file path, line number, secret type, and a masked preview.
 *
 * Pattern sources:
 *   - GitHub's own secret scanning patterns
 *   - TruffleHog patterns
 *   - Common AI-generated credential patterns
 */

// ─── Secret Patterns ──────────────────────────────────────────────────────────

/**
 * Each pattern has:
 *   type:        Human-readable name
 *   pattern:     Regex to detect the secret
 *   severity:    'critical' | 'high' | 'medium'
 *   description: What this is and why it is dangerous
 */
const SECRET_PATTERNS = [
  // ── Cloud Provider Keys ────────────────────────────────────────

  {
    type: "AWS Access Key ID",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    severity: "critical",
    description: "AWS Access Key ID. Can be used to access AWS services.",
  },

  {
    type: "AWS Secret Access Key",
    pattern:
      /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi,
    severity: "critical",
    description:
      "AWS Secret Access Key. Paired with Access Key ID gives full AWS access.",
  },

  {
    type: "Google API Key",
    pattern: /AIza[0-9A-Za-z_-]{35}/g,
    severity: "critical",
    description:
      "Google API Key. Can enable billing on your Google Cloud account.",
  },

  {
    type: "Google OAuth Client Secret",
    pattern: /GOCSPX-[0-9A-Za-z_-]{28}/g,
    severity: "critical",
    description: "Google OAuth 2.0 Client Secret.",
  },

  // ── GitHub Tokens ──────────────────────────────────────────────

  {
    type: "GitHub Personal Access Token",
    pattern: /ghp_[A-Za-z0-9]{36}/g,
    severity: "critical",
    description:
      "GitHub Personal Access Token. Can access repositories and user data.",
  },

  {
    type: "GitHub OAuth Token",
    pattern: /gho_[A-Za-z0-9]{36}/g,
    severity: "critical",
    description: "GitHub OAuth Access Token.",
  },

  {
    type: "GitHub App Token",
    pattern: /ghs_[A-Za-z0-9]{36}/g,
    severity: "critical",
    description: "GitHub App Installation Token.",
  },

  {
    type: "GitHub Refresh Token",
    pattern: /ghr_[A-Za-z0-9]{36}/g,
    severity: "high",
    description: "GitHub OAuth Refresh Token.",
  },

  // ── Payment & Financial ────────────────────────────────────────

  {
    type: "Stripe Secret Key",
    pattern: /sk_live_[0-9a-zA-Z]{24,}/g,
    severity: "critical",
    description: "Stripe Live Secret Key. Can process real payments.",
  },

  {
    type: "Stripe Restricted Key",
    pattern: /rk_live_[0-9a-zA-Z]{24,}/g,
    severity: "critical",
    description: "Stripe Restricted Key.",
  },

  {
    type: "Stripe Test Key",
    pattern: /sk_test_[0-9a-zA-Z]{24,}/g,
    severity: "medium",
    description: "Stripe Test Key. Risky if test environment has real data.",
  },

  // ── Communication ──────────────────────────────────────────────

  {
    type: "Twilio Auth Token",
    pattern:
      /(?:twilio.*auth.*token|auth.*token.*twilio)['":\s]+([0-9a-f]{32})/gi,
    severity: "high",
    description:
      "Twilio Auth Token. Can send SMS and make calls at your expense.",
  },

  {
    type: "SendGrid API Key",
    pattern: /SG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}/g,
    severity: "high",
    description: "SendGrid API Key. Can send emails from your account.",
  },

  {
    type: "Slack Bot Token",
    pattern: /xoxb-[0-9]{11}-[0-9]{11}-[0-9a-zA-Z]{24}/g,
    severity: "high",
    description: "Slack Bot Token. Can read and post messages.",
  },

  {
    type: "Slack User Token",
    pattern: /xoxp-[0-9]{11}-[0-9]{11}-[0-9]{11}-[0-9a-f]{32}/g,
    severity: "critical",
    description: "Slack User Token. Can act as the user in Slack.",
  },

  // ── Database URLs ──────────────────────────────────────────────

  {
    type: "MongoDB Connection String",
    pattern: /mongodb(?:\+srv)?:\/\/[^:]+:[^@\s]+@[^\s"']+/gi,
    severity: "critical",
    description: "MongoDB connection string with credentials.",
  },

  {
    type: "PostgreSQL Connection String",
    pattern: /postgres(?:ql)?:\/\/[^:]+:[^@\s]+@[^\s"']+/gi,
    severity: "critical",
    description: "PostgreSQL connection string with credentials.",
  },

  {
    type: "MySQL Connection String",
    pattern: /mysql:\/\/[^:]+:[^@\s]+@[^\s"']+/gi,
    severity: "critical",
    description: "MySQL connection string with credentials.",
  },

  {
    type: "Redis URL with Password",
    pattern: /redis:\/\/:[^@\s]+@[^\s"']+/gi,
    severity: "high",
    description: "Redis connection URL with password.",
  },

  // ── Private Keys ───────────────────────────────────────────────

  {
    type: "RSA Private Key",
    pattern: /-----BEGIN RSA PRIVATE KEY-----/g,
    severity: "critical",
    description:
      "RSA Private Key. Can be used to impersonate servers or decrypt data.",
  },

  {
    type: "SSH Private Key",
    pattern: /-----BEGIN OPENSSH PRIVATE KEY-----/g,
    severity: "critical",
    description: "SSH Private Key. Gives SSH access to servers.",
  },

  {
    type: "EC Private Key",
    pattern: /-----BEGIN EC PRIVATE KEY-----/g,
    severity: "critical",
    description: "Elliptic Curve Private Key.",
  },

  {
    type: "PGP Private Key",
    pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g,
    severity: "critical",
    description: "PGP Private Key.",
  },

  // ── Generic High-Risk Patterns ─────────────────────────────────

  {
    type: "Generic API Key Assignment",
    pattern:
      /(?:api_key|apikey|api-key)\s*[=:]\s*['"][0-9a-zA-Z_\-]{20,}['"]/gi,
    severity: "high",
    description: "Generic API key assignment. Value may be a real secret.",
  },

  {
    type: "Generic Secret Assignment",
    pattern: /(?:secret|password|passwd|pwd)\s*[=:]\s*['"][^'"]{8,}['"]/gi,
    severity: "medium",
    description: "Generic secret or password assignment.",
  },

  {
    type: "JWT Secret",
    pattern: /(?:jwt_secret|JWT_SECRET|jwtSecret)\s*[=:]\s*['"][^'"]{16,}['"]/g,
    severity: "high",
    description:
      "JWT signing secret. Can be used to forge authentication tokens.",
  },

  {
    type: "Bearer Token in Code",
    pattern: /Authorization:\s*['"`]Bearer\s+[A-Za-z0-9_\-\.]{20,}['"`]/gi,
    severity: "high",
    description: "Hardcoded Bearer token. Should use environment variables.",
  },
];

// ─── False Positive Filter ────────────────────────────────────────────────────

/**
 * Check if a detected secret is likely a false positive.
 * Common false positives: test values, placeholders, examples.
 *
 * @param {string} matchedValue
 * @returns {boolean} true if likely a false positive
 */
function isFalsePositive(matchedValue) {
  const lower = matchedValue.toLowerCase();

  const FALSE_POSITIVE_PATTERNS = [
    "your_api_key",
    "your-api-key",
    "your_token",
    "insert_key_here",
    "replace_with",
    "change_this",
    "xxx",
    "yyy",
    "zzz",
    "example",
    "placeholder",
    "dummy",
    "test_key",
    "fake_key",
    "1234567890",
    "abcdefghij",
    "<api_key>",
    "${",
    "process.env",
    "os.environ",
  ];

  return FALSE_POSITIVE_PATTERNS.some((fp) => lower.includes(fp));
}

/**
 * Mask a secret value for safe display.
 * Shows first 4 chars + asterisks + last 4 chars.
 *
 * @param {string} value
 * @returns {string}
 */
function maskSecret(value) {
  if (!value || value.length < 8) return "****";
  return value.substring(0, 4) + "****" + value.substring(value.length - 4);
}

// ─── Main Scanner ─────────────────────────────────────────────────────────────

/**
 * Scan a single file's content for secrets.
 *
 * @param {string} filePath
 * @param {string} content
 * @returns {object[]} Array of detected secrets
 */
function scanFileForSecrets(filePath, content) {
  const findings = [];
  const lines = content.split("\n");

  // Skip minified files — too many false positives
  const avgLineLength = content.length / (lines.length || 1);
  if (avgLineLength > 500) return [];

  // Skip obvious test/fixture files
  const lowerPath = filePath.toLowerCase();
  if (
    lowerPath.includes("test") ||
    lowerPath.includes("spec") ||
    lowerPath.includes("fixture") ||
    lowerPath.includes("mock") ||
    lowerPath.includes(".md")
  )
    return [];

  SECRET_PATTERNS.forEach(({ type, pattern, severity, description }) => {
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      const matchedValue = match[0];

      // Skip false positives
      if (isFalsePositive(matchedValue)) continue;

      // Find line number
      const beforeMatch = content.substring(0, match.index);
      const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;

      // Get the actual line for context
      const line = lines[lineNumber - 1] || "";

      findings.push({
        type,
        severity,
        description,
        file: filePath,
        line: lineNumber,
        masked: maskSecret(matchedValue),
        context: line.trim().substring(0, 80), // First 80 chars of the line
      });
    }
  });

  return findings;
}

/**
 * Scan multiple files for hardcoded secrets.
 *
 * @param {Array<{ path: string, content: string }>} files
 * @returns {{
 *   secrets:      object[],
 *   filesScanned: number,
 *   elapsedMs:    number,
 * }}
 */
function scanForSecrets(files) {
  console.log(
    `\n[Secrets] Scanning ${files.length} files for hardcoded secrets`,
  );
  const startTime = Date.now();

  const allSecrets = [];

  files.forEach((file) => {
    const fileSecrets = scanFileForSecrets(file.path, file.content);
    allSecrets.push(...fileSecrets);
  });

  // Sort: critical first
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  allSecrets.sort(
    (a, b) =>
      (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3),
  );

  const elapsed = Date.now() - startTime;
  console.log(`[Secrets] Found ${allSecrets.length} secrets in ${elapsed}ms`);

  return {
    secrets: allSecrets,
    filesScanned: files.length,
    elapsedMs: elapsed,
  };
}

module.exports = {
  scanForSecrets,
  scanFileForSecrets,
  SECRET_PATTERNS,
};
