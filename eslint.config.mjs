// Minimal flat config: run with `npx eslint .`
export default [
  { ignores: ['node_modules/**', 'test/output/**', 'test/fixtures/**'] },
  {
    files: ['js/**/*.js', 'test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024, sourceType: 'module',
      globals: Object.fromEntries(['window', 'document', 'navigator', 'localStorage', 'URL', 'Blob', 'File', 'MediaRecorder', 'MediaStream', 'AudioContext', 'OfflineAudioContext', 'Image', 'Audio', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'console', 'ResizeObserver', 'crypto', 'btoa', 'process', 'Buffer', 'decodeURIComponent'].map((g) => [g, 'readonly'])),
    },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none' }], 'no-dupe-keys': 'error', 'no-unreachable': 'error', 'no-const-assign': 'error', 'no-redeclare': 'error', 'no-unsafe-finally': 'error' },
  },
];
