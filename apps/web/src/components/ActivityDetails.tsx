import type { ActivityDetail as ActivityDetailType } from "@vatove/contracts";
import { useTooltip } from "../context/TooltipContext";
import { downloadActivityGpx } from "../utils/gpx";
import {
  formatActivityDate,
  formatChartDistance,
  formatDistance,
  formatDuration,
} from "../utils/format";
import { formatZoneRange, summarizeZoneTiming } from "./heartRateAnalysis";

export interface ActivityDetailsProps {
  activity: ActivityDetailType;
  expanded: boolean;
  onToggleExpanded: () => void;
}

function formatHeartRate(value: number | null): string {
  return value !== null && Number.isFinite(value) ? `${Math.round(value)} bpm` : "—";
}

export function ActivityDetails({
  activity,
  expanded,
  onToggleExpanded,
}: ActivityDetailsProps) {
  const { activeSampleIndex } = useTooltip();
  const activeSample = activity.samples.find((sample) => sample.index === activeSampleIndex);
  const activeZone = activity.heartRateZones.find(
    (zone) => zone.index === activeSample?.heartRateZone,
  );
  const zoneTiming = summarizeZoneTiming(activity.heartRateZones);

  return (
    <section className="activity-detail" aria-label={`${activity.name} details`}>
      <div className="detail-title-row">
        <div>
          <span className="eyebrow">{activity.sport}</span>
          <h1>{activity.name}</h1>
          <p>{formatActivityDate(activity.startAt)}</p>
        </div>
        <div className="detail-actions">
          <button
            type="button"
            className="expand-button"
            aria-expanded={expanded}
            onClick={onToggleExpanded}
          >
            <span aria-hidden="true">{expanded ? "↙" : "↗"}</span>
            {expanded ? "Minimise" : "Expand"}
          </button>
          <button
            type="button"
            className="export-button"
            disabled={activity.samples.length === 0}
            onClick={() => downloadActivityGpx(activity)}
          >
            <span aria-hidden="true">↓</span>
            Export GPX
          </button>
        </div>
      </div>

      <dl className="summary-stats">
        <div>
          <dt>Distance</dt>
          <dd>{formatDistance(activity.distanceMeters)}</dd>
        </div>
        <div>
          <dt>Moving time</dt>
          <dd>{formatDuration(activity.movingTimeSeconds)}</dd>
        </div>
        <div>
          <dt>Average HR</dt>
          <dd>{formatHeartRate(activity.averageHeartRateBpm)}</dd>
        </div>
        <div>
          <dt>Maximum HR</dt>
          <dd>{formatHeartRate(activity.maxHeartRateBpm)}</dd>
        </div>
      </dl>

      {activity.heartRateZones.length > 0 && (
        <section className="zone-analysis" aria-labelledby="zone-analysis-title">
          <div className="zone-heading">
            <div>
              <span className="eyebrow">Dynamic sport zones</span>
              <h2 id="zone-analysis-title">Time in zone</h2>
            </div>
            {zoneTiming.totalSeconds > 0 && <span>{formatDuration(zoneTiming.totalSeconds)}</span>}
          </div>

          {zoneTiming.hasTiming ? (
            <>
              <div className="zone-bar" aria-hidden="true">
                {zoneTiming.entries.filter((entry) => entry.seconds !== null).map(({ zone, percentage }) => (
                  <i
                    key={zone.index}
                    style={{
                      backgroundColor: zone.color,
                      width: `${percentage ?? 0}%`,
                    }}
                  />
                ))}
              </div>
              <div className="zone-list">
                {zoneTiming.entries.map(({ zone, seconds, percentage }) => {
                  return (
                    <div key={zone.index} className="zone-row">
                      <i style={{ backgroundColor: zone.color }} />
                      <span>
                        <strong>{zone.label}</strong>
                        <small>{formatZoneRange(zone.minBpm, zone.maxBpm)}</small>
                      </span>
                      <span className="zone-duration">
                        <strong>{formatDuration(seconds)}</strong>
                        <small>{percentage === null ? "—" : `${percentage.toFixed(0)}%`}</small>
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="zone-unavailable">Time in zone was not available for this activity.</p>
          )}
        </section>
      )}

      {activeSample && (
        <div className="sample-readout" role="status">
          <span>
            <small>Position</small>
            <strong>
              {activeSample.distanceMeters === null
                ? `Sample ${activeSample.sourceIndex}`
                : formatChartDistance(activeSample.distanceMeters)}
            </strong>
          </span>
          <span>
            <small>Elevation</small>
            <strong>
              {activeSample.elevationMeters === null
                ? "—"
                : `${activeSample.elevationMeters.toFixed(0)} m`}
            </strong>
          </span>
          <span>
            <small>Heart rate</small>
            <strong>
              {activeSample.heartRateBpm === null ? "—" : `${activeSample.heartRateBpm} bpm`}
            </strong>
          </span>
          {activeZone && (
            <span className="active-zone">
              <i style={{ backgroundColor: activeZone.color }} />
              <small>Zone</small>
              <strong>{activeZone.label}</strong>
            </span>
          )}
        </div>
      )}
    </section>
  );
}
