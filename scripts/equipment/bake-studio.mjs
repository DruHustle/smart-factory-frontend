/** Bake HDR CubeUV mip levels with the pinned Three version. Requires Chromium. */
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const server = await createServer({
  server: { host: "127.0.0.1", port: 3140, strictPort: true },
  plugins: [
    {
      name: "bake-blank-page",
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (req.url !== "/__bake/") return next();
          res.setHeader("Content-Type", "text/html");
          res.end("<!doctype html><title>Studio bake</title>");
        });
      },
    },
  ],
});
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3140/__bake/");
  const result = await page.evaluate(async (root) => {
    const THREE = await import(
      "/@fs/" + root + "/node_modules/three/build/three.module.js"
    );
    const { studioScene } = await import(
      "/@fs/" + root + "/scripts/equipment/studio-scene.ts"
    );
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    const room = studioScene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromScene(room, 0.04, 0.1, 100, { size: 128 });
    const pixels = new Uint16Array(target.width * target.height * 4);
    renderer.readRenderTargetPixels(
      target,
      0,
      0,
      target.width,
      target.height,
      pixels,
    );
    if (renderer.getContext().getError())
      throw new Error("Studio readback failed");
    const bytes = new Uint8Array(pixels.buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    const output = {
      width: target.width,
      height: target.height,
      base64: btoa(binary),
      three: THREE.REVISION,
    };
    target.dispose();
    pmrem.dispose();
    room.dispose();
    renderer.dispose();
    return output;
  }, process.cwd());
  const directory = "client/src/assets/equipment";
  await mkdir(directory, { recursive: true });
  const bytes = Buffer.from(result.base64, "base64");
  const header = Buffer.alloc(12);
  header.write("SFE1");
  header.writeUInt32LE(result.width, 4);
  header.writeUInt32LE(result.height, 8);
  const compressed = gzipSync(Buffer.concat([header, bytes]), { level: 9 });
  await writeFile(
    path.join(directory, "studio-environment.bin.gz"),
    compressed,
  );
  console.log(
    JSON.stringify({
      three: result.three,
      width: result.width,
      height: result.height,
      decodedBytes: bytes.length,
      transferBytes: compressed.length,
    }),
  );
} finally {
  await browser?.close();
  await server.close();
}
