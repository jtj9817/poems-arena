/** Base class for all API errors that produce structured JSON responses. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 404 – duel ID not found, or duel exists but a referenced poem row is missing. */
export class DuelNotFoundError extends ApiError {
  constructor(message = 'Duel not found') {
    super(message, 'DUEL_NOT_FOUND', 404);
    this.name = 'DuelNotFoundError';
  }
}

/** 400 – `page` query param is not a positive integer. */
export class InvalidPageError extends ApiError {
  constructor(message: string) {
    super(message, 'INVALID_PAGE', 400);
    this.name = 'InvalidPageError';
  }
}

/** 404 – request to a removed or unknown endpoint (e.g. GET /duels/today). */
export class EndpointNotFoundError extends ApiError {
  constructor(message = 'Endpoint not found') {
    super(message, 'ENDPOINT_NOT_FOUND', 404);
    this.name = 'EndpointNotFoundError';
  }
}

/** 503 – service is alive but required dependencies are not ready yet. */
export class ServiceUnavailableError extends ApiError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 'SERVICE_UNAVAILABLE', 503);
    this.name = 'ServiceUnavailableError';
  }
}
