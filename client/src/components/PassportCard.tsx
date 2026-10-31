import { QRCodeSVG } from "qrcode.react";
import { QrCode } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export type PassportRow = { key: string; label: string; value: string };

/** Presentation only. Callers decide which reviewed or synthetic fields may appear. */
export function PassportCard({
  title,
  rows,
  qr,
  status,
}: {
  title: string;
  rows: PassportRow[];
  qr?: { value: string; caption: string; demo?: boolean };
  status: string;
}) {
  return (
    <Card className="gap-0 overflow-hidden print:break-inside-avoid print:border-black print:shadow-none">
      <CardHeader className="gap-3 border-b bg-muted/25 pb-6 print:bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground print:text-gray-700">
            EU Digital Product Passport
          </p>
          <span className="rounded-full border bg-background px-3 py-1 text-[11px] font-medium print:text-black">
            {status}
          </span>
        </div>
        <h1 className="break-words text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          {title}
        </h1>
      </CardHeader>
      <CardContent
        className={`grid gap-8 pt-6 ${qr ? "md:grid-cols-[minmax(0,1fr)_264px]" : ""}`}
      >
        <dl className="min-w-0 space-y-3">
          {rows.map((row) => (
            <div
              key={row.key}
              className="grid min-w-0 grid-cols-1 gap-1 border-b pb-3 last:border-0 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-3"
            >
              <dt className="text-sm text-muted-foreground print:text-gray-700">
                {row.label}
              </dt>
              <dd className="min-w-0 break-words text-sm font-medium [overflow-wrap:anywhere]">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
        {qr && (
          <figure
            data-testid="passport-qr"
            data-qr-value={qr.value}
            className="mx-auto w-full max-w-[264px] space-y-3 self-start rounded-xl border bg-muted/20 p-3 text-center print:break-inside-avoid print:bg-white"
            aria-label={`${qr.demo ? "Demo" : "Published"} passport link for ${title}`}
          >
            <div className="flex items-center justify-center gap-2 text-sm font-medium">
              <QrCode aria-hidden="true" className="size-4" />
              Scan product passport
            </div>
            <div className="overflow-hidden rounded-lg border bg-white">
              <QRCodeSVG
                aria-label={`Passport QR code for ${title}`}
                role="img"
                value={qr.value}
                size={240}
                level={qr.demo ? "M" : "H"}
                marginSize={4}
                className="h-auto w-full"
                title={`Passport QR code for ${title}`}
              />
            </div>
            <figcaption className="space-y-2 text-xs text-muted-foreground print:text-gray-700">
              <p>{qr.caption}</p>
              {qr.demo ? (
                <p className="text-[10px]">
                  Portable demonstration · no sign-in required
                </p>
              ) : (
                <p className="break-all font-mono text-[10px]">{qr.value}</p>
              )}
            </figcaption>
          </figure>
        )}
      </CardContent>
    </Card>
  );
}
