import { randomUUID } from "node:crypto";

import { createSyncRunSchema } from "@vatove/contracts";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { resolveSyncDateRange } from "./dates.js";
import type { ReadinessChecker } from "./health.js";
import type { Logger } from "./logger.js";
import { HttpProblem, notFound, problemHandler } from "./problems.js";
import type { ActivitiesStore, SyncRunsStore } from "./repositories.js";

export interface AppDependencies {
  syncRuns: SyncRunsStore;
  activities: ActivitiesStore;
  readiness: ReadinessChecker;
  logger: Logger;
  appTimezone: string;
  clock?: () => Date;
}

const idSchema = z.string().uuid();
const listActivitiesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).optional(),
});

type AsyncRequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => Promise<void>;

function asyncHandler(handler: AsyncRequestHandler) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response, next).catch(next);
  };
}

export function createApp(dependencies: AppDependencies): express.Express {
  const app = express();
  const clock = dependencies.clock ?? (() => new Date());

  app.disable("x-powered-by");
  app.use((request, response, next) => {
    const requestId = request.header("x-request-id") ?? randomUUID();
    response.setHeader("x-request-id", requestId);
    response.setHeader("cache-control", "no-store");
    next();
  });
  app.use(express.json({ limit: "1mb", strict: true }));

  app.get("/api/v1/health/live", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.get(
    "/api/v1/health/ready",
    asyncHandler(async (_request, response) => {
      const ready = await dependencies.readiness.isReady();
      response.status(ready ? 200 : 503).json({ status: ready ? "ok" : "unavailable" });
    }),
  );

  app.post(
    "/api/v1/sync-runs",
    asyncHandler(async (request, response) => {
      const parsed = createSyncRunSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        throw new HttpProblem(
          400,
          "Invalid sync request",
          parsed.error.issues[0]?.message ?? "The request body is invalid.",
        );
      }
      const range = resolveSyncDateRange(parsed.data, clock(), dependencies.appTimezone);
      const syncRun = await dependencies.syncRuns.create(range);
      response.status(202).json(syncRun);
    }),
  );

  app.get(
    "/api/v1/sync-runs/:id",
    asyncHandler(async (request, response) => {
      const id = parseId(request.params.id);
      const syncRun = await dependencies.syncRuns.findById(id);
      if (!syncRun) throw notFound("The requested sync run does not exist.");
      response.json(syncRun);
    }),
  );

  app.get(
    "/api/v1/activities",
    asyncHandler(async (request, response) => {
      const parsed = listActivitiesSchema.safeParse(request.query);
      if (!parsed.success) {
        throw new HttpProblem(
          400,
          "Invalid pagination",
          parsed.error.issues[0]?.message ?? "The pagination parameters are invalid.",
        );
      }
      const page = await dependencies.activities.list(parsed.data.limit, parsed.data.cursor);
      response.json(page);
    }),
  );

  app.get(
    "/api/v1/activities/:id",
    asyncHandler(async (request, response) => {
      const id = parseId(request.params.id);
      const activity = await dependencies.activities.findById(id);
      if (!activity) throw notFound("The requested activity does not exist.");
      response.json(activity);
    }),
  );

  app.use((request, _response, next) => {
    next(notFound(`No endpoint exists for ${request.method} ${request.path}.`));
  });
  app.use(problemHandler(dependencies.logger));

  return app;
}

function parseId(value: unknown): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw notFound("The requested resource does not exist.");
  return parsed.data;
}
