import { createSql, runMigrations } from './index.js';

// Local development: read the repository's .env. Variables already in the environment always win, so production is unchanged.
try { process.loadEnvFile(new URL('../../../.env', import.meta.url)); } catch { /* no .env file */ }

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) throw new Error('MIGRATE_DATABASE_URL is not set (see .env.example)');
const sql = createSql(url, { max: 1 });
const applied = await runMigrations(sql);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
await sql.end();
