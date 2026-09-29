export class HttpError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    body: string,
  ) {
    super(`${service} returned ${status}${body ? `: ${body.slice(0, 300)}` : ''}`);
    this.name = 'HttpError';
  }
}

interface RequestOptions extends Omit<RequestInit, 'signal'> {
  service: string;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * fetch + timeout + retry with exponential backoff (honouring Retry-After).
 * Every provider goes through here so failures read the same everywhere.
 */
export async function request(url: string, options: RequestOptions): Promise<Response> {
  const { service, timeoutMs = 60_000, retries = 2, signal, ...init } = options;

  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetch(url, { ...init, signal: combined });
      if (response.ok) return response;
      if (attempt < retries && RETRYABLE.has(response.status)) {
        await sleep(retryDelay(response, attempt), signal);
        continue;
      }
      throw new HttpError(service, response.status, await response.text().catch(() => ''));
    } catch (error) {
      if (error instanceof HttpError || signal?.aborted) throw error;
      if (attempt >= retries) {
        const reason = timeout.aborted ? `timed out after ${timeoutMs / 1000}s` : String(error);
        throw new Error(`${service} request failed: ${reason}`);
      }
      await sleep(500 * 2 ** attempt, signal);
    }
  }
}

export async function requestJson<T>(url: string, options: RequestOptions): Promise<T> {
  const response = await request(url, options);
  return (await response.json()) as T;
}

function retryDelay(response: Response, attempt: number): number {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 30_000);
  return 1000 * 2 ** attempt;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}
