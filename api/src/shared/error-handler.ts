import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z, ZodError } from 'zod';
import { AppError } from './errors.ts';
import { logger } from './logger.ts';

// Lab reference: section 1.3 (src/shared/error-handler.ts).

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Route ${req.method} ${req.path} not found`));
};

// Express recognises an error handler by its FOUR parameters.
// Every error thrown anywhere in the app ends up here.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // 1. Validation errors raised by schema.parse(...)
  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request contains invalid data',
        details: z.flattenError(err).fieldErrors,
      },
    });
    return;
  }

  // 2. Errors we threw on purpose
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  // 3. Malformed JSON body (thrown by express.json())
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' },
    });
    return;
  }

  // 4. EVENTPASS MODIFICATION OF THE LAB (ADR-007):
  // a body larger than the express.json() limit is rejected by the body
  // parser with type 'entity.too.large'. The lab handler had no branch for
  // it, so the client received a misleading 500. Answer 413 instead.
  if (isPayloadTooLarge(err)) {
    res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'The request body is too large',
      },
    });
    return;
  }

  // 5. Anything else is a bug: log it, but never leak details to the client.
  logger.error(err, 'Unhandled error');
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
  });
};

function isPayloadTooLarge(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    err.type === 'entity.too.large'
  );
}
