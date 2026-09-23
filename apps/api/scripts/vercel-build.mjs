import { spawnSync } from 'node:child_process';

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('npx', ['prisma', 'generate']);

const shouldMigrate = process.env.VERCEL_ENV === 'production' || process.env.RUN_MIGRATIONS === 'true';
if (shouldMigrate) {
  const migrationUrl = process.env.DIRECT_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!migrationUrl) {
    console.error('DATABASE_URL is required to run Prisma migrations.');
    process.exit(1);
  }
  run('npx', ['prisma', 'migrate', 'deploy'], { ...process.env, DATABASE_URL: migrationUrl });
} else {
  console.log('Skipping prisma migrate deploy outside production. Set RUN_MIGRATIONS=true for an isolated preview database.');
}

