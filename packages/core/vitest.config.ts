import { defineConfig } from 'vitest/config';

// Every test file builds its own database from all the migrations, and the files run side by side. On a busy machine
// that can take longer than vitest's default five seconds for a single test, which is a slow run, not a wrong answer.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 90_000 } });
