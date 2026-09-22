import { Request, Response, NextFunction } from 'express';
import AppError from '../utils/errorHandler';

const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  console.error('🔥 CRITICAL API ERROR LOG:', {
    route: req.originalUrl || req.url,
    method: req.method,
    body: req.body,
    params: req.params,
    query: req.query,
    user: (req as any).user ? { id: (req as any).user.id || (req as any).user._id, role: (req as any).user.role } : null,
    errorMessage: message,
    stack: err.stack,
  });
  
  const isDev = process.env.NODE_ENV === 'development';

  res.status(statusCode).json({
    success: false,
    message: statusCode === 500 && !isDev ? 'An unexpected internal error occurred' : message,
    ...(isDev && { stack: err.stack }),
    error: err.name || 'Error'
  });
};

export default errorHandler;