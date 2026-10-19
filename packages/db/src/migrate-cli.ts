import { createSql, runMigrations } from './index.js';

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) throw new Error('MIGRATE_DATABASE_URL is not set (see .env.example)');
const sql = createSql(url, { max: 1 });
const applied = await runMigrations(sql);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
await sql.end();
