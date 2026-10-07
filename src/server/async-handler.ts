import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Wrap async route handlers so rejected promises become Express errors. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function sendError(res: Response, err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : String(err);
  res.status(status).json({ error: message });
}
