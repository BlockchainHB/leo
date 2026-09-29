import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: false,
  clean: true,
  // Dependencies stay external; npm installs them next to the bundle.
  outputOptions: { banner: '#!/usr/bin/env node' },
});
