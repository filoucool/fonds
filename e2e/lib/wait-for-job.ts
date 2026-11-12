import type { APIRequestContext } from '@playwright/test';

interface JobBody {
  state?: string;
  errorMessage?: string | null;
}

export async function waitForJob(
  request: APIRequestContext,
  jobId: string,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<JobBody> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const intervalMs = options?.intervalMs ?? 400;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await request.get(`/api/jobs/${jobId}`);
    if (!response.ok()) {
      throw new Error(`job ${jobId} lookup failed: HTTP ${response.status()}`);
    }
    const body: unknown = await response.json();
    if (!isJobBody(body)) {
      throw new Error(`job ${jobId} returned an unexpected body`);
    }
    if (body.state === 'completed') return body;
    if (body.state === 'failed' || body.state === 'cancelled') {
      throw new Error(`job ${jobId} ended as ${body.state}: ${body.errorMessage ?? 'no message'}`);
    }
    await delay(intervalMs);
  }
  throw new Error(`timed out waiting for job ${jobId}`);
}

function isJobBody(value: unknown): value is JobBody {
  return typeof value === 'object' && value !== null && 'state' in value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
