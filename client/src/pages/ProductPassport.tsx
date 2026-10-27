import { useState } from "react";
import { Link, useParams } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { passportFields } from "@shared/passport";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/workspace/Primitives";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Printer } from "lucide-react";
import { toast } from "sonner";
type Field = keyof typeof passportFields;
export default function ProductPassport() {
  const { id, publicId } = useParams<{ id?: string; publicId?: string }>(),
    { user } = useAuth();
  const numericId = Number(id),
    privatePreview = !publicId;
  const [fields, setFields] = useState<Field[]>([
      "name",
      "assetType",
      "manufacturer",
      "model",
    ]),
    [guidance, setGuidance] = useState("");
  const preview = trpc.assets.getPassport.useQuery(
    { id: numericId },
    {
      enabled:
        privatePreview &&
        !!user &&
        Number.isInteger(numericId) &&
        numericId > 0,
      retry: false,
    },
  );
  const publicQuery = trpc.assets.getPublishedPassport.useQuery(
    { publicId: publicId ?? "" },
    { enabled: !!publicId, retry: false },
  );
  const history = trpc.assets.passportPublications.useQuery(
    { id: numericId },
    {
      enabled: privatePreview && !!user?.access?.canEngineer && !!preview.data,
    },
  );
  const publish = trpc.assets.publishPassport.useMutation({
    onSuccess: async () => {
      toast.success(
        "Reviewed passport published. Only the selected fields are public.",
      );
      await history.refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const revoke = trpc.assets.revokePassport.useMutation({
    onSuccess: async () => {
      toast.success("Public passport revoked.");
      await history.refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const query = privatePreview ? preview : publicQuery,
    item = query.data;
  const url = (value: string) =>
    `${window.location.origin}${window.location.pathname}#/passport/published/${value}`;
  if (privatePreview && !user)
    return (
      <main className="mx-auto max-w-xl p-6">
        <EmptyState
          title="Private passport preview"
          description="Sign in with an authorized account to preview this asset. A numeric asset link does not publish a passport."
          action={
            <Button asChild>
              <Link href="/login">Sign in</Link>
            </Button>
          }
        />
      </main>
    );
  if (query.isLoading)
    return (
      <main className="p-6">
        <EmptyState title="Loading product passport…" />
      </main>
    );
  if (query.error || !item)
    return (
      <main className="mx-auto max-w-xl p-6">
        <EmptyState
          error
          title="Passport unavailable"
          description={
            query.error?.message ??
            "The link is invalid, unpublished or revoked."
          }
        />
      </main>
    );
  const rows = privatePreview
    ? item.fields.filter((f) => fields.includes(f.key as Field))
    : item.fields;
  return (
    <main className="eudpp-page min-h-screen bg-background p-4 text-foreground print:bg-white print:p-0 print:text-black">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <p className="text-sm font-medium">
            {privatePreview
              ? "Private publication preview"
              : "Published product passport"}
          </p>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" />
            Print passport
          </Button>
        </div>
        {privatePreview && (
          <p className="rounded-md border border-warning/40 p-3 text-sm print:hidden">
            This preview requires sign-in. Review the fields below before
            creating a public snapshot. Later asset edits do not silently change
            a published snapshot.
          </p>
        )}
        <Card className="print:break-inside-avoid print:shadow-none">
          <CardHeader>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              EU Digital Product Passport · voluntary prototype
            </p>
            <h1 className="text-2xl font-semibold">
              {privatePreview && !fields.includes("name")
                ? "Product passport"
                : item.title}
            </h1>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_210px]">
            <dl className="space-y-3">
              {rows.map((row) => (
                <div key={row.key} className="border-b pb-2">
                  <dt className="text-xs text-muted-foreground">{row.label}</dt>
                  <dd className="mt-1 break-words font-medium">{row.value}</dd>
                </div>
              ))}
            </dl>
            {!privatePreview && publicId && (
              <figure
                data-testid="passport-qr"
                data-qr-value={url(publicId)}
                className="space-y-2 text-center"
                aria-label={`Published passport link for ${item.title}`}
              >
                <div className="inline-block rounded-md border bg-white p-3">
                  <QRCodeSVG
                    aria-label={`Passport QR code for ${item.title}`}
                    role="img"
                    value={url(publicId)}
                    size={180}
                    level="H"
                  />
                </div>
                <figcaption className="break-all text-xs">
                  {url(publicId)}
                </figcaption>
              </figure>
            )}
          </CardContent>
        </Card>
        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle>Use, repair and end of life</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="whitespace-pre-wrap">
              {privatePreview
                ? guidance ||
                  "No asset-specific guidance has been reviewed for publication. Refer to the manufacturer's approved documentation."
                : item.reviewedGuidance ||
                  "No asset-specific guidance has been published. Refer to the manufacturer's approved documentation."}
            </p>
            <p className="rounded-md border p-3">
              <strong>Regulatory status:</strong> {item.disclaimer}
            </p>
            {item.publishedAt && (
              <p className="text-xs text-muted-foreground">
                Snapshot published {new Date(item.publishedAt).toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
        {privatePreview && user?.access?.canEngineer && (
          <Card className="print:hidden">
            <CardHeader>
              <CardTitle>Review public fields</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <fieldset className="grid gap-2 sm:grid-cols-2">
                <legend className="mb-2 text-sm text-muted-foreground">
                  Only checked fields will be public, including on the printed
                  passport.
                </legend>
                {Object.entries(passportFields).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={fields.includes(key as Field)}
                      onChange={(e) =>
                        setFields(
                          e.target.checked
                            ? [...fields, key as Field]
                            : fields.filter((f) => f !== key),
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <div className="space-y-1">
                <Label htmlFor="reviewed-guidance">
                  Reviewed asset-specific guidance (optional)
                </Label>
                <Textarea
                  id="reviewed-guidance"
                  maxLength={4000}
                  rows={4}
                  value={guidance}
                  onChange={(e) => setGuidance(e.target.value)}
                  placeholder="Approved manufacturer guidance for this exact equipment, or leave empty."
                />
              </div>
              <Button
                disabled={!fields.length || publish.isPending}
                onClick={() =>
                  publish.mutate({
                    id: numericId,
                    expectedVersion: preview.data!.assetVersion,
                    fields,
                    reviewedGuidance: guidance,
                  })
                }
              >
                Publish reviewed snapshot
              </Button>
              <div className="space-y-2">
                <p className="font-medium">Publication history</p>
                {history.error ? (
                  <p role="alert" className="text-sm text-destructive">
                    Publication history unavailable
                  </p>
                ) : !history.data?.length ? (
                  <p className="text-sm text-muted-foreground">
                    No public snapshots.
                  </p>
                ) : (
                  history.data.map((p) => (
                    <div
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                    >
                      <span className="text-xs">
                        {new Date(p.publishedAt).toLocaleString()} ·{" "}
                        {p.revokedAt ? "Revoked" : "Published"}
                      </span>
                      {!p.revokedAt && (
                        <div className="flex gap-2">
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/passport/published/${p.id}`}>
                              Open public passport
                            </Link>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={revoke.isPending}
                            onClick={() => revoke.mutate({ publicId: p.id })}
                          >
                            Revoke
                          </Button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
