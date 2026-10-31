import { useEffect } from "react";
import { useParams } from "wouter";
import { Printer } from "lucide-react";
import { decodeDemoPassport } from "@shared/demo-passport";
import { DemoPassportContent } from "@/components/DemoPassportContent";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/workspace/Primitives";

/** Portable demonstration only; no account, publication or asset API is used. */
export default function DemoProductPassport() {
  const { encoded } = useParams<{ encoded?: string }>();
  const identity = decodeDemoPassport(encoded ?? "");
  const name = identity?.name;
  useEffect(() => {
    if (!name) return;
    const previous = document.title;
    document.title = `${name} · Demo product passport`;
    return () => {
      document.title = previous;
    };
  }, [name]);
  if (!identity)
    return (
      <main className="mx-auto max-w-xl p-6">
        <EmptyState
          error
          title="Demo passport unavailable"
          description="This demo link is incomplete, invalid or uses an unsupported version. Open the item’s digital passport and scan its QR code again."
        />
      </main>
    );
  return (
    <main className="eudpp-page min-h-screen bg-background p-4 text-foreground sm:p-6 print:bg-white print:p-0 print:text-black">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <p className="text-sm font-medium">
            Demo product passport · simulated information
          </p>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer aria-hidden="true" className="size-4" />
            Print demo passport
          </Button>
        </div>
        <DemoPassportContent identity={identity} />
      </div>
    </main>
  );
}
