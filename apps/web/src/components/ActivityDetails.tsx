import type { ActivityDetail as ActivityDetailType } from "@vatove/contracts";
import { useTooltip } from "../context/TooltipContext";
import { downloadActivityGpx } from "../utils/gpx";
import {
  formatActivityDate,
  formatChartDistance,
  formatDistance,
  formatDuration,
} from "../utils/format";

export interface ActivityDetailsProps {
  activity: ActivityDetailType;
}

export function ActivityDetails({ activity }: ActivityDetailsProps) {
  const { activeSampleIndex } = useTooltip();
  const activeSample = activity.samples.find((sample) => sample.index === activeSampleIndex);
  const activeZone = activity.heartRateZones.find(
    (zone) => zone.index === activeSample?.heartRateZone,
  );

  return (
    <section className="activity-detail" aria-label={`${activity.name} details`}>
      <div className="detail-title-row">
        <div>
          <span className="eyebrow">{activity.sport}</span>
          <h1>{activity.name}</h1>
          <p>{formatActivityDate(activity.startAt)}</p>
        </div>
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
          <dt>Route samples</dt>
          <dd>{activity.samples.length.toLocaleString()}</dd>
        </div>
      </dl>

      {activity.hasHeartRate && activity.heartRateZones.length > 0 && (
        <div className="zone-legend" aria-label="Heart-rate zones">
          {activity.heartRateZones.map((zone) => (
            <span key={zone.index}>
              <i style={{ backgroundColor: zone.color }} />
              {zone.label}
            </span>
          ))}
        </div>
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
