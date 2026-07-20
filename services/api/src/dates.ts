import type { CreateSyncRun } from "@vatove/contracts";

import { HttpProblem } from "./problems.js";

export interface SyncDateRange {
  oldest: string;
  newest: string;
}

export interface OptionalDateRange {
  oldest?: string | undefined;
  newest?: string | undefined;
}

export function calendarDateInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function subtractCalendarDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

export function resolveSyncDateRange(
  input: CreateSyncRun,
  now: Date,
  timeZone: string,
): SyncDateRange {
  const today = calendarDateInTimeZone(now, timeZone);
  const newest = input.newest ?? today;
  const oldest = input.oldest ?? subtractCalendarDays(newest, 59);

  validateDateRange(oldest, newest);
  return { oldest, newest };
}

export function resolveActivityDateRange(
  input: OptionalDateRange,
  now: Date,
  timeZone: string,
): SyncDateRange {
  if ((input.oldest === undefined) !== (input.newest === undefined)) {
    throw new HttpProblem(
      400,
      "Invalid date range",
      "oldest and newest must be supplied together.",
    );
  }

  const newest = input.newest ?? calendarDateInTimeZone(now, timeZone);
  const oldest = input.oldest ?? subtractCalendarDays(newest, 59);

  validateDateRange(oldest, newest);
  return { oldest, newest };
}

function validateDateRange(oldest: string, newest: string): void {
  if (!isCalendarDate(oldest) || !isCalendarDate(newest)) {
    throw new HttpProblem(400, "Invalid date range", "Dates must be valid YYYY-MM-DD values.");
  }
  if (oldest > newest) {
    throw new HttpProblem(400, "Invalid date range", "oldest must not be after newest.");
  }
}
