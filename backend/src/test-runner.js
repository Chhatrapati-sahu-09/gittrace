/**
 * GitTrace Backend — Test Runner (Day 4 Update)
 *
 * Run with: npm test
 * Server must be running first: npm run dev
 */

const axios = require("axios");

const BASE_URL = "http://localhost:3001";
const SECRET = "dev-secret-day3";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runTest(name, fn) {
  console.log(`\n🧪 ${name}`);
  try {
    await fn();
  } catch (err) {
    console.log(`  ❌ TEST ERROR: ${err.message}`);
    if (err.response?.data) {
      console.log(`  ℹ️  Response:`, JSON.stringify(err.response.data));
    }
    failed++;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n══════════════════════════════════════════════");
  console.log("  GitTrace Backend — Test Runner (Day 4)");
  console.log("══════════════════════════════════════════════\n");

  // ── Test 1: Server health ────────────────────────────────────────
  await runTest("GET /health — server is running", async () => {
    const res = await axios.get(`${BASE_URL}/health`);
    assert(res.status === 200, "Status 200");
    assert(res.data.success === true, "success is true");
    assert(res.data.status === "healthy", "Status is healthy");
  });

  // ── Test 2: Cache stats in route health ─────────────────────────
  await runTest("GET /api/analyze/health — shows cache stats", async () => {
    const res = await axios.get(`${BASE_URL}/api/analyze/health`);
    assert(res.status === 200, "Status 200");
    assert(typeof res.data.cache === "object", "Has cache object");
    assert(typeof res.data.cache.size === "number", "Cache has size field");
  });

  // ── Test 3: Missing body ─────────────────────────────────────────
  await runTest("POST /api/analyze — missing body returns 400", async () => {
    try {
      await axios.post(`${BASE_URL}/api/analyze`, {});
    } catch (err) {
      assert(err.response?.status === 400, "Returns 400");
      assert(err.response?.data?.success === false, "success is false");
    }
  });

  // ── Test 4: Full analysis with real repo ─────────────────────────
  await runTest("POST /api/analyze — real repo facebook/react", async () => {
    console.log("  ⏳ Fetching GitHub data + running AI detection...");
    console.log("  ⏳ This takes 10-20 seconds on first run...");

    const res = await axios.post(
      `${BASE_URL}/api/analyze`,
      { owner: "facebook", repo: "react" },
      { headers: { "X-GitTrace-Key": SECRET }, timeout: 60000 },
    );

    assert(res.status === 200, "Status 200");
    assert(res.data.success === true, "success is true");

    // Meta checks
    assert(res.data.meta.owner === "facebook", "Owner is facebook");
    assert(res.data.meta.repo === "react", "Repo is react");
    assert(typeof res.data.meta.stars === "number", "Has stars");
    assert(typeof res.data.meta.elapsedMs === "number", "Has elapsed time");

    // AI Analysis checks — NEW Day 4
    const ai = res.data.aiAnalysis;
    assert(typeof ai === "object", "Has aiAnalysis object");
    assert(typeof ai.overallScore === "number", "Has overallScore number");
    assert(ai.overallScore >= 0 && ai.overallScore <= 100, "Score is 0-100");
    assert(typeof ai.label === "string", "Has label string");
    assert(
      ["Low", "Medium", "High", "Very High"].includes(ai.label),
      "Label is valid value",
    );
    assert(Array.isArray(ai.perFileScores), "perFileScores is array");
    assert(ai.perFileScores.length > 0, "Has per file scores");
    assert(typeof ai.analyzedFiles === "number", "Has analyzedFiles count");

    // Per file score structure
    const firstFile = ai.perFileScores[0];
    assert(typeof firstFile.path === "string", "File has path");
    assert(typeof firstFile.score === "number", "File has score");

    // Commit velocity checks — NEW Day 4
    const vel = res.data.commits.velocity;
    assert(typeof vel === "object", "Has velocity object");
    assert(Array.isArray(vel.flags), "velocity.flags is array");
    assert(typeof vel.summary === "object", "Has velocity summary");
    assert(typeof vel.riskLevel === "string", "Has riskLevel");
    assert(
      ["low", "medium", "high"].includes(vel.riskLevel),
      "riskLevel is valid",
    );

    console.log(`\n  ── Results ──────────────────────────`);
    console.log(`  AI Score:  ${ai.overallScore} (${ai.label})`);
    console.log(
      `  Files:     ${ai.analyzedFiles} analyzed, ${ai.perFileScores.length} scored`,
    );
    console.log(`  Chunks:    ${ai.totalChunks} total API calls`);
    console.log(
      `  Velocity:  ${vel.flags.length} flags, risk: ${vel.riskLevel}`,
    );
    console.log(`  Time:      ${res.data.meta.elapsedMs}ms total`);
    console.log(`  ─────────────────────────────────────`);
  });

  // ── Test 5: Cache hit on second request ──────────────────────────
  await runTest("POST /api/analyze — second request hits cache", async () => {
    console.log("  ⏳ Second request should be instant from cache...");

    const start = Date.now();
    const res = await axios.post(
      `${BASE_URL}/api/analyze`,
      { owner: "facebook", repo: "react" },
      { headers: { "X-GitTrace-Key": SECRET }, timeout: 10000 },
    );
    const elapsed = Date.now() - start;

    assert(res.status === 200, "Status 200");
    assert(res.data.fromCache === true, "fromCache is true");
    assert(elapsed < 300, `Response was fast: ${elapsed}ms (cache working)`);
    console.log(`  ℹ️  Cache response time: ${elapsed}ms`);
  });

  // ── Test 6: Clear cache ──────────────────────────────────────────
  await runTest("DELETE /api/analyze/cache — clears cache", async () => {
    const res = await axios.delete(`${BASE_URL}/api/analyze/cache`, {
      headers: { "X-GitTrace-Key": SECRET },
    });
    assert(res.status === 200, "Status 200");
    assert(res.data.success === true, "success is true");

    // Verify cache is empty
    const health = await axios.get(`${BASE_URL}/api/analyze/health`);
    assert(health.data.cache.size === 0, "Cache size is 0 after clear");
  });

  // ── Test 7: Non-existent repo ────────────────────────────────────
  await runTest("POST /api/analyze — fake repo returns error", async () => {
    try {
      await axios.post(
        `${BASE_URL}/api/analyze`,
        { owner: "this-does-not-exist-xyz999", repo: "fake-repo-abc123" },
        { headers: { "X-GitTrace-Key": SECRET }, timeout: 15000 },
      );
      assert(false, "Should have thrown");
    } catch (err) {
      assert(
        err.response?.status === 404 || err.response?.status === 500,
        "Returns error for fake repo",
      );
      assert(err.response?.data?.success === false, "success is false");
    }
  });

  // ── Summary ──────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed  |  ${failed} failed`);
  console.log("══════════════════════════════════════════════\n");

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\n❌ Test runner crashed:", err.message);
  process.exit(1);
});
