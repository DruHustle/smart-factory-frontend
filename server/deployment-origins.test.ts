import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const configure = fileURLToPath(
  new URL("../scripts/configure-vercel.mjs", import.meta.url),
);
const fixture = readFileSync(
  new URL("../vercel.json", import.meta.url),
  "utf8",
);
const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
);

function temporary() {
  const path = mkdtempSync(join(tmpdir(), "factory-deployment-origins-"));
  directories.push(path);
  return path;
}

function configureProxy(changes: Record<string, string>) {
  const cwd = temporary();
  writeFileSync(join(cwd, "vercel.json"), fixture);
  const env = { ...process.env };
  for (const key of ["API_ORIGIN", "RENDER_API_ORIGIN", "RELEASE_ORIGIN"])
    delete env[key];
  const result = spawnSync(process.execPath, [configure], {
    cwd,
    encoding: "utf8",
    env: { ...env, ...changes },
  });
  return {
    ...result,
    config: JSON.parse(readFileSync(join(cwd, "vercel.json"), "utf8")),
  };
}

describe("configured Vercel and verification origins", () => {
  it("generates every proxy route for the selected API while retaining unrelated protections", () => {
    const result = configureProxy({
      API_ORIGIN: "https://api.onesa.eu",
      RELEASE_ORIGIN: "https://factory.onesa.eu",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.config.rewrites).toEqual([
      {
        source: "/health/live",
        destination: "https://api.onesa.eu/health/live",
      },
      {
        source: "/health/ready",
        destination: "https://api.onesa.eu/health/ready",
      },
      {
        source: "/api/health/live",
        destination: "https://api.onesa.eu/health/live",
      },
      {
        source: "/api/health/ready",
        destination: "https://api.onesa.eu/health/ready",
      },
      { source: "/api/:path*", destination: "https://api.onesa.eu/api/:path*" },
      { source: "/:path*", destination: "/index.html" },
    ]);
    const { rewrites: _old, ...original } = JSON.parse(fixture);
    const { rewrites: _new, ...actual } = result.config;
    expect(actual).toEqual(original);
  });

  it("retains the existing legacy API configuration input", () => {
    const result = configureProxy({
      RENDER_API_ORIGIN: "https://api.152-70-22-84.sslip.io",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.config).toEqual(JSON.parse(fixture));
  });

  it.each([
    "http://api.onesa.eu",
    "https://secret@api.onesa.eu",
    "https://api.onesa.eu/path/..",
    "https://api.onesa.eu?",
    "https://api.onesa.eu/#",
    "https://api.onesa.eu,https://other.example",
    "https://api.onesa.eu\n",
    "https://api.invalid",
  ])(
    "rejects ambiguous API input before rewriting config: %s",
    (API_ORIGIN) => {
      const result = configureProxy({ API_ORIGIN });
      expect(result.status).not.toBe(0);
      expect(result.config).toEqual(JSON.parse(fixture));
      expect(result.stderr).not.toContain("secret@");
    },
  );

  it("also validates the frontend verification destination before changing the proxy", () => {
    const result = configureProxy({
      API_ORIGIN: "https://api.onesa.eu",
      RELEASE_ORIGIN: "https://factory.onesa.eu/#/login",
    });
    expect(result.status).not.toBe(0);
    expect(result.config).toEqual(JSON.parse(fixture));
  });

  it("runs both HTTP readiness checks against the chosen frontend without contacting the old host", () => {
    const cwd = temporary();
    const capture = join(cwd, "requests.jsonl");
    const preload = join(cwd, "capture-fetch.mjs");
    writeFileSync(
      preload,
      `import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, init) => {
  appendFileSync(process.env.CAPTURE, JSON.stringify({url: String(url), redirect: init.redirect}) + '\\n');
  return new Response('ready', {status: 200});
};\n`,
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--import",
        preload,
        "scripts/check-frontend-http.mts",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          RELEASE_ORIGIN: "https://factory.onesa.eu",
          CAPTURE: capture,
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const requests = readFileSync(capture, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(requests).toEqual([
      { url: "https://factory.onesa.eu/health/ready", redirect: "error" },
      { url: "https://factory.onesa.eu/", redirect: "error" },
    ]);
  });
});

describe("manual workflow origin binding", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/deploy-vercel-oracle.yml", import.meta.url),
    "utf8",
  );
  const start = workflow.indexOf('          [[ -z "$EXPECTED_API_ORIGIN"');
  const end = workflow.indexOf("          pnpm install", start);
  const guard = workflow
    .slice(start, end)
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
  const check = (changes: Record<string, string> = {}) =>
    spawnSync("bash", ["-e", "-c", guard], {
      encoding: "utf8",
      env: {
        ...process.env,
        API_ORIGIN: "https://api.onesa.eu",
        RELEASE_ORIGIN: "https://factory.onesa.eu",
        EXPECTED_API_ORIGIN: "https://api.onesa.eu",
        EXPECTED_UI_ORIGIN: "https://factory.onesa.eu",
        ...changes,
      },
    });

  it("uses the actual workflow guard to reject a request targeting different origins", () => {
    expect(start).toBeGreaterThan(0);
    expect(check().status).toBe(0);
    expect(check({ EXPECTED_API_ORIGIN: "https://other.example" }).status).toBe(
      1,
    );
    expect(check({ EXPECTED_UI_ORIGIN: "https://other.example" }).status).toBe(
      1,
    );
    expect(
      check({ EXPECTED_API_ORIGIN: "", EXPECTED_UI_ORIGIN: "" }).status,
    ).toBe(0);
  });
});

describe("deployment topology validator", () => {
  const workflowPath = ".github/workflows/deploy-vercel-oracle.yml";
  const workflow = readFileSync(join(root, workflowPath), "utf8");
  const proxyVerification = workflow
    .split("\n")
    .find((line) => line.includes('API_ORIGIN="$RELEASE_ORIGIN"'))!;
  const promotion = workflow
    .split("\n")
    .find((line) => line.includes("vercel@62.2.0 deploy --prebuilt"))!;

  function validateWorkflow(candidate = workflow) {
    const cwd = temporary();
    for (const name of [
      ".github/workflows/release.yml",
      "vercel.json",
      "deploy/render/Dockerfile",
      "deploy/render/supervisord.conf",
      "deploy/render/entrypoint.py",
      "deploy/oracle/compose.yaml",
      "deploy/oracle/README.md",
      "scripts/verify-runtime.mts",
    ]) {
      const destination = join(cwd, name);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(root, name), destination);
    }
    writeFileSync(join(cwd, workflowPath), candidate);
    return spawnSync(
      process.execPath,
      [join(root, "scripts/check-deployment.mjs")],
      { cwd, encoding: "utf8", timeout: 10_000 },
    );
  }

  it("accepts the real workflow's selected UI verification after promotion", () => {
    expect(proxyVerification).toBeTruthy();
    expect(promotion).toBeTruthy();
    const result = validateWorkflow();
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    "",
    'API_ORIGIN="$API_ORIGIN"',
    "API_ORIGIN=https://smart-factory-iot-app.vercel.app",
    "API_ORIGIN=https://unrelated.example",
  ])("rejects an absent or rebound promoted-UI origin: %s", (assignment) => {
    const result = validateWorkflow(
      workflow.replace(
        proxyVerification,
        proxyVerification.replace('API_ORIGIN="$RELEASE_ORIGIN"', assignment),
      ),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "The promoted UI origin must proxy the qualified API",
    );
  });

  it("rejects proxy verification moved before artifact promotion", () => {
    const result = validateWorkflow(
      workflow
        .replace(proxyVerification + "\n", "")
        .replace(promotion, proxyVerification + "\n" + promotion),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "The promoted UI origin must proxy the qualified API",
    );
  });
});
