import { requireEnv } from '../core/env';
import { requestJson } from '../core/http';

interface ImageResponse {
  data?: { b64_json?: string; url?: string; media_type?: string }[];
  usage?: { cost?: number };
}

export interface GeneratedImage {
  bytes: Buffer;
  extension: string;
  costUsd: number;
}

/** OpenRouter's unified Image API (`/api/v1/images`). */
export async function generateImage(options: {
  model: string;
  prompt: string;
  aspectRatio: '16:9' | '3:2' | '1:1';
  signal?: AbortSignal;
}): Promise<GeneratedImage> {
  const body = await requestJson<ImageResponse>('https://openrouter.ai/api/v1/images', {
    service: 'OpenRouter',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireEnv('OPENROUTER_API_KEY')}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/BlockchainHB/leo',
      'X-Title': 'Leo',
    },
    body: JSON.stringify({
      model: options.model,
      prompt: options.prompt,
      aspect_ratio: options.aspectRatio,
      output_format: 'webp',
      n: 1,
    }),
    timeoutMs: 180_000,
    signal: options.signal,
  });

  const image = body.data?.[0];
  if (!image?.b64_json) throw new Error('OpenRouter returned no image');
  const extension = image.media_type?.split('/')[1]?.replace('jpeg', 'jpg') ?? 'webp';
  return {
    bytes: Buffer.from(image.b64_json, 'base64'),
    extension,
    costUsd: body.usage?.cost ?? 0,
  };
}
