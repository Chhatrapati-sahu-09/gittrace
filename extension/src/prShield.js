/**
 * GitTrace — PR Inline Shield Module
 *
 * Detects when the user is on a GitHub Pull Request diff page
 * and injects AI probability warnings directly onto code lines.
 *
 * How it works:
 *   1. Detect PR diff page via URL pattern
 *   2. Extract which files are changed in the PR
 *   3. Match those files against per-file AI scores from analysis
 *   4. Highlight added lines (+) in high-scoring files
 *   5. Add a PR summary bar above the file list
 *   6. Watch for lazy-loaded diff files (MutationObserver)
 *
 * GitHub PR diff page URL patterns:
 *   https://github.com/owner/repo/pull/123/files
 *   https://github.com/owner/repo/pull/123/files#diff-abc123
 *
 * What we highlight:
 *   - Files with AI score > 70% get a header warning banner
 *   - Individual added lines get a subtle left border colour
 *   - Entire diff gets a summary bar at the top
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const PR_SHIELD_ATTR      = 'data-gt-pr-shield';
const PR_BANNER_ID        = 'gt-pr-summary-bar';
const PR_FILE_BANNER_ATTR = 'data-gt-pr-file-banner';
const PR_LINE_ATTR        = 'data-gt-pr-line';

// Files with AI score above this get highlighted
const HIGH_SCORE_THRESHOLD  = 70;
const MEDIUM_SCORE_THRESHOLD = 40;

// ─── URL Detection ────────────────────────────────────────────────────────────

/**
 * Check if the current page is a GitHub PR files diff page.
 *
 * @returns {boolean}
 */
export function isPRFilesPage() {
  return /^\/[^/]+\/[^/]+\/pull\/\d+\/files/.test(
    window.location.pathname
  );
}

/**
 * Extract PR info from the current URL.
 *
 * @returns {{ owner: string, repo: string, prNumber: string } | null}
 */
export function parsePRFromURL() {
  const match = window.location.pathname.match(
    /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/files/
  );
  if (!match) return null;

  return {
    owner:    match[1],
    repo:     match[2],
    prNumber: match[3],
  };
}

// ─── Colour Helpers ───────────────────────────────────────────────────────────

/**
 * Get colour values for a given AI score.
 *
 * @param {number} score
 * @returns {{ border: string, bg: string, text: string, label: string }}
 */
function scoreToStyle(score) {
  if (score >= 80) {
    return {
      border: '#f85149',
      bg:     'rgba(248, 81, 73, 0.06)',
      text:   '#f85149',
      label:  'Very High AI',
    };
  }
  if (score >= 70) {
    return {
      border: '#f0883e',
      bg:     'rgba(240, 136, 62, 0.06)',
      text:   '#f0883e',
      label:  'High AI',
    };
  }
  if (score >= 40) {
    return {
      border: '#d29922',
      bg:     'rgba(210, 153, 34, 0.05)',
      text:   '#d29922',
      label:  'Medium AI',
    };
  }
  return {
    border: '#3fb950',
    bg:     'transparent',
    text:   '#3fb950',
    label:  'Low AI',
  };
}

// ─── PR Summary Bar ───────────────────────────────────────────────────────────

/**
 * Inject a summary bar at the top of the PR files page.
 * Shows: total files flagged, highest risk file, overall repo score.
 *
 * @param {object[]} perFileScores - Array of { path, score }
 * @param {number}   overallScore  - Repo-wide AI score
 */
export function injectPRSummaryBar(perFileScores, overallScore) {
  // Remove existing bar
  const existing = document.getElementById(PR_BANNER_ID);
  if (existing) existing.remove();

  // Find insertion point — above the PR file list
  const insertionPoint = document.querySelector(
    '#files, ' +
    '.js-diff-progressive-container, ' +
    '.diff-view, ' +
    '[data-target="diff-layout.diffContainer"]'
  );

  if (!insertionPoint) {
    console.warn('[GitTrace PR] Could not find PR file list container');
    return;
  }

  // Count flagged files
  const highRiskFiles   = perFileScores.filter(f => f.score >= HIGH_SCORE_THRESHOLD);
  const mediumRiskFiles = perFileScores.filter(
    f => f.score >= MEDIUM_SCORE_THRESHOLD && f.score < HIGH_SCORE_THRESHOLD
  );

  // Overall colour
  const overallStyle = scoreToStyle(overallScore || 0);

  // Build bar HTML
  const bar = document.createElement('div');
  bar.id = PR_BANNER_ID;

  Object.assign(bar.style, {
    display:       'flex',
    alignItems:    'center',
    justifyContent:'space-between',
    flexWrap:      'wrap',
    gap:           '8px',
    padding:       '10px 16px',
    margin:        '0 0 12px 0',
    background:    '#161b22',
    border:        '1px solid #30363d',
    borderLeft:    `4px solid ${overallStyle.border}`,
    borderRadius:  '6px',
    fontFamily:    '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize:      '13px',
    zIndex:        '100',
  });

  bar.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="
        font-weight:700;
        color:${overallStyle.text};
        display:flex;
        align-items:center;
        gap:6px;
      ">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="${overallStyle.text}">
          <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm1 11H7V9h2v2zm0-4H7V4h2v3z"/>
        </svg>
        GitTrace PR Shield
      </span>

      <span style="color:#8b949e;font-size:12px;">
        Repo AI Score:
        <strong style="color:${overallStyle.text}">
          ${overallScore || '--'}%
        </strong>
      </span>

      ${highRiskFiles.length > 0 ? `
        <span style="
          font-size:11px;font-weight:700;
          color:#f85149;
          background:rgba(248,81,73,0.1);
          padding:2px 10px;border-radius:99px;
        ">
          ${highRiskFiles.length} High Risk File${highRiskFiles.length > 1 ? 's' : ''}
        </span>
      ` : ''}

      ${mediumRiskFiles.length > 0 ? `
        <span style="
          font-size:11px;font-weight:700;
          color:#d29922;
          background:rgba(210,153,34,0.1);
          padding:2px 10px;border-radius:99px;
        ">
          ${mediumRiskFiles.length} Medium Risk File${mediumRiskFiles.length > 1 ? 's' : ''}
        </span>
      ` : ''}

      ${highRiskFiles.length === 0 && mediumRiskFiles.length === 0 ? `
        <span style="
          font-size:11px;font-weight:700;
          color:#3fb950;
          background:rgba(63,185,80,0.1);
          padding:2px 10px;border-radius:99px;
        ">
          ✅ No High Risk Files
        </span>
      ` : ''}
    </div>

    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:11px;color:#484f58;">
        ${perFileScores.length} files scored
      </span>
      <span style="
        font-size:10px;
        color:#6e6eff;
        font-weight:600;
        letter-spacing:.05em;
        text-transform:uppercase;
      ">
        GITTRACE
      </span>
    </div>
  `;

  insertionPoint.insertBefore(bar, insertionPoint.firstChild);
  console.log('[GitTrace PR] Summary bar injected');
}

// ─── File Header Banner ───────────────────────────────────────────────────────

/**
 * Inject a warning banner into a single file's diff header.
 * Shows the AI score and risk level for that specific file.
 *
 * @param {Element} fileHeader - The diff file header element
 * @param {number}  score      - AI score for this file
 * @param {string}  filePath   - File path for display
 */
function injectFileBanner(fileHeader, score, filePath) {
  // Skip if already injected
  if (fileHeader.getAttribute(PR_FILE_BANNER_ATTR)) return;

  const style  = scoreToStyle(score);
  const banner = document.createElement('div');

  Object.assign(banner.style, {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    padding:        '6px 12px',
    background:     style.bg,
    borderTop:      `1px solid ${style.border}44`,
    borderBottom:   `1px solid ${style.border}44`,
    fontFamily:     '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize:       '12px',
  });

  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="
        font-size:10px;font-weight:700;
        color:${style.text};
        background:${style.bg};
        border:1px solid ${style.border}44;
        padding:2px 8px;border-radius:99px;
        text-transform:uppercase;letter-spacing:.06em;
      ">
        GitTrace: ${style.label}
      </span>
      <span style="color:#8b949e;">
        AI Probability: <strong style="color:${style.text}">${score}%</strong>
      </span>
    </div>
    <span style="font-size:11px;color:#484f58;">
      Review added lines carefully
    </span>
  `;

  // Insert after the file header
  fileHeader.parentNode.insertBefore(banner, fileHeader.nextSibling);
  fileHeader.setAttribute(PR_FILE_BANNER_ATTR, 'true');
}

// ─── Line Highlighter ─────────────────────────────────────────────────────────

/**
 * Highlight added lines (+) in a diff file block.
 * Only highlights lines in files with score above threshold.
 *
 * @param {Element} diffBlock - The diff file container element
 * @param {number}  score     - AI score for this file
 */
function highlightAddedLines(diffBlock, score) {
  if (score < MEDIUM_SCORE_THRESHOLD) return;

  const style = scoreToStyle(score);

  // Find all added lines in this diff block
  // GitHub uses different selectors for added lines
  const addedLines = diffBlock.querySelectorAll(
    '.blob-code-addition, ' +
    'td.blob-code.blob-code-addition, ' +
    '[data-type="addition"], ' +
    '.diff-line-addition'
  );

  addedLines.forEach(line => {
    // Skip already processed lines
    if (line.getAttribute(PR_LINE_ATTR)) return;

    // Apply subtle left border highlight
    Object.assign(line.style, {
      borderLeft:      `3px solid ${style.border}`,
      backgroundColor: style.bg,
      position:        'relative',
    });

    line.setAttribute(PR_LINE_ATTR, String(score));
  });

  console.log(`[GitTrace PR] Highlighted ${addedLines.length} added lines (score: ${score})`);
}

// ─── File Path Extractor ──────────────────────────────────────────────────────

/**
 * Extract the file path from a GitHub diff file header element.
 * GitHub uses different structures for different UI versions.
 *
 * @param {Element} fileHeader
 * @returns {string | null}
 */
function extractFilePathFromHeader(fileHeader) {
  // New GitHub UI: data-path attribute
  const dataPath = fileHeader.getAttribute('data-path') ||
                   fileHeader.closest('[data-path]')?.getAttribute('data-path');
  if (dataPath) return dataPath;

  // Link text inside the header
  const link = fileHeader.querySelector(
    'a[href*="/blob/"], ' +
    '.Link--primary, ' +
    '[data-testid="diff-file-header-filename"]'
  );
  if (link) {
    const href = link.getAttribute('href') || '';
    // Extract path after /blob/branch/
    const match = href.match(/\/blob\/[^/]+\/(.+)/);
    if (match) return match[1];
    return link.textContent.trim();
  }

  // Title attribute
  const title = fileHeader.querySelector('[title]');
  if (title) return title.getAttribute('title');

  return null;
}

// ─── Score Matcher ────────────────────────────────────────────────────────────

/**
 * Find the best matching score for a PR file path
 * against the analyzed file scores.
 *
 * @param {string}   prFilePath   - File path from GitHub diff
 * @param {object[]} fileScores   - Per-file scores from backend
 * @returns {number | null}
 */
function matchScore(prFilePath, fileScores) {
  if (!prFilePath || !fileScores?.length) return null;

  // Exact match
  const exact = fileScores.find(f => f.path === prFilePath);
  if (exact) return exact.score;

  // Filename match (e.g. "index.js" matches "src/index.js")
  const fileName = prFilePath.split('/').pop();
  const byName   = fileScores.find(
    f => f.path.split('/').pop() === fileName
  );
  if (byName) return byName.score;

  // Partial path match — last 2 segments
  const lastTwo = prFilePath.split('/').slice(-2).join('/');
  const partial  = fileScores.find(f => f.path.endsWith(lastTwo));
  if (partial) return partial.score;

  return null;
}

// ─── Main Injector ────────────────────────────────────────────────────────────

/**
 * Process all diff file blocks on the PR page.
 * For each file: find its score, inject banner, highlight lines.
 *
 * @param {object[]} perFileScores - Array of { path, score }
 * @param {number}   overallScore  - Overall repo AI score
 */
export function processPRDiffs(perFileScores, overallScore) {
  if (!perFileScores?.length) {
    console.log('[GitTrace PR] No per-file scores available');
    return;
  }

  // Find all diff file containers on the page
  const diffFiles = document.querySelectorAll(
    '.js-file, ' +
    '.file, ' +
    '[data-testid="pr-file"], ' +
    '.diff-table-container, ' +
    '[id^="diff-"]'
  );

  if (diffFiles.length === 0) {
    console.warn('[GitTrace PR] No diff file blocks found on page');
    return;
  }

  console.log(`[GitTrace PR] Processing ${diffFiles.length} diff files`);

  let processedCount = 0;
  let flaggedCount   = 0;

  diffFiles.forEach(diffFile => {
    // Skip already processed
    if (diffFile.getAttribute(PR_SHIELD_ATTR)) return;

    // Find the file header
    const fileHeader = diffFile.querySelector(
      '.file-header, ' +
      '.js-file-header, ' +
      '[data-testid="file-header"], ' +
      '.diff-file-header'
    );

    if (!fileHeader) return;

    // Extract file path
    const filePath = extractFilePathFromHeader(fileHeader);
    if (!filePath) return;

    // Find matching score
    const score = matchScore(filePath, perFileScores);

    // Mark as processed
    diffFile.setAttribute(PR_SHIELD_ATTR, 'true');
    processedCount++;

    if (score === null) return;  // No score data for this file

    // Only show banners and highlights for medium+ risk files
    if (score >= MEDIUM_SCORE_THRESHOLD) {
      // Inject file-level banner
      injectFileBanner(fileHeader, score, filePath);

      // Highlight individual added lines
      highlightAddedLines(diffFile, score);

      flaggedCount++;
    }
  });

  console.log(`[GitTrace PR] Processed: ${processedCount}, Flagged: ${flaggedCount}`);
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Remove all PR Shield injections from the page.
 * Called on SPA navigation away from PR page.
 */
export function removePRShield() {
  // Remove summary bar
  const bar = document.getElementById(PR_BANNER_ID);
  if (bar) bar.remove();

  // Remove file banners — find by the next sibling pattern
  document.querySelectorAll(`[${PR_FILE_BANNER_ATTR}]`).forEach(el => {
    el.removeAttribute(PR_FILE_BANNER_ATTR);
    // Remove the banner div that was inserted after this element
    const next = el.nextSibling;
    if (next && next.nodeType === 1 && next.style?.borderTop?.includes('solid')) {
      next.remove();
    }
  });

  // Remove line highlights
  document.querySelectorAll(`[${PR_LINE_ATTR}]`).forEach(line => {
    line.style.borderLeft      = '';
    line.style.backgroundColor = '';
    line.removeAttribute(PR_LINE_ATTR);
  });

  // Remove processed markers
  document.querySelectorAll(`[${PR_SHIELD_ATTR}]`).forEach(el => {
    el.removeAttribute(PR_SHIELD_ATTR);
  });

  console.log('[GitTrace PR] PR Shield removed');
}

// ─── MutationObserver ─────────────────────────────────────────────────────────

/**
 * Watch for lazily loaded diff files.
 * GitHub loads large PR diffs progressively as you scroll.
 * When new diff blocks appear, we process them immediately.
 *
 * @param {object[]} perFileScores
 * @param {number}   overallScore
 * @returns {MutationObserver}
 */
export function watchPRDiffs(perFileScores, overallScore) {
  const targetNode = document.querySelector(
    '#files, ' +
    '.js-diff-progressive-container, ' +
    'main'
  );

  if (!targetNode) return null;

  let debounceTimer = null;

  const observer = new MutationObserver((mutations) => {
    const hasNewDiffs = mutations.some(m =>
      [...m.addedNodes].some(n =>
        n.nodeType === 1 && (
          n.classList?.contains('js-file')   ||
          n.classList?.contains('file')      ||
          n.querySelector?.('.file-header')
        )
      )
    );

    if (!hasNewDiffs) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.log('[GitTrace PR] New diff blocks detected — processing');
      processPRDiffs(perFileScores, overallScore);
    }, 400);
  });

  observer.observe(targetNode, {
    childList: true,
    subtree:   true,
  });

  console.log('[GitTrace PR] MutationObserver watching for new diff blocks');
  return observer;
}
