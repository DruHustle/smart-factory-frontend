import { sampleValidity, type SampleValidityInput } from "@shared/measurements";

export function ObservationValidity({
  reading,
}: {
  reading?: SampleValidityInput | null;
}) {
  if (!reading) return null;
  const validity = sampleValidity(reading);
  if (validity.acquisitionMode !== "on_change") return null;
  const label =
    validity.state === "held"
      ? "Valid held value"
      : validity.state === "stale"
        ? "Held value expired"
        : "Held value unverified";
  const seconds =
    validity.validForMs == null ? null : Math.round(validity.validForMs / 1000);
  return (
    <p
      className="text-xs text-muted-foreground"
      data-value-validity={validity.state}
    >
      <strong
        className={
          validity.state === "held" ? "text-foreground" : "text-warning"
        }
      >
        {label}
      </strong>{" "}
      · on-change acquisition
      {seconds != null
        ? ` · maximum value age ${seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`}`
        : ""}
      . Communication keepalives do not update the sample time.
    </p>
  );
}
