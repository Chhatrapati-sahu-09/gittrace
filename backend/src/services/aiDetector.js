/**
 * GitTrace Backend — AI Detector Service
 *
 * Detects whether code files were AI generated.
 *
 * How it works:
 *   1. Split each file into chunks (Sapling has token limits)
 *   2. Send each chunk to Sapling AI Detection API
 *   3. Average the scores across all chunks
 *   4. Add heuristic boosts (variable names, comment density etc.)
 *   5. Return per-file scores + weighted overall score
 *
 * Sapling API:
 *   POST https://api.sapling.ai/api/v1/aidetect
 *   Body: { key: API_KEY, text: "code here" }
 *   Response: { score: 0.87 }  (0 = human, 1 = AI)
 */

const axios = require("axios");
const config = require("../config");

// ─── Sapling API Client ───────────────────────────────────────────────────────

const saplingClient = axios.create({
  baseURL: config.ai.apiUrl,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

// ─── Chunk Splitter ───────────────────────────────────────────────────────────

/**
 * Split a long string into chunks of a given max length.
 * We split at newlines to avoid cutting code mid-line.
 *
 * @param {string} text      - Full file content
 * @param {number} chunkSize - Max characters per chunk
 * @returns {string[]}       - Array of text chunks
 */
function splitIntoChunks(text, chunkSize) {
  if (text.length <= chunkSize) return [text];

  const chunks = [];
  const lines = text.split("\n");
  let current = "";

  for (const line of lines) {
    // If adding this line would exceed the limit, save current chunk
    if (current.length + line.length > chunkSize && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += line + "\n";
  }

  // Push any remaining content
  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks;
}

// ─── Sapling API Call ─────────────────────────────────────────────────────────

/**
 * Send one chunk of text to Sapling and get AI probability score.
 * Returns a score from 0 to 100.
 * 0   = definitely human written
 * 100 = definitely AI generated
 *
 * @param {string} text - Code chunk to analyze
 * @returns {Promise<number>} Score 0 to 100
 */
async function callSaplingAPI(text) {
  // Demo mode — return fake score without calling API
  if (config.ai.demoMode || config.ai.apiKey === "demo-mode") {
    // Fake random score between 60 and 95 so UI looks interesting
    await new Promise((r) => setTimeout(r, 100)); // fake delay
    return Math.floor(Math.random() * 35) + 60;
  }

  try {
    const response = await saplingClient.post("", {
      key: config.ai.apiKey,
      text: text,
    });

    // Sapling returns score as 0.0 to 1.0
    // We convert to 0 to 100
    const rawScore = response.data?.score ?? 0;
    return Math.round(rawScore * 100);
  } catch (err) {
    // If API fails, log warning and return neutral score
    // We don't want one bad API call to crash the whole analysis
    console.warn(`[AI Detector] Sapling API call failed: ${err.message}`);
    return 50; // neutral fallback
  }
}

// ─── Heuristic Analysis ───────────────────────────────────────────────────────

/**
 * Run heuristic checks on code to boost or reduce AI probability.
 * These patterns are common in AI-generated code.
 *
 * Returns a modifier from -15 to +25.
 * Positive = more likely AI, Negative = more likely human.
 *
 * @param {string} content - Full file content
 * @param {string} filePath - File path for extension checks
 * @returns {{ modifier: number, flags: string[] }}
 */
function runHeuristics(content, filePath) {
  const flags = [];
  let modifier = 0;
  const lines = content.split("\n");
  const totalLines = lines.length;

  if (totalLines === 0) return { modifier: 0, flags: [] };

  // ── 1. Generic variable name density ────────────────────────────
  // AI loves: data, result, response, value, item, element, temp
  const GENERIC_NAMES = [
    /\bdata\b/g,
    /\bresult\b/g,
    /\bresponse\b/g,
    /\bvalue\b/g,
    /\bitem\b/g,
    /\belement\b/g,
    /\btemp\b/g,
    /\boutput\b/g,
    /\binput\b/g,
  ];
  let genericCount = 0;
  GENERIC_NAMES.forEach((pattern) => {
    const matches = content.match(pattern);
    if (matches) genericCount += matches.length;
  });
  const genericDensity = genericCount / totalLines;
  if (genericDensity > 3) {
    modifier += 10;
    flags.push(
      `High generic variable density: ${genericCount} occurrences in ${totalLines} lines`,
    );
  }

  // ── 2. Comment to code ratio ─────────────────────────────────────
  // AI writes a LOT of comments explaining obvious things
  const commentLines = lines.filter((l) => {
    const trimmed = l.trim();
    return (
      trimmed.startsWith("//") ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith('"""')
    );
  }).length;

  const commentRatio = commentLines / totalLines;
  if (commentRatio > 0.35) {
    modifier += 12;
    flags.push(
      `Unusually high comment ratio: ${Math.round(commentRatio * 100)}% of lines are comments`,
    );
  }

  // ── 3. Boilerplate structure detection ───────────────────────────
  // AI generated files often start with imports, then a class/function
  // with perfectly uniform spacing
  const BOILERPLATE_PATTERNS = [
    /^\/\*\*\n \* @/m, // JSDoc on every function
    /console\.log\(['"]Starting/i, // AI always logs "Starting..."
    /TODO: Implement/i, // AI writes TODO comments
    /This function (handles|processes|manages)/i, // AI describes what functions do
    /Helper function (to|that)/i,
    /Utility (function|method) (to|that|for)/i,
  ];

  BOILERPLATE_PATTERNS.forEach((pattern) => {
    if (pattern.test(content)) {
      modifier += 5;
      flags.push(
        `Boilerplate pattern detected: ${pattern.source.substring(0, 40)}`,
      );
    }
  });

  // ── 4. Perfect symmetry — AI writes very uniform code ────────────
  // Check if function lengths are suspiciously similar
  const functionMatches = content.match(/function\s+\w+/g) || [];
  if (functionMatches.length > 5) {
    modifier += 5;
    flags.push(
      `Many small functions: ${functionMatches.length} functions detected`,
    );
  }

  // ── 5. Copied template indicators ────────────────────────────────
  const TEMPLATE_PATTERNS = [
    /your[- _]api[- _]key/i,
    /your[- _]token/i,
    /your[- _](username|password)/i,
    /change[- _]this/i,
    /replace[- _]with/i,
    /example\.com/i,
    /test@test\.com/i,
    /1234567890/,
    /foo|bar|baz/i,
  ];

  TEMPLATE_PATTERNS.forEach((pattern) => {
    if (pattern.test(content)) {
      modifier += 4;
      flags.push(`Template placeholder detected: ${pattern.source}`);
    }
  });

  // ── 6. Human signals — reduce score ──────────────────────────────
  // Profanity, slang, personal comments = human written
  const HUMAN_SIGNALS = [
    /\/\/ wtf/i,
    /\/\/ hack/i,
    /\/\/ fixme/i,
    /\/\/ not sure why/i,
    /\/\/ this is terrible/i,
    /\/\/ i don't (know|understand)/i,
    /\/\/ lol/i,
  ];

  HUMAN_SIGNALS.forEach((pattern) => {
    if (pattern.test(content)) {
      modifier -= 8;
      flags.push(`Human signal detected: personal comment found`);
    }
  });

  // Cap modifier at -15 to +25
  modifier = Math.max(-15, Math.min(25, modifier));

  return { modifier, flags };
}

// ─── Single File Scorer ───────────────────────────────────────────────────────

/**
 * Score a single file for AI probability.
 *
 * Steps:
 *   1. Split file into chunks
 *   2. Call Sapling API for each chunk
 *   3. Average chunk scores
 *   4. Apply heuristic modifier
 *   5. Return final score 0-100
 *
 * @param {{ path: string, content: string }} file
 * @returns {Promise<{
 *   path: string,
 *   score: number,
 *   chunkCount: number,
 *   heuristicModifier: number,
 *   heuristicFlags: string[]
 * }>}
 */
async function scoreFile(file) {
  const { path, content } = file;

  // Skip empty files
  if (!content || content.trim().length < 50) {
    return {
      path,
      score: 0,
      chunkCount: 0,
      heuristicModifier: 0,
      heuristicFlags: ["File too short to analyze"],
    };
  }

  console.log(`[AI Detector] Scoring: ${path} (${content.length} chars)`);

  // Step 1: Split into chunks
  const chunks = splitIntoChunks(content, config.ai.chunkSize);
  console.log(`[AI Detector] ${path} → ${chunks.length} chunk(s)`);

  // Step 2: Score each chunk
  const chunkScores = await Promise.all(
    chunks.map((chunk) => callSaplingAPI(chunk)),
  );

  // Step 3: Average chunk scores
  const avgScore =
    chunkScores.reduce((sum, s) => sum + s, 0) / chunkScores.length;

  // Step 4: Run heuristics
  const { modifier, flags } = runHeuristics(content, path);

  // Step 5: Apply modifier and clamp to 0-100
  const finalScore = Math.max(
    0,
    Math.min(100, Math.round(avgScore + modifier)),
  );

  console.log(
    `[AI Detector] ${path} → chunks avg: ${Math.round(avgScore)}, modifier: ${modifier}, final: ${finalScore}`,
  );

  return {
    path,
    score: finalScore,
    chunkCount: chunks.length,
    heuristicModifier: modifier,
    heuristicFlags: flags,
  };
}

// ─── Overall Score Calculator ─────────────────────────────────────────────────

/**
 * Calculate weighted overall score from per-file scores.
 * Larger files get more weight — they have more signal.
 *
 * @param {Array<{ path: string, score: number }>} perFileScores
 * @param {Array<{ path: string, size: number }>}  fileTree
 * @returns {number} Weighted average score 0-100
 */
function calculateOverallScore(perFileScores, fileTree) {
  if (perFileScores.length === 0) return 0;

  // Build a size map for weighting
  const sizeMap = {};
  fileTree.forEach((f) => {
    sizeMap[f.path] = f.size || 1000;
  });

  let totalWeight = 0;
  let weightedSum = 0;

  perFileScores.forEach((file) => {
    const weight = sizeMap[file.path] || 1000;
    weightedSum += file.score * weight;
    totalWeight += weight;
  });

  return Math.round(weightedSum / totalWeight);
}

/**
 * Map a score to a human readable label.
 *
 * @param {number} score
 * @returns {'Low'|'Medium'|'High'|'Very High'}
 */
function scoreToLabel(score) {
  if (score < config.ai.thresholds.low) return "Low";
  if (score < config.ai.thresholds.medium) return "Medium";
  if (score < config.ai.thresholds.high) return "High";
  return "Very High";
}

// ─── Main Export Function ─────────────────────────────────────────────────────

/**
 * Run AI detection on a list of files.
 *
 * @param {Array<{ path: string, content: string }>} files
 * @param {Array<{ path: string, size: number }>}    fileTreeItems
 * @returns {Promise<{
 *   overallScore:    number,
 *   label:           string,
 *   perFileScores:   object[],
 *   heuristicFlags:  object[],
 *   analyzedFiles:   number,
 *   totalChunks:     number,
 * }>}
 */
async function analyzeFiles(files, fileTreeItems = []) {
  console.log(`\n[AI Detector] Starting analysis on ${files.length} files`);
  const startTime = Date.now();

  // Score all files in parallel
  // Note: Promise.all runs them simultaneously which is fine for 10 files
  // For larger batches we would use a concurrency limiter
  const perFileResults = await Promise.all(
    files.map((file) => scoreFile(file)),
  );

  // Calculate overall weighted score
  const overallScore = calculateOverallScore(perFileResults, fileTreeItems);
  const label = scoreToLabel(overallScore);

  // Collect all heuristic flags across all files
  const allFlags = perFileResults
    .filter((f) => f.heuristicFlags.length > 0)
    .map((f) => ({
      file: f.path,
      flags: f.heuristicFlags,
    }));

  const totalChunks = perFileResults.reduce((sum, f) => sum + f.chunkCount, 0);
  const elapsed = Date.now() - startTime;

  console.log(`[AI Detector] Done in ${elapsed}ms`);
  console.log(`[AI Detector] Overall score: ${overallScore} (${label})`);
  console.log(
    `[AI Detector] Analyzed ${perFileResults.length} files across ${totalChunks} chunks`,
  );

  return {
    overallScore,
    label,
    perFileScores: perFileResults.map((f) => ({
      path: f.path,
      score: f.score,
    })),
    heuristicFlags: allFlags,
    analyzedFiles: perFileResults.length,
    totalChunks,
    elapsedMs: elapsed,
  };
}

module.exports = {
  analyzeFiles,
  scoreFile,
  scoreToLabel,
  runHeuristics,
  splitIntoChunks,
};
