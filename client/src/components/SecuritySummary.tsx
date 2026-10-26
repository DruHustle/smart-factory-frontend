import { trpc } from "@/lib/trpc";
/** Complete list fallback; never requires a model, WebGL or optional collector. */
export default function SecuritySummary({
  kind,
  id,
}: {
  kind: "asset" | "device";
  id: number;
}) {
  const access = trpc.security.availability.useQuery();
  const findings = trpc.security.findings.useQuery(
    { targetKind: kind, targetId: id },
    {
      enabled: access.data?.enabled === true && Number.isInteger(id) && id > 0,
    },
  );
  return (
    <section
      aria-label="Cybersecurity summary"
      className="space-y-2 rounded border p-4"
    >
      <h2 className="font-semibold">Cybersecurity</h2>
      {!access.data?.enabled ? (
        <p className="text-sm">
          Security evidence is unconfigured or unavailable. No security
          assessment is implied.
        </p>
      ) : findings.isLoading ? (
        <p role="status" className="text-sm">
          Loading scoped security evidence…
        </p>
      ) : findings.error ? (
        <p role="status" className="text-sm">
          Security evidence is temporarily unavailable.
        </p>
      ) : (
        <p className="text-sm">
          {findings.data?.items.length ?? 0}
          {findings.data?.hasMore ? "+" : ""} scoped findings. Missing controls
          remain unknown.
        </p>
      )}
      {findings.data?.items.slice(0, 3).map((f) => (
        <p key={f.id} className="text-sm">
          <a
            className="text-primary underline"
            href={`#/cybersecurity?finding=${f.id}`}
          >
            {f.title}
          </a>{" "}
          · {f.mode} · {f.status}
        </p>
      ))}
      <a
        className="text-sm text-primary underline"
        href={`#/cybersecurity?tab=Findings&targetKind=${kind}&targetId=${id}`}
      >
        Review scoped security posture and findings
      </a>
    </section>
  );
}
