import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import path from 'node:path';

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  resolve: {
    alias: [
      { find: '@repo-archive/shared/policy', replacement: path.resolve('packages/shared/src/policy.ts') },
      { find: '@repo-archive/shared', replacement: path.resolve('packages/shared/src/index.ts') },
      { find: '@repo-archive/archive-format', replacement: path.resolve('packages/archive-format/src/index.ts') },
      { find: '@repo-archive/git-exec', replacement: path.resolve('packages/git-exec/src/index.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts', 'apps/api/test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
