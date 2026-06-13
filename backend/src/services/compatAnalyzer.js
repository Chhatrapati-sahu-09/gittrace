/**
 * GitTrace Backend — System Compatibility Analyzer
 *
 * Analyzes a repository's configuration files to determine:
 *   1. Required Node.js version (from package.json engines, .nvmrc)
 *   2. Required Python version (from .python-version, runtime.txt)
 *   3. Required OS / platform (from Dockerfile, package.json os field)
 *   4. CPU architecture requirements (x86 vs arm64 binaries)
 *   5. Heavy compute dependencies (ML models, GPU requirements)
 *   6. Missing global tools (docker, cmake, ffmpeg, etc.)
 *
 * The frontend (content.js) reads the user's environment via:
 *   - navigator.userAgent  → OS and architecture
 *   - navigator.platform   → platform string
 *
 * The backend provides what the REPO needs.
 * The frontend compares that against what the USER has.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * npm packages that indicate heavy GPU/CPU compute requirements.
 * If a repo depends on these, it will likely need significant hardware.
 */
const HEAVY_COMPUTE_PACKAGES = {
  // Machine Learning
  'tensorflow':         { label: 'TensorFlow',       ram: '4GB+',  gpu: true  },
  '@tensorflow/tfjs':   { label: 'TensorFlow.js',    ram: '2GB+',  gpu: false },
  'torch':              { label: 'PyTorch',           ram: '4GB+',  gpu: true  },
  'transformers':       { label: 'HuggingFace',       ram: '8GB+',  gpu: true  },
  'onnxruntime':        { label: 'ONNX Runtime',      ram: '2GB+',  gpu: true  },
  'onnxruntime-node':   { label: 'ONNX Runtime Node', ram: '2GB+',  gpu: true  },
  '@xenova/transformers':{ label: 'Transformers.js',  ram: '4GB+',  gpu: false },
  'llama-node':         { label: 'LLaMA Node',        ram: '8GB+',  gpu: true  },
  'node-llama-cpp':     { label: 'LLaMA CPP',         ram: '8GB+',  gpu: true  },
  'sharp':              { label: 'Sharp (image)',      ram: '512MB', gpu: false },
  'canvas':             { label: 'Canvas (native)',    ram: '256MB', gpu: false },

  // Video / Audio
  'fluent-ffmpeg':      { label: 'FFmpeg wrapper',    ram: '1GB+',  gpu: false },
  'ffmpeg-static':      { label: 'FFmpeg static',     ram: '1GB+',  gpu: false },
  'opencv4nodejs':      { label: 'OpenCV',            ram: '2GB+',  gpu: true  },

  // Databases (local)
  'better-sqlite3':     { label: 'SQLite3 (native)',  ram: '256MB', gpu: false },
  'pg-native':          { label: 'PostgreSQL native', ram: '256MB', gpu: false },
  'leveldown':          { label: 'LevelDB',           ram: '512MB', gpu: false },
};

/**
 * Python packages that indicate heavy compute.
 */
const HEAVY_PYTHON_PACKAGES = {
  'tensorflow':   { label: 'TensorFlow',      ram: '4GB+', gpu: true  },
  'torch':        { label: 'PyTorch',         ram: '4GB+', gpu: true  },
  'transformers': { label: 'HuggingFace',     ram: '8GB+', gpu: true  },
  'keras':        { label: 'Keras',           ram: '2GB+', gpu: true  },
  'sklearn':      { label: 'Scikit-learn',    ram: '1GB+', gpu: false },
  'scikit-learn': { label: 'Scikit-learn',    ram: '1GB+', gpu: false },
  'numpy':        { label: 'NumPy',           ram: '512MB',gpu: false },
  'pandas':       { label: 'Pandas',          ram: '1GB+', gpu: false },
  'opencv-python':{ label: 'OpenCV Python',   ram: '2GB+', gpu: true  },
  'llama-cpp-python':{ label: 'LLaMA CPP',   ram: '8GB+', gpu: true  },
  'diffusers':    { label: 'HuggingFace Diffusers', ram:'16GB+', gpu: true },
};

/**
 * Global system tools that repos commonly require.
 * Detected from README keywords and Dockerfile RUN commands.
 */
const GLOBAL_TOOLS = [
  { name: 'docker',    patterns: [/\bdocker\b/i, /dockerfile/i],        description: 'Docker container runtime' },
  { name: 'cmake',     patterns: [/\bcmake\b/i, /CMakeLists/],          description: 'CMake build system' },
  { name: 'ffmpeg',    patterns: [/\bffmpeg\b/i],                       description: 'FFmpeg media processing' },
  { name: 'git-lfs',   patterns: [/git.lfs/i, /\.gitattributes/],       description: 'Git Large File Storage' },
  { name: 'make',      patterns: [/\bMakefile\b/, /\bmake\b/],          description: 'Make build tool' },
  { name: 'rust',      patterns: [/\bcargo\b/i, /Cargo\.toml/],         description: 'Rust compiler and Cargo' },
  { name: 'go',        patterns: [/\bgo\.mod\b/, /\bgo build\b/i],      description: 'Go compiler' },
  { name: 'java',      patterns: [/\bpom\.xml\b/, /\bgradle\b/i],       description: 'Java JDK' },
  { name: 'python',    patterns: [/\brequirements\.txt\b/, /\.py\b/],   description: 'Python interpreter' },
  { name: 'redis',     patterns: [/\bredis\b/i],                        description: 'Redis server' },
  { name: 'postgres',  patterns: [/\bpostgres(ql)?\b/i],               description: 'PostgreSQL database' },
  { name: 'mongodb',   patterns: [/\bmongodb\b/i, /\bmongoose\b/i],    description: 'MongoDB database' },
  { name: 'kubectl',   patterns: [/\bkubectl\b/i, /kubernetes/i],       description: 'Kubernetes CLI' },
  { name: 'terraform', patterns: [/\bterraform\b/i, /\.tf\b/],          description: 'Terraform IaC tool' },
  { name: 'wasm-pack', patterns: [/\bwasm-pack\b/i, /webassembly/i],    description: 'WebAssembly Pack' },
];

/**
 * Architecture-specific package patterns.
 * These packages include pre-compiled binaries for specific architectures.
 * On wrong arch → silent failure or massive performance penalty.
 */
const ARCH_SENSITIVE_PATTERNS = [
  { pattern: /darwin-arm64/i,   arch: 'arm64',  os: 'macOS'   },
  { pattern: /darwin-x64/i,     arch: 'x86_64', os: 'macOS'   },
  { pattern: /linux-arm64/i,    arch: 'arm64',  os: 'Linux'   },
  { pattern: /linux-x64/i,      arch: 'x86_64', os: 'Linux'   },
  { pattern: /win32-x64/i,      arch: 'x86_64', os: 'Windows' },
  { pattern: /win32-arm64/i,    arch: 'arm64',  os: 'Windows' },
  { pattern: /linux-musl/i,     arch: 'any',    os: 'Alpine'  },
  { pattern: /apple.silicon/i,  arch: 'arm64',  os: 'macOS'   },
  { pattern: /m1|m2|m3/i,       arch: 'arm64',  os: 'macOS'   },
  { pattern: /x86_64|amd64/i,   arch: 'x86_64', os: 'any'     },
];

// ─── Version Parsers ──────────────────────────────────────────────────────────

/**
 * Extract required Node.js version from package.json.
 *
 * @param {string} content - package.json content
 * @returns {string | null} e.g. ">=18.0.0", "20.x", null
 */
function extractNodeVersion(content) {
  try {
    const pkg = JSON.parse(content);

    // 1. engines.node field (most reliable)
    if (pkg.engines?.node) return pkg.engines.node;

    // 2. volta.node field (used by Volta version manager)
    if (pkg.volta?.node) return `=${pkg.volta.node}`;

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract required Node version from .nvmrc file.
 * .nvmrc contains just the version number: "18.17.0" or "lts/hydrogen"
 *
 * @param {string} content
 * @returns {string | null}
 */
function extractNvmrc(content) {
  const trimmed = content.trim();
  if (!trimmed) return null;
  return trimmed;
}

/**
 * Extract required Python version from .python-version or runtime.txt.
 *
 * @param {string} content
 * @param {string} fileName
 * @returns {string | null}
 */
function extractPythonVersion(content, fileName) {
  const trimmed = content.trim();
  if (!trimmed) return null;

  // runtime.txt format: "python-3.11.0"
  if (fileName.endsWith('runtime.txt')) {
    return trimmed.replace(/^python-?/i, '');
  }

  // .python-version: just "3.11.0"
  return trimmed;
}

/**
 * Extract OS requirements from package.json os field.
 *
 * @param {string} content - package.json content
 * @returns {string[] | null} e.g. ["linux", "darwin"]
 */
function extractOSRequirements(content) {
  try {
    const pkg = JSON.parse(content);
    if (pkg.os && Array.isArray(pkg.os) && pkg.os.length > 0) {
      return pkg.os;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract CPU architecture requirements from package.json cpu field.
 *
 * @param {string} content - package.json content
 * @returns {string[] | null} e.g. ["x64", "arm64"]
 */
function extractCPURequirements(content) {
  try {
    const pkg = JSON.parse(content);
    if (pkg.cpu && Array.isArray(pkg.cpu) && pkg.cpu.length > 0) {
      return pkg.cpu;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Compute Footprint Analyzer ───────────────────────────────────────────────

/**
 * Detect heavy compute dependencies in package.json or requirements.txt.
 *
 * @param {Array<{ path: string, content: string }>} files
 * @returns {object[]} Array of detected heavy dependencies
 */
function detectComputeFootprint(files) {
  const detected = [];

  files.forEach(file => {
    const baseName = file.path.split('/').pop();

    if (baseName === 'package.json') {
      try {
        const pkg  = JSON.parse(file.content);
        const deps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.optionalDependencies,
        };

        Object.keys(deps).forEach(pkgName => {
          if (HEAVY_COMPUTE_PACKAGES[pkgName]) {
            detected.push({
              package:  pkgName,
              ...HEAVY_COMPUTE_PACKAGES[pkgName],
              ecosystem: 'npm',
            });
          }
        });
      } catch { /* skip */ }
    }

    if (baseName === 'requirements.txt' || baseName === 'Pipfile') {
      const lines = file.content.split('\n');
      lines.forEach(line => {
        const pkgName = line.split(/[>=<!]/)[0].trim().toLowerCase();
        if (HEAVY_PYTHON_PACKAGES[pkgName]) {
          detected.push({
            package:  pkgName,
            ...HEAVY_PYTHON_PACKAGES[pkgName],
            ecosystem: 'PyPI',
          });
        }
      });
    }
  });

  // Remove duplicates
  const seen = new Set();
  return detected.filter(d => {
    if (seen.has(d.package)) return false;
    seen.add(d.package);
    return true;
  });
}

// ─── Global Tools Detector ────────────────────────────────────────────────────

/**
 * Detect required global tools from file tree and README content.
 *
 * @param {string[]}  filePaths    - All file paths in the repo
 * @param {string}    readmeContent - README file content if available
 * @returns {object[]} Array of required global tools
 */
function detectRequiredTools(filePaths, readmeContent) {
  const required = [];
  const allText  = [
    filePaths.join('\n'),
    readmeContent || '',
  ].join('\n');

  GLOBAL_TOOLS.forEach(tool => {
    const isRequired = tool.patterns.some(pattern => pattern.test(allText));
    if (isRequired) {
      required.push({
        name:        tool.name,
        description: tool.description,
      });
    }
  });

  return required;
}

// ─── Architecture Analyzer ────────────────────────────────────────────────────

/**
 * Detect architecture-specific binaries or requirements.
 *
 * @param {Array<{ path: string, content: string }>} files
 * @param {string[]} filePaths
 * @returns {object[]} Array of architecture requirements detected
 */
function detectArchRequirements(files, filePaths) {
  const detected = [];
  const allText  = [
    filePaths.join('\n'),
    ...files.map(f => f.content.substring(0, 2000)),
  ].join('\n');

  ARCH_SENSITIVE_PATTERNS.forEach(({ pattern, arch, os }) => {
    if (pattern.test(allText)) {
      detected.push({ arch, os, pattern: pattern.source });
    }
  });

  // Remove duplicates
  const seen = new Set();
  return detected.filter(d => {
    const key = `${d.arch}-${d.os}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Storage Estimator ────────────────────────────────────────────────────────

/**
 * Estimate storage and memory footprint based on repo size and dependencies.
 *
 * @param {number}   repoSizeKB   - Repo size from GitHub metadata
 * @param {object[]} computeDeps  - Heavy compute deps detected
 * @returns {{
 *   diskEstimateMB: number,
 *   ramEstimateMB:  number,
 *   needsGPU:       boolean,
 *   warning:        string | null
 * }}
 */
function estimateFootprint(repoSizeKB, computeDeps) {
  // Base: repo source code
  let diskMB = Math.ceil(repoSizeKB / 1024);

  // Add node_modules estimate (average 5-10x source size for JS projects)
  diskMB += Math.min(diskMB * 6, 500);

  // Add compute dependency sizes
  const GPU_PACKAGES = computeDeps.filter(d => d.gpu);
  if (GPU_PACKAGES.length > 0) {
    diskMB += GPU_PACKAGES.length * 2000;  // ML models are huge
  }

  // RAM estimate
  let ramMB = 256;  // Base Node.js
  computeDeps.forEach(dep => {
    const ramStr  = dep.ram || '256MB';
    const ramNum  = parseInt(ramStr.replace(/[^0-9]/g, '')) || 256;
    const isGB    = ramStr.includes('GB');
    ramMB        += isGB ? ramNum * 1024 : ramNum;
  });

  const needsGPU = GPU_PACKAGES.length > 0;
  let warning    = null;

  if (diskMB > 10000) {
    warning = `Estimated ${Math.round(diskMB / 1024)}GB disk space required`;
  }
  if (ramMB > 8192) {
    warning = (warning ? warning + '. ' : '') +
              `Requires ~${Math.round(ramMB / 1024)}GB RAM`;
  }
  if (needsGPU) {
    warning = (warning ? warning + '. ' : '') + 'GPU recommended for ML dependencies';
  }

  return { diskEstimateMB: diskMB, ramEstimateMB: ramMB, needsGPU, warning };
}

// ─── Main Export Function ─────────────────────────────────────────────────────

/**
 * Run full compatibility analysis on a repository.
 *
 * @param {object} params
 * @param {Array<{ path: string, content: string }>} params.configFiles
 *   Config files with content (package.json, requirements.txt, etc.)
 * @param {string[]} params.allFilePaths
 *   All file paths in the repo (for tool detection)
 * @param {number}   params.repoSizeKB
 *   Repository size from GitHub metadata
 *
 * @returns {object} Full compatibility report
 */
function analyzeCompatibility({ configFiles, allFilePaths, repoSizeKB }) {
  console.log(`\n[Compat] Analyzing compatibility for ${configFiles.length} config files`);

  const result = {
    runtime: {
      nodeVersion:   null,
      pythonVersion: null,
      nvmrc:         null,
    },
    platform: {
      requiredOS:    null,
      requiredCPU:   null,
      archWarnings:  [],
    },
    tools: {
      required: [],
    },
    compute: {
      heavyDeps:      [],
      footprint:      null,
    },
    rawConfigFiles: [],
  };

  // ── Step 1: Parse each config file ────────────────────────────
  let readmeContent = '';

  configFiles.forEach(file => {
    const baseName = file.path.split('/').pop();
    result.rawConfigFiles.push(baseName);

    switch (baseName) {

      case 'package.json': {
        const nodeVer = extractNodeVersion(file.content);
        if (nodeVer) result.runtime.nodeVersion = nodeVer;

        const os  = extractOSRequirements(file.content);
        const cpu = extractCPURequirements(file.content);
        if (os)  result.platform.requiredOS  = os;
        if (cpu) result.platform.requiredCPU = cpu;
        break;
      }

      case '.nvmrc': {
        const nvmVer = extractNvmrc(file.content);
        if (nvmVer) result.runtime.nvmrc = nvmVer;
        break;
      }

      case '.python-version':
      case 'runtime.txt': {
        const pyVer = extractPythonVersion(file.content, baseName);
        if (pyVer) result.runtime.pythonVersion = pyVer;
        break;
      }
    }

    // Collect README for tool detection
    if (
      baseName.toLowerCase() === 'readme.md' ||
      baseName.toLowerCase() === 'readme'
    ) {
      readmeContent = file.content;
    }
  });

  // Use .nvmrc if engines.node not specified
  if (!result.runtime.nodeVersion && result.runtime.nvmrc) {
    result.runtime.nodeVersion = result.runtime.nvmrc;
  }

  // ── Step 2: Detect required global tools ──────────────────────
  result.tools.required = detectRequiredTools(allFilePaths, readmeContent);

  // ── Step 3: Detect architecture requirements ──────────────────
  result.platform.archWarnings = detectArchRequirements(configFiles, allFilePaths);

  // ── Step 4: Detect heavy compute dependencies ─────────────────
  result.compute.heavyDeps = detectComputeFootprint(configFiles);

  // ── Step 5: Estimate storage/RAM footprint ────────────────────
  result.compute.footprint = estimateFootprint(
    repoSizeKB || 0,
    result.compute.heavyDeps
  );

  console.log(`[Compat] Node: ${result.runtime.nodeVersion || 'not specified'}`);
  console.log(`[Compat] Python: ${result.runtime.pythonVersion || 'not specified'}`);
  console.log(`[Compat] Tools: ${result.tools.required.map(t => t.name).join(', ') || 'none'}`);
  console.log(`[Compat] Heavy deps: ${result.compute.heavyDeps.length}`);
  console.log(`[Compat] Arch warnings: ${result.platform.archWarnings.length}`);

  return result;
}

module.exports = {
  analyzeCompatibility,
  detectComputeFootprint,
  detectRequiredTools,
  extractNodeVersion,
  extractPythonVersion,
  HEAVY_COMPUTE_PACKAGES,
};
