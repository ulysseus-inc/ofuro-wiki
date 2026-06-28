import { spawnSync } from 'node:child_process';

spawnSync('yarn', ['r', 'ofuro.ts', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
