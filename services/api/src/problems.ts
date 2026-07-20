import type { NextFunction, Request, Response } from "express";

import type { Logger } from "./logger.js";
import { errorContext } from "./logger.js";

const TYPE_BASE = "https://vatove.local/problems";

export class HttpProblem extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail: string | undefined;
  readonly type: string;

  constructor(status: number, title: string, detail?: string, type = "request-error") {
    super(detail ?? title);
    this.name = "HttpProblem";
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.type = `${TYPE_BASE}/${type}`;
  }
}

export function notFound(detail: string): HttpProblem {
  return new HttpProblem(404, "Not found", detail, "not-found");
}

export function problemHandler(log: Logger) {
  return (error: unknown, request: Request, response: Response, _next: NextFunction): void => {
    let problem: HttpProblem;
    if (error instanceof HttpProblem) {
      problem = error;
    } else if (
      error instanceof SyntaxError &&
      "status" in error &&
      (error as SyntaxError & { status: unknown }).status === 400
    ) {
      problem = new HttpProblem(400, "Invalid JSON", "The request body is not valid JSON.");
    } else {
      problem = new HttpProblem(
        500,
        "Internal server error",
        "The request could not be completed.",
        "internal-error",
      );
      log.error("Unhandled request error", {
        method: request.method,
        path: request.path,
        ...errorContext(error),
      });
    }

    const body: { type: string; title: string; status: number; detail?: string } = {
      type: problem.type,
      title: problem.title,
      status: problem.status,
    };
    if (problem.detail !== undefined) body.detail = problem.detail;
    response.status(problem.status).type("application/problem+json").json(body);
  };
}
