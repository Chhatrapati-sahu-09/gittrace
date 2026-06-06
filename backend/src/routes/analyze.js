/**
 * GitTrace — /api/analyze Route
 *
 * POST /api/analyze
 * Body: { owner: string, repo: string }
 *
 * Flow:
 *   1. Validate request body
 *   2. Fetch repo metadata from GitHub
 *   3. Fetch file tree
 *   4. Fetch content of top source files
 *   5. Fetch commits
 *   6. Fetch license
 *   7. Assemble and return full payload
 *
 * Day 4 will add:
 *   - AI detection scoring on the file contents
 *   - Commit velocity analysis
 *
 * Day 7 will add:
 *   - Security vulnerability scanning (OSV API)
 *   - Phantom package detection
 */

const express = require("express");
const router = express.Router();
const github = require("../services/github");

// ─── Input Validation ─────────────────────────────────────────────────────────

/**
 * Validate the owner and repo strings from the request body.
 * GitHub usernames/repo names: alphanumeric, hyphens, underscores, dots.
 *
 * @param {string} owner
 * @param {string} repo
 * @returns {{ valid: boolean, error?: string }}
 */
function validateInput(owner, repo) {
  if (!owner || typeof owner !== "string") {
    return { valid: false, error: "owner is required and must be a string" };
  }
  if (!repo || typeof repo !== "string") {
    return { valid: false, error: "repo is required and must be a string" };
  }

  const GITHUB_NAME_REGEX = /^[a-zA-Z0-9._-]+$/;

  if (!GITHUB_NAME_REGEX.test(owner)) {
    return { valid: false, error: `Invalid owner name: "${owner}"` };
  }
  if (!GITHUB_NAME_REGEX.test(repo)) {
    return { valid: false, error: `Invalid repo name: "${repo}"` };
  }
  if (owner.length > 100 || repo.length > 100) {
    return {
      valid: false,
      error: "owner and repo names must be under 100 characters",
    };
  }

  return { valid: true };
}

// ─── POST /api/analyze ────────────────────────────────────────────────────────

/**
 * Main analysis endpoint.
 * Fetches all GitHub data and returns structured payload.
 */
router.post("/", async (req, res, next) => {
  const startTime = Date.now();
  const { owner, repo } = req.body;

  console.log(`\n[Analyze] ─── New Request ────────────────`);
  console.log(`[Analyze] Repo: ${owner}/${repo}`);
  console.log(`[Analyze] IP: ${req.ip}`);

  // Step 1: Validate inputs
  const validation = validateInput(owner, repo);
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      error: validation.error,
    });
  }

  try {
    // Step 2: Fetch repo metadata
    console.log("[Analyze] Step 1/5 — Fetching repo metadata...");
    const meta = await github.getRepoMeta(owner, repo);

    // Step 3: Fetch file tree
    console.log("[Analyze] Step 2/5 — Fetching file tree...");
    const fileTree = await github.getFileTree(owner, repo, meta.defaultBranch);

    // Step 4: Fetch file contents (top 10 largest source files)
    console.log("[Analyze] Step 3/5 — Fetching file contents...");
    const fileContents = await github.getMultipleFileContents(
      owner,
      repo,
      fileTree.sourceFiles,
      10,
    );

    // Step 5: Fetch commits (last 50)
    console.log("[Analyze] Step 4/5 — Fetching commits...");
    const commits = await github.getCommits(owner, repo, 50);

    // Step 6: Fetch license
    console.log("[Analyze] Step 5/5 — Fetching license...");
    const license = await github.getLicense(owner, repo);

    const elapsed = Date.now() - startTime;
    console.log(`[Analyze] Complete in ${elapsed}ms`);

    // Step 7: Assemble response payload
    // Day 4 will replace the placeholder scores with real AI detection
    const payload = {
      success: true,
      meta: {
        owner,
        repo,
        fullName: meta.fullName,
        description: meta.description,
        language: meta.language,
        stars: meta.stars,
        defaultBranch: meta.defaultBranch,
        size: meta.size,
        createdAt: meta.createdAt,
        pushedAt: meta.pushedAt,
        isFork: meta.isFork,
        topics: meta.topics,
        analyzedAt: new Date().toISOString(),
        elapsedMs: elapsed,
      },
      fileTree: {
        stats: fileTree.stats,
        truncated: fileTree.truncated,
        configFiles: fileTree.configFiles.map((f) => f.path),
        // Return top 20 source file paths for heatmap
        sourceFiles: fileTree.sourceFiles.slice(0, 20).map((f) => ({
          path: f.path,
          size: f.size,
        })),
      },
      // Files with content — Day 4 will run AI detection on these
      sampleFiles: fileContents.map((f) => ({
        path: f.path,
        size: f.size,
        // Return first 3000 chars for preview — full content used by AI detector
        preview: f.content.substring(0, 3000),
        // Day 4: score will be set by AI detector
        score: null,
      })),
      commits: {
        total: commits.length,
        // Return last 20 for velocity analysis
        recent: commits.slice(0, 20),
        // Day 4: velocity flags will be set here
        flags: [],
      },
      license: license
        ? {
            spdxId: license.spdxId,
            name: license.name,
            // Day 6: risk level will be classified here
            risk: null,
            colour: null,
          }
        : null,
      // Day 4: AI scores go here
      aiAnalysis: {
        overallScore: null,
        label: null,
        perFileScores: [],
        heuristicFlags: [],
        note: "AI scoring not yet implemented — arrives Day 4",
      },
    };

    return res.status(200).json(payload);
  } catch (error) {
    // Pass to global error handler (errorHandler.js)
    next(error);
  }
});

// ─── GET /api/analyze/health ──────────────────────────────────────────────────

/**
 * Health check for this specific route.
 * Lets us verify the route is mounted without triggering a full analysis.
 */
router.get("/health", (req, res) => {
  res.json({
    success: true,
    route: "/api/analyze",
    status: "ready",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
