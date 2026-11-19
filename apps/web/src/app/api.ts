/** Error from the Pattern server (HTTP status + its message). `status` 0 = unreachable. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
  get offline() {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

/**
 * JSON call to `/api` (same origin: Vite proxy in dev, reverse proxy in
 * production). Sends the session cookie and the CSRF header the server
 * requires on writes.
 */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin',
      headers: {
        'x-requested-with': 'pattern',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'Không kết nối được server');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    // the dev proxy answers 500 with an HTML/text page when the server is down
    if (res.status >= 500) throw new ApiError(0, 'Không kết nối được server');
  }
  // the Vite dev proxy answers an empty 500 when the server is not running
  if (res.status >= 500 && !text) throw new ApiError(0, 'Không kết nối được server');
  if (!res.ok) {
    const msg = (body as { message?: string | string[] } | undefined)?.message;
    throw new ApiError(res.status, Array.isArray(msg) ? msg.join(', ') : (msg ?? res.statusText), body);
  }
  return body as T;
}
