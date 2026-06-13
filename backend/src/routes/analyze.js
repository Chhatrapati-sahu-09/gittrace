/**
 * GitTrace Backend — /api/analyze Route (Day 4 Update)
 *
 * Now includes:
 *   - AI detection scoring via Sapling API
 *   - Commit velocity analysis
 *   - In-memory caching (10 min TTL)
 *   - Full structured response for the Chrome extension
 */

const express = require("express");
const router = express.Router();
const github = require("../services/github");
const aiDetector = require("../services/aiDetector");
const commitVelocity = require("../services/commitVelocity");
const cache = require("../services/cache");
const licenseClassifier = require('../services/licenseClassifier');
const compatAnalyzer = require('../services/compatAnalyzer');

// ─── Input Validation ─────────────────────────────────────────────────────────

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

router.post("/", async (req, res, next) => {
  const startTime = Date.now();
  const { owner, repo } = req.body;

  console.log(`\n[Analyze] ─── New Request ─────────────────────`);
  console.log(`[Analyze] Repo:  ${owner}/${repo}`);
  console.log(`[Analyze] IP:    ${req.ip}`);
  console.log(`[Analyze] Time:  ${new Date().toISOString()}`);

  // Step 1: Validate inputs
  const validation = validateInput(owner, repo);
  if (!validation.valid) {
    return res.status(400).json({ success: false, error: validation.error });
  }

  // Step 2: Check cache
  const cacheKey = `${owner}/${repo}`;
  const cachedData = cache.get(cacheKey);

  if (cachedData) {
    console.log(`[Analyze] Returning cached result for ${cacheKey}`);
    return res.status(200).json({
      ...cachedData,
      fromCache: true,
    });
  }

  try {
    // Step 3: Fetch GitHub data in parallel where possible
    console.log("[Analyze] Step 1/8 — Fetching repo metadata...");
    const meta = await github.getRepoMeta(owner, repo);

    console.log("[Analyze] Step 2/8 — Fetching file tree...");
    const fileTree = await github.getFileTree(owner, repo, meta.defaultBranch);

    // Fetch file contents, commits, license, and config files in parallel
    console.log(
      "[Analyze] Step 3/8 — Fetching files, commits, license, and config files in parallel...",
    );
    const [fileContents, commits, license, configFileContents] = await Promise.all([
      github.getMultipleFileContents(owner, repo, fileTree.sourceFiles, 10),
      github.getCommits(owner, repo, 50),
      github.getLicense(owner, repo),
      github.getMultipleFileContents(owner, repo, fileTree.configFiles, 15),
    ]);

    // Step 4: Run AI detection on file contents
    console.log("[Analyze] Step 4/8 — Running AI detection...");
    const aiResults = await aiDetector.analyzeFiles(
      fileContents,
      fileTree.sourceFiles,
    );

    // Step 5: (Placeholder for Security scan)

    // Step 6: Run commit velocity analysis
    console.log('[Analyze] Step 6/8 — Analyzing commit velocity...');
    const velocityResults = commitVelocity.analyzeCommitVelocity(commits);

    // Step 7: Run compatibility analysis — NEW Day 8
    console.log('[Analyze] Step 7/8 — Analyzing compatibility...');
    const compatResults = compatAnalyzer.analyzeCompatibility({
      configFiles:  configFileContents,
      allFilePaths: fileTree.allFiles.map(f => f.path),
      repoSizeKB:   meta.size || 0,
    });

    // Step 8: Assemble final payload
    console.log('[Analyze] Step 8/8 — Assembling response...');
    const elapsed = Date.now() - startTime;

    const payload = {
      success: true,
      fromCache: false,

      // Repository metadata
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

      // File tree stats
      fileTree: {
        stats: fileTree.stats,
        truncated: fileTree.truncated,
        configFiles: fileTree.configFiles.map((f) => f.path),
        sourceFiles: fileTree.sourceFiles.slice(0, 20).map((f) => ({
          path: f.path,
          size: f.size,
        })),
      },

      // AI Detection Results — NEW in Day 4
      aiAnalysis: {
        overallScore: aiResults.overallScore,
        label: aiResults.label,
        perFileScores: aiResults.perFileScores,
        heuristicFlags: aiResults.heuristicFlags,
        analyzedFiles: aiResults.analyzedFiles,
        totalChunks: aiResults.totalChunks,
        elapsedMs: aiResults.elapsedMs,
      },

      // Commit Velocity Results — NEW in Day 4
      commits: {
        total: commits.length,
        recent: commits.slice(0, 10),
        velocity: {
          flags: velocityResults.flags,
          summary: velocityResults.summary,
          riskLevel: velocityResults.riskLevel,
        },
      },

      // License info (classification comes Day 6)
      license: (() => {
        const spdxId     = license?.spdxId || null;
        const classified = licenseClassifier.classifyLicense(spdxId);
        const combined   = licenseClassifier.getCombinedRisk(
          classified,
          aiResults.overallScore
        );
        return {
          spdxId:       classified.spdxId,
          name:         classified.shortName,
          risk:         classified.risk,
          colour:       classified.colour,
          label:        classified.label,
          explanation:  classified.explanation,
          canUseAI:     classified.canUseAI,
          combinedRisk: combined.combinedRisk,
          warning:      combined.warning,
        };
      })(),

      // Compatibility Results — NEW Day 8
      compatInfo: {
        runtime: {
          nodeVersion:   compatResults.runtime.nodeVersion,
          pythonVersion: compatResults.runtime.pythonVersion,
          nvmrc:         compatResults.runtime.nvmrc,
        },
        platform: {
          requiredOS:    compatResults.platform.requiredOS,
          requiredCPU:   compatResults.platform.requiredCPU,
          archWarnings:  compatResults.platform.archWarnings,
        },
        tools: {
          required: compatResults.tools.required,
        },
        compute: {
          heavyDeps: compatResults.compute.heavyDeps,
          footprint: compatResults.compute.footprint,
        },
        configFilesScanned: compatResults.rawConfigFiles,
      },

      // Sample file previews
      sampleFiles: fileContents.map((f) => ({
        path: f.path,
        size: f.size,
        preview: f.content.substring(0, 500),
        // Match score from AI results
        score:
          aiResults.perFileScores.find((s) => s.path === f.path)?.score ?? null,
      })),
    };

    // Cache the result for 10 minutes
    cache.set(cacheKey, payload);

    console.log(
      `[Analyze] Complete in ${elapsed}ms — Score: ${aiResults.overallScore} (${aiResults.label})`,
    );

    return res.status(200).json(payload);
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/analyze/health ──────────────────────────────────────────────────

router.get("/health", (req, res) => {
  res.json({
    success: true,
    route: "/api/analyze",
    status: "ready",
    cache: cache.stats(),
    timestamp: new Date().toISOString(),
  });
});

// ─── DELETE /api/analyze/cache ────────────────────────────────────────────────

router.delete("/cache", (req, res) => {
  cache.clear();
  res.json({ success: true, message: "Cache cleared" });
});

module.exports = router;
