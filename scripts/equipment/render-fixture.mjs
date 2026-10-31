/** Isolated renderer qualification; no accounts, backend or production records. */
import { createServer } from "vite";
import { readFile } from "node:fs/promises";
const factories = new Set([
  "conveyor",
  "robot-arm",
  "control-cabinet",
  "valve",
  "storage-tank",
]);
export function fixtureDirectory(model) {
  return factories.has(model)
    ? `fixtures/equipment/factory/${model}/`
    : model === "pi" || model === "raspberry-pi-4b"
      ? "fixtures/equipment/raspberry-pi-4b/"
      : "fixtures/equipment/";
}

const entry = "\0equipment-render-fixture";
const server = await createServer({
  server: { host: "127.0.0.1", port: 3139, strictPort: true },
  plugins: [
    {
      name: "equipment-render-fixture",
      resolveId(id) {
        if (id === entry) return entry;
      },
      load(id) {
        if (id !== entry) return;
        return `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import Renderer from '/src/components/equipment/LocalEquipmentRenderer.tsx';
        import Gallery from '/src/pages/FactoryModels.tsx';
        import {trpc} from '/src/lib/trpc.ts';
        import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
        import {httpBatchLink} from '@trpc/client';
        import superjson from 'superjson';
        import '/src/index.css';
        const query = new URLSearchParams(location.search);
        const slug = query.get('model') || 'pump';
        const template = query.has('gallery') ? null : await (await fetch('/__equipment-render/template?model='+slug)).json();
        const components = template?.components.map(p=>({...p,installedComponentId:p.templateComponentId})) || [];
        if (location.search.includes('dark')) document.documentElement.classList.add('dark');
        function App(){
          const [selected,onSelect] = React.useState(null);
          return React.createElement(Renderer,{modelUrl:'/api/equipment/fixture/model?model='+slug,modelRevision:template.revision,initialViewDirection:template.initialViewDirection,components,selected,onSelect,observations:[],annotations:[]});
        }
        const root=createRoot(document.getElementById('root'));
        if(query.has('gallery')){
          const queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
          const client=trpc.createClient({links:[httpBatchLink({url:'/__equipment-render/trpc',transformer:superjson})]});
          root.render(React.createElement(trpc.Provider,{client,queryClient},React.createElement(QueryClientProvider,{client:queryClient},React.createElement(Gallery))));
        }else root.render(React.createElement(App));
      `;
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url, "http://127.0.0.1:3139");
          const directory = fixtureDirectory(url.searchParams.get("model"));
          const pump = directory === "fixtures/equipment/";
          if (url.pathname === "/__equipment-render/trpc/equipment.access") {
            res.setHeader("Content-Type", "application/json");
            const result = {
              result: { data: { json: { canWrite: false, demoOnly: true } } },
            };
            res.end(
              JSON.stringify(url.searchParams.has("batch") ? [result] : result),
            );
            return;
          }
          if (url.pathname === "/__equipment-render/trpc/equipment.reference") {
            const input = JSON.parse(url.searchParams.get("input") || "{}");
            const slug = (input["0"] || input).json.slug;
            const folder = fixtureDirectory(slug);
            const template = JSON.parse(
              await readFile(
                folder +
                  (folder === "fixtures/equipment/"
                    ? "local-template.json"
                    : "template.json"),
                "utf8",
              ),
            );
            const data = {
              slug,
              revision: template.revision,
              name: template.name,
              initialViewDirection: template.initialViewDirection,
              components: template.components.map((part) => ({
                ...part,
                installedComponentId: part.templateComponentId,
              })),
              modelUrl: "/api/equipment/fixture/model?model=" + slug,
            };
            res.setHeader("Content-Type", "application/json");
            const result = { result: { data: { json: data } } };
            res.end(
              JSON.stringify(url.searchParams.has("batch") ? [result] : result),
            );
            return;
          }
          if (url.pathname === "/__equipment-render/") {
            const html = await vite.transformIndexHtml(
              req.url,
              `<html><head></head><body><div id="root" style="max-width:1100px;margin:24px auto"></div><script type="module" src="/@id/__x00__equipment-render-fixture"></script></body></html>`,
            );
            res.setHeader("Content-Type", "text/html");
            res.end(html);
            return;
          }
          if (
            url.pathname === "/__equipment-render/template" ||
            url.pathname === "/api/equipment/fixture/model"
          ) {
            const model = url.pathname.endsWith("model");
            const file = model
              ? pump
                ? "pump-motor.glb"
                : "model.glb"
              : pump
                ? "local-template.json"
                : "template.json";
            res.setHeader(
              "Content-Type",
              model ? "model/gltf-binary" : "application/json",
            );
            res.setHeader("Cache-Control", "no-store");
            res.end(await readFile(directory + file));
            return;
          }
          next();
        });
      },
    },
  ],
});
await server.listen();
console.log("Renderer fixture: http://127.0.0.1:3139/__equipment-render/");
export { server };
