/**
 * GitTrace — Badge UI Module (Day 2 — Full Implementation)
 *
 * Handles everything visual inside the Shadow DOM:
 *   - Animated score ring (SVG)
 *   - GitTrace badge pill
 *   - Dropdown panel with 4 tabs: Score, Breakdown, Security, Compat
 *   - Loading, error, and scored states
 *   - Dynamic colour logic based on AI probability score
 */

import { saveUserRuntimeVersions } from './osDetector.js';

// ─── Colour Logic ─────────────────────────────────────────────────────────────

/**
 * Map a 0–100 score to a semantic colour name.
 * @param {number} score
 * @returns {'green'|'amber'|'orange'|'red'}
 */
export function scoreToColour(score) {
  if (score < 30) return "green";
  if (score < 60) return "amber";
  if (score < 80) return "orange";
  return "red";
}

/**
 * Map colour name to hex.
 * @param {'green'|'amber'|'orange'|'red'} colour
 * @returns {string}
 */
export function colourToHex(colour) {
  const MAP = {
    green: "#3fb950",
    amber: "#d29922",
    orange: "#f0883e",
    red: "#f85149",
  };
  return MAP[colour] ?? "#8b949e";
}

// ─── All Styles ───────────────────────────────────────────────────────────────

/**
 * Full CSS injected into Shadow DOM.
 * GitHub styles CANNOT reach in here.
 * Our styles CANNOT leak out to GitHub.
 */
export const BADGE_CSS = `
  /* ── Reset ── */
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  /* ── Host ── */
  :host {
    display: inline-flex;
    align-items: center;
    margin-right: 8px;
    vertical-align: middle;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    position: relative;
    z-index: 9999;
  }

  /* ── Badge Pill ── */
  .gt-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px 5px 8px;
    background: #0d1117;
    border: 1.5px solid #30363d;
    border-radius: 20px;
    cursor: pointer;
    user-select: none;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
    position: relative;
  }

  .gt-badge:hover {
    border-color: #6e6eff;
    box-shadow: 0 0 0 3px rgba(110,110,255,0.15);
  }

  .gt-badge:active {
    transform: scale(0.97);
  }

  /* ── Score Ring (SVG) ── */
  .gt-ring-wrap {
    position: relative;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
  }

  .gt-ring-svg {
    width: 28px;
    height: 28px;
    transform: rotate(-90deg);
  }

  .gt-ring-track {
    fill: none;
    stroke: #21262d;
    stroke-width: 3;
  }

  .gt-ring-fill {
    fill: none;
    stroke: #6e6eff;
    stroke-width: 3;
    stroke-linecap: round;
    stroke-dasharray: 63.6;
    stroke-dashoffset: 63.6;
    transition: stroke-dashoffset 0.8s ease, stroke 0.4s ease;
  }

  /* Loading dot inside ring */
  .gt-ring-dot {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .gt-ring-dot-inner {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #6e6eff;
    animation: gt-pulse 1.8s ease-in-out infinite;
  }

  /* Score number inside ring (shown after scan) */
  .gt-ring-number {
    position: absolute;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    font-size: 8px;
    font-weight: 700;
    color: #e6edf3;
    line-height: 1;
  }

  /* ── Text Section ── */
  .gt-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 70px;
  }

  .gt-label {
    font-size: 10px;
    font-weight: 700;
    color: #8b949e;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    line-height: 1;
  }

  .gt-status {
    font-size: 12px;
    font-weight: 600;
    color: #e6edf3;
    line-height: 1.2;
  }

  /* ── Chevron ── */
  .gt-chevron {
    width: 14px;
    height: 14px;
    color: #8b949e;
    transition: transform 0.2s ease;
    flex-shrink: 0;
  }

  .gt-chevron.open {
    transform: rotate(180deg);
  }

  /* ── Dropdown Panel ── */
  .gt-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 340px;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 12px;
    box-shadow: 0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05);
    display: none;
    flex-direction: column;
    overflow: hidden;
    z-index: 99999;
    animation: gt-dropdown-in 0.18s ease;
  }

  .gt-dropdown.open {
    display: flex;
  }

  @keyframes gt-dropdown-in {
    from { opacity: 0; transform: translateY(-6px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* Dropdown Header */
  .gt-dropdown-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 10px;
    border-bottom: 1px solid #21262d;
  }

  .gt-dropdown-title {
    font-size: 13px;
    font-weight: 700;
    color: #e6edf3;
    letter-spacing: 0.02em;
  }

  .gt-dropdown-repo {
    font-size: 11px;
    color: #8b949e;
    font-family: 'SFMono-Regular', Consolas, monospace;
  }

  /* Refresh button */
  .gt-refresh-btn {
    background: none;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #8b949e;
    font-size: 11px;
    padding: 3px 8px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .gt-refresh-btn:hover {
    border-color: #6e6eff;
    color: #e6edf3;
  }

  /* ── Tabs ── */
  .gt-tabs {
    display: flex;
    border-bottom: 1px solid #21262d;
    padding: 0 12px;
    gap: 2px;
  }

  .gt-tab {
    padding: 8px 10px;
    font-size: 12px;
    font-weight: 500;
    color: #8b949e;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
    user-select: none;
    white-space: nowrap;
  }

  .gt-tab:hover {
    color: #e6edf3;
  }

  .gt-tab.active {
    color: #e6edf3;
    border-bottom-color: #6e6eff;
    font-weight: 600;
  }

  /* ── Tab Content Panels ── */
  .gt-panel {
    display: none;
    padding: 16px;
    flex-direction: column;
    gap: 12px;
    max-height: 320px;
    overflow-y: auto;
  }

  .gt-panel.active {
    display: flex;
  }

  /* Scrollbar inside panel */
  .gt-panel::-webkit-scrollbar { width: 4px; }
  .gt-panel::-webkit-scrollbar-track { background: transparent; }
  .gt-panel::-webkit-scrollbar-thumb { background: #30363d; border-radius: 4px; }

  /* ── Score Panel ── */
  .gt-score-hero {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 12px;
    background: #0d1117;
    border-radius: 8px;
    border: 1px solid #21262d;
  }

  .gt-score-ring-large {
    position: relative;
    width: 72px;
    height: 72px;
    flex-shrink: 0;
  }

  .gt-score-ring-large svg {
    width: 72px;
    height: 72px;
    transform: rotate(-90deg);
  }

  .gt-score-ring-large .gt-ring-track { stroke-width: 5; }
  .gt-score-ring-large .gt-ring-fill  { stroke-width: 5; stroke-dasharray: 175.9; stroke-dashoffset: 175.9; }

  .gt-score-ring-number {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
  }

  .gt-score-big {
    font-size: 20px;
    font-weight: 800;
    color: #e6edf3;
    line-height: 1;
  }

  .gt-score-pct {
    font-size: 10px;
    color: #8b949e;
    line-height: 1;
  }

  .gt-score-info {
    flex: 1;
  }

  .gt-score-verdict {
    font-size: 15px;
    font-weight: 700;
    color: #e6edf3;
    margin-bottom: 4px;
  }

  .gt-score-desc {
    font-size: 12px;
    color: #8b949e;
    line-height: 1.5;
  }

  /* Signal rows */
  .gt-signal-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: #0d1117;
    border-radius: 6px;
    border: 1px solid #21262d;
    font-size: 12px;
  }

  .gt-signal-label {
    color: #8b949e;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .gt-signal-value {
    font-weight: 600;
    color: #e6edf3;
  }

  /* ── Breakdown Panel ── */
  .gt-file-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 10px;
    background: #0d1117;
    border-radius: 6px;
    border: 1px solid #21262d;
    gap: 8px;
  }

  .gt-file-name {
    font-size: 11px;
    color: #8b949e;
    font-family: 'SFMono-Regular', Consolas, monospace;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .gt-file-bar-wrap {
    width: 60px;
    height: 4px;
    background: #21262d;
    border-radius: 2px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .gt-file-bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.6s ease;
  }

  .gt-file-score {
    font-size: 11px;
    font-weight: 700;
    width: 30px;
    text-align: right;
    flex-shrink: 0;
  }

  /* ── Security Panel ── */
  .gt-security-empty {
    text-align: center;
    padding: 24px;
    color: #8b949e;
    font-size: 13px;
  }

  .gt-security-item {
    display: flex;
    gap: 10px;
    padding: 10px;
    background: #0d1117;
    border-radius: 6px;
    border: 1px solid #21262d;
  }

  .gt-security-icon {
    font-size: 16px;
    flex-shrink: 0;
    line-height: 1.4;
  }

  .gt-security-text {
    flex: 1;
  }

  .gt-security-title {
    font-size: 12px;
    font-weight: 600;
    color: #e6edf3;
    margin-bottom: 2px;
  }

  .gt-security-desc {
    font-size: 11px;
    color: #8b949e;
    line-height: 1.4;
  }

  /* ── License Panel ── */
  .gt-license-card {
    background: #0d1117;
    border: 1px solid #21262d;
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .gt-license-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .gt-license-name {
    font-size: 13px;
    font-weight: 600;
    color: #e6edf3;
  }
  .gt-risk-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 99px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: rgba(255,255,255,0.08);
  }
  .gt-license-explanation {
    font-size: 12px;
    color: #8b949e;
    line-height: 1.55;
    margin: 0;
  }
  .gt-license-warning {
    font-size: 11px;
    color: #f85149;
    background: rgba(248, 81, 73, 0.1);
    border: 1px solid rgba(248, 81, 73, 0.3);
    border-radius: 6px;
    padding: 8px 10px;
    line-height: 1.5;
  }
  .gt-license-meta {
    display: flex;
    gap: 14px;
    font-size: 11px;
    color: #8b949e;
    padding-top: 4px;
    border-top: 1px solid #21262d;
  }
  .gt-license-meta code {
    font-family: 'SFMono-Regular', Consolas, monospace;
    background: #21262d;
    padding: 1px 5px;
    border-radius: 3px;
  }

  /* ── Compat Panel ── */
  .gt-compat-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 12px;
    background: #0d1117;
    border-radius: 6px;
    border: 1px solid #21262d;
  }

  .gt-compat-label {
    font-size: 12px;
    color: #8b949e;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .gt-compat-value {
    font-size: 12px;
    font-weight: 600;
    color: #e6edf3;
  }

  /* ── Colour Utilities ── */
  .gt-green  { color: #3fb950; }
  .gt-amber  { color: #d29922; }
  .gt-orange { color: #f0883e; }
  .gt-red    { color: #f85149; }

  .gt-bg-green  { background: #3fb950; }
  .gt-bg-amber  { background: #d29922; }
  .gt-bg-orange { background: #f0883e; }
  .gt-bg-red    { background: #f85149; }

  .gt-border-green  { border-color: #3fb950 !important; }
  .gt-border-amber  { border-color: #d29922 !important; }
  .gt-border-orange { border-color: #f0883e !important; }
  .gt-border-red    { border-color: #f85149 !important; }

  /* ── Badge colour states ── */
  .gt-badge.gt-state-green  { border-color: #3fb950; }
  .gt-badge.gt-state-amber  { border-color: #d29922; }
  .gt-badge.gt-state-orange { border-color: #f0883e; }
  .gt-badge.gt-state-red    { border-color: #f85149; }

  /* ── Loading Skeleton ── */
  .gt-skeleton {
    background: linear-gradient(90deg, #21262d 25%, #30363d 50%, #21262d 75%);
    background-size: 200% 100%;
    animation: gt-skeleton-move 1.5s linear infinite;
    border-radius: 4px;
    height: 12px;
  }

  /* ── Animations ── */
  @keyframes gt-pulse {
    0%, 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 0 rgba(110,110,255,0.5); }
    50%       { opacity: 0.6; transform: scale(0.75); box-shadow: 0 0 0 5px rgba(110,110,255,0); }
  }

  @keyframes gt-skeleton-move {
    0%   { background-position: 200% center; }
    100% { background-position: -200% center; }
  }

  /* ── Footer ── */
  .gt-footer {
    padding: 10px 16px;
    border-top: 1px solid #21262d;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .gt-footer-brand {
    font-size: 11px;
    color: #484f58;
    font-weight: 600;
    letter-spacing: 0.05em;
  }

  .gt-footer-powered {
    font-size: 10px;
    color: #484f58;
  }
`;

// ─── Build Full Badge HTML ────────────────────────────────────────────────────

/**
 * Build the complete badge + dropdown HTML structure.
 * Returns a DocumentFragment ready to append to shadow root.
 *
 * @param {{ owner: string, repo: string }} repoInfo
 * @returns {HTMLElement}
 */
export function buildBadgeHTML(repoInfo) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `

    <!-- Badge Pill -->
    <div class="gt-badge" id="gt-badge" role="button" tabindex="0"
         aria-label="GitTrace: analyzing repository"
         title="GitTrace — ${repoInfo.owner}/${repoInfo.repo}">

      <!-- Score Ring (small) -->
      <div class="gt-ring-wrap">
        <svg class="gt-ring-svg" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
          <circle class="gt-ring-track" cx="14" cy="14" r="10.1"/>
          <circle class="gt-ring-fill" id="gt-ring-fill-small" cx="14" cy="14" r="10.1"/>
        </svg>
        <!-- Loading dot (shown while scanning) -->
        <div class="gt-ring-dot" id="gt-ring-dot">
          <div class="gt-ring-dot-inner"></div>
        </div>
        <!-- Score number (shown after scan) -->
        <div class="gt-ring-number" id="gt-ring-number"></div>
      </div>

      <!-- Text -->
      <div class="gt-text">
        <span class="gt-label">GitTrace</span>
        <span class="gt-status" id="gt-status-text">Scanning…</span>
      </div>

      <!-- Chevron -->
      <svg class="gt-chevron" id="gt-chevron" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z"/>
      </svg>
    </div>

    <!-- Dropdown Panel -->
    <div class="gt-dropdown" id="gt-dropdown" role="dialog" aria-label="GitTrace analysis">

      <!-- Header -->
      <div class="gt-dropdown-header">
        <div>
          <div class="gt-dropdown-title">GitTrace Analysis</div>
          <div class="gt-dropdown-repo">${repoInfo.owner}/${repoInfo.repo}</div>
        </div>
        <button class="gt-refresh-btn" id="gt-refresh-btn" title="Re-scan this repository">
          ↻ Refresh
        </button>
      </div>

      <!-- Tabs -->
      <div class="gt-tabs" role="tablist">
        <div class="gt-tab active" data-tab="score"     role="tab">Score</div>
        <div class="gt-tab"       data-tab="breakdown"  role="tab">Breakdown</div>
        <div class="gt-tab"       data-tab="security"   role="tab">Security</div>
        <div class="gt-tab"       data-tab="compat"     role="tab">Compat</div>
      </div>

      <!-- Score Panel -->
      <div class="gt-panel active" id="gt-panel-score">
        <!-- Loading skeleton (shown before data) -->
        <div id="gt-score-loading">
          <div class="gt-score-hero">
            <div style="width:72px;height:72px;border-radius:50%;background:#21262d;flex-shrink:0;animation:gt-skeleton-move 1.5s linear infinite;background-size:200% 100%;background-image:linear-gradient(90deg,#21262d 25%,#30363d 50%,#21262d 75%)"></div>
            <div style="flex:1;display:flex;flex-direction:column;gap:8px">
              <div class="gt-skeleton" style="width:60%;height:16px"></div>
              <div class="gt-skeleton" style="width:90%;height:11px"></div>
              <div class="gt-skeleton" style="width:75%;height:11px"></div>
            </div>
          </div>
          <div class="gt-skeleton" style="height:36px"></div>
          <div class="gt-skeleton" style="height:36px"></div>
        </div>

        <!-- Real content (hidden until data arrives) -->
        <div id="gt-score-content" style="display:none;flex-direction:column;gap:12px">
          <div class="gt-score-hero">
            <div class="gt-score-ring-large">
              <svg viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">
                <circle class="gt-ring-track" cx="36" cy="36" r="28"/>
                <circle class="gt-ring-fill" id="gt-ring-fill-large" cx="36" cy="36" r="28"/>
              </svg>
              <div class="gt-score-ring-number">
                <span class="gt-score-big" id="gt-score-big">--</span>
                <span class="gt-score-pct">%</span>
              </div>
            </div>
            <div class="gt-score-info">
              <div class="gt-score-verdict" id="gt-verdict">Analyzing…</div>
              <div class="gt-score-desc"  id="gt-verdict-desc">Fetching repository data and running AI detection.</div>
            </div>
          </div>

          <div class="gt-signal-row">
            <span class="gt-signal-label">🤖 AI Probability</span>
            <span class="gt-signal-value" id="gt-sig-ai">—</span>
          </div>
          <div class="gt-signal-row">
            <span class="gt-signal-label">⚡ Commit Velocity</span>
            <span class="gt-signal-value" id="gt-sig-velocity">—</span>
          </div>
          <div class="gt-signal-row">
            <span class="gt-signal-label">📄 License Risk</span>
            <span class="gt-signal-value" id="gt-sig-license">—</span>
          </div>
          <div class="gt-signal-row">
            <span class="gt-signal-label">🛡️ Security</span>
            <span class="gt-signal-value" id="gt-sig-security">—</span>
          </div>
          <div id="gt-license-detail"></div>
          <!-- Heatmap Legend -->
          <div style=" background:#0d1117; border:1px solid #21262d; border-radius:8px; padding:10px 12px; margin-top:4px; ">
            <div style="font-size:11px;color:#8b949e;margin-bottom:8px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">
              File Tree Legend
            </div>
            <div style="display:flex;flex-direction:column;gap:5px;">
              <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:#8b949e;">
                <span style="width:8px;height:8px;border-radius:50%;background:#3fb950;flex-shrink:0"></span>
                &lt; 30% — Likely human-written
              </div>
              <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:#8b949e;">
                <span style="width:8px;height:8px;border-radius:50%;background:#d29922;flex-shrink:0"></span>
                30–60% — Mixed signals
              </div>
              <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:#8b949e;">
                <span style="width:8px;height:8px;border-radius:50%;background:#f0883e;flex-shrink:0"></span>
                60–80% — Probably AI
              </div>
              <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:#8b949e;">
                <span style="width:8px;height:8px;border-radius:50%;background:#f85149;flex-shrink:0"></span>
                &gt; 80% — Very likely AI
              </div>
            </div>
          </div>
          <!-- PR Shield Info (shown on PR pages only) -->
          <div id="gt-pr-info" style="display:none;flex-direction:column;"></div>
        </div>
      </div>

      <!-- Breakdown Panel -->
      <div class="gt-panel" id="gt-panel-breakdown">
        <div id="gt-breakdown-loading">
          <div class="gt-skeleton" style="height:32px"></div>
          <div class="gt-skeleton" style="height:32px"></div>
          <div class="gt-skeleton" style="height:32px"></div>
          <div class="gt-skeleton" style="height:32px"></div>
        </div>
        <div id="gt-breakdown-content" style="display:none;flex-direction:column;gap:6px">
          <!-- File rows injected by renderBreakdown() -->
        </div>
      </div>

      <!-- Security Panel -->
      <div class="gt-panel" id="gt-panel-security">
        <div id="gt-security-loading">
          <div class="gt-skeleton" style="height:56px"></div>
          <div class="gt-skeleton" style="height:56px"></div>
        </div>
        <div id="gt-security-content" style="display:none;flex-direction:column;gap:8px">
          <!-- Security items injected by renderSecurity() -->
        </div>
      </div>

      <!-- Compat Panel -->
      <div class="gt-panel" id="gt-panel-compat">
        <div id="gt-compat-loading">
          <div class="gt-skeleton" style="height:36px"></div>
          <div class="gt-skeleton" style="height:36px"></div>
          <div class="gt-skeleton" style="height:36px"></div>
        </div>
        <div id="gt-compat-content" style="display:none;flex-direction:column;gap:8px">
          <!-- Compat rows injected by renderCompat() -->
        </div>
      </div>

      <!-- Footer -->
      <div class="gt-footer">
        <span class="gt-footer-brand">GITTRACE</span>
        <span class="gt-footer-powered">v0.2.0 · AI Code Detector</span>
      </div>
    </div>
  `;

  return wrapper;
}

// ─── Tab Switching ────────────────────────────────────────────────────────────

/**
 * Wire up tab click handlers inside the shadow root.
 * @param {ShadowRoot} shadow
 */
export function initTabs(shadow) {
  const tabs = shadow.querySelectorAll(".gt-tab");
  const panels = shadow.querySelectorAll(".gt-panel");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      // Remove active from all tabs and panels
      tabs.forEach((t) => t.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));

      // Activate clicked tab and matching panel
      tab.classList.add("active");
      const target = shadow.getElementById(`gt-panel-${tab.dataset.tab}`);
      if (target) target.classList.add("active");
    });
  });
}

// ─── Dropdown Toggle ──────────────────────────────────────────────────────────

/**
 * Wire up badge click → dropdown open/close.
 * Also handles outside-click-to-close.
 *
 * @param {ShadowRoot} shadow
 * @param {HTMLElement} hostElement - The span#gittrace-badge-host
 */
export function initDropdownToggle(shadow, hostElement) {
  const badge = shadow.getElementById("gt-badge");
  const dropdown = shadow.getElementById("gt-dropdown");
  const chevron = shadow.getElementById("gt-chevron");

  if (!badge || !dropdown) return;

  badge.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.toggle("open");
    chevron?.classList.toggle("open", isOpen);
    badge.setAttribute("aria-expanded", String(isOpen));
  });

  // Close on outside click (listen on document, not shadow)
  document.addEventListener("click", (e) => {
    // If click is outside our host element, close dropdown
    if (!hostElement.contains(e.target)) {
      dropdown.classList.remove("open");
      chevron?.classList.remove("open");
      badge.setAttribute("aria-expanded", "false");
    }
  });

  // Keyboard: Escape closes dropdown
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      dropdown.classList.remove("open");
      chevron?.classList.remove("open");
      badge.setAttribute("aria-expanded", "false");
    }
  });
}

// ─── Loading State ────────────────────────────────────────────────────────────

/**
 * Set badge to loading/scanning state.
 * Shows skeleton loaders in all panels.
 * Called immediately when content.js starts the API request.
 *
 * @param {ShadowRoot} shadow
 */
export function setBadgeLoading(shadow) {
  // Badge text
  const statusText = shadow.getElementById("gt-status-text");
  if (statusText) statusText.textContent = "Scanning…";

  // Show loading dot, hide number
  const dot = shadow.getElementById("gt-ring-dot");
  const number = shadow.getElementById("gt-ring-number");
  if (dot) dot.style.display = "flex";
  if (number) number.style.display = "none";

  // Reset ring fill
  const fillSmall = shadow.getElementById("gt-ring-fill-small");
  if (fillSmall) {
    fillSmall.style.strokeDashoffset = "63.6";
    fillSmall.style.stroke = "#6e6eff";
  }

  // Show skeletons, hide content
  showLoading(shadow, "score");
  showLoading(shadow, "breakdown");
  showLoading(shadow, "security");
  showLoading(shadow, "compat");
}

// ─── Error State ──────────────────────────────────────────────────────────────

/**
 * Set badge to error state.
 * Called when backend is unreachable or returns an error.
 *
 * @param {ShadowRoot} shadow
 * @param {string} message - Short error description
 */
export function setBadgeError(shadow, message) {
  const statusText = shadow.getElementById("gt-status-text");
  if (statusText) statusText.textContent = "⚠ Unavailable";

  const badge = shadow.getElementById("gt-badge");
  if (badge) {
    badge.classList.remove(
      "gt-state-green",
      "gt-state-amber",
      "gt-state-orange",
      "gt-state-red",
    );
    badge.style.borderColor = "#f85149";
  }

  // Show error in score panel
  hideLoading(shadow, "score");
  const scoreContent = shadow.getElementById("gt-score-content");
  if (scoreContent) {
    scoreContent.style.display = "flex";
    const verdict = shadow.getElementById("gt-verdict");
    const desc = shadow.getElementById("gt-verdict-desc");
    if (verdict) {
      verdict.textContent = "⚠ Analysis Failed";
      verdict.className = "gt-score-verdict gt-red";
    }
    if (desc)
      desc.textContent = message || "Could not connect to GitTrace backend.";
  }
}

// ─── Render Full Score ────────────────────────────────────────────────────────

/**
 * Render the badge with real API data.
 * This is the main render function called after backend responds.
 *
 * @param {ShadowRoot} shadow
 * @param {object} data
 * @param {number}   data.overallScore   - 0 to 100
 * @param {string}   data.label          - 'Low' | 'Medium' | 'High'
 * @param {object[]} data.perFileScores  - [{ path, score }]
 * @param {object[]} data.commitFlags    - [{ message, additions, flag }]
 * @param {object}   data.licenseInfo    - { spdx, risk, label }
 * @param {object}   data.securityIssues - { cves, phantoms, secrets }
 * @param {object}   data.compatInfo     - { os, nodeRequired, nodeDetected, ... }
 */
export function renderBadge(shadow, data) {
  // ── PR page context ────────────────────────────────────────────
  // If on a PR diff page, add PR badge to the status text
  const onPRPage = window.location.pathname.includes('/pull/');
  if (onPRPage) {
    const statusText = shadow.getElementById('gt-status-text');
    if (statusText && data.overallScore !== null) {
      statusText.textContent = `${data.overallScore}% · PR`;
    }
  }

  const {
    overallScore,
    label,
    perFileScores,
    commitFlags,
    licenseInfo,
    securityIssues,
    compatInfo,
  } = data;

  const colour = scoreToColour(overallScore);
  const hex = colourToHex(colour);

  // ── Update badge pill ──────────────────────────────────────────
  const badge = shadow.getElementById("gt-badge");
  const statusText = shadow.getElementById("gt-status-text");
  const fillSmall = shadow.getElementById("gt-ring-fill-small");
  const dot = shadow.getElementById("gt-ring-dot");
  const ringNum = shadow.getElementById("gt-ring-number");

  if (badge) {
    badge.classList.remove(
      "gt-state-green",
      "gt-state-amber",
      "gt-state-orange",
      "gt-state-red",
    );
    badge.classList.add(`gt-state-${colour}`);
  }

  if (statusText) statusText.textContent = `${overallScore}% AI`;

  // Small ring animation
  if (fillSmall) {
    const circumference = 63.6;
    const offset = circumference - (overallScore / 100) * circumference;
    fillSmall.style.strokeDashoffset = String(offset);
    fillSmall.style.stroke = hex;
  }

  // Swap dot → number inside small ring
  if (dot) dot.style.display = "none";
  if (ringNum) {
    ringNum.style.display = "flex";
    ringNum.textContent = String(overallScore);
    ringNum.style.color = hex;
  }

  // ── Score tab ─────────────────────────────────────────────────
  hideLoading(shadow, "score");
  const scoreContent = shadow.getElementById("gt-score-content");
  if (scoreContent) scoreContent.style.display = "flex";

  // Large ring
  const fillLarge = shadow.getElementById("gt-ring-fill-large");
  if (fillLarge) {
    const circ = 175.9;
    const offset = circ - (overallScore / 100) * circ;
    fillLarge.style.strokeDashoffset = String(offset);
    fillLarge.style.stroke = hex;
  }

  const scoreBig = shadow.getElementById("gt-score-big");
  if (scoreBig) {
    scoreBig.textContent = String(overallScore);
    scoreBig.className = `gt-score-big gt-${colour}`;
  }

  const verdict = shadow.getElementById("gt-verdict");
  const desc = shadow.getElementById("gt-verdict-desc");

  const VERDICTS = {
    green: [
      "Likely Human-Written",
      "Low AI signal. Code patterns suggest primarily human authorship.",
    ],
    amber: [
      "Mixed Signals",
      "Moderate AI probability. Some files show LLM patterns.",
    ],
    orange: [
      "Probably AI-Generated",
      "High AI signal across multiple files. Review carefully.",
    ],
    red: [
      "Almost Certainly AI",
      "Very strong AI signal. Boilerplate patterns detected repo-wide.",
    ],
  };

  if (verdict) {
    verdict.textContent = VERDICTS[colour][0];
    verdict.className = `gt-score-verdict gt-${colour}`;
  }
  if (desc) desc.textContent = VERDICTS[colour][1];

  // Signal rows
  setSignalRow(shadow, "gt-sig-ai", `${overallScore}%`, colour);

  setSignalRow(
    shadow,
    "gt-sig-velocity",
    velocityResult(commitFlags),
    commitFlags?.length ? "red" : "green",
  );

  setSignalRow(
    shadow,
    "gt-sig-license",
    licenseInfo?.risk || "Unknown",
    licenseInfo?.colour || "amber",
  );

  setSignalRow(
    shadow,
    "gt-sig-security",
    securityResult(securityIssues),
    hasSecurityIssues(securityIssues) ? "red" : "green",
  );

  // Add this line after the 4 setSignalRow calls inside renderBadge()
  renderLicenseInfo(shadow, licenseInfo);

  // ── PR context in Score tab ──────────────────────────────────
  const prInfoEl = shadow.getElementById('gt-pr-info');
  if (prInfoEl) {
    const onPR      = window.location.pathname.includes('/pull/');
    const highFiles = (perFileScores || []).filter(f => f.score >= 70);

    if (onPR) {
      prInfoEl.style.display = 'flex';
      prInfoEl.innerHTML = `
        <div style="
          padding:10px 12px;
          background:#0d1117;
          border:1px solid #21262d;
          border-radius:6px;
          font-size:12px;
          display:flex;
          flex-direction:column;
          gap:6px;
        ">
          <div style="font-weight:600;color:#e6edf3;">
            🔍 PR Shield Active
          </div>
          <div style="color:#8b949e;font-size:11px;line-height:1.5;">
            ${highFiles.length > 0
              ? `<span style="color:#f85149;font-weight:600;">
                   ${highFiles.length} file${highFiles.length > 1 ? 's' : ''} flagged.
                 </span>
                 Added lines in these files are highlighted in the diff.`
              : '✅ No high-risk files detected in this PR.'
            }
          </div>
          ${highFiles.length > 0 ? `
            <div style="display:flex;flex-direction:column;gap:3px;margin-top:2px;">
              ${highFiles.slice(0, 3).map(f => `
                <div style="font-family:monospace;font-size:10px;
                  color:#8b949e;display:flex;justify-content:space-between;">
                  <span>${f.path.split('/').pop()}</span>
                  <span style="color:#f0883e;font-weight:700;">${f.score}%</span>
                </div>
              `).join('')}
              ${highFiles.length > 3 ? `
                <div style="font-size:10px;color:#484f58;">
                  + ${highFiles.length - 3} more
                </div>
              ` : ''}
            </div>
          ` : ''}
        </div>
      `;
    } else {
      prInfoEl.style.display = 'none';
    }
  }

  // ── Breakdown tab ─────────────────────────────────────────────
  renderBreakdown(shadow, perFileScores || []);

  // ── Security tab ──────────────────────────────────────────────
  renderSecurity(shadow, securityIssues || {});

  // ── Compat tab ────────────────────────────────────────────────
  renderCompat(shadow, data.compatReport || null);
}

// ─── Breakdown Panel ──────────────────────────────────────────────────────────

function renderBreakdown(shadow, perFileScores) {
  hideLoading(shadow, "breakdown");
  const container = shadow.getElementById("gt-breakdown-content");
  if (!container) return;

  container.style.display = "flex";

  if (!perFileScores.length) {
    container.innerHTML =
      '<div class="gt-security-empty">No file data available yet.</div>';
    return;
  }

  // Sort by score descending
  const sorted = [...perFileScores].sort((a, b) => b.score - a.score);

  container.innerHTML = sorted
    .map((file) => {
      const colour = scoreToColour(file.score);
      const hex = colourToHex(colour);
      return `
      <div class="gt-file-row">
        <span class="gt-file-name" title="${file.path}">${file.path}</span>
        <div class="gt-file-bar-wrap">
          <div class="gt-file-bar-fill gt-bg-${colour}" style="width:${file.score}%"></div>
        </div>
        <span class="gt-file-score gt-${colour}">${file.score}%</span>
      </div>
    `;
    })
    .join("");
}

// ─── Security Panel ───────────────────────────────────────────────────────────

function renderSecurity(shadow, securityIssues) {
  hideLoading(shadow, "security");
  const container = shadow.getElementById("gt-security-content");
  if (!container) return;

  container.style.display = "flex";

  const items = [];

  (securityIssues.cves || []).forEach((cve) => {
    items.push(`
      <div class="gt-security-item">
        <span class="gt-security-icon">🔴</span>
        <div class="gt-security-text">
          <div class="gt-security-title">${cve.id} — ${cve.severity}</div>
          <div class="gt-security-desc">${cve.package}: ${cve.summary}</div>
        </div>
      </div>
    `);
  });

  (securityIssues.phantoms || []).forEach((pkg) => {
    items.push(`
      <div class="gt-security-item">
        <span class="gt-security-icon">☠️</span>
        <div class="gt-security-text">
          <div class="gt-security-title">Phantom Package: ${pkg.name}</div>
          <div class="gt-security-desc">Not found on ${pkg.registry}. Possible AI hallucination or typosquatting.</div>
        </div>
      </div>
    `);
  });

  (securityIssues.secrets || []).forEach((s) => {
    items.push(`
      <div class="gt-security-item">
        <span class="gt-security-icon">🔑</span>
        <div class="gt-security-text">
          <div class="gt-security-title">Hardcoded Secret — ${s.type}</div>
          <div class="gt-security-desc">${s.file} · Pattern matched, value hidden</div>
        </div>
      </div>
    `);
  });

  if (!items.length) {
    container.innerHTML =
      '<div class="gt-security-empty">✅ No security issues detected yet.<br>Full scan runs on Day 7.</div>';
    return;
  }

  container.innerHTML = items.join("");
}

// ─── License Panel ────────────────────────────────────────────────────────────
/**
 * Render license information inside the Score tab.
 * Called from renderBadge() after real data arrives.
 *
 * @param {ShadowRoot} shadow
 * @param {object} licenseInfo
 */
function renderLicenseInfo(shadow, licenseInfo) {
  // Find the license signal row in the Score tab
  const licenseSignal = shadow.getElementById('gt-sig-license');
  if (licenseSignal) {
    licenseSignal.textContent = licenseInfo?.label || 'Unknown';
    licenseSignal.className   = `gt-signal-value gt-${licenseInfo?.colour || 'amber'}`;
  }

  // Find the license detail area (if it exists in the dropdown)
  const licenseDetail = shadow.getElementById('gt-license-detail');
  if (!licenseDetail) return;

  if (!licenseInfo) {
    licenseDetail.innerHTML = `
      <div class="gt-security-empty">No license information available.</div>
    `;
    return;
  }

  // Risk badge colour
  const riskColour = licenseInfo.colour || 'amber';

  licenseDetail.innerHTML = `
    <div class="gt-license-card">
      <div class="gt-license-header">
        <span class="gt-license-name">${licenseInfo.name || licenseInfo.spdxId}</span>
        <span class="gt-risk-badge gt-${riskColour}">${licenseInfo.label}</span>
      </div>
      <p class="gt-license-explanation">${licenseInfo.explanation || ''}</p>
      ${licenseInfo.warning ? `
        <div class="gt-license-warning">
          ⚠ ${licenseInfo.warning}
        </div>
      ` : ''}
      <div class="gt-license-meta">
        <span>SPDX: <code>${licenseInfo.spdxId || 'NONE'}</code></span>
        <span>AI Use: <strong class="${licenseInfo.canUseAI ? 'gt-green' : 'gt-red'}">
          ${licenseInfo.canUseAI ? '✓ Generally Safe' : '✗ Caution Required'}
        </strong></span>
      </div>
    </div>
  `;
}

// ─── Compat Panel ─────────────────────────────────────────────────────────────

/**
 * Render the compatibility tab with full report data.
 *
 * @param {ShadowRoot} shadow
 * @param {object}     compatReport - From buildCompatReport() in osDetector.js
 */
function renderCompat(shadow, compatReport) {
  hideLoading(shadow, 'compat');
  const container = shadow.getElementById('gt-compat-content');
  if (!container) return;

  container.style.display = 'flex';

  // No compat data yet
  if (!compatReport) {
    container.innerHTML = `
      <div class="gt-security-empty">
        Compatibility data not available.<br>
        <span style="font-size:11px;margin-top:4px;display:block;">
          Make sure the backend is running.
        </span>
      </div>
    `;
    return;
  }

  const { userEnvironment, repoRequirements, checks, compute, overallStatus } = compatReport;

  const items = [];

  // ── Overall status banner ──────────────────────────────────────
  const statusColour = overallStatus === 'ok'      ? '#3fb950' :
                       overallStatus === 'warning'  ? '#d29922' : '#f85149';
  const statusLabel  = overallStatus === 'ok'      ? '✅ Compatible' :
                       overallStatus === 'warning'  ? '⚠ Review Required' :
                                                      '❌ Incompatible';

  items.push(`
    <div style="
      padding:10px 12px;
      background:#0d1117;
      border:1px solid ${statusColour}44;
      border-radius:8px;
      display:flex;
      align-items:center;
      justify-content:space-between;
    ">
      <span style="font-size:12px;font-weight:700;color:${statusColour}">
        ${statusLabel}
      </span>
      <span style="font-size:10px;color:#8b949e;">
        ${compatReport.configFilesScanned?.length || 0} config files scanned
      </span>
    </div>
  `);

  // ── Your Environment ───────────────────────────────────────────
  items.push(`
    <div style="font-size:11px;font-weight:600;color:#8b949e;
      text-transform:uppercase;letter-spacing:.06em;margin-top:4px;">
      Your Environment
    </div>
  `);

  items.push(compatRow(
    '💻 OS',
    userEnvironment.os || 'Unknown',
    checks.os?.status || 'unknown'
  ));

  items.push(compatRow(
    '🏗️ Architecture',
    userEnvironment.arch || 'Unknown',
    checks.arch?.warnings?.length > 0 ? 'warning' : 'ok'
  ));

  // Node version row with input if not set
  if (!userEnvironment.versionsSetByUser) {
    items.push(`
      <div class="gt-compat-row" style="flex-direction:column;align-items:flex-start;gap:6px;">
        <span class="gt-compat-label">📦 Your Node.js Version</span>
        <div style="display:flex;gap:6px;width:100%;">
          <input
            id="gt-node-input"
            type="text"
            placeholder="e.g. 20.11.0"
            style="
              flex:1;padding:4px 8px;font-size:12px;
              background:#21262d;border:1px solid #30363d;
              border-radius:4px;color:#e6edf3;outline:none;
              font-family:inherit;
            "
          />
          <button id="gt-node-save" style="
            padding:4px 10px;font-size:11px;font-weight:600;
            background:#6e6eff;border:none;border-radius:4px;
            color:#fff;cursor:pointer;
          ">Save</button>
        </div>
        <span style="font-size:10px;color:#8b949e;">
          Required: ${repoRequirements.nodeVersion || 'Not specified'}
        </span>
      </div>
    `);
  } else {
    items.push(compatRow(
      '📦 Node.js',
      `You: ${userEnvironment.nodeVersion} / Required: ${repoRequirements.nodeVersion || 'Any'}`,
      checks.node?.status || 'unknown',
      checks.node?.reason
    ));
  }

  // Python row
  if (repoRequirements.pythonVersion) {
    items.push(compatRow(
      '🐍 Python',
      `Required: ${repoRequirements.pythonVersion}` +
      (userEnvironment.pythonVersion ? ` / You: ${userEnvironment.pythonVersion}` : ''),
      checks.python?.status || 'unknown',
      checks.python?.reason
    ));
  }

  // ── Repo Requirements ──────────────────────────────────────────
  items.push(`
    <div style="font-size:11px;font-weight:600;color:#8b949e;
      text-transform:uppercase;letter-spacing:.06em;margin-top:4px;">
      Repo Requirements
    </div>
  `);

  if (repoRequirements.requiredOS) {
    items.push(compatRow(
      '🖥️ Required OS',
      repoRequirements.requiredOS.join(', '),
      checks.os?.status || 'unknown'
    ));
  }

  // Architecture warnings
  if (checks.arch?.warnings?.length > 0) {
    checks.arch.warnings.forEach(warn => {
      items.push(`
        <div style="
          padding:8px 10px;
          background:rgba(210,153,34,0.1);
          border:1px solid rgba(210,153,34,0.3);
          border-radius:6px;
          font-size:11px;
          color:#d29922;
          line-height:1.5;
        ">
          ⚠ ${warn}
        </div>
      `);
    });
  }

  // Required global tools
  if (repoRequirements.requiredTools?.length > 0) {
    items.push(`
      <div style="
        background:#0d1117;border:1px solid #21262d;
        border-radius:6px;padding:10px 12px;
      ">
        <div style="font-size:11px;color:#8b949e;margin-bottom:8px;font-weight:600;">
          🔧 Required Global Tools
        </div>
        ${repoRequirements.requiredTools.map(tool => `
          <div style="display:flex;align-items:center;gap:8px;padding:4px 0;
            font-size:12px;color:#e6edf3;border-bottom:1px solid #21262d;">
            <code style="font-family:monospace;background:#21262d;
              padding:1px 6px;border-radius:3px;font-size:11px;">
              ${tool.name}
            </code>
            <span style="color:#8b949e;font-size:11px;">${tool.description}</span>
          </div>
        `).join('')}
      </div>
    `);
  }

  // ── Compute Footprint ──────────────────────────────────────────
  if (compute.heavyDeps?.length > 0) {
    items.push(`
      <div style="
        background:rgba(248,81,73,0.06);
        border:1px solid rgba(248,81,73,0.2);
        border-radius:6px;padding:10px 12px;
      ">
        <div style="font-size:11px;color:#f85149;margin-bottom:8px;font-weight:700;">
          ⚡ Heavy Compute Dependencies
          ${compute.needsGPU ? '<span style="margin-left:6px;font-size:10px;background:rgba(248,81,73,0.2);padding:1px 6px;border-radius:99px;">GPU Required</span>' : ''}
        </div>
        ${compute.heavyDeps.map(dep => `
          <div style="display:flex;justify-content:space-between;
            font-size:11px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
            <span style="color:#e6edf3;font-family:monospace;">${dep.package}</span>
            <span style="color:#8b949e;">${dep.ram} RAM${dep.gpu ? ' · GPU' : ''}</span>
          </div>
        `).join('')}
        ${compute.footprint?.warning ? `
          <div style="margin-top:8px;font-size:11px;color:#f0883e;">
            ⚠ ${compute.footprint.warning}
          </div>
        ` : ''}
      </div>
    `);
  }

  // ── Empty state ────────────────────────────────────────────────
  if (items.length <= 1) {
    container.innerHTML = `
      <div class="gt-security-empty">
        ✅ No compatibility issues detected.
      </div>
    `;
    return;
  }

  container.innerHTML = items.join('');

  // Wire the save button for Node version input
  const saveBtn  = container.querySelector('#gt-node-save');
  const nodeInput = container.querySelector('#gt-node-input');

  if (saveBtn && nodeInput) {
    saveBtn.addEventListener('click', async () => {
      const version = nodeInput.value.trim();
      if (!version) return;

      await saveUserRuntimeVersions({ nodeVersion: version });
      saveBtn.textContent = '✓ Saved';
      saveBtn.style.background = '#3fb950';

      // Re-run analysis after a short delay so new version is used
      setTimeout(() => {
        console.log('[GitTrace] Node version saved — refresh for updated compat check');
      }, 500);
    });
  }
}

// ─── Compat Row Helper ────────────────────────────────────────────────────────

function compatRow(label, value, status, tooltip) {
  const statusIcon = status === 'ok'      ? '✅' :
                     status === 'warning'  ? '⚠️' :
                     status === 'error'    ? '❌' : '❓';

  const statusColour = status === 'ok'     ? '#3fb950' :
                       status === 'warning' ? '#d29922' :
                       status === 'error'   ? '#f85149' : '#8b949e';

  return `
    <div class="gt-compat-row" title="${tooltip || ''}">
      <span class="gt-compat-label">${label}</span>
      <span style="font-size:12px;font-weight:600;color:${statusColour};
        display:flex;align-items:center;gap:4px;">
        ${statusIcon} ${value}
      </span>
    </div>
  `;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showLoading(shadow, panel) {
  const loading = shadow.getElementById(`gt-${panel}-loading`);
  const content = shadow.getElementById(`gt-${panel}-content`);
  if (loading) loading.style.display = "";
  if (content) content.style.display = "none";
}

function hideLoading(shadow, panel) {
  const loading = shadow.getElementById(`gt-${panel}-loading`);
  if (loading) loading.style.display = "none";
}

function setSignalRow(shadow, id, value, colour) {
  const el = shadow.getElementById(id);
  if (el) {
    el.textContent = value;
    el.className = `gt-signal-value gt-${colour}`;
  }
}

// ─── Signal Helpers ───────────────────────────────────────────────────────────

function velocityResult(commitFlags) {
  if (!commitFlags || commitFlags.length === 0) return "Normal";
  const high = commitFlags.filter((f) => f.severity === "high").length;
  if (high > 0) return `${high} high severity flag${high > 1 ? "s" : ""}`;
  return `${commitFlags.length} flag${commitFlags.length > 1 ? "s" : ""}`;
}

function securityResult(securityIssues) {
  if (!securityIssues) return "Not scanned";
  const cves = securityIssues.cves?.length || 0;
  const phantoms = securityIssues.phantoms?.length || 0;
  const secrets = securityIssues.secrets?.length || 0;
  const total = cves + phantoms + secrets;
  if (total === 0) return "Clean";
  return `${total} issue${total > 1 ? "s" : ""}`;
}

function hasSecurityIssues(securityIssues) {
  if (!securityIssues) return false;
  return (
    (securityIssues.cves?.length || 0) > 0 ||
    (securityIssues.phantoms?.length || 0) > 0 ||
    (securityIssues.secrets?.length || 0) > 0
  );
}
