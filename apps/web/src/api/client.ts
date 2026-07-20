import type {
  ActivityDetail,
  ActivityPage,
  ActivityRouteCollection,
  CreateSyncRun,
  SyncRun,
} from "@vatove/contracts";

const API_ROOT = "/api/v1";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as {
        detail?: unknown;
        error?: unknown;
        message?: unknown;
      };
      if (typeof body.detail === "string") message = body.detail;
      else if (typeof body.message === "string") message = body.message;
      else if (typeof body.error === "string") message = body.error;
    } catch {
      // Keep the status-based message when the server did not return JSON.
    }
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export function listActivities(options: {
  cursor?: string;
  limit?: number;
  oldest?: string;
  newest?: string;
  signal?: AbortSignal;
} = {}): Promise<ActivityPage> {
  const params = new URLSearchParams();
  params.set("limit", String(options.limit ?? 30));
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.oldest) params.set("oldest", options.oldest);
  if (options.newest) params.set("newest", options.newest);

  const init: RequestInit = {};
  if (options.signal) init.signal = options.signal;
  return request<ActivityPage>(`/activities?${params.toString()}`, init);
}

export function getActivityRoutes(options: {
  oldest?: string;
  newest?: string;
  signal?: AbortSignal;
} = {}): Promise<ActivityRouteCollection> {
  const params = new URLSearchParams();
  if (options.oldest) params.set("oldest", options.oldest);
  if (options.newest) params.set("newest", options.newest);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const init: RequestInit = {};
  if (options.signal) init.signal = options.signal;
  return request<ActivityRouteCollection>(`/activity-routes${query}`, init);
}

export function getActivity(id: string, signal?: AbortSignal): Promise<ActivityDetail> {
  const init: RequestInit = {};
  if (signal) init.signal = signal;
  return request<ActivityDetail>(`/activities/${encodeURIComponent(id)}`, init);
}

export function createSyncRun(input: CreateSyncRun = {}): Promise<SyncRun> {
  return request<SyncRun>("/sync-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getSyncRun(id: string, signal?: AbortSignal): Promise<SyncRun> {
  const init: RequestInit = {};
  if (signal) init.signal = signal;
  return request<SyncRun>(`/sync-runs/${encodeURIComponent(id)}`, init);
}
