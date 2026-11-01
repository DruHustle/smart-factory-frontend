/** Static guidance only: never disclose administrator existence or offer a claim action. */
export function FirstAdministratorHelp() {
  return (
    <details className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
      <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Setting up the first administrator?
      </summary>
      <div className="mt-3 space-y-2 text-muted-foreground">
        <p>
          The installation operator sets up the first individual Administrator
          through the trusted deployment setup. Registration alone does not
          grant administrator access.
        </p>
        <p>
          Administrator is the highest application role. After setup, sign in
          with that personal account, select Live data, and open Administration
          → Users &amp; access to approve other people and assign their roles.
        </p>
      </div>
    </details>
  );
}
