import { createHash, createHmac, randomUUID } from 'node:crypto';
import { config } from '../config';

export interface InternalCallOptions {
  method?: string;
  timeoutMs?: number;
}

export async function callGoInternal<T = unknown>(
  path: string,
  payload: unknown,
  options: InternalCallOptions = {}
): Promise<T> {
  const method = options.method ?? 'POST';
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const signature = createHmac('sha256', config.security.internalHmacSecret)
    .update(`${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`)
    .digest('hex');

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? config.security.internalTimeoutMs
  );
  try {
    const response = await fetch(`${config.security.goInternalUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-timestamp': timestamp,
        'x-nonce': nonce,
        'x-body-sha256': bodyHash,
        'x-signature': signature
      },
      body: body || undefined,
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`internal ${path} returned ${response.status}`);
    }
    if (!text) return null as T;
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}
