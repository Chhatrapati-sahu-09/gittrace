/**
 * GitTrace — File Tree Heatmap Module
 *
 * Injects colour-coded dots next to every file in GitHub's
 * file browser to visually show AI probability per file.
 *
 * Colour scale:
 *   🟢 Green  → score < 30  (likely human)
 *   🟡 Amber  → score 30-60 (ambiguous)
 *   🟠 Orange → score 60-80 (probably AI)
 *   🔴 Red    → score > 80  (very likely AI)
 *   ⚪ Grey   → no score data for this file
 *
 * GitHub's file tree uses different HTML structures
 * depending on the page (repo root vs subdirectory).
 * We handle both cases.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

// CSS class we add to dots so we can find and remove them later
const HEATMAP_DOT_CLASS = 'gt-heatmap-dot';
// CSS class on the host element to prevent double injection
const HEATMAP_DONE_ATTR = 'data-gt-heatmap';

// ─── Colour Helpers ───────────────────────────────────────────────────────────

/**
 * Map a score to a colour hex value.
 * @param {number | null} score
 * @returns {{ hex: string, label: string }}
 */
function scoreToHeatColour(score) {
  if (score === null || score === undefined) {
    return { hex: '#484f58', label: 'Not analyzed' };
  }
  if (score < 30)  return { hex: '#3fb950', label: `${score}% — Likely human` };
  if (score < 60)  return { hex: '#d29922', label: `${score}% — Mixed signals` };
  if (score < 80)  return { hex: '#f0883e', label: `${score}% — Probably AI` };
  return             { hex: '#f85149', label: `${score}% — Very likely AI` };
}

// ─── Dot Builder ──────────────────────────────────────────────────────────────

/**
 * Build a coloured dot element to inject into the file tree.
 *
 * @param {number | null} score
 * @param {string}        filePath
 * @returns {HTMLElement}
 */
function buildDot(score, filePath) {
  const { hex, label } = scoreToHeatColour(score);
  const dot = document.createElement('span');
  dot.className = HEATMAP_DOT_CLASS;
  dot.title     = `GitTrace: ${label}\n${filePath}`;

  // Inline styles — we are injecting into the real GitHub DOM
  // (not Shadow DOM) so we use very specific styles to avoid conflicts
  Object.assign(dot.style, {
    display:        'inline-block',
    width:          '8px',
    height:         '8px',
    borderRadius:   '50%',
    background:     hex,
    marginRight:    '6px',
    flexShrink:     '0',
    verticalAlign:  'middle',
    cursor:         'help',
    transition:     'transform 0.15s ease',
    position:       'relative',
    top:            '-1px',
  });

  // Hover: make dot slightly bigger
  dot.addEventListener('mouseenter', () => {
    dot.style.transform = 'scale(1.4)';
  });
  dot.addEventListener('mouseleave', () => {
    dot.style.transform = 'scale(1)';
  });

  return dot;
}

// ─── File Row Finder ──────────────────────────────────────────────────────────

/**
 * Find all file rows in GitHub's file tree.
 * GitHub uses different selectors depending on the UI version.
 *
 * Returns array of: { element, fileName, filePath }
 *
 * @returns {Array<{ element: Element, fileName: string, filePath: string }>}
 */
function findFileRows() {
  const rows = [];

  // ── New GitHub UI (2023+) ────────────────────────────────────────
  // Used on the main repo file browser page
  const newUIRows = document.querySelectorAll(
    '[data-testid="file-tree-item"], ' +
    'tr.react-directory-row, ' +
    '[role="row"][aria-label]'
  );

  if (newUIRows.length > 0) {
    newUIRows.forEach(row => {
      // Find the link inside the row to get the file path
      const link = row.querySelector('a[href*="/blob/"], a[href*="/tree/"]');
      if (!link) return;

      const href     = link.getAttribute('href') || '';
      const isFile   = href.includes('/blob/');
      if (!isFile) return;  // Skip directories

      // Extract file path from href
      // href format: /owner/repo/blob/branch/path/to/file.js
      const parts    = href.split('/blob/')[1] || '';
      const filePath = parts.split('/').slice(1).join('/');  // remove branch
      const fileName = filePath.split('/').pop();

      rows.push({
        element:  row,
        fileName,
        filePath,
        linkEl:   link,
      });
    });
  }

  // ── Classic GitHub UI (table-based) ─────────────────────────────
  if (rows.length === 0) {
    const classicRows = document.querySelectorAll(
      '.js-navigation-item, ' +
      'tr.js-navigation-item'
    );

    classicRows.forEach(row => {
      const link = row.querySelector(
        '.js-navigation-open[href*="/blob/"], ' +
        'a[href*="/blob/"]'
      );
      if (!link) return;

      const href     = link.getAttribute('href') || '';
      const parts    = href.split('/blob/')[1] || '';
      const filePath = parts.split('/').slice(1).join('/');
      const fileName = filePath.split('/').pop();

      rows.push({
        element:  row,
        fileName,
        filePath,
        linkEl:   link,
      });
    });
  }

  return rows;
}

// ─── Score Matcher ────────────────────────────────────────────────────────────

/**
 * Find the AI score for a given file path.
 * Tries exact match first, then filename-only match.
 *
 * @param {string}   filePath    - e.g. "src/utils/index.js"
 * @param {object[]} fileScores  - Array of { path, score }
 * @returns {number | null}
 */
function findScore(filePath, fileScores) {
  if (!fileScores || fileScores.length === 0) return null;

  // Exact match
  const exact = fileScores.find(f => f.path === filePath);
  if (exact) return exact.score;

  // Match by filename only (e.g. "index.js" matches "src/index.js")
  const fileName = filePath.split('/').pop();
  const byName   = fileScores.find(f => f.path.split('/').pop() === fileName );
  if (byName) return byName.score;

  // Partial path match — last 2 segments
  const lastTwo = filePath.split('/').slice(-2).join('/');
  const partial  = fileScores.find(f => f.path.endsWith(lastTwo) );
  if (partial) return partial.score;

  return null;
}

// ─── Heatmap Injector ─────────────────────────────────────────────────────────

/**
 * Main function — inject heatmap dots into the file tree.
 *
 * Uses requestIdleCallback so we don't block the main thread
 * and cause layout jank on the GitHub page.
 *
 * @param {object[]} perFileScores - Array of { path, score } from backend
 */
function injectHeatmap(perFileScores) {
  if (!perFileScores || perFileScores.length === 0) {
    console.log('[GitTrace Heatmap] No scores available — skipping heatmap');
    return;
  }

  // Use requestIdleCallback to avoid jank
  // Falls back to setTimeout for browsers without support
  const schedule = window.requestIdleCallback || ((cb) => setTimeout(cb, 100));

  schedule(() => {
    _doInject(perFileScores);
  });
}

/**
 * Actually do the DOM injection (runs in idle time).
 * @param {object[]} perFileScores
 */
function _doInject(perFileScores) {
  // Check if we are on a page with a file tree
  const fileRows = findFileRows();
  if (fileRows.length === 0) {
    console.log('[GitTrace Heatmap] No file rows found — not a file tree page');
    return;
  }

  console.log(`[GitTrace Heatmap] Injecting dots for ${fileRows.length} file rows`);

  let injectedCount = 0;
  let skippedCount  = 0;

  fileRows.forEach(({ element, filePath, linkEl }) => {
    // Skip if we already added a dot to this row
    if (element.getAttribute(HEATMAP_DONE_ATTR)) {
      skippedCount++;
      return;
    }

    // Find the score for this file
    const score = findScore(filePath, perFileScores);

    // Build the dot
    const dot = buildDot(score, filePath);

    // Find the best place to insert the dot
    // — before the filename link, or at the start of the row
    const insertBefore = linkEl || element.firstChild;
    if (insertBefore && insertBefore.parentNode) {
      insertBefore.parentNode.insertBefore(dot, insertBefore);
    } else {
      element.prepend(dot);
    }

    // Mark this row as done
    element.setAttribute(HEATMAP_DONE_ATTR, 'true');
    injectedCount++;
  });

  console.log(`[GitTrace Heatmap] Done. Injected: ${injectedCount}, Skipped: ${skippedCount}`);
}

// ─── Mutation Observer ────────────────────────────────────────────────────────

/**
 * Watch for GitHub's file tree to be dynamically rendered.
 * GitHub sometimes renders the file tree after the initial page load.
 * When new rows appear, we inject dots for them too.
 *
 * @param {object[]} perFileScores
 * @returns {MutationObserver} The observer (call .disconnect() to stop)
 */
function watchFileTree(perFileScores) {
  const targetNode = document.querySelector(
    '#repository-content, ' +
    '.repository-content, ' +
    'main'
  );

  if (!targetNode) {
    console.warn('[GitTrace Heatmap] Could not find target node for MutationObserver');
    return null;
  }

  let debounceTimer = null;

  const observer = new MutationObserver((mutations) => {
    // Debounce: wait 300ms after last mutation before re-injecting
    // This prevents multiple rapid re-injections during GitHub's rendering
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const hasNewRows = mutations.some(m =>
        [...m.addedNodes].some(n =>
          n.nodeType === 1 && (
            n.matches?.('[data-testid="file-tree-item"]') ||
            n.matches?.('tr.react-directory-row') ||
            n.querySelector?.('[data-testid="file-tree-item"]')
          )
        )
      );

      if (hasNewRows) {
        console.log('[GitTrace Heatmap] New file rows detected — re-injecting dots');
        _doInject(perFileScores);
      }
    }, 300);
  });

  observer.observe(targetNode, {
    childList: true,
    subtree:   true,
  });

  return observer;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Remove all heatmap dots from the page.
 * Called before re-injecting (e.g. after refresh or navigation).
 */
function removeHeatmap() {
  const dots = document.querySelectorAll(`.${HEATMAP_DOT_CLASS}`);
  dots.forEach(dot => dot.remove());

  // Remove the "done" markers so rows can be re-processed
  const markedRows = document.querySelectorAll(`[${HEATMAP_DONE_ATTR}]`);
  markedRows.forEach(row => row.removeAttribute(HEATMAP_DONE_ATTR));

  console.log(`[GitTrace Heatmap] Removed ${dots.length} dots`);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export {
  injectHeatmap,
  removeHeatmap,
  watchFileTree,
  scoreToHeatColour,
};
