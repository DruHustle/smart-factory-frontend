import { useEffect, useRef, useState } from "react";
import { FloorPlan } from "./FactoryFloorPlan";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  floorModelUrl,
  type FloorLink,
  type layoutFactory,
} from "@shared/factory-floor";

type Layout = ReturnType<typeof layoutFactory>;
const indicatorColor = (item: Layout["placements"][number]["item"]) =>
  item.status === "error"
    ? 0xef6461
    : item.status === "maintenance"
      ? 0xdba64a
      : item.mode === "simulated"
        ? 0x28a6c4
        : item.status === "live"
          ? 0x32b881
          : 0xdba64a;
function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh ||
      object instanceof THREE.Line ||
      object instanceof THREE.Sprite
    ) {
      if ("geometry" in object)
        geometries.add(object.geometry as THREE.BufferGeometry);
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) textures.add(value);
      }
    }
    if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
  });
  textures.forEach((t) => t.dispose());
  materials.forEach((m) => m.dispose());
  geometries.forEach((g) => g.dispose());
}
const models = new Map<string, Promise<THREE.Group>>();
// The overview uses one draw per reference instance. Full component/material
// structure remains in the dedicated inspection workspace.
function compactReference(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  root.traverse((object) => {
    if (
      !(object instanceof THREE.Mesh) ||
      !object.geometry?.attributes.position
    )
      return;
    const source = object.geometry as THREE.BufferGeometry;
    const expanded = source.index ? source.toNonIndexed() : source.clone();
    const part = new THREE.BufferGeometry();
    part.setAttribute("position", expanded.attributes.position.clone());
    if (expanded.attributes.normal)
      part.setAttribute("normal", expanded.attributes.normal.clone());
    else part.computeVertexNormals();
    const count = part.attributes.position.count;
    const colors = new Float32Array(count * 3);
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    const first =
      (materials[0] as THREE.MeshStandardMaterial).color ??
      new THREE.Color(0x879da6);
    for (let n = 0; n < count; n++) first.toArray(colors, n * 3);
    for (const group of expanded.groups) {
      const color =
        (materials[group.materialIndex ?? 0] as THREE.MeshStandardMaterial)
          ?.color ?? first;
      for (
        let n = group.start;
        n < Math.min(count, group.start + group.count);
        n++
      )
        color.toArray(colors, n * 3);
    }
    part.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    part.applyMatrix4(object.matrixWorld);
    parts.push(part);
    expanded.dispose();
  });
  const geometry = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  disposeObject(root);
  if (!geometry) throw Error("Reference geometry unavailable");
  const result = new THREE.Group();
  result.add(
    new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.6,
        metalness: 0.25,
      }),
    ),
  );
  return result;
}
function referenceModel(slug: string) {
  if (!models.has(slug)) {
    const url = floorModelUrl(slug);
    if (!url) return Promise.reject(Error("Unknown reference"));
    const pending = fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then((r) => {
        if (!r.ok) throw Error("Reference model unavailable");
        return r.arrayBuffer();
      })
      .then((bytes) => new GLTFLoader().parseAsync(bytes, ""))
      .then((gltf) => compactReference(gltf.scene))
      .catch((error) => {
        models.delete(slug);
        throw error;
      });
    models.set(slug, pending);
  }
  return models.get(slug)!;
}
function label(text: string, color: string, size = 3.4) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 72;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(248,250,252,.94)";
  ctx.beginPath();
  ctx.roundRect(0, 0, 512, 72, 12);
  ctx.fill();
  ctx.font = "500 24px sans-serif";
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.length > 32 ? text.slice(0, 29) + "…" : text, 256, 36, 490);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true,
    }),
  );
  sprite.scale.set(size, (size * 72) / 512, 1);
  return sprite;
}
function proxy(model: string | null, color: THREE.ColorRepresentation) {
  const body = new THREE.Group(),
    material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.65,
      metalness: 0.35,
    });
  const part = (
    geometry: THREE.BufferGeometry,
    x: number,
    y: number,
    z: number,
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    body.add(mesh);
    return mesh;
  };
  if (model === "storage-tank")
    part(new THREE.CylinderGeometry(0.65, 0.65, 1.7, 24), 0, 0.9, 0);
  else if (model === "conveyor") {
    part(new THREE.BoxGeometry(2.4, 0.35, 0.85), 0, 0.65, 0);
    for (const x of [-0.8, 0.8])
      part(new THREE.BoxGeometry(0.12, 0.6, 0.65), x, 0.3, 0);
  } else if (model === "robot-arm") {
    part(new THREE.CylinderGeometry(0.5, 0.6, 0.3, 16), 0, 0.15, 0);
    const link = part(new THREE.BoxGeometry(0.35, 1.3, 0.35), -0.1, 0.85, 0);
    link.rotation.z = -0.35;
    const arm = part(new THREE.BoxGeometry(1.2, 0.3, 0.3), 0.65, 1.4, 0);
    arm.rotation.z = -0.2;
  } else if (model === "pump-motor") {
    part(new THREE.BoxGeometry(1.8, 0.12, 0.9), 0, 0.1, 0);
    const motor = part(
      new THREE.CylinderGeometry(0.4, 0.4, 1.1, 20),
      0,
      0.6,
      0,
    );
    motor.rotation.z = Math.PI / 2;
  } else if (model === "control-cabinet")
    part(new THREE.BoxGeometry(1, 1.7, 0.6), 0, 0.85, 0);
  else if (model === "raspberry-pi-4b")
    part(new THREE.BoxGeometry(1, 0.3, 0.7), 0, 0.3, 0);
  else {
    part(new THREE.CylinderGeometry(0.25, 0.3, 0.8, 16), 0, 0.5, 0);
    part(new THREE.SphereGeometry(0.3, 16, 12), 0, 0.95, 0);
  }
  return body;
}

export default function FactoryFloorScene({
  layout,
  links,
  selected,
  onSelect,
  dark,
  reset,
  zone,
}: {
  layout: Layout;
  links: FloorLink[];
  selected: string | null;
  onSelect: (ref: string) => void;
  dark: boolean;
  reset: number;
  zone: string;
}) {
  const host = useRef<HTMLDivElement>(null),
    choose = useRef(onSelect);
  const runtime = useRef<{
    focus: (ref: string | null) => void;
    reset: () => void;
    statuses: (items: Layout["placements"]) => void;
  } | null>(null);
  const [failed, setFailed] = useState(false),
    [ready, setReady] = useState(false),
    [loaded, setLoaded] = useState(0);
  choose.current = onSelect;
  const key =
    layout.placements
      .map((p) => `${p.item.ref}:${p.x}:${p.z}:${p.model}`)
      .join("|") + links.map((l) => `${l.from}:${l.to}`).join("|");
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    setFailed(false);
    setReady(false);
    setLoaded(0);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch {
      setFailed(true);
      return;
    }
    let disposed = false,
      dirty = true,
      frame = 0;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(dark ? "#101a26" : "#eaf0f3");
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D factory floor",
    );
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.dataset.floorNodeCount = String(
      layout.placements.length,
    );
    element.appendChild(renderer.domElement);
    const camera = new THREE.OrthographicCamera(-20, 20, 15, -15, 0.1, 500);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minZoom = 0.4;
    controls.maxZoom = 10;
    controls.screenSpacePanning = true;
    scene.add(new THREE.HemisphereLight(0xdcefff, 0x667766, 2.6));
    const sun = new THREE.DirectionalLight(0xfff5e8, 3.5);
    sun.position.set(12, 28, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    scene.add(sun);
    const plane = new THREE.Mesh(
      new THREE.BoxGeometry(layout.width + 4, 0.2, layout.depth + 4),
      new THREE.MeshStandardMaterial({
        color: dark ? 0x23313c : 0xcbd5db,
        roughness: 0.95,
      }),
    );
    plane.position.y = -0.22;
    plane.receiveShadow = true;
    scene.add(plane);
    const grid = new THREE.GridHelper(
      Math.max(layout.width, layout.depth) + 4,
      Math.ceil(Math.max(layout.width, layout.depth)),
      dark ? 0x496175 : 0xa5b5bf,
      dark ? 0x2b4050 : 0xc2d0d5,
    );
    grid.position.y = -0.105;
    scene.add(grid);
    const objects = new Map<string, THREE.Group>(),
      hits: THREE.Object3D[] = [],
      indicators = new Map<string, THREE.Mesh>(),
      markers = new Map<
        string,
        THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>
      >();
    const zoneColors = [0x2c8f9b, 0x537dd3, 0xb58d42, 0x608d71, 0x8b72ad];
    layout.zones.forEach((area, index) => {
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(area.width, 0.04, area.depth),
        new THREE.MeshStandardMaterial({
          color: zoneColors[index % zoneColors.length],
          transparent: true,
          opacity: dark ? 0.17 : 0.1,
          roughness: 1,
        }),
      );
      plate.position.set(
        area.x + area.width / 2,
        -0.08,
        area.z + area.depth / 2,
      );
      scene.add(plate);
      const name = label(
        `${area.name} · ${area.count}`,
        "#284d64",
        Math.min(area.width - 1, 6),
      );
      name.position.set(area.x + area.width / 2, 0.3, area.z + 0.6);
      scene.add(name);
    });
    for (const p of layout.placements) {
      const group = new THREE.Group();
      group.position.set(p.x, 0, p.z);
      group.userData.ref = p.item.ref;
      const body = proxy(
        p.model,
        p.item.kind === "device" ? 0x5089a3 : 0x738da1,
      );
      group.add(body);
      const name = label(p.item.name, "#203c4b");
      name.position.set(0, 2.6, 0);
      group.add(name);
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 0.08, 12),
        new THREE.MeshBasicMaterial({
          color: indicatorColor(p.item),
        }),
      );
      marker.position.set(-0.8, 0.12, -0.7);
      group.add(marker);
      markers.set(p.item.ref, marker);
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(1.25, 1.38, 48),
        new THREE.MeshBasicMaterial({
          color: 0x36b6dd,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.9,
        }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.025;
      halo.visible = false;
      group.add(halo);
      indicators.set(p.item.ref, halo);
      scene.add(group);
      objects.set(p.item.ref, group);
      hits.push(group);
      if (p.model)
        void referenceModel(p.model)
          .then((model) => {
            if (disposed) return;
            const copy = model.clone(true),
              box = new THREE.Box3().setFromObject(copy),
              size = box.getSize(new THREE.Vector3()),
              center = box.getCenter(new THREE.Vector3());
            const scale = 2.35 / Math.max(size.x, size.y, size.z, 0.001);
            copy.position.sub(center);
            const normalized = new THREE.Group();
            normalized.add(copy);
            normalized.scale.setScalar(scale);
            normalized.position.y = (size.y * scale) / 2 + 0.1;
            normalized.traverse((o) => {
              if (o instanceof THREE.Mesh) {
                o.castShadow = true;
                o.receiveShadow = true;
              }
            });
            group.remove(body);
            disposeObject(body);
            group.add(normalized);
            setLoaded((n) => n + 1);
            dirty = true;
          })
          .catch(() => {
            /* The labelled proxy remains available when a reference cannot load. */
          });
    }
    for (const link of links) {
      const from = objects.get(link.from),
        to = objects.get(link.to);
      if (!from || !to) continue;
      const points = [
        new THREE.Vector3(from.position.x, 0.07, from.position.z),
        new THREE.Vector3(to.position.x, 0.07, to.position.z),
      ];
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineDashedMaterial({
          color: link.kind === "fx" ? 0xaa70e9 : 0x2d99a2,
          dashSize: 0.25,
          gapSize: 0.15,
          transparent: true,
          opacity: 0.55,
        }),
      );
      line.computeLineDistances();
      scene.add(line);
    }
    const size = () => {
      const width = element.clientWidth,
        height = element.clientHeight,
        aspect = width / Math.max(height, 1);
      const extent = Math.max(
        (layout.width * 0.7) / aspect,
        layout.depth * 0.65,
        9,
      );
      camera.left = -extent * aspect;
      camera.right = extent * aspect;
      camera.top = extent;
      camera.bottom = -extent;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      dirty = true;
    };
    const fit = () => {
      camera.position.set(
        layout.width * 0.8,
        Math.max(layout.width, layout.depth),
        layout.depth * 0.9,
      );
      camera.zoom = 1;
      controls.target.set(0, 0, 0);
      camera.updateProjectionMatrix();
      controls.update();
      dirty = true;
    };
    runtime.current = {
      reset: fit,
      statuses: (placements) => {
        placements.forEach((p) =>
          markers
            .get(p.item.ref)
            ?.material.color.setHex(indicatorColor(p.item)),
        );
        dirty = true;
      },
      focus: (ref) => {
        for (const [id, halo] of indicators) halo.visible = id === ref;
        dirty = true;
      },
    };
    const observer = new ResizeObserver(size);
    observer.observe(element);
    size();
    fit();
    const change = () => {
      dirty = true;
    };
    controls.addEventListener("change", change);
    const ray = new THREE.Raycaster(),
      point = new THREE.Vector2();
    let start: [number, number] | undefined;
    const down = (e: PointerEvent) => {
      start = [e.clientX, e.clientY];
    };
    const up = (e: PointerEvent) => {
      if (!start || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 6)
        return;
      const rect = renderer.domElement.getBoundingClientRect();
      point.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(point, camera);
      const hit = ray.intersectObjects(hits, true)[0];
      if (!hit) return;
      let node: THREE.Object3D | null = hit.object;
      while (node && !node.userData.ref) node = node.parent;
      if (node?.userData.ref) choose.current(node.userData.ref as string);
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointerup", up);
    const lost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(frame);
      setFailed(true);
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    const tick = () => {
      if (disposed) return;
      frame = requestAnimationFrame(tick);
      if (document.hidden) return;
      controls.update();
      if (dirty) {
        renderer.render(scene, camera);
        dirty = false;
        setReady(true);
      }
    };
    tick();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      runtime.current = null;
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      // Disposing GPU resources preserves the cached CPU references for reuse.
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [key, dark]);
  useEffect(() => {
    runtime.current?.focus(selected);
  }, [selected, key, dark]);
  useEffect(() => {
    runtime.current?.statuses(layout.placements);
  }, [layout, key, dark]);
  useEffect(() => {
    runtime.current?.reset();
  }, [reset, zone]);
  return (
    <div className="relative h-full w-full">
      <div ref={host} className={`h-full w-full ${failed ? "hidden" : ""}`} />
      {failed ? (
        <FloorPlan
          layout={layout}
          links={links}
          selected={selected}
          onSelect={onSelect}
        />
      ) : (
        <span
          className="pointer-events-none absolute bottom-3 left-3 rounded-md border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground"
          role="status"
        >
          {ready
            ? `${layout.placements.length} items on floor · ${loaded} detailed models ready`
            : "Preparing factory floor…"}
        </span>
      )}
    </div>
  );
}
