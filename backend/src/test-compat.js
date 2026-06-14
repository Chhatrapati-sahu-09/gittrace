/**
 * Quick test for compatibility analyzer.
 * Run: node backend/src/test-compat.js
 */

const { analyzeCompatibility, extractNodeVersion } = require('./services/compatAnalyzer');

// Test 1: extractNodeVersion
const pkg1 = JSON.stringify({ engines: { node: '>=18.0.0' } });
console.assert(extractNodeVersion(pkg1) === '>=18.0.0', '❌ engines.node test failed');
console.log('✅ extractNodeVersion: engines.node works');

const pkg2 = JSON.stringify({ volta: { node: '20.11.0' } });
console.assert(extractNodeVersion(pkg2) === '=20.11.0', '❌ volta.node test failed');
console.log('✅ extractNodeVersion: volta.node works');

// Test 2: Full compat analysis
const mockConfigFiles = [
  {
    path:    'package.json',
    content: JSON.stringify({
      engines:      { node: '>=18.0.0' },
      dependencies: { tensorflow: '^4.0.0', express: '^4.18.0' },
    }),
  },
  {
    path:    '.nvmrc',
    content: '20.11.0',
  },
];

const result = analyzeCompatibility({
  configFiles:  mockConfigFiles,
  allFilePaths: ['package.json', '.nvmrc', 'Dockerfile', 'README.md'],
  repoSizeKB:   1024,
});

console.assert(result.runtime.nodeVersion === '>=18.0.0', '❌ nodeVersion wrong');
console.assert(result.runtime.nvmrc === '20.11.0',        '❌ nvmrc wrong');
console.assert(result.compute.heavyDeps.length > 0,       '❌ heavyDeps not detected');
console.assert(result.compute.footprint.needsGPU === true, '❌ GPU not detected');
console.assert(result.tools.required.some(t => t.name === 'docker'), '❌ docker not detected');

console.log('\n✅ All compat tests passed');
console.log('Node required:  ', result.runtime.nodeVersion);
console.log('Heavy deps:     ', result.compute.heavyDeps.map(d => d.package).join(', '));
console.log('GPU required:   ', result.compute.footprint.needsGPU);
console.log('Tools required: ', result.tools.required.map(t => t.name).join(', '));
console.log('RAM estimate:   ', result.compute.footprint.ramEstimateMB + 'MB');
