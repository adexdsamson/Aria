export class OAuthConfigMissingError extends Error {
  override readonly name = 'OAuthConfigMissingError';
}

export class TokenInvalidError extends Error {
  override readonly name = 'TokenInvalidError';
  readonly reason: 'expired' | 'revoked';
  constructor(opts: { reason: 'expired' | 'revoked'; message?: string }) {
    super(opts.message ?? `Microsoft token ${opts.reason}`);
    this.reason = opts.reason;
  }
}

export class GraphHttpError extends Error {
  override readonly name = 'GraphHttpError';
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class GraphRecurrenceUnsupported extends Error {
  override readonly name = 'GraphRecurrenceUnsupported';
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

export class DeltaExpiredError extends Error {
  override readonly name = 'DeltaExpiredError';
}

export class TransientGraphError extends Error {
  override readonly name = 'TransientGraphError';
}

export class EtagMismatchError extends Error {
  override readonly name = 'EtagMismatchError';
}
