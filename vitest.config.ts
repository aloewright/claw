import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    projects: [
      // Server-side Worker tests (existing)
      {
        test: {
          name: 'server',
          globals: true,
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/client/**'],
          coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            exclude: ['src/client/**', 'node_modules/**', '**/*.test.ts'],
          },
        },
      },
      // Client-side React component tests
      {
        plugins: [react()],
        test: {
          name: 'client',
          globals: true,
          environment: 'jsdom',
          include: ['src/client/**/*.test.{ts,tsx}'],
          setupFiles: ['src/client/test-setup.ts'],
        },
      },
    ],
  },
});
