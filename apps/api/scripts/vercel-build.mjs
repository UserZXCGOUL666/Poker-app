import { spawnSync } from 'node:child_process';

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Build-time client generation only.
// Database schema changes are intentionally NEVER executed by the application deploy.
run('npx', ['prisma', 'generate']);
