import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
export function ShowcaseJourney({ expanded = false }: { expanded?: boolean }) {
  const query = trpc.system.showcase.useQuery(undefined, { staleTime: 300000 }),
    s = query.data;
  if (!s) return null;
  const from = s.from.slice(0, 16),
    to = s.anchor.slice(0, 16),
    analysis = `/analytics?asset=${encodeURIComponent(s.assetId)}&scope=simulated&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const chapters = s.chapters;
  return (
    <section
      className="space-y-3 rounded-lg border border-info/40 bg-info/5 p-4"
      aria-label="Isolated simulation walkthrough"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Explore the simulation walkthrough</h2>
        <Badge variant="outline">Simulated data · read-only</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Inspect an AAS asset, independent sensor, gateway, native 3D assembly
        and recorded investigations. This authored example has no physical
        equipment connection. Evidence was recorded at{" "}
        {new Date(s.anchor).toLocaleString(undefined, {
          timeZoneName: "short",
        })}
        .
      </p>
      {expanded && chapters && (
        <ul className="grid gap-3 md:grid-cols-2">
          {chapters.map((c) => (
            <li key={c.title} className="rounded-md border bg-card p-4">
              <Link
                href={c.href}
                className="font-semibold text-primary underline"
              >
                {c.title}
              </Link>
              <p className="mt-2 text-sm text-muted-foreground">
                {c.description}
              </p>
              <Badge variant="outline" className="mt-3">
                {c.state === "available"
                  ? "Recorded example"
                  : "Commissioning prerequisite"}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <div className={expanded && chapters ? "hidden" : "flex flex-wrap gap-2"}>
        {(chapters
          ? chapters.map((c) => [c.title, c.href])
          : [
              ["Open pump workspace", `/inventory/${s.assetRef}/overview`],
              ["Inspect 3D", `/inventory/${s.assetRef}/3d`],
              ["View observed trend", analysis],
              ["Review process incident", `/alerts/${s.incidentId}`],
              [
                "Review security evidence",
                `/cybersecurity?tab=Findings&mode=simulated&sourceId=${s.securitySourceId}`,
              ],
              [
                "Open independent sensor",
                `/inventory/${s.sensorRef}/telemetry`,
              ],
            ]
        ).map(([label, href]) => (
          <Button key={href} asChild size="sm" variant="outline">
            <Link href={href} aria-label={label}>
              {label}
            </Link>
          </Button>
        ))}
      </div>
    </section>
  );
}
