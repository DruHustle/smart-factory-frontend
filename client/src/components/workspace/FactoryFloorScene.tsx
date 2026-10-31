import { useEffect, useRef, useState } from "react";
import { FloorPlan } from "./FactoryFloorPlan";
import {
  constrainFloorPosition,
  type FloorSelect,
  type FloorMove,
  type FloorLayout,
  type FloorDragHandlers,
} from "./floor-arrangement";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  createWorkshop,
  createEquipmentProxy,
  isBenchHardwareLayout,
} from "./FactoryEnvironment";
import { createStudioEnvironment } from "../equipment/studioEnvironment";
import { floorItemAtRay } from "./floor-picking";
import { factoryAreas, factoryAreaColors } from "./factory-spaces";
import {
  optimizeFactoryReference,
  instantiateFactoryReference,
  createSurfaceGrain,
  createContactShadow,
  factoryModelSize,
  fitFactoryDimensions,
} from "./factory-graphics";
import {
  floorModelUrl,
  type FloorLink,
  type layoutFactory,
} from "@shared/factory-floor";

type Layout = FloorLayout;
const indicatorColor = (item: Layout["placements"][number]["item"]) =>
  item.status === "error"
    ? 0xef6461
    : item.status === "maintenance" || item.status === "stale"
      ? 0xdba64a
      : item.mode === "simulated"
        ? 0x28a6c4
        : item.status === "live"
          ? 0x32b881
          : item.status === "offline"
            ? 0xef6461
            : 0x8191a3;
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
      if ("geometry" in object && !object.userData.sharedReferenceGeometry)
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
      .then((gltf) => optimizeFactoryReference(gltf.scene))
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

function areaSign(text: string, color: string, width: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, 512, 128);
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  const [title, ...rest] = text.split(/\s*\/\s*/);
  const subtitle = rest.join(" / ");
  context.font = `600 ${Math.min(subtitle ? 78 : 112, 456 / Math.max(1, title.length * 0.64))}px sans-serif`;
  context.fillText(title, 256, subtitle ? 77 : 101, 472);
  if (subtitle) {
    context.font = `500 ${Math.min(34, 456 / Math.max(1, subtitle.length * 0.6))}px sans-serif`;
    context.fillText(subtitle, 256, 116, 472);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, width / 4),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  );
}

export default function FactoryFloorScene({
  layout,
  links,
  selected,
  onSelect,
  dark,
  reset,
  zone,
  onMove,
  onItemDrag,
  onItemDrop,
  onDelete,
}: {
  layout: Layout;
  links: FloorLink[];
  selected: string | null;
  onSelect: FloorSelect;
  dark: boolean;
  reset: number;
  zone: string;
  onMove?: FloorMove;
} & FloorDragHandlers) {
  const [rotateOnHover, setRotateOnHover] = useState(false);
  const rotateOnHoverRef = useRef(false);
  rotateOnHoverRef.current = rotateOnHover;
  const host = useRef<HTMLDivElement>(null),
    choose = useRef(onSelect),
    selection = useRef(selected),
    move = useRef(onMove);
  const dragEvents = useRef({ onItemDrag, onItemDrop, onDelete });
  dragEvents.current = { onItemDrag, onItemDrop, onDelete };
  const runtime = useRef<{
    focus: (ref: string | null) => void;
    reset: () => void;
    resetHover: () => void;
    statuses: (items: Layout["placements"]) => void;
    positions: (items: Layout["placements"]) => void;
    zones: (zones: Layout["zones"]) => void;
  } | null>(null);
  const cameraMemory = useRef<{
    width: number;
    depth: number;
    zone: string;
    reset: number;
    position: THREE.Vector3;
    target: THREE.Vector3;
    zoom: number;
  } | null>(null);
  const [failed, setFailed] = useState(false),
    [ready, setReady] = useState(false),
    [loaded, setLoaded] = useState(0);
  choose.current = onSelect;
  selection.current = selected;
  move.current = onMove;
  const key =
    layout.placements
      .map(
        (p) =>
          `${p.item.ref}:${p.model}:${JSON.stringify(p.dimensions ?? null)}`,
      )
      .join("|") +
    links.map((l) => `${l.from}:${l.to}`).join("|") +
    `${layout.width}:${layout.depth}:${layout.measured ?? false}:` +
    (layout.measured
      ? JSON.stringify(
          layout.placements
            .filter((p) => /door/.test(p.model ?? ""))
            .map((p) => [p.item.ref, p.x, p.z, p.rotation, p.dimensions]),
        )
      : "") +
    JSON.stringify(layout.zones.map(({ count, ...zone }) => zone));
  useEffect(() => {
    if (failed) return;
    let cleanup: (() => void) | undefined;
    let secondFrame = 0;
    // Present the summary and accessible floor before initializing WebGL.
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        cleanup = mountScene();
      });
    });
    function mountScene() {
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
      let cancelForResize = () => {};
      let disposed = false,
        dirty = true,
        frame = 0;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(dark ? "#182532" : "#dce3e6");
      const gl = renderer.getContext(),
        debug = gl.getExtension("WEBGL_debug_renderer_info");
      const software = debug
        ? /swiftshader|llvmpipe|software/i.test(
            String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)),
          )
        : false;
      renderer.setPixelRatio(
        Math.min(
          devicePixelRatio || 1,
          software ? 1 : innerWidth < 768 ? 1.5 : 2,
        ),
      );
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = dark ? 0.95 : 1.05;
      let studio: THREE.Texture | undefined;
      void createStudioEnvironment()
        .then((texture) => {
          if (disposed) {
            texture.dispose();
            return;
          }
          studio = texture;
          scene.environment = texture;
          scene.environmentIntensity = 0.85;
          renderer.domElement.dataset.graphicsEnvironment = "baked-hdr-studio";
          dirty = true;
        })
        .catch(() => {
          if (disposed) return;
          renderer.domElement.dataset.graphicsEnvironment =
            "direct-light-fallback";
        });
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
      renderer.domElement.setAttribute(
        "aria-label",
        "Interactive 3D factory floor",
      );
      renderer.domElement.setAttribute("role", "img");
      renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute(
        "aria-description",
        "With Rotate off, press and hold the left mouse button on empty floor, then drag to pan left/right or up/down. Release to stop; hovering does not move the view. Enable Rotate to orbit with mouse movement. Press and hold equipment to grab it. Rotation pauses while grabbing. Release to drop. Right-drag or Shift-drag also rotates; scroll or pinch zooms. Hold Space while dragging to pan over equipment. Arrow keys move selected equipment; Escape cancels an item grab or clears selection.",
      );
      renderer.domElement.dataset.floorNodeCount = String(
        layout.placements.length,
      );
      const flowAreas = factoryAreas(layout);
      renderer.domElement.dataset.factoryAreas = JSON.stringify(flowAreas);
      element.appendChild(renderer.domElement);
      const camera = new THREE.OrthographicCamera(
        -20,
        20,
        15,
        -15,
        0.1,
        Math.max(
          500,
          Math.max(layout.width, layout.depth) * 8,
          ...layout.placements.map((p) => (p.dimensions?.height ?? 0) * 4),
        ),
      );
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      controls.cursorStyle = "grab";
      controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
      controls.touches.ONE = THREE.TOUCH.PAN;
      controls.maxPolarAngle = Math.PI * 0.48;
      controls.minZoom = 0.4;
      controls.maxZoom = 10;
      controls.screenSpacePanning = true;
      let hoverPoint: { x: number; y: number } | undefined;
      const resetHover = () => {
        hoverPoint = undefined;
      };
      const hoverOffset = new THREE.Vector3(),
        hoverRotation = new THREE.Spherical();
      scene.add(new THREE.HemisphereLight(0xdceaff, 0x4b535b, 0.75));
      const benchHardware = isBenchHardwareLayout(layout);
      const maxItemHeight = Math.max(
        benchHardware ? 1.2 : 5,
        ...layout.placements.map((p) =>
          p.dimensions ? p.dimensions.height + 1 : 0,
        ),
      );
      const span = Math.max(
        layout.width,
        layout.depth,
        maxItemHeight * 1.5,
        20,
      );
      const sun = new THREE.DirectionalLight(0xfff1de, 3.1);
      sun.position.set(span * 0.45, span * 0.9, span * 0.55);
      sun.castShadow = true;
      const shadowSize = software ? 1024 : innerWidth >= 1400 ? 4096 : 2048;
      sun.shadow.mapSize.set(shadowSize, shadowSize);
      sun.shadow.normalBias = 0.015;
      sun.shadow.bias = -0.00008;
      sun.shadow.radius = 3;
      sun.shadow.camera.left = sun.shadow.camera.bottom = -span * 0.8;
      sun.shadow.camera.right = sun.shadow.camera.top = span * 0.8;
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = span * 4;
      scene.add(sun);
      const fill = new THREE.DirectionalLight(0xc5d9f4, 0.65);
      fill.position.set(-span * 0.5, span * 0.5, -span * 0.4);
      scene.add(fill);
      const viewerMaterials = new Map<THREE.Material, THREE.Material>();
      const viewerTextures = new Map<THREE.Texture, THREE.Texture>();
      const metalGrain = createSurfaceGrain("metal");
      metalGrain.repeat.set(24, 24);
      const finishMaterial = (material: THREE.Material) => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return;
        if (/enamel|paint|powder|ceramic blue/i.test(material.name)) {
          material.metalness = 0.06;
          material.roughness = Math.max(material.roughness, 0.32);
        }
        if (/rubber|elastomer|polymer/i.test(material.name)) {
          material.metalness = 0.01;
          material.roughness = Math.max(material.roughness, 0.65);
        }
        if (
          /steel|copper|brass|lamination/i.test(material.name) &&
          !material.roughnessMap
        )
          material.roughnessMap = metalGrain;
        if (/glass/i.test(material.name)) {
          material.transparent = true;
          material.opacity = Math.min(material.opacity, 0.4);
          material.depthWrite = false;
        }
        material.envMapIntensity = 0.9;
      };
      const contactMaterial = createContactShadow();
      const contactGeometry = new THREE.PlaneGeometry(1, 1);
      renderer.domElement.dataset.graphicsQuality = software
        ? "efficient-pbr"
        : "high-pbr";
      renderer.domElement.dataset.shadowResolution = String(shadowSize);
      scene.add(createWorkshop(layout, dark));
      for (const area of flowAreas) {
        const color = factoryAreaColors[area.kind];
        if (area.door) {
          const door = area.door;
          for (const side of [-1, 1]) {
            const sign = areaSign(
              area.kind === "inbound" ? "IN" : "EXIT",
              color,
              door.width * 0.7,
            );
            const offset = new THREE.Vector3(
              0,
              3.45,
              side * 0.22,
            ).applyAxisAngle(new THREE.Vector3(0, 1, 0), door.rotation);
            sign.position.set(door.x + offset.x, offset.y, door.z + offset.z);
            sign.rotation.y = door.rotation + (side < 0 ? Math.PI : 0);
            scene.add(sign);
          }
        }
        if (area.origin === "reference" || area.kind === "storage") {
          const sign = areaSign(
            area.kind === "storage"
              ? `WAREHOUSE / ${area.origin === "zone" ? area.name : "Inventory"}`
              : area.name,
            color,
            Math.min(5, Math.max(1, area.width * 0.9)),
          );
          if (area.kind === "storage") {
            sign.position.set(
              area.x + area.width / 2,
              3.1,
              area.z +
                Math.min(area.depth / 2, 0.8) +
                Math.min(0.9, Math.max(0.45, area.depth - 0.2)) / 2 +
                0.02,
            );
          } else {
            sign.rotation.x = -Math.PI / 2;
            sign.position.set(
              area.x + area.width / 2,
              0.017,
              area.z + area.depth * 0.8,
            );
          }
          scene.add(sign);
        }
      }
      const objects = new Map<string, THREE.Group>(),
        indicators = new Map<string, THREE.Mesh>(),
        markers = new Map<
          string,
          THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>
        >();
      const labels = new Map<string, THREE.Sprite>();
      const retired: THREE.Object3D[] = [];
      const zoneLabels = new Map<
        number,
        { sprite: THREE.Sprite; count: number }
      >();
      layout.zones.forEach((area, index) => {
        const name = label(
          `${area.name} · ${area.count}`,
          "#284d64",
          Math.min(area.width - 1, 6),
        );
        name.position.set(area.x + area.width / 2, 1.45, area.z + 0.6);
        scene.add(name);
        zoneLabels.set(index, { sprite: name, count: area.count });
      });
      for (const p of layout.placements) {
        const group = new THREE.Group();
        group.position.set(p.x, 0, p.z);
        group.rotation.y = THREE.MathUtils.degToRad(p.rotation ?? 0);
        group.userData.ref = p.item.ref;
        const contact = new THREE.Mesh(contactGeometry, contactMaterial);
        contact.rotation.x = -Math.PI / 2;
        contact.position.y = 0.018;
        const footprintSize =
          p.item.kind === "device"
            ? 0.9
            : (factoryModelSize[p.model ?? ""] ?? 2.7) * 1.05;
        contact.scale.set(
          p.dimensions?.width ?? footprintSize,
          p.dimensions?.depth ?? footprintSize * 0.8,
          1,
        );
        contact.userData.nonSelectable = true;
        group.add(contact);
        const benchBoard = ["raspberry-pi-5", "esp32-wrover-dht11"].includes(
          p.model ?? "",
        );
        const proxy = createEquipmentProxy(p.model, p.item.itemType);
        const body =
          p.dimensions && !benchBoard
            ? fitFactoryDimensions(proxy, p.dimensions)
            : proxy;
        body.userData.floorItemRef = p.item.ref;
        group.add(body);
        const name = label(p.item.name, "#203c4b");
        name.position.set(
          0,
          benchBoard ? 1.12 : p.dimensions ? p.dimensions.height + 0.8 : 3.05,
          0,
        );
        name.visible = p.item.ref === selection.current;
        labels.set(p.item.ref, name);
        group.add(name);
        const marker = new THREE.Mesh(
          new THREE.CylinderGeometry(0.13, 0.13, 0.1, 16),
          new THREE.MeshBasicMaterial({
            color: indicatorColor(p.item),
          }),
        );
        marker.position.set(
          benchBoard
            ? -0.4
            : p.dimensions
              ? -Math.min(p.dimensions.width / 2, 0.64)
              : -0.64,
          benchBoard ? 0.75 : p.dimensions ? p.dimensions.height + 0.32 : 2.55,
          0,
        );
        marker.userData.nonSelectable = true;
        const rim = new THREE.Mesh(
          new THREE.TorusGeometry(0.16, 0.035, 8, 16),
          new THREE.MeshBasicMaterial({ color: 0xf7fafc }),
        );
        rim.rotation.x = Math.PI / 2;
        marker.add(rim);
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
        if (p.dimensions)
          halo.scale.set(p.dimensions.width / 2.5, p.dimensions.depth / 2.5, 1);
        halo.rotation.x = -Math.PI / 2;
        halo.position.y = 0.025;
        halo.visible = false;
        halo.userData.nonSelectable = true;
        group.add(halo);
        indicators.set(p.item.ref, halo);
        scene.add(group);
        objects.set(p.item.ref, group);
        if (
          p.model &&
          ![
            "warehouse-rack",
            "loading-door",
            "exit-door",
            "raspberry-pi-5",
            "esp32-wrover-dht11",
          ].includes(p.model) &&
          (p.model !== "raspberry-pi-4b" || p.item.equipmentId)
        )
          void referenceModel(p.model)
            .then((model) => {
              if (disposed) return;
              const copy = instantiateFactoryReference(
                  model,
                  viewerMaterials,
                  viewerTextures,
                  finishMaterial,
                ),
                box = new THREE.Box3().setFromObject(copy),
                size = box.getSize(new THREE.Vector3()),
                center = box.getCenter(new THREE.Vector3());
              const scale =
                (factoryModelSize[p.model!] ?? 2.7) /
                Math.max(size.x, size.y, size.z, 0.001);
              copy.position.sub(center);
              const normalized = new THREE.Group();
              normalized.userData.floorItemRef = p.item.ref;
              normalized.add(copy);
              if (p.dimensions)
                normalized.scale.set(
                  p.dimensions.width / Math.max(size.x, 0.00001),
                  p.dimensions.height / Math.max(size.y, 0.00001),
                  p.dimensions.depth / Math.max(size.z, 0.00001),
                );
              else normalized.scale.setScalar(scale);
              const height = p.dimensions?.height ?? size.y * scale;
              normalized.position.y = height / 2 + 0.025;
              group.userData.modelHeight = height;
              name.position.y = height + 0.8;
              marker.position.set(
                -Math.min((p.dimensions?.width ?? size.x * scale) / 2, 0.64),
                height + 0.32,
                0,
              );
              normalized.traverse((o) => {
                if (o instanceof THREE.Mesh) {
                  o.castShadow = true;
                  o.receiveShadow = true;
                }
              });
              group.remove(body);
              retired.push(body);
              group.add(normalized);
              setLoaded((n) => n + 1);
              renderer.shadowMap.needsUpdate = true;
              renderer.domElement.dataset.referenceMaterialCount = String(
                viewerMaterials.size,
              );
              dirty = true;
            })
            .catch(() => {
              /* The labelled proxy remains available when a reference cannot load. */
            });
      }
      const connectionLines: Array<{ link: FloorLink; line: THREE.Line }> = [];
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
            opacity: 0.24,
          }),
        );
        line.computeLineDistances();
        scene.add(line);
        connectionLines.push({ link, line });
      }
      const updateConnections = () => {
        renderer.shadowMap.needsUpdate = true;
        for (const { link, line } of connectionLines) {
          const from = objects.get(link.from),
            to = objects.get(link.to);
          if (!from || !to) continue;
          const positions = line.geometry.getAttribute("position");
          positions.setXYZ(0, from.position.x, 0.07, from.position.z);
          positions.setXYZ(1, to.position.x, 0.07, to.position.z);
          positions.needsUpdate = true;
          line.geometry.computeBoundingSphere();
          line.computeLineDistances();
        }
        dirty = true;
      };
      const size = () => {
        resetHover();
        cancelForResize();
        const width = element.clientWidth,
          height = element.clientHeight,
          aspect = width / Math.max(height, 1);
        camera.updateMatrixWorld(true);
        let halfWidth = 0,
          halfHeight = 0;
        // Fit the projected bounds, including the outermost equipment labels.
        // A width/depth heuristic clips corners after an isometric rotation.
        for (const x of [-layout.width / 2 - 2, layout.width / 2 + 2])
          for (const y of [-0.5, maxItemHeight])
            for (const z of [-layout.depth / 2 - 2, layout.depth / 2 + 2]) {
              const point = new THREE.Vector3(x, y, z).applyMatrix4(
                camera.matrixWorldInverse,
              );
              halfWidth = Math.max(halfWidth, Math.abs(point.x));
              halfHeight = Math.max(halfHeight, Math.abs(point.y));
            }
        const extent =
          Math.max(
            halfWidth / Math.max(aspect, 0.1),
            halfHeight,
            benchHardware ? 1.8 : 9,
          ) * 1.06;
        camera.left = -extent * aspect;
        camera.right = extent * aspect;
        camera.top = extent;
        camera.bottom = -extent;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        dirty = true;
      };
      const fit = () => {
        // Clear remaining orbit/pan inertia before establishing the fitted view.
        const damping = controls.enableDamping;
        controls.enableDamping = false;
        controls.update();
        camera.position.set(
          layout.width * 0.8,
          Math.max(layout.width, layout.depth) * 0.82,
          layout.depth * 0.95,
        );
        camera.zoom = 1;
        controls.target.set(0, 0, 0);
        camera.updateProjectionMatrix();
        controls.update();
        controls.enableDamping = damping;
        size();
        dirty = true;
      };
      runtime.current = {
        reset: fit,
        resetHover,
        zones: (zones) => {
          for (const [index, area] of zones.entries()) {
            const prior = zoneLabels.get(index);
            if (!prior || prior.count === area.count) continue;
            const next = label(
              `${area.name} · ${area.count}`,
              "#284d64",
              Math.min(area.width - 1, 6),
            );
            next.position.copy(prior.sprite.position);
            scene.remove(prior.sprite);
            disposeObject(prior.sprite);
            scene.add(next);
            zoneLabels.set(index, { sprite: next, count: area.count });
            dirty = true;
          }
        },
        positions: (placements) => {
          for (const p of placements) {
            const object = objects.get(p.item.ref);
            if (object && dragging?.ref !== p.item.ref) {
              object.position.set(p.x, 0, p.z);
              object.rotation.y = THREE.MathUtils.degToRad(p.rotation ?? 0);
            }
          }
          updateConnections();
        },
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
          for (const [id, itemLabel] of labels) itemLabel.visible = id === ref;
          dirty = true;
        },
      };
      runtime.current.focus(selection.current);
      const observer = new ResizeObserver(size);
      observer.observe(element);
      fit();
      const remembered = cameraMemory.current;
      if (
        remembered &&
        remembered.width === layout.width &&
        remembered.depth === layout.depth &&
        remembered.zone === zone &&
        remembered.reset === reset
      ) {
        camera.position.copy(remembered.position);
        controls.target.copy(remembered.target);
        camera.zoom = remembered.zoom;
        camera.updateProjectionMatrix();
        controls.update();
        size();
      }
      const change = () => {
        dirty = true;
        renderer.domElement.dataset.cameraView = JSON.stringify({
          position: camera.position.toArray(),
          target: controls.target.toArray(),
          zoom: camera.zoom,
        });
      };
      controls.addEventListener("change", change);
      change();
      const ray = new THREE.Raycaster(),
        point = new THREE.Vector2();
      const pointers = new Set<number>();
      let panModifier = false;
      let start:
        | { x: number; y: number; pointerId: number; select: boolean }
        | undefined;
      let dragging:
        | {
            ref: string;
            point: THREE.Vector3;
            original: THREE.Vector3;
            pointerId: number;
            moved: boolean;
          }
        | undefined;
      const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hand = () => {
        renderer.domElement.style.cursor = pointers.size ? "grabbing" : "grab";
        renderer.domElement.dataset.grabState = dragging
          ? "item"
          : pointers.size
            ? "floor"
            : "idle";
      };
      renderer.domElement.dataset.interaction = "grab";
      hand();
      const setRay = (e: PointerEvent) => {
        camera.updateMatrixWorld();
        const rect = renderer.domElement.getBoundingClientRect();
        point.set(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        );
        ray.setFromCamera(point, camera);
      };
      const picked = () => floorItemAtRay(scene, ray);
      const unlockView = () => {
        controls.enablePan = controls.enableRotate = controls.enableZoom = true;
      };
      const cancel = (releaseCapture = true) => {
        dragEvents.current.onItemDrag?.(null);
        resetHover();
        start = undefined;
        if (dragging) {
          const ended = dragging;
          dragging = undefined;
          objects.get(ended.ref)?.position.copy(ended.original);
          updateConnections();
          if (
            releaseCapture &&
            renderer.domElement.hasPointerCapture(ended.pointerId)
          )
            renderer.domElement.releasePointerCapture(ended.pointerId);
        }
        unlockView();
        runtime.current?.focus(selection.current);
        hand();
      };
      const down = (e: PointerEvent) => {
        resetHover();
        if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
        pointers.add(e.pointerId);
        if (!e.isPrimary || pointers.size > 1) {
          // OrbitControls has tracked the first touch, so two fingers can take over for pinch/pan.
          cancel(false);
          hand();
          return;
        }
        renderer.domElement.focus({ preventScroll: true });
        const select =
          e.button === 0 &&
          !e.shiftKey &&
          !e.ctrlKey &&
          !e.metaKey &&
          !panModifier;
        start = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, select };
        if (select) {
          setRay(e);
          const ref = picked(),
            ground = ray.ray.intersectPlane(floorPlane, new THREE.Vector3());
          const object = ref && objects.get(ref);
          if (ref && object && ground && move.current) {
            dragging = {
              ref,
              point: ground.clone(),
              original: object.position.clone(),
              pointerId: e.pointerId,
              moved: false,
            };
            dragEvents.current.onItemDrag?.({
              ref,
              clientX: e.clientX,
              clientY: e.clientY,
            });
            // Allow OrbitControls to track pointer lifetimes while suppressing camera motion.
            controls.enablePan =
              controls.enableRotate =
              controls.enableZoom =
                false;
            runtime.current?.focus(ref);
          }
        }
        hand();
      };
      const hoverOrbit = (e: PointerEvent) => {
        // Pan is handled only by OrbitControls during a held pointer grab.
        // With Rotate off, ordinary mouse movement must never move the camera.
        if (
          !rotateOnHoverRef.current ||
          e.pointerType !== "mouse" ||
          e.buttons !== 0 ||
          pointers.size ||
          panModifier ||
          !controls.enabled ||
          document.hidden
        ) {
          resetHover();
          return;
        }
        const previous = hoverPoint;
        hoverPoint = { x: e.clientX, y: e.clientY };
        if (!previous) return;
        const rect = renderer.domElement.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = (e.clientX - previous.x) / rect.width,
          y = (e.clientY - previous.y) / rect.height;
        if (!x && !y) return;
        // Follow actual mouse motion only: no idle spin, inertia, pan or zoom.
        // Bound an individual event so re-entry/device jumps cannot swing the view.
        hoverOffset.copy(camera.position).sub(controls.target);
        hoverRotation.setFromVector3(hoverOffset);
        hoverRotation.theta -=
          THREE.MathUtils.clamp(x, -0.1, 0.1) * Math.PI * 0.8;
        hoverRotation.phi = THREE.MathUtils.clamp(
          hoverRotation.phi -
            THREE.MathUtils.clamp(y, -0.1, 0.1) * Math.PI * 0.4,
          Math.max(controls.minPolarAngle, 0.12),
          controls.maxPolarAngle,
        );
        hoverRotation.makeSafe();
        camera.position
          .copy(controls.target)
          .add(hoverOffset.setFromSpherical(hoverRotation));
        controls.update();
      };
      const pointerMove = (e: PointerEvent) => {
        if (dragging && dragging.pointerId === e.pointerId) {
          dragEvents.current.onItemDrag?.({
            ref: dragging.ref,
            clientX: e.clientX,
            clientY: e.clientY,
          });
          if (
            !start ||
            (!dragging.moved &&
              Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 6)
          )
            return;
          setRay(e);
          const ground = ray.ray.intersectPlane(
            floorPlane,
            new THREE.Vector3(),
          );
          if (!ground) return;
          dragging.moved = true;
          const next = constrainFloorPosition(
            layout,
            dragging.original.x + ground.x - dragging.point.x,
            dragging.original.z + ground.z - dragging.point.z,
            dragging.ref,
          );
          objects.get(dragging.ref)?.position.set(next.x, 0, next.z);
          updateConnections();
          e.preventDefault();
        } else if (!pointers.size) {
          hoverOrbit(e);
          setRay(e);
          const ref = panModifier ? undefined : picked();
          renderer.domElement.dataset.grabTarget = ref ?? "floor";
          renderer.domElement.title = ref
            ? `Grab ${layout.placements.find((p) => p.item.ref === ref)?.item.name ?? "equipment"}`
            : rotateOnHoverRef.current
              ? "Move the mouse to rotate; hold and drag to pan"
              : "Hold the left mouse button and drag to pan; release to stop";
        }
      };
      const up = (e: PointerEvent) => {
        resetHover();
        pointers.delete(e.pointerId);
        const began = start;
        start = undefined;
        if (dragging && dragging.pointerId === e.pointerId) {
          const ended = dragging;
          dragging = undefined;
          unlockView();
          const position = objects.get(ended.ref)?.position;
          const sentToBin =
            ended.moved &&
            dragEvents.current.onItemDrop?.(ended.ref, e.clientX, e.clientY);
          if (sentToBin || !move.current) {
            objects.get(ended.ref)?.position.copy(ended.original);
            updateConnections();
          } else if (
            ended.moved &&
            position &&
            position.distanceTo(ended.original) > 0.001
          )
            move.current?.(ended.ref, position.x, position.z);
          dragEvents.current.onItemDrag?.(null);
          choose.current(ended.ref, !ended.moved && !sentToBin);
        } else if (
          began?.select &&
          began.pointerId === e.pointerId &&
          Math.hypot(e.clientX - began.x, e.clientY - began.y) <= 6
        ) {
          setRay(e);
          const ref = picked();
          if (ref) choose.current(ref);
        }
        hand();
      };
      const focusEquipment = (e: MouseEvent) => {
        resetHover();
        setRay(e as PointerEvent);
        const ref = picked(),
          object = ref && objects.get(ref);
        if (!object) return;
        e.preventDefault();
        const target = object.position.clone();
        target.y += (object.userData.modelHeight ?? 2.7) * 0.45;
        camera.position.add(target.clone().sub(controls.target));
        controls.target.copy(target);
        camera.zoom = Math.min(
          10,
          Math.max(
            1,
            (camera.top - camera.bottom) /
              Math.max(4, (object.userData.modelHeight ?? 2.7) * 1.8),
          ),
        );
        camera.updateProjectionMatrix();
        controls.update();
        dirty = true;
      };
      const pointerCancel = (e: PointerEvent) => {
        pointers.delete(e.pointerId);
        cancel();
      };
      const blur = () => {
        pointers.clear();
        panModifier = false;
        cancel();
        controls.disconnect();
        controls.connect(renderer.domElement);
        controls.cursorStyle = "grab";
      };
      const visibility = () => {
        if (document.hidden) blur();
        else resetHover();
      };
      cancelForResize = () => {
        if (pointers.size || dragging) blur();
      };
      const spaceDown = (e: KeyboardEvent) => {
        const target = e.target;
        if (
          e.code === "Space" &&
          renderer.domElement.matches(":hover") &&
          !(
            target instanceof HTMLElement &&
            (target.isContentEditable ||
              ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName))
          )
        ) {
          e.preventDefault();
          panModifier = true;
        }
      };
      const keyUp = (e: KeyboardEvent) => {
        if (e.code === "Space") panModifier = false;
      };
      const keyDown = (e: KeyboardEvent) => {
        if (
          ["Delete", "Backspace"].includes(e.key) &&
          dragEvents.current.onDelete
        ) {
          const ref = dragging?.ref ?? selection.current;
          if (ref) {
            e.preventDefault();
            cancel();
            dragEvents.current.onDelete(ref);
          }
          return;
        }
        if (e.code === "Space") {
          e.preventDefault();
          panModifier = true;
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          if (dragging) cancel();
          else choose.current("");
          return;
        }
        if (
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            e.key,
          ) ||
          dragging
        )
          return;
        e.preventDefault();
        const direction = new THREE.Vector3();
        camera.getWorldDirection(direction);
        direction.y = 0;
        direction.normalize();
        const right = new THREE.Vector3().crossVectors(
          direction,
          new THREE.Vector3(0, 1, 0),
        );
        const offset = (
          e.key === "ArrowLeft"
            ? right.multiplyScalar(-1)
            : e.key === "ArrowRight"
              ? right
              : e.key === "ArrowUp"
                ? direction
                : direction.multiplyScalar(-1)
        ).multiplyScalar(e.shiftKey ? 2 : 0.5);
        const object = selection.current && objects.get(selection.current);
        if (object && move.current) {
          const next = constrainFloorPosition(
            layout,
            object.position.x + offset.x,
            object.position.z + offset.z,
            selection.current!,
          );
          object.position.set(next.x, 0, next.z);
          updateConnections();
          move.current(selection.current!, next.x, next.z);
        } else {
          camera.position.add(offset);
          controls.target.add(offset);
          controls.update();
        }
      };
      renderer.domElement.addEventListener("dblclick", focusEquipment);
      renderer.domElement.addEventListener("pointercancel", pointerCancel);
      renderer.domElement.addEventListener("lostpointercapture", pointerCancel);
      renderer.domElement.addEventListener("pointermove", pointerMove);
      renderer.domElement.addEventListener("pointerenter", resetHover);
      renderer.domElement.addEventListener("pointerleave", resetHover);
      renderer.domElement.addEventListener("keydown", keyDown);
      renderer.domElement.addEventListener("pointerdown", down, true);
      renderer.domElement.addEventListener("pointerup", up, true);
      window.addEventListener("keydown", spaceDown);
      window.addEventListener("keyup", keyUp);
      window.addEventListener("blur", blur);
      document.addEventListener("visibilitychange", visibility);
      const lost = (event: Event) => {
        event.preventDefault();
        cancelAnimationFrame(frame);
        setFailed(true);
        cleanup?.();
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
        if (disposed) return;
        cameraMemory.current = {
          width: layout.width,
          depth: layout.depth,
          zone,
          reset,
          position: camera.position.clone(),
          target: controls.target.clone(),
          zoom: camera.zoom,
        };
        disposed = true;
        cancel();
        cancelAnimationFrame(frame);
        observer.disconnect();
        controls.dispose();
        runtime.current = null;
        renderer.domElement.removeEventListener("dblclick", focusEquipment);
        renderer.domElement.removeEventListener("pointercancel", pointerCancel);
        renderer.domElement.removeEventListener(
          "lostpointercapture",
          pointerCancel,
        );
        window.removeEventListener("keydown", spaceDown);
        window.removeEventListener("keyup", keyUp);
        window.removeEventListener("blur", blur);
        document.removeEventListener("visibilitychange", visibility);
        renderer.domElement.removeEventListener("pointermove", pointerMove);
        renderer.domElement.removeEventListener("pointerenter", resetHover);
        renderer.domElement.removeEventListener("pointerleave", resetHover);
        renderer.domElement.removeEventListener("keydown", keyDown);
        renderer.domElement.removeEventListener("pointerdown", down, true);
        renderer.domElement.removeEventListener("pointerup", up, true);
        renderer.domElement.removeEventListener("webglcontextlost", lost);
        // Disposing GPU resources preserves the cached CPU references for reuse.
        retired.forEach(disposeObject);
        disposeObject(scene);
        studio?.dispose();
        metalGrain.dispose();
        contactMaterial.map?.dispose();
        contactMaterial.dispose();
        contactGeometry.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    }
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      cleanup?.();
    };
  }, [key, dark, failed]);
  useEffect(() => {
    runtime.current?.focus(selected);
  }, [selected, key, dark]);
  useEffect(() => {
    runtime.current?.statuses(layout.placements);
    runtime.current?.positions(layout.placements);
    runtime.current?.zones(layout.zones);
  }, [layout, key, dark]);
  useEffect(() => {
    runtime.current?.reset();
  }, [reset, zone]);
  return (
    <div className="relative h-full w-full">
      <div ref={host} className={`h-full w-full ${failed ? "hidden" : ""}`} />
      {!failed && (
        <button
          type="button"
          aria-pressed={rotateOnHover}
          aria-label="Rotate with mouse movement"
          title={
            rotateOnHover
              ? "Rotate on: move the mouse to orbit"
              : "Rotate off: hold the left mouse button and drag to pan"
          }
          onClick={() => {
            runtime.current?.resetHover();
            setRotateOnHover((value) => !value);
          }}
          className="absolute right-3 top-3 z-10 rounded-md border bg-background/95 px-3 py-2 text-xs font-medium shadow-sm"
        >
          {rotateOnHover ? "Rotate: On" : "Rotate: Off · Pan"}
        </button>
      )}
      {failed ? (
        <>
          <FloorPlan
            layout={layout}
            links={links}
            selected={selected}
            onSelect={onSelect}
            onMove={onMove}
            onItemDrag={onItemDrag}
            onItemDrop={onItemDrop}
            onDelete={onDelete}
            reset={reset}
          />
          <p
            role="status"
            className="pointer-events-none absolute left-3 right-3 top-3 w-fit rounded-md border bg-background/95 px-2 py-1 text-[11px] text-muted-foreground"
          >
            3D unavailable on this device · Showing floor plan
          </p>
        </>
      ) : (
        <>
          <span
            className="pointer-events-none absolute top-3 left-3 rounded-md border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground"
            role="status"
          >
            {ready
              ? `${layout.placements.length} items on floor · ${loaded} detailed models ready`
              : "Preparing factory floor…"}
          </span>
        </>
      )}
    </div>
  );
}
