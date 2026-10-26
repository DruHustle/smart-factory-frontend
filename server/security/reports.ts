import { z } from "zod";
import { utc, text, SecurityError, digest, sanitize } from "./contract";
const vulnerability = z
  .object({
    VulnerabilityID: z.string().regex(/^CVE-\d{4}-\d{4,}$/),
    PkgName: text(128).refine((s) => !s.includes("://") && !/[=\s]/.test(s)),
    InstalledVersion: text(128),
    FixedVersion: z.string().max(128).optional(),
    Severity: z.enum(["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    Title: z.string().max(512).transform(sanitize).optional(),
    CVSS: z
      .object({
        nvd: z
          .object({
            V3Score: z.number().min(0).max(10),
            V3Vector: z.string().max(256).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
/** Documented strict Trivy schema-2 subset. Export only these fields. No feed fetches. */
export const trivy = z
  .object({
    SchemaVersion: z.literal(2),
    CreatedAt: utc,
    ArtifactName: text(128).transform(sanitize),
    ArtifactType: z.enum(["container_image", "filesystem"]),
    Results: z
      .array(
        z
          .object({
            Target: text(256).transform(sanitize),
            Class: z.enum(["os-pkgs", "lang-pkgs"]).optional(),
            Type: text(64),
            Vulnerabilities: z.array(vulnerability).max(500),
          })
          .strict(),
      )
      .max(20),
  })
  .strict()
  .refine(
    (r) => r.Results.reduce((n, v) => n + v.Vulnerabilities.length, 0) <= 2000,
    "At most 2000 vulnerabilities",
  );
export function parseReport(raw: string) {
  if (Buffer.byteLength(raw) > 4 * 1024 * 1024)
    throw new SecurityError(413, "report_too_large");
  try {
    const input = JSON.parse(raw);
    if (Array.isArray(input?.Results)) {
      if (input.Results.length > 20)
        throw new SecurityError(422, "unsupported_trivy_subset");
      let total = 0;
      for (const result of input.Results)
        if (Array.isArray(result?.Vulnerabilities)) {
          total += result.Vulnerabilities.length;
          if (result.Vulnerabilities.length > 500 || total > 2000)
            throw new SecurityError(422, "unsupported_trivy_subset");
        }
    }
    return {
      report: trivy.parse(input),
      sha256: digest(raw),
      bytes: Buffer.byteLength(raw),
    };
  } catch (e) {
    if (e instanceof SecurityError) throw e;
    throw new SecurityError(422, "unsupported_trivy_subset");
  }
}
