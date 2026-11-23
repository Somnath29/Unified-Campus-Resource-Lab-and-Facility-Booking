import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { ApiError } from './auth';

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, { status: 200, ...init });
}

export function created<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, { status: 201, ...init });
}

export function fail(status: number, message: string, details?: any): NextResponse {
  const body: { error: string; details?: any } = { error: message };
  if (details !== undefined && process.env.NODE_ENV !== 'production') {
    body.details = details;
  }
  return NextResponse.json(body, { status });
}

export function withErrorHandling(
  handler: (request: Request, context?: any) => Promise<Response | NextResponse>
) {
  return async (request: Request, context?: any): Promise<Response | NextResponse> => {
    try {
      return await handler(request, context);
    } catch (err: any) {
      if (err instanceof ZodError) {
        const firstMessage = err.errors[0]?.message || 'Validation error';
        return fail(400, firstMessage, err.errors);
      }

      if (err instanceof ApiError) {
        return fail(err.status, err.message, err.details);
      }

      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') {
          return fail(409, 'A resource with this identifier or unique field already exists.');
        }
        if (err.code === 'P2025') {
          return fail(404, 'The requested resource was not found.');
        }
      }

      console.error('Unhandled API Error:', err);
      const isProd = process.env.NODE_ENV === 'production';
      return fail(
        500,
        isProd ? 'Internal server error' : (err.message || 'Internal server error')
      );
    }
  };
}
