/**
 * GitTrace Backend — PR Analysis Route
 *
 * GET /api/pr/:owner/:repo/pull/:prNumber
 *
 * Returns a lightweight payload specifically for the PR Shield.
 * Much faster than /api/analyze because:
 *   - Uses cached analyze result if available
 *   - Only returns per-file scores (not full analysis)
 *   - Adds PR-specific data: files changed in this PR
 *
 * The PR Shield only needs:
 *   - Per-file AI scores (to highlight lines)
 *   - Overall score (for the summary bar)
 *   - Which files were actually changed in this PR
 */

const express = require('express');
const router  = express.Router();
const github  = require('../services/github');
const cache   = require('../services/cache');

// ─── GET /api/pr/:owner/:repo/pull/:prNumber ──────────────────────────────────

router.get('/:owner/:repo/pull/:prNumber', async (req, res, next) => {
  const { owner, repo, prNumber } = req.params;

  console.log(`\n[PR Route] PR analysis: ${owner}/${repo}#${prNumber}`);

  try {
    // Step 1: Check if we have a cached full analysis for this repo
    const cacheKey   = `${owner}/${repo}`;
    const cachedData = cache.get(cacheKey);

    let perFileScores = [];
    let overallScore  = null;

    if (cachedData) {
      console.log('[PR Route] Using cached analysis data');
      perFileScores = cachedData.aiAnalysis?.perFileScores || [];
      overallScore  = cachedData.aiAnalysis?.overallScore  || null;
    } else {
      console.log('[PR Route] No cached data — returning empty scores');
      // No cache — the content script will trigger a full analysis
      // which will then populate the cache for future PR requests
    }

    // Step 2: Fetch the list of files changed in this specific PR
    // This helps us filter which files to highlight
    let prFiles = [];
    try {
      const response = await github.getPRFiles(owner, repo, prNumber);
      prFiles = response;
    } catch (err) {
      console.warn('[PR Route] Could not fetch PR files:', err.message);
    }

    // Step 3: Filter scores to only files changed in this PR
    const prFilePaths = new Set(prFiles.map(f => f.filename));

    const prRelevantScores = perFileScores.length > 0 && prFilePaths.size > 0
      ? perFileScores.filter(f =>
          prFilePaths.has(f.path) ||
          [...prFilePaths].some(pf =>
            pf.endsWith(f.path) || f.path.endsWith(pf.split('/').pop())
          )
        )
      : perFileScores;

    return res.status(200).json({
      success:      true,
      owner,
      repo,
      prNumber,
      overallScore,
      perFileScores: prRelevantScores,
      prFiles:       prFiles.slice(0, 50),  // max 50 files
      fromCache:     !!cachedData,
      timestamp:     new Date().toISOString(),
    });

  } catch (error) {
    next(error);
  }
});

module.exports = router;
