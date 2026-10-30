import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/http';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (!WRITE_METHODS.has(req.method)) {
    next();
    return;
  }
  const token = req.header('x-csrf-token');
  if (!req.auth || !token || token !== req.auth.csrfToken) {
    next(new ApiError(403, 'CSRF_INVALID', 'CSRF token không hợp lệ'));
    return;
  }
  next();
}
