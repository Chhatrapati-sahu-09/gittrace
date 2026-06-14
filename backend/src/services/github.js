/**
 * GitTrace Backend — GitHub Service
 *
 * All GitHub REST API calls live here.
 * Nothing else in the codebase calls GitHub directly.
 *
 * Responsibilities:
 *   - Fetch repository metadata
 *   - Fetch file tree (all file paths recursively)
 *   - Fetch content of selected files
 *   - Fetch commit history
 *   - Handle rate limiting and errors gracefully
 */

const axios = require("axios");
const config = require("../config");

// ─── Axios Instance ───────────────────────────────────────────────────────────

/**
 * Pre-configured axios client for GitHub API.
 * All requests automatically get:
 *   - Base URL: https://api.github.com
 *   - Authorization header with our token
 *   - Accept header for GitHub v3 JSON
 *   - 10 second timeout
 */
const githubClient = axios.create({
  baseURL: config.github.apiBase,
  timeout: 10000,
  headers: {
    Authorization: `Bearer ${config.github.token}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "GitTrace-Extension/0.1.0",
  },
});

// ─── Rate Limit Guard ─────────────────────────────────────────────────────────

/**
 * Check GitHub rate limit headers from any response.
 * GitHub allows 5000 requests/hour with a token.
 * We warn when under 100 remaining and block when under 10.
 *
 * @param {object} headers - Response headers from GitHub
 * @throws {Error} If rate limit is critically low
 */
function checkRateLimit(headers) {
  const remaining = parseInt(headers["x-ratelimit-remaining"] || "9999", 10);
  const resetTime = parseInt(headers["x-ratelimit-reset"] || "0", 10);
  const resetDate = new Date(resetTime * 1000).toLocaleTimeString();

  if (remaining < 10) {
    throw new Error(
      `GitHub API rate limit critically low: ${remaining} requests remaining. ` +
        `Resets at ${resetDate}.`,
    );
  }

  if (remaining < 100) {
    console.warn(
      `[GitHub] Rate limit warning: ${remaining} requests remaining. Resets at ${resetDate}.`,
    );
  }
}

// ─── Error Handler ────────────────────────────────────────────────────────────

/**
 * Convert GitHub API errors into friendly messages.
 *
 * @param {Error} error - Axios error
 * @param {string} context - What we were doing when the error happened
 * @throws {Error} Always throws with a clear message
 */
function handleGitHubError(error, context) {
  if (error.response) {
    const status = error.response.status;
    const message = error.response.data?.message || "Unknown GitHub API error";

    const errorMap = {
      401: `GitHub authentication failed. Check your GITHUB_TOKEN in .env. (${context})`,
      403: `GitHub access forbidden. Token may lack permissions. (${context})`,
      404: `Repository not found or is private. (${context})`,
      422: `GitHub API validation failed: ${message} (${context})`,
      429: `GitHub rate limit exceeded. Wait before retrying. (${context})`,
    };

    throw new Error(
      errorMap[status] || `GitHub API error ${status}: ${message} (${context})`,
    );
  }

  if (error.code === "ECONNABORTED") {
    throw new Error(`GitHub API request timed out after 10s. (${context})`);
  }

  throw new Error(`GitHub API network error: ${error.message} (${context})`);
}

// ─── Public API Functions ─────────────────────────────────────────────────────

/**
 * Fetch basic repository metadata.
 * Returns things like: description, stars, language, size, license, topics.
 *
 * @param {string} owner - GitHub username or org name
 * @param {string} repo  - Repository name
 * @returns {Promise<object>} Repository metadata
 */
async function getRepoMeta(owner, repo) {
  console.log(`[GitHub] Fetching repo metadata: ${owner}/${repo}`);

  try {
    const response = await githubClient.get(`/repos/${owner}/${repo}`);
    checkRateLimit(response.headers);

    const data = response.data;

    // Return only the fields we actually need
    // (GitHub returns 100+ fields — we trim it down)
    return {
      fullName: data.full_name,
      description: data.description,
      defaultBranch: data.default_branch,
      language: data.language,
      stars: data.stargazers_count,
      forks: data.forks_count,
      size: data.size, // in KB
      createdAt: data.created_at,
      pushedAt: data.pushed_at,
      isPrivate: data.private,
      isFork: data.fork,
      topics: data.topics || [],
      license: data.license
        ? {
            key: data.license.key,
            name: data.license.name,
            spdxId: data.license.spdx_id,
          }
        : null,
      hasPackageJson: false, // filled in later by getFileTree
      hasRequirements: false,
    };
  } catch (error) {
    handleGitHubError(error, `getRepoMeta(${owner}/${repo})`);
  }
}

/**
 * Fetch the complete file tree of a repository.
 * Uses the Git Trees API with recursive=1 to get ALL files in one request.
 * This is much more efficient than walking directories one by one.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch - Usually 'main' or 'master'
 * @returns {Promise<object>} { allFiles, sourceFiles, configFiles, truncated }
 */
async function getFileTree(owner, repo, branch = "main") {
  console.log(`[GitHub] Fetching file tree: ${owner}/${repo} @ ${branch}`);

  try {
    const response = await githubClient.get(
      `/repos/${owner}/${repo}/git/trees/${branch}`,
      { params: { recursive: "1" } },
    );
    checkRateLimit(response.headers);

    const tree = response.data.tree || [];
    const truncated = response.data.truncated || false; // true if repo has >100k files

    if (truncated) {
      console.warn(
        `[GitHub] File tree truncated for ${owner}/${repo} — very large repo`,
      );
    }

    // Filter to only files (not directories)
    const allFiles = tree.filter((item) => item.type === "blob");

    // Source files — code we want to analyze for AI patterns
    const SOURCE_EXTENSIONS = new Set([
      ".js",
      ".jsx",
      ".ts",
      ".tsx", // JavaScript / TypeScript
      ".py",
      ".rb",
      ".php",
      ".java", // Other languages
      ".go",
      ".rs",
      ".cs",
      ".cpp",
      ".c", // Systems languages
      ".vue",
      ".svelte", // Frontend frameworks
      ".html",
      ".css",
      ".scss", // Web
    ]);

    const sourceFiles = allFiles.filter((file) => {
      const ext = "." + file.path.split(".").pop().toLowerCase();
      // Skip files that are too large
      if (file.size > config.github.maxFileSizeBytes) return false;
      // Skip obvious generated/vendor files
      if (file.path.includes("node_modules")) return false;
      if (file.path.includes("vendor/")) return false;
      if (file.path.includes(".min.")) return false;
      if (file.path.includes("dist/")) return false;
      return SOURCE_EXTENSIONS.has(ext);
    });

    // Config files — dependency and platform files
    const CONFIG_FILENAMES = new Set([
      "package.json",
      "requirements.txt",
      "Pipfile",
      "Gemfile",
      "go.mod",
      "Cargo.toml",
      "pom.xml",
      "build.gradle",
      ".nvmrc",
      ".python-version",
      "Dockerfile",
      "docker-compose.yml",
      ".tool-versions",
    ]);

    const configFiles = allFiles.filter((file) => {
      const filename = file.path.split("/").pop();
      return CONFIG_FILENAMES.has(filename);
    });

    console.log(
      `[GitHub] File tree: ${allFiles.length} total, ${sourceFiles.length} source, ${configFiles.length} config files`,
    );

    return {
      allFiles,
      sourceFiles,
      configFiles,
      truncated,
      stats: {
        total: allFiles.length,
        source: sourceFiles.length,
        config: configFiles.length,
      },
    };
  } catch (error) {
    // Some repos use 'master' as default branch — retry with master
    if (
      error.message.includes("not found") ||
      (error.message.includes("404") && branch === "main")
    ) {
      console.log(`[GitHub] Branch 'main' not found, retrying with 'master'`);
      return getFileTree(owner, repo, "master");
    }
    handleGitHubError(error, `getFileTree(${owner}/${repo}@${branch})`);
  }
}

/**
 * Fetch the raw text content of a single file.
 * GitHub returns file content as base64 encoded — we decode it here.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} filePath - Path relative to repo root e.g. "src/index.js"
 * @returns {Promise<{ path: string, content: string, size: number } | null>}
 */
async function getFileContent(owner, repo, filePath) {
  try {
    const response = await githubClient.get(
      `/repos/${owner}/${repo}/contents/${filePath}`,
    );
    checkRateLimit(response.headers);

    const data = response.data;

    // GitHub returns content as base64 with newlines — decode it
    const content = Buffer.from(data.content, "base64").toString("utf-8");

    return {
      path: filePath,
      content: content,
      size: data.size,
      sha: data.sha,
      encoding: data.encoding,
    };
  } catch (error) {
    // Non-fatal: if one file fails, we skip it and continue with others
    console.warn(
      `[GitHub] Could not fetch file: ${filePath} — ${error.message}`,
    );
    return null;
  }
}

/**
 * Fetch content of multiple files in parallel.
 * Limits concurrency to avoid hammering the GitHub API.
 *
 * @param {string}   owner
 * @param {string}   repo
 * @param {object[]} files     - Array of file tree items { path, size }
 * @param {number}   maxFiles  - Max files to fetch (default from config)
 * @returns {Promise<object[]>} Array of { path, content, size } (nulls filtered out)
 */
async function getMultipleFileContents(owner, repo, files, maxFiles) {
  const limit = maxFiles || config.github.maxFilesToFetch;

  // Sort by size descending — larger files are more likely to have AI patterns
  // Then take the top N files
  const selectedFiles = [...files]
    .sort((a, b) => (b.size || 0) - (a.size || 0))
    .slice(0, limit);

  console.log(
    `[GitHub] Fetching content for ${selectedFiles.length} files (from ${files.length} source files)`,
  );

  // Fetch all in parallel — GitHub can handle this with a token
  const results = await Promise.all(
    selectedFiles.map((file) => getFileContent(owner, repo, file.path)),
  );

  // Filter out any files that failed to load
  const successful = results.filter(Boolean);
  console.log(
    `[GitHub] Successfully fetched ${successful.length}/${selectedFiles.length} files`,
  );

  return successful;
}

/**
 * Fetch recent commit history.
 * Used by Day 4's commit velocity checker.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {number} perPage - Number of commits to fetch (max 100)
 * @returns {Promise<object[]>} Array of commit objects
 */
async function getCommits(owner, repo, perPage = 50) {
  console.log(`[GitHub] Fetching commits: ${owner}/${repo} (last ${perPage})`);

  try {
    const response = await githubClient.get(`/repos/${owner}/${repo}/commits`, {
      params: { per_page: perPage },
    });
    checkRateLimit(response.headers);

    return response.data.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author.name,
      date: commit.commit.author.date,
      additions: commit.stats?.additions || 0,
      deletions: commit.stats?.deletions || 0,
      url: commit.html_url,
    }));
  } catch (error) {
    // Non-fatal — commits are a nice-to-have, not essential
    console.warn(`[GitHub] Could not fetch commits: ${error.message}`);
    return [];
  }
}

/**
 * Fetch the repo's license file content directly.
 * More reliable than the license field in repo metadata.
 *
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<{ spdxId: string, name: string, content: string } | null>}
 */
async function getLicense(owner, repo) {
  console.log(`[GitHub] Fetching license: ${owner}/${repo}`);

  try {
    const response = await githubClient.get(`/repos/${owner}/${repo}/license`);
    checkRateLimit(response.headers);

    const data = response.data;
    const content = Buffer.from(data.content, "base64").toString("utf-8");

    return {
      spdxId: data.license?.spdx_id || "NOASSERTION",
      name: data.license?.name || "Unknown",
      content: content.substring(0, 500), // First 500 chars is enough
    };
  } catch (error) {
    console.warn(`[GitHub] No license file found: ${error.message}`);
    return null;
  }
}

/**
 * Fetch the list of files changed in a Pull Request.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} prNumber
 * @returns {Promise<Array<{ filename: string, status: string, additions: number, deletions: number }>>}
 */
async function getPRFiles(owner, repo, prNumber) {
  console.log(`[GitHub] Fetching PR files: ${owner}/${repo}#${prNumber}`);

  try {
    const response = await githubClient.get(
      `/repos/${owner}/${repo}/pulls/${prNumber}/files`,
      { params: { per_page: 100 } }
    );
    checkRateLimit(response.headers);

    return response.data.map(file => ({
      filename:  file.filename,
      status:    file.status,   // added, modified, removed, renamed
      additions: file.additions,
      deletions: file.deletions,
      changes:   file.changes,
    }));

  } catch (error) {
    handleGitHubError(error, `getPRFiles(${owner}/${repo}#${prNumber})`);
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getRepoMeta,
  getFileTree,
  getFileContent,
  getMultipleFileContents,
  getCommits,
  getLicense,
  getPRFiles,       // NEW
};
