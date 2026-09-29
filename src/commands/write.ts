import { openProject } from '../core/project';
import { Queue, type QueueItem } from '../core/queue';
import { formatUsd } from '../core/text';
import { publishRun } from '../pipeline/publish';
import { writeArticle } from '../pipeline/run';
import { createReporter, pickReporterMode } from '../ui/reporters';

export interface WriteFlags {
  next?: boolean;
  queue?: boolean | string;
  publish?: boolean;
  images?: boolean;
  fresh?: boolean;
  budget?: string;
  json?: boolean;
}

export async function writeCommand(words: string[], flags: WriteFlags): Promise<number> {
  const project = openProject();
  const queue = new Queue(project);

  const jobs: { keyword: string; item?: QueueItem }[] = [];
  if (words.length) {
    jobs.push({ keyword: words.join(' ') });
  } else if (flags.next || flags.queue) {
    const limit =
      typeof flags.queue === 'string' ? Number(flags.queue) : flags.queue ? Infinity : 1;
    if (!Number.isFinite(limit) && limit !== Infinity) throw new Error('--queue takes a number');
    for (const item of queue.items) {
      if (item.status === 'pending' && jobs.length < limit)
        jobs.push({ keyword: item.keyword, item });
    }
    if (!jobs.length)
      throw new Error('The queue has no pending keywords. Add some with `leo queue add`.');
  } else {
    throw new Error(
      'Give me a keyword, e.g. `leo write "how to price a saas product"`, or use --next.',
    );
  }

  const budgetUsd = flags.budget ? Number(flags.budget) : undefined;
  if (budgetUsd !== undefined && !(budgetUsd > 0))
    throw new Error('--budget must be a positive number');

  const controller = new AbortController();
  let cancelled = false;
  const cancel = () => {
    if (cancelled) process.exit(130);
    cancelled = true;
    controller.abort(new Error('Cancelled'));
  };
  process.on('SIGINT', cancel);

  const reporter = createReporter(pickReporterMode(!!flags.json), cancel);
  let failures = 0;
  let total = 0;

  try {
    for (const job of jobs) {
      if (controller.signal.aborted) break;
      if (job.item) queue.set(job.item.id, 'running');
      try {
        const result = await writeArticle(
          project,
          {
            keyword: job.keyword,
            fresh: flags.fresh,
            images: flags.images,
            budgetUsd,
            signal: controller.signal,
          },
          reporter.emit,
        );
        total += result.costUsd;
        if (flags.publish) {
          const published = await publishRun(project, result.slug);
          reporter.note(`published ${result.slug} → ${published.location}`);
        }
        if (job.item) queue.set(job.item.id, 'done');
      } catch (error) {
        failures++;
        if (job.item) {
          queue.set(
            job.item.id,
            cancelled ? 'pending' : 'failed',
            cancelled ? undefined : (error as Error).message,
          );
        }
      }
    }
    if (jobs.length > 1) {
      reporter.note(
        `${jobs.length - failures}/${jobs.length} articles written · ${formatUsd(total)} total`,
      );
    }
  } finally {
    process.off('SIGINT', cancel);
    await reporter.close();
  }

  if (cancelled) return 130;
  return failures ? 1 : 0;
}
