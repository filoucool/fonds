export class HttpError extends Error {
  readonly details: Record<string, unknown>;

  constructor(readonly status: number, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'HttpError';
    this.details = details;
  }
}

export class StorageThresholdError extends Error {
  readonly category = 'storage';

  constructor(message = 'free space is below the pool threshold') {
    super(message);
    this.name = 'StorageThresholdError';
  }
}

export class RateLimitError extends Error {
  readonly category = 'rate_limit';

  constructor(message: string, readonly retryAt: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class ComponentLimitError extends Error {
  readonly category = 'limit';

  constructor(message = 'component size limit reached') {
    super(message);
    this.name = 'ComponentLimitError';
  }
}

export class JobInterrupted extends Error {
  constructor(readonly outcome: 'paused' | 'cancelled') {
    super(outcome);
    this.name = 'JobInterrupted';
  }
}
