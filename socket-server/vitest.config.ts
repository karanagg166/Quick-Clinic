import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 20000,
    fileParallelism: false,
    include: ['__tests__/**/*.{test,spec}.{ts,js}'],
  },
});
