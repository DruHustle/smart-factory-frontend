import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { EmptyState, PageHeader, SectionNav } from "./Primitives";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useWorkspaceLocation } from "@/lib/hashLocation";
export function DemoAdministration({ section }: { section: string }) {
  const query = trpc.system.showcase.useQuery(undefined, { staleTime: 300000 }),
    [, navigate] = useWorkspaceLocation();
  const sections = [
    { id: "users", label: "Users & access" },
    { id: "integrations", label: "Integrations" },
    { id: "audit", label: "Audit trail" },
    { id: "workspace", label: "Workspace settings" },
  ];
  return (
    <div className="space-y-4">
      <PageHeader
        title="Administration"
        description="Read-only examples of access, integration and audit workflows."
      />
      <Badge variant="outline">
        Authored simulation · private configuration is hidden
      </Badge>
      <p className="text-sm text-muted-foreground">
        Use an individual engineering or administrator account on a private
        installation to read private configuration or make changes.
      </p>
      <SectionNav
        label="Administration sections"
        sections={sections}
        value={section}
        onChange={(v) => navigate(`/administration/${v}`)}
      >
        {query.isLoading ? (
          <EmptyState title="Loading demonstration…" />
        ) : query.error ? (
          <EmptyState error title="Demonstration unavailable" />
        ) : !query.data?.chapters ? (
          <EmptyState title="Demonstration is not installed" />
        ) : section === "users" ? (
          <Card>
            <CardHeader>
              <CardTitle>Individual account roles</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {[
                  ["Viewer", "Observe authorized equipment and evidence."],
                  ["Operator", "Review and acknowledge process incidents."],
                  [
                    "Engineer",
                    "Manage inventory, engineering and incident workflows.",
                  ],
                  [
                    "Administrator",
                    "Manage accounts, recovery, sessions and workspace settings.",
                  ],
                ].map(([role, detail]) => (
                  <li key={role} className="py-3">
                    <strong>{role}</strong>
                    <p className="text-sm text-muted-foreground">{detail}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-3 rounded-md border border-info/40 bg-info/5 p-3 text-sm">
                Every shared demo role remains read-only. These are role
                descriptions; no private accounts, sessions or recovery tokens
                are displayed.
              </p>
            </CardContent>
          </Card>
        ) : section === "integrations" ? (
          <Card>
            <CardHeader>
              <CardTitle>Demonstration integrations</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {query.data.integrations?.map((i) => (
                  <li
                    key={i.name}
                    className="flex flex-wrap justify-between gap-3 py-4"
                  >
                    <div>
                      <Link
                        href={i.href}
                        className="font-medium text-primary underline"
                      >
                        {i.name}
                      </Link>
                      <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                        {i.detail}
                      </p>
                    </div>
                    <Badge className="self-start" variant="outline">
                      {i.state}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : section === "audit" ? (
          <Card>
            <CardHeader>
              <CardTitle>Authored audit examples</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-4 border-l-2 border-info pl-4">
                {query.data.audit?.map((a) => (
                  <li key={a.action}>
                    <time className="text-xs text-muted-foreground">
                      {new Date(a.at).toLocaleString()}
                    </time>
                    <h2 className="font-medium">{a.action}</h2>
                    <p className="text-sm text-muted-foreground">{a.detail}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ) : section === "workspace" ? (
          <Card>
            <CardHeader>
              <CardTitle>Isolated demonstration policy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                Approved simulated records only. Factory settings, account
                roles, seeding and delivery controls are unavailable to shared
                accounts.
              </p>
              <p>
                Scenario acquisition time:{" "}
                {new Date(query.data.anchor).toLocaleString()}. Charts open at
                this recorded time; current connection states remain independent
                of the simulation.
              </p>
              <Link href="/demo" className="text-primary underline">
                Explore all demo chapters
              </Link>
            </CardContent>
          </Card>
        ) : (
          <EmptyState title="Section unavailable" />
        )}
      </SectionNav>
    </div>
  );
}
