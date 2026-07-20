export type PaceDistance = 100 | 1_000;

/** Returns the conventional pace distance for sports that are pace-oriented. */
export function paceDistanceForSport(sport: string): PaceDistance | null {
  const normalized = sport.trim().toLocaleLowerCase();
  if (normalized.includes("swim")) return 100;
  if (
    normalized.includes("run") ||
    normalized.includes("walk") ||
    normalized.includes("hike")
  ) {
    return 1_000;
  }
  return null;
}
