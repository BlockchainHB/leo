import { styleText } from 'node:util';
import { Command, Option } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { ConfigError } from './core/config';

const program = new Command()
  .name('leo')
  .description('Research-first SEO writing agent. Run `leo` with no arguments to chat.')
  .version(pkg.version, '-v, --version')
  .showHelpAfterError('(run `leo --help` for usage)')
  .configureHelp({ sortSubcommands: false });

const json = new Option('--json', 'machine-readable output');

program.action(async () => {
  const { openProject } = await import('./core/project');
  const project = openProject();
  const { render } = await import('ink');
  const { createElement } = await import('react');
  const { ChatApp } = await import('./ui/ChatApp');
  const app = render(createElement(ChatApp, { project }), { exitOnCtrlC: false });
  await app.waitUntilExit();
});

program
  .command('init')
  .description('set up leo.config.json and API keys in this directory')
  .action(async () => {
    const { initCommand } = await import('./commands/init');
    process.exitCode = await initCommand();
  });

program
  .command('write')
  .description('research and write an article')
  .argument('[keyword...]', 'target keyword (quotes optional)')
  .option('-n, --next', 'write the next keyword from the queue')
  .option('-q, --queue [count]', 'work through the queue (all pending, or up to <count>)')
  .option('-p, --publish', 'publish when finished')
  .option('--no-images', 'skip image generation')
  .option('--fresh', 'ignore cached stages from a previous run')
  .option('-b, --budget <usd>', 'max Claude spend for this article')
  .addOption(json)
  .addHelpText(
    'after',
    `
Examples:
  leo write how to price a saas product
  leo write "kubernetes autoscaling" --publish
  leo write --queue 5 --json > run.ndjson`,
  )
  .action(async (keyword: string[], flags) => {
    const { writeCommand } = await import('./commands/write');
    process.exitCode = await writeCommand(keyword, flags);
  });

program
  .command('publish')
  .description('publish a finished article to your CMS or content folder')
  .argument('<slug>')
  .addOption(json)
  .action(async (slug: string, flags) => {
    const { publishCommand } = await import('./commands/manage');
    process.exitCode = await publishCommand(slug, flags);
  });

const queue = program.command('queue').description('manage the keyword queue');
queue
  .command('add')
  .description('add one or more keywords')
  .argument('<keywords...>', 'each quoted keyword becomes one item')
  .addOption(json)
  .action(async (keywords: string[], flags) => {
    const { queueAdd } = await import('./commands/manage');
    process.exitCode = queueAdd(keywords, flags);
  });
queue
  .command('list', { isDefault: true })
  .alias('ls')
  .description('show pending keywords')
  .option('-a, --all', 'include finished items')
  .addOption(json)
  .action(async (flags) => {
    const { queueList } = await import('./commands/manage');
    process.exitCode = queueList(flags);
  });
queue
  .command('remove')
  .alias('rm')
  .description('remove items by id')
  .argument('<ids...>')
  .addOption(json)
  .action(async (ids: string[], flags) => {
    const { queueRemove } = await import('./commands/manage');
    process.exitCode = queueRemove(ids, flags);
  });
queue
  .command('clear')
  .description('empty the queue')
  .option('--done', 'only remove finished items')
  .addOption(json)
  .action(async (flags) => {
    const { queueClear } = await import('./commands/manage');
    process.exitCode = queueClear(flags);
  });

program
  .command('runs')
  .description('list articles and their status')
  .addOption(json)
  .action(async (flags) => {
    const { runsCommand } = await import('./commands/manage');
    process.exitCode = runsCommand(flags);
  });

program
  .command('doctor')
  .description('check Node, config, and which providers are configured')
  .addOption(json)
  .action(async (flags) => {
    const { doctorCommand } = await import('./commands/manage');
    process.exitCode = doctorCommand(flags);
  });

try {
  await program.parseAsync();
} catch (error) {
  const err = error as Error;
  console.error(`${styleText('red', '✗')} ${err.message}`);
  if (error instanceof ConfigError) {
    for (const issue of error.issues) console.error(styleText('gray', `  ${issue}`));
  } else if (process.env.LEO_DEBUG && err.stack) {
    console.error(styleText('gray', err.stack));
  }
  process.exitCode = 1;
}
