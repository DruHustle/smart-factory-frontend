import { PageHeader } from "@/components/workspace/Primitives";
import { ShowcaseJourney } from "@/components/workspace/ShowcaseJourney";
export default function Demonstration() {
  return (
    <div className="space-y-[var(--workspace-gap)]">
      <PageHeader
        title="Demonstration"
        description="Explore the implemented workspaces with isolated, recorded simulation."
      />
      <ShowcaseJourney expanded />
      <p className="text-sm text-muted-foreground">
        Shared accounts are read-only. Editing, registration, assignment and
        publication workflows are exercised with individual accounts in the
        disposable acceptance environment. Physical equipment commands, firmware
        delivery, email sending and external consumer acceptance require
        separately commissioned services.
      </p>
    </div>
  );
}
