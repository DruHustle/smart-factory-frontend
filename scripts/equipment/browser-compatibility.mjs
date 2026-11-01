/** Isolate native browser startup so a hung driver cannot stall qualification. */
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

export async function qualifyBrowser(name, directory, probe = false) {
  const output = resolve(
    directory,
    `${name}${probe ? "-probe" : ""}-result.json`,
  );
  // Firefox resolves app data separately from -profile on macOS. Keep tests
  // away from a user's TCC-protected Firefox data; do not change HOME/privacy.
  const isolatedHome =
    name === "firefox" && process.platform === "darwin"
      ? await mkdtemp(join(tmpdir(), "sf-firefox-appdata-"))
      : undefined;
  console.log(`Compatibility: starting ${name} (90 second process deadline)`);
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(import.meta.url),
      name,
      resolve(directory),
      ...(probe ? ["--probe"] : []),
    ],
    {
      stdio: ["ignore", "inherit", "inherit"],
      detached: process.platform !== "win32",
      env: isolatedHome
        ? { ...process.env, CFFIXED_USER_HOME: isolatedHome }
        : process.env,
    },
  );
  let timedOut = false;
  const stop = () => {
    if (!child.pid) return;
    try {
      if (process.platform === "win32") child.kill("SIGKILL");
      else process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const deadline = setTimeout(() => {
    timedOut = true;
    stop();
  }, 90000);
  try {
    const code = await new Promise((accept, reject) => {
      child.once("error", reject);
      child.once("exit", accept);
    });
    if (timedOut) {
      const result = {
        name,
        state: "failed",
        error:
          "Native browser lifecycle exceeded 90 seconds; owned process group stopped",
      };
      await writeFile(output, JSON.stringify(result, null, 2));
      throw Error(`${name}: ${result.error}`);
    }
    const result = JSON.parse(await readFile(output, "utf8"));
    if (code !== 0 || result.state === "failed")
      throw Error(`${name}: ${result.error ?? `exit ${code}`}`);
    return result;
  } finally {
    clearTimeout(deadline);
    stop();
    if (isolatedHome) {
      // macOS adds a deny-delete ACL to Downloads even under this newly made
      // test home. Remove it only within that owned tree, without following
      // symlinks; never touch a user's real home or Firefox application data.
      execFileSync("/bin/chmod", ["-R", "-P", "-N", isolatedHome]);
      await rm(isolatedHome, { recursive: true, force: true });
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [name, directory, probeFlag] = process.argv.slice(2);
  if (name === "--probe-firefox") {
    console.log(
      JSON.stringify(await qualifyBrowser("firefox", directory, true), null, 2),
    );
  } else {
    if (!["firefox", "webkit"].includes(name) || !directory)
      throw Error("Expected firefox|webkit and evidence directory");
    const { firefox, webkit, expect } = await import("@playwright/test");
    const { assets } = JSON.parse(
      await readFile("shared/industrial-assets.catalog.json", "utf8"),
    );
    let browser, result;
    try {
      browser = await { firefox, webkit }[name].launch({ timeout: 30000 });
      console.log(`Compatibility: ${name} launched`);
      const page = await browser.newPage({
        viewport: { width: 1024, height: 900 },
      });
      console.log(`Compatibility: ${name} page created`);
      if (probeFlag === "--probe") {
        expect(await page.evaluate(() => 2 + 2)).toBe(4);
        result = {
          name,
          state: "ready",
          blankPageEvaluation: true,
          browserVersion: browser.version(),
          appDataIsolated: !!process.env.CFFIXED_USER_HOME,
        };
      } else {
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto("http://127.0.0.1:3139/__equipment-render/?gallery", {
          timeout: 20000,
        });
        const host = page.locator(
          "[data-state=ready], [data-state=unsupported]",
        );
        await host.waitFor({ timeout: 45000 });
        const state = await host.getAttribute("data-state");
        if (state === "unsupported")
          await expect(
            host.locator(`img[src="${assets[0].previewUrl}"]`).first(),
          ).toBeVisible();
        await expect(
          page
            .getByLabel("Reference components", { exact: true })
            .getByRole("button")
            .first(),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth -
                document.documentElement.clientWidth <=
              1,
          ),
        ).toBe(true);
        expect(errors).toEqual([]);
        await page.screenshot({
          path: `${directory}/${name}.png`,
          fullPage: true,
        });
        result = { name, state };
      }
    } catch (error) {
      result = { name, state: "failed", error: String(error.stack || error) };
      process.exitCode = 1;
    } finally {
      await writeFile(
        resolve(
          directory,
          `${name}${probeFlag === "--probe" ? "-probe" : ""}-result.json`,
        ),
        JSON.stringify(result, null, 2),
      );
      await browser?.close();
    }
  }
}
