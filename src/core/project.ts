import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ConfigError, findConfig, type LeoConfig, loadConfig } from './config';
import { loadDotEnv } from './env';

export interface Project {
  root: string;
  configPath: string;
  config: LeoConfig;
  /** `.leo/` holds runs and the queue. It's safe to delete. */
  stateDir: string;
  runsDir: string;
}

export function openProject(cwd = process.cwd()): Project {
  const configPath = findConfig(cwd);
  if (!configPath) {
    throw new ConfigError('No leo.config.json found here or in any parent directory.', [
      'Run `leo init` to create one.',
    ]);
  }
  const root = dirname(configPath);
  loadDotEnv(root);
  const stateDir = join(root, '.leo');
  const runsDir = join(stateDir, 'runs');
  mkdirSync(runsDir, { recursive: true });
  return { root, configPath, config: loadConfig(configPath), stateDir, runsDir };
}
