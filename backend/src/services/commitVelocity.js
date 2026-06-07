/**
 * GitTrace Backend — Commit Velocity Analyzer
 *
 * Detects "superhuman" commit patterns that suggest
 * code was AI generated and pasted in bulk.
 *
 * What we flag:
 *   - Large number of lines added in a single commit
 *   - First commit contains thousands of lines (full project dumped at once)
 *   - Multiple huge commits in rapid succession
 *   - Commit messages that look AI generated
 */

// ─── Constants ────────────────────────────────────────────────────────────────

// A human typing fast can do ~60 lines/hour of real code.
// We flag commits adding more than this many lines as suspicious.
const SUSPICIOUS_LINES_THRESHOLD = 500;

// First commit with this many lines = project was generated not built
const FIRST_COMMIT_THRESHOLD = 1000;

// If more than this many large commits exist = pattern of AI usage
const LARGE_COMMIT_COUNT_THRESHOLD = 3;

// AI generated commit messages are very generic
const AI_COMMIT_MESSAGE_PATTERNS = [
  /^initial commit$/i,
  /^first commit$/i,
  /^add (all|everything|files|code|project)$/i,
  /^update$/i,
  /^fix$/i,
  /^done$/i,
  /^working$/i,
  /^test$/i,
  /^wip$/i,
  /^(feat|fix|chore|refactor): .{3,10}$/i, // very short conventional commits
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check if a commit message looks AI-generated or lazy.
 * @param {string} message
 * @returns {boolean}
 */
function isGenericCommitMessage(message) {
  if (!message) return false;
  const firstLine = message.split("\n")[0].trim();
  return AI_COMMIT_MESSAGE_PATTERNS.some((pattern) => pattern.test(firstLine));
}

/**
 * Parse a date string and return a Date object.
 * @param {string} dateStr
 * @returns {Date}
 */
function parseDate(dateStr) {
  return new Date(dateStr);
}

// ─── Main Analyzer ────────────────────────────────────────────────────────────

/**
 * Analyze commit history for velocity anomalies.
 *
 * @param {Array<{
 *   sha:       string,
 *   message:   string,
 *   date:      string,
 *   additions: number,
 *   deletions: number,
 *   author:    string
 * }>} commits - Commit history, newest first
 *
 * @returns {{
 *   flags:           object[],
 *   summary:         object,
 *   riskLevel:       'low'|'medium'|'high',
 * }}
 */
function analyzeCommitVelocity(commits) {
  if (!commits || commits.length === 0) {
    return {
      flags: [],
      summary: { totalCommits: 0, flaggedCommits: 0, genericMessages: 0 },
      riskLevel: "low",
    };
  }

  const flags = [];

  // Sort commits oldest first for analysis
  const sorted = [...commits].sort(
    (a, b) => parseDate(a.date) - parseDate(b.date),
  );

  // ── Check 1: First commit size ───────────────────────────────────
  const firstCommit = sorted[0];
  if (firstCommit && firstCommit.additions > FIRST_COMMIT_THRESHOLD) {
    flags.push({
      type: "LARGE_FIRST_COMMIT",
      severity: "high",
      sha: firstCommit.sha,
      message: firstCommit.message,
      date: firstCommit.date,
      additions: firstCommit.additions,
      description:
        `First commit added ${firstCommit.additions} lines — ` +
        `entire project may have been AI generated and dumped at once`,
    });
  }

  // ── Check 2: Individual large commits ───────────────────────────
  let largeCommitCount = 0;

  sorted.forEach((commit, index) => {
    if (commit.additions > SUSPICIOUS_LINES_THRESHOLD) {
      largeCommitCount++;

      flags.push({
        type: "LARGE_COMMIT",
        severity: commit.additions > 2000 ? "high" : "medium",
        sha: commit.sha,
        message: commit.message,
        date: commit.date,
        additions: commit.additions,
        deletions: commit.deletions,
        description:
          `Commit added ${commit.additions} lines — ` +
          `unusually large for human-written code`,
      });
    }
  });

  // ── Check 3: Too many large commits ─────────────────────────────
  if (largeCommitCount >= LARGE_COMMIT_COUNT_THRESHOLD) {
    flags.push({
      type: "REPEATED_LARGE_COMMITS",
      severity: "high",
      count: largeCommitCount,
      description:
        `${largeCommitCount} commits each added over ${SUSPICIOUS_LINES_THRESHOLD} lines — ` +
        `pattern suggests repeated AI generation and paste sessions`,
    });
  }

  // ── Check 4: Generic commit messages ────────────────────────────
  const genericMessages = sorted.filter((c) =>
    isGenericCommitMessage(c.message),
  );

  if (genericMessages.length > 0) {
    const ratio = genericMessages.length / sorted.length;

    if (ratio > 0.5) {
      flags.push({
        type: "GENERIC_COMMIT_MESSAGES",
        severity: "medium",
        count: genericMessages.length,
        total: sorted.length,
        ratio: Math.round(ratio * 100),
        examples: genericMessages
          .slice(0, 3)
          .map((c) => c.message.split("\n")[0]),
        description:
          `${genericMessages.length} of ${sorted.length} commit messages are generic ` +
          `(${Math.round(ratio * 100)}%) — suggests AI-assisted development`,
      });
    }
  }

  // ── Check 5: Bulk delete and re-add ─────────────────────────────
  // Vibe coding pattern: delete everything, paste new AI version
  sorted.forEach((commit) => {
    if (commit.deletions > 300 && commit.additions > 300) {
      const ratio =
        Math.min(commit.additions, commit.deletions) /
        Math.max(commit.additions, commit.deletions);

      if (ratio > 0.6) {
        flags.push({
          type: "BULK_REWRITE",
          severity: "high",
          sha: commit.sha,
          message: commit.message,
          date: commit.date,
          additions: commit.additions,
          deletions: commit.deletions,
          description:
            `Commit deleted ${commit.deletions} lines and added ${commit.additions} lines — ` +
            `classic "vibe coding" pattern of wiping and re-pasting AI output`,
        });
      }
    }
  });

  // ── Check 6: Single contributor + all large commits ─────────────
  const authors = new Set(sorted.map((c) => c.author));
  if (authors.size === 1 && largeCommitCount >= 2) {
    flags.push({
      type: "SINGLE_AUTHOR_BULK",
      severity: "low",
      author: [...authors][0],
      description:
        `Single author made ${largeCommitCount} large commits — ` +
        `could indicate solo AI-assisted development`,
    });
  }

  // ── Risk Level ───────────────────────────────────────────────────
  const highFlags = flags.filter((f) => f.severity === "high").length;
  const mediumFlags = flags.filter((f) => f.severity === "medium").length;

  let riskLevel = "low";
  if (highFlags >= 2 || (highFlags >= 1 && mediumFlags >= 1))
    riskLevel = "high";
  else if (highFlags >= 1 || mediumFlags >= 2) riskLevel = "medium";

  // ── Summary ──────────────────────────────────────────────────────
  const summary = {
    totalCommits: sorted.length,
    flaggedCommits: flags.filter((f) => f.sha).length,
    genericMessages: genericMessages.length,
    largeCommits: largeCommitCount,
    authors: authors.size,
    riskLevel,
  };

  console.log(`[Velocity] ${flags.length} flags found. Risk: ${riskLevel}`);

  return { flags, summary, riskLevel };
}

module.exports = {
  analyzeCommitVelocity,
  isGenericCommitMessage,
};
