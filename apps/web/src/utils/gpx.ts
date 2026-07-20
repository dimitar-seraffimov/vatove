import type { ActivityDetail, ActivitySample } from "@vatove/contracts";

export interface GpxOptions {
  includeTimestamps?: boolean;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function finiteCoordinate(sample: ActivitySample): boolean {
  return Number.isFinite(sample.longitude) && Number.isFinite(sample.latitude);
}

function timestampFor(startAt: string, elapsedSeconds: number | null): string | null {
  if (elapsedSeconds === null || !Number.isFinite(elapsedSeconds)) return null;
  const start = new Date(startAt).getTime();
  if (!Number.isFinite(start)) return null;
  return new Date(start + Math.max(0, elapsedSeconds) * 1_000).toISOString();
}

export function serializeActivityToGpx(
  activity: ActivityDetail,
  options: GpxOptions = {},
): string {
  const includeTimestamps = options.includeTimestamps ?? true;
  const points = activity.samples.filter(finiteCoordinate);
  const trackPoints = points
    .map((sample) => {
      const attributes = `lat="${sample.latitude.toFixed(7)}" lon="${sample.longitude.toFixed(7)}"`;
      const elevation =
        sample.elevationMeters !== null && Number.isFinite(sample.elevationMeters)
          ? `<ele>${sample.elevationMeters.toFixed(3)}</ele>`
          : "";
      const timestamp = includeTimestamps
        ? timestampFor(activity.startAt, sample.elapsedSeconds)
        : null;
      const time = timestamp ? `<time>${timestamp}</time>` : "";
      return `      <trkpt ${attributes}>${elevation}${time}</trkpt>`;
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Vatove" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    "  <metadata>",
    `    <name>${escapeXml(activity.name)}</name>`,
    `    <time>${escapeXml(activity.startAt)}</time>`,
    "  </metadata>",
    "  <trk>",
    `    <name>${escapeXml(activity.name)}</name>`,
    "    <trkseg>",
    trackPoints,
    "    </trkseg>",
    "  </trk>",
    "</gpx>",
    "",
  ].join("\n");
}

function safeFilename(name: string): string {
  const printableName = [...name.normalize("NFKD")]
    .map((character) => (character.codePointAt(0)! < 32 ? "-" : character))
    .join("");
  const normalized = printableName
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${normalized || "activity"}.gpx`;
}

export function downloadActivityGpx(activity: ActivityDetail): void {
  const blob = new Blob([serializeActivityToGpx(activity)], {
    type: "application/gpx+xml",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeFilename(activity.name);
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
