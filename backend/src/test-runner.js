/**
 * GitTrace Backend — Manual Test Runner
 *
 * Run with: npm test
 * Tests all endpoints and GitHub service functions.
 * No external test framework needed — pure Node.js.
 */

const axios = require("axios");

const BASE_URL = "http://localhost:3001";
const SECRET = "dev-secret-day3";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

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
    failed++;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n══════════════════════════════════════");
  console.log("  GitTrace Backend — Test Runner");
  console.log("══════════════════════════════════════\n");

  // ── Test 1: Root endpoint ────────────────────────────────────────
  await runTest("GET / — root health check", async () => {
    const res = await axios.get(`${BASE_URL}/`);
    assert(res.status === 200, "Status is 200");
    assert(res.data.name === "GitTrace API", "Name is GitTrace API");
    assert(res.data.status === "running", "Status is running");
    assert(typeof res.data.version === "string", "Has version");
  });

  // ── Test 2: Health endpoint ──────────────────────────────────────
  await runTest("GET /health — server health", async () => {
    const res = await axios.get(`${BASE_URL}/health`);
    assert(res.status === 200, "Status is 200");
    assert(res.data.success === true, "success is true");
    assert(res.data.status === "healthy", "Status is healthy");
    assert(typeof res.data.uptime === "number", "Has uptime in seconds");
    assert(typeof res.data.memory === "number", "Has memory usage");
  });

  // ── Test 3: Analyze route health ─────────────────────────────────
  await runTest("GET /api/analyze/health — route health", async () => {
    const res = await axios.get(`${BASE_URL}/api/analyze/health`);
    assert(res.status === 200, "Status is 200");
    assert(res.data.success === true, "success is true");
    assert(res.data.route === "/api/analyze", "Correct route name");
  });

  // ── Test 4: 404 for unknown routes ───────────────────────────────
  await runTest("GET /unknown — 404 handler", async () => {
    try {
      await axios.get(`${BASE_URL}/unknown-route-xyz`);
      assert(false, "Should have thrown 404");
    } catch (err) {
      assert(err.response?.status === 404, "Returns 404");
      assert(err.response?.data?.success === false, "success is false");
    }
  });

  // ── Test 5: Missing body fields ──────────────────────────────────
  await runTest(
    "POST /api/analyze — missing owner/repo returns 400",
    async () => {
      try {
        await axios.post(`${BASE_URL}/api/analyze`, {});
      } catch (err) {
        assert(err.response?.status === 400, "Returns 400");
        assert(err.response?.data?.success === false, "success is false");
        assert(
          typeof err.response?.data?.error === "string",
          "Has error message",
        );
      }
    },
  );

  // ── Test 6: Invalid characters in owner ─────────────────────────
  await runTest(
    "POST /api/analyze — invalid owner name returns 400",
    async () => {
      try {
        await axios.post(`${BASE_URL}/api/analyze`, {
          owner: "bad name!",
          repo: "some-repo",
        });
      } catch (err) {
        assert(err.response?.status === 400, "Returns 400");
      }
    },
  );

  // ── Test 7: Real repo analysis ───────────────────────────────────
  await runTest("POST /api/analyze — real repo (facebook/react)", async () => {
    console.log("  ⏳ This may take 3-8 seconds (fetching from GitHub)...");

    const res = await axios.post(
      `${BASE_URL}/api/analyze`,
      { owner: "facebook", repo: "react" },
      { headers: { "X-GitTrace-Key": SECRET }, timeout: 30000 },
    );

    assert(res.status === 200, "Status is 200");
    assert(res.data.success === true, "success is true");
    assert(res.data.meta.owner === "facebook", "owner is facebook");
    assert(res.data.meta.repo === "react", "repo is react");
    assert(typeof res.data.meta.stars === "number", "Has star count");
    assert(typeof res.data.meta.language === "string", "Has language");
    assert(res.data.fileTree.stats.total > 0, "Has files in tree");
    assert(res.data.fileTree.stats.source > 0, "Has source files");
    assert(Array.isArray(res.data.sampleFiles), "sampleFiles is array");
    assert(res.data.sampleFiles.length > 0, "Has file contents");
    assert(Array.isArray(res.data.commits.recent), "commits.recent is array");
    assert(typeof res.data.meta.elapsedMs === "number", "Has elapsed time");
    console.log(
      `  ℹ️  Stars: ${res.data.meta.stars}, Language: ${res.data.meta.language}`,
    );
    console.log(
      `  ℹ️  Files: ${res.data.fileTree.stats.source} source, ${res.data.fileTree.stats.config} config`,
    );
    console.log(`  ℹ️  Sample files fetched: ${res.data.sampleFiles.length}`);
    console.log(`  ℹ️  Commits fetched: ${res.data.commits.total}`);
    console.log(`  ℹ️  License: ${res.data.license?.spdxId || "none"}`);
    console.log(`  ℹ️  Elapsed: ${res.data.meta.elapsedMs}ms`);
  });

  // ── Test 8: Non-existent repo ────────────────────────────────────
  await runTest("POST /api/analyze — fake repo returns error", async () => {
    try {
      await axios.post(
        `${BASE_URL}/api/analyze`,
        { owner: "this-user-does-not-exist-xyz", repo: "fake-repo-abc" },
        { headers: { "X-GitTrace-Key": SECRET }, timeout: 15000 },
      );
      assert(false, "Should have thrown an error");
    } catch (err) {
      assert(
        err.response?.status === 404 || err.response?.status === 500,
        "Returns 404 or 500 for non-existent repo",
      );
      assert(err.response?.data?.success === false, "success is false");
    }
  });

  // ── Summary ──────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("══════════════════════════════════════\n");

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\n❌ Test runner crashed:", err.message);
  process.exit(1);
});
