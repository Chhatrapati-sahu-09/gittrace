/**
 * GitTrace — Connection Test Helper
 *
 * Paste this into the Chrome DevTools console on any GitHub page
 * to manually test the extension ↔ backend connection.
 *
 * Usage:
 *   1. Open DevTools on any github.com page
 *   2. Paste this entire file content into the Console
 *   3. Run: await testGitTrace()
 */

async function testGitTrace() {
  console.log("═══════════════════════════════════");
  console.log("  GitTrace Connection Test");
  console.log("═══════════════════════════════════\n");

  // Test 1: Can we reach background?
  console.log("Test 1: Background service worker...");
  await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "PING" }, (r) => {
      if (chrome.runtime.lastError) {
        console.log(
          "  ❌ Background unreachable:",
          chrome.runtime.lastError.message,
        );
      } else if (r?.data?.pong) {
        console.log("  ✅ Background alive. Version:", r.data.version);
      } else {
        console.log("  ❌ Unexpected response:", r);
      }
      resolve();
    });
  });

  // Test 2: Config in storage
  console.log("\nTest 2: Extension config in storage...");
  await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_CONFIG" }, (r) => {
      if (r?.success) {
        console.log("  ✅ Config loaded:");
        console.log("     version:", r.data.gittrace_version);
        console.log("     backend:", r.data.gittrace_backend_url);
        console.log("     enabled:", r.data.gittrace_enabled);
      } else {
        console.log("  ❌ Config failed:", r?.error);
      }
      resolve();
    });
  });

  // Test 3: Real repo analysis
  console.log("\nTest 3: Real repo analysis (facebook/react)...");
  console.log("  ⏳ Calling backend — may take 10-20s...");

  const start = Date.now();
  await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "ANALYZE_REPO", payload: { owner: "facebook", repo: "react" } },
      (r) => {
        const elapsed = Date.now() - start;
        if (r?.success) {
          const ai = r.data.aiAnalysis;
          console.log("  ✅ Analysis complete in", elapsed + "ms");
          console.log(
            "     AI Score:  ",
            ai.overallScore,
            "(" + ai.label + ")",
          );
          console.log("     Files:     ", ai.analyzedFiles, "analyzed");
          console.log("     From cache:", r.data.fromCache);
        } else {
          console.log("  ❌ Analysis failed:", r?.error);
        }
        resolve();
      },
    );
  });

  // Test 4: Cache hit
  console.log("\nTest 4: Second request — should hit cache...");
  const start2 = Date.now();
  await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "ANALYZE_REPO", payload: { owner: "facebook", repo: "react" } },
      (r) => {
        const elapsed = Date.now() - start2;
        if (r?.success && r.data.fromCache) {
          console.log("  ✅ Cache hit! Response in", elapsed + "ms");
        } else if (r?.success) {
          console.log(
            "  ⚠️  Got result but fromCache was false. elapsed:",
            elapsed + "ms",
          );
        } else {
          console.log("  ❌ Failed:", r?.error);
        }
        resolve();
      },
    );
  });

  console.log("\n═══════════════════════════════════");
  console.log("  All tests complete.");
  console.log("═══════════════════════════════════");
}

// Auto-run
testGitTrace();
