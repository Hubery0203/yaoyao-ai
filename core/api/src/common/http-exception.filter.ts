import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import {
  AuthenticationError,
  AuthorizationError,
  DuplicateEntityError,
  EntityNotFoundError,
  IdempotencyKeyReusedError,
  PersistenceConflictError,
  PersistenceError,
  StaleWriteError,
} from "@yaoyao/application";
import { DomainError } from "@yaoyao/domain";
import type { Request, Response } from "express";

/**
 * Central domain/application → HTTP error translation (proposal §H).
 *
 * Every error leaves the host inside the standard envelope
 * { error: { code, message } }. Internal details (SQL, constraint names,
 * stack traces) never cross the boundary — unknown failures become a
 * generic 500 and are logged server-side.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("DomainExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, code, message } = this.translate(exception);

    if (status >= 500) {
      this.logger.error(
        {
          method: request.method,
          path: request.path,
          code,
          err:
            exception instanceof Error
              ? { name: exception.name, message: exception.message }
              : String(exception),
        },
        "unhandled error",
      );
    }

    response.status(status).json({ error: { code, message } });
  }

  private translate(exception: unknown): {
    status: number;
    code: string;
    message: string;
  } {
    // NestJS-native errors (BadRequestException from validation, etc.)
    // already carry a status; normalize them into the envelope.
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const body =
        typeof res === "object" && res !== null
          ? (res as Record<string, unknown>)
          : {};
      const code =
        typeof body["code"] === "string" ? body["code"] : "BAD_REQUEST";
      return {
        status: exception.getStatus(),
        code,
        message: exception.message,
      };
    }

    if (exception instanceof AuthenticationError) {
      return {
        status: HttpStatus.UNAUTHORIZED,
        code: exception.code,
        message: "authentication required or failed",
      };
    }
    if (exception instanceof AuthorizationError) {
      return {
        status: HttpStatus.FORBIDDEN,
        code: exception.code,
        message: "forbidden",
      };
    }
    if (exception instanceof EntityNotFoundError) {
      return { status: HttpStatus.NOT_FOUND, code: exception.code, message: exception.message };
    }
    if (exception instanceof DuplicateEntityError) {
      return { status: HttpStatus.CONFLICT, code: exception.code, message: exception.message };
    }
    if (exception instanceof IdempotencyKeyReusedError) {
      return { status: HttpStatus.CONFLICT, code: exception.code, message: exception.message };
    }
    if (
      exception instanceof StaleWriteError ||
      exception instanceof PersistenceConflictError
    ) {
      return {
        status: HttpStatus.CONFLICT,
        code: exception.code,
        message: "conflicting write; reload and retry",
      };
    }
    if (exception instanceof PersistenceError) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: "PERSISTENCE_ERROR",
        message: "storage failure",
      };
    }
    if (exception instanceof DomainError) {
      // A domain invariant fired on a request path — 422, no internal detail.
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: "DOMAIN_INVARIANT",
        message: "request violates a core invariant",
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: "INTERNAL_ERROR",
      message: "internal error",
    };
  }
}
