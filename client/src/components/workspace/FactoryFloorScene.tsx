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
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  createWorkshop,
  createEquipmentProxy,
  isBenchHardwareLayout,
} from "./FactoryEnvironment";
import { createStudioEnvironment } from "../equipment/studioEnvironment";
import {
  FactoryScenePreparation,
  disposeFactoryScene,
} from "./factory-scene-preparation";
import { floorItemAtRay } from "./floor-picking";
import {
  findExplorePosition,
  moveExplorePosition,
} from "./floor-explore-navigation";
import { floorReferenceBytes } from "./factory-reference-delivery";
import { factoryAreas, factoryAreaColors } from "./factory-spaces";
import {
  FactoryConnectionLayer,
  EMPTY_CONNECTION_APPEARANCES,
  type ConnectionAppearances,
} from "./factory-connections";
import {
  optimizeFactoryReference,
  instantiateFactoryReference,
  createSurfaceGrain,
  createContactShadow,
  factoryModelSize,
  fitFactoryDimensions,
} from "./factory-graphics";
import {
  floorNvidiaAsset,
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
const models = new Map<string, Promise<THREE.Group>>();

function referenceModel(slug: string) {
  if (!models.has(slug)) {
    const pending = floorReferenceBytes(slug)
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
  connectionAppearances = EMPTY_CONNECTION_APPEARANCES,
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
  connectionAppearances?: ConnectionAppearances;
  selected: string | null;
  onSelect: FloorSelect;
  dark: boolean;
  reset: number;
  zone: string;
  onMove?: FloorMove;
} & FloorDragHandlers) {
  const [rotateEnabled, setRotateEnabled] = useState(false);
  const [exploring, setExploring] = useState(false);
  const exploringRef = useRef(false);
  const [exploreNotice, setExploreNotice] = useState("");
  const rotateEnabledRef = useRef(false);
  rotateEnabledRef.current = rotateEnabled;
  const [rotationActive, setRotationActive] = useState(false);
  const rotationActiveRef = useRef(false);
  const appearances = useRef(connectionAppearances);
  appearances.current = connectionAppearances;
  const latestLayout = useRef(layout);
  latestLayout.current = layout;
  const host = useRef<HTMLDivElement>(null),
    choose = useRef(onSelect),
    selection = useRef(selected),
    move = useRef(onMove);
  const dragEvents = useRef({ onItemDrag, onItemDrop, onDelete });
  dragEvents.current = { onItemDrag, onItemDrop, onDelete };
  const runtime = useRef<{
    focus: (ref: string | null) => void;
    reset: () => void;
    setExplore: (enabled: boolean, ref?: string | null) => void;
    stepExplore: (forward: number, sideways: number) => void;
    lookExplore: (yaw: number, pitch: number) => void;
    pauseRotation: () => void;
    connections: () => void;
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
    [loaded, setLoaded] = useState(0),
    [unavailable, setUnavailable] = useState(0);
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
    JSON.stringify(links.map((l) => [l.from, l.to, l.kind])) +
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
    if (exploringRef.current) {
      exploringRef.current = false;
      setExploring(false);
    }
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
      setUnavailable(0);
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
        scenePrepared = false,
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
      const renderedNvidia = new Set<string>();
      renderer.domElement.dataset.floorNvidiaModels = "[]";
      renderer.domElement.dataset.floorReferenceFailures = "0";
      let referenceFailures = 0;
      let studio: THREE.Texture | undefined;
      const environment = createStudioEnvironment()
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
      const overviewDescription =
        "With Rotate off, press and hold the left mouse button on empty floor, then drag to pan left/right or up/down. Release to stop; hovering does not move the view. Enable Rotate, then click empty floor to start mouse-controlled rotation. Click again to stop. Press and hold equipment to grab it. Grabbing or leaving the floor stops rotation. Release to drop. Right-drag or Shift-drag also rotates; scroll or pinch zooms. Hold Space while dragging to pan over equipment. Arrow keys move selected equipment; Escape cancels an item grab or clears selection.";
      renderer.domElement.setAttribute("aria-description", overviewDescription);
      renderer.domElement.dataset.viewMode = "overview";
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
      const exploreCamera = new THREE.PerspectiveCamera(
        62,
        1,
        0.08,
        camera.far,
      );
      const controls = new OrbitControls(camera, renderer.domElement);
      const preparation = new FactoryScenePreparation(
        renderer,
        camera,
        scene,
        environment,
      );
      const pendingReferences = new Set<THREE.Object3D>();
      void preparation
        .enqueue(() => ({
          object: scene,
          activate: () => {
            scenePrepared = true;
            renderer.shadowMap.needsUpdate = true;
            dirty = true;
          },
        }))
        .catch(() => {
          if (disposed) return;
          setFailed(true);
          cleanup?.();
        });
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
      const setRotation = (active: boolean) => {
        rotationActiveRef.current = active;
        setRotationActive(active);
        resetHover();
      };
      const pauseRotation = () => setRotation(false);
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
      // An illustrative enclosure is shown only from inside; the overview
      // keeps its open cutaway and continues to represent the same equipment.
      const interior = new THREE.Group();
      interior.visible = false;
      const interiorMaterial = new THREE.MeshStandardMaterial({
        color: dark ? 0x344451 : 0xdce1e2,
        roughness: 0.86,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      const padding = layout.measured ? 0 : 3;
      const interiorWidth = layout.width + padding;
      const interiorDepth = layout.depth + padding;
      const interiorHeight = Math.max(4.5, Math.min(24, maxItemHeight));
      const interiorWall = (
        width: number,
        height: number,
        x: number,
        y: number,
        z: number,
        rotation = 0,
      ) => {
        const wall = new THREE.Mesh(
          new THREE.PlaneGeometry(width, height),
          interiorMaterial,
        );
        wall.position.set(x, y, z);
        wall.rotation.y = rotation;
        interior.add(wall);
      };
      interiorWall(
        interiorWidth,
        interiorHeight,
        0,
        interiorHeight / 2,
        interiorDepth / 2,
      );
      interiorWall(
        interiorDepth,
        interiorHeight,
        interiorWidth / 2,
        interiorHeight / 2,
        0,
        Math.PI / 2,
      );
      const ceiling = new THREE.Mesh(
        new THREE.PlaneGeometry(interiorWidth, interiorDepth),
        interiorMaterial,
      );
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.y = interiorHeight;
      interior.add(ceiling);
      // Two merged meshes provide readable overhead structure without adding
      // point lights or extra shadow passes. This enclosure is illustrative.
      const beamParts: THREE.BufferGeometry[] = [];
      const stripParts: THREE.BufferGeometry[] = [];
      const rows = Math.max(2, Math.min(8, Math.ceil(interiorDepth / 6)));
      for (let row = 0; row < rows; row++) {
        const z = (row / (rows - 1) - 0.5) * Math.max(0, interiorDepth - 1);
        const beam = new THREE.BoxGeometry(
          Math.max(0.5, interiorWidth - 0.5),
          0.16,
          0.18,
        );
        beam.translate(0, interiorHeight - 0.12, z);
        beamParts.push(beam);
        for (const fraction of [-0.3, 0, 0.3]) {
          const strip = new THREE.BoxGeometry(
            Math.min(2.4, interiorWidth / 4),
            0.035,
            0.2,
          );
          strip.translate(interiorWidth * fraction, interiorHeight - 0.22, z);
          stripParts.push(strip);
        }
      }
      const beamGeometry = mergeGeometries(beamParts);
      const stripGeometry = mergeGeometries(stripParts);
      beamParts.forEach((geometry) => geometry.dispose());
      stripParts.forEach((geometry) => geometry.dispose());
      if (!beamGeometry || !stripGeometry)
        throw new Error("Unable to prepare factory interior");
      interior.add(
        new THREE.Mesh(
          beamGeometry,
          new THREE.MeshStandardMaterial({
            color: dark ? 0x71808a : 0x9aa8ac,
            roughness: 0.48,
            metalness: 0.45,
          }),
        ),
      );
      interior.add(
        new THREE.Mesh(
          stripGeometry,
          new THREE.MeshStandardMaterial({
            color: 0xfff5df,
            emissive: 0xffe7bd,
            emissiveIntensity: 1.1,
            roughness: 0.5,
          }),
        ),
      );
      scene.add(interior);
      renderer.domElement.dataset.exploreInteriorMeshes = String(
        interior.children.length,
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
      let updateConnections = () => {};
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
      const setZoneLabelsVisible = (visible: boolean) => {
        for (const { sprite } of zoneLabels.values()) sprite.visible = visible;
        renderer.domElement.dataset.floorZoneLabelsTotal = String(
          zoneLabels.size,
        );
        renderer.domElement.dataset.floorZoneLabelsVisible = String(
          visible ? zoneLabels.size : 0,
        );
        dirty = true;
      };
      setZoneLabelsVisible(true);
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
        const proxySize = new THREE.Box3()
          .setFromObject(body)
          .getSize(new THREE.Vector3());
        group.userData.connectionSize = proxySize.toArray();
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
          !["raspberry-pi-5", "esp32-wrover-dht11"].includes(p.model) &&
          (p.model !== "raspberry-pi-4b" || p.item.equipmentId)
        )
          void referenceModel(p.model)
            .then((model) => {
              if (disposed) return;
              return preparation.enqueue(() => {
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
                normalized.traverse((o) => {
                  if (o instanceof THREE.Mesh) {
                    o.castShadow = true;
                    o.receiveShadow = true;
                  }
                });
                pendingReferences.add(normalized);
                return {
                  object: normalized,
                  activate: () => {
                    group.userData.modelHeight = height;
                    group.userData.connectionSize = [
                      p.dimensions?.width ?? size.x * scale,
                      height,
                      p.dimensions?.depth ?? size.z * scale,
                    ];
                    name.position.y = height + 0.8;
                    marker.position.set(
                      -Math.min(
                        (p.dimensions?.width ?? size.x * scale) / 2,
                        0.64,
                      ),
                      height + 0.32,
                      0,
                    );
                    group.remove(body);
                    retired.push(body);
                    group.add(normalized);
                    pendingReferences.delete(normalized);
                    setLoaded((n) => n + 1);
                    const nvidia = floorNvidiaAsset(p.model!);
                    if (nvidia) {
                      renderedNvidia.add(nvidia);
                      renderer.domElement.dataset.floorNvidiaModels =
                        JSON.stringify([...renderedNvidia].sort());
                    }
                    renderer.shadowMap.needsUpdate = true;
                    renderer.domElement.dataset.referenceMaterialCount = String(
                      viewerMaterials.size,
                    );
                    updateConnections();
                    dirty = true;
                  },
                };
              });
            })
            .catch(() => {
              // Keep the selectable proxy and tell the user the detail is unavailable.
              if (!disposed) {
                renderer.domElement.dataset.floorReferenceFailures = String(
                  ++referenceFailures,
                );
                setUnavailable((count) => count + 1);
              }
            });
      }
      const connectionLayer = new FactoryConnectionLayer(software);
      scene.add(connectionLayer.root);
      updateConnections = () => {
        connectionLayer.update(links, objects, appearances.current, {
          width: layout.width,
          depth: layout.depth,
        });
        renderer.domElement.dataset.connectionTrayTrunks = String(
          connectionLayer.trayMetrics.trunks,
        );
        renderer.domElement.dataset.connectionTrayBranches = String(
          connectionLayer.trayMetrics.branches,
        );
        renderer.domElement.dataset.connectionRendering = "physical-meshes";
        renderer.domElement.dataset.connectionRoutes = JSON.stringify(
          connectionLayer.summary,
        );
        renderer.domElement.dataset.connectionCount = String(
          connectionLayer.summary.length,
        );
        renderer.shadowMap.needsUpdate = true;
        dirty = true;
      };
      updateConnections();
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
        // A small hardware bench has no warehouse walls or zone labels. The
        // factory's two-metre margin doubled its footprint and hid board detail.
        const margin = benchHardware ? 0.15 : 2;
        const bounds = new THREE.Box3(
          new THREE.Vector3(
            -layout.width / 2 - margin,
            benchHardware ? -0.85 : -0.5,
            -layout.depth / 2 - margin,
          ),
          new THREE.Vector3(
            layout.width / 2 + margin,
            maxItemHeight,
            layout.depth / 2 + margin,
          ),
        );
        if (connectionLayer.root.children.length)
          bounds.union(new THREE.Box3().setFromObject(connectionLayer.root));
        for (const x of [bounds.min.x, bounds.max.x])
          for (const y of [bounds.min.y, bounds.max.y])
            for (const z of [bounds.min.z, bounds.max.z]) {
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
        exploreCamera.aspect = aspect;
        exploreCamera.updateProjectionMatrix();
        renderer.setSize(width, height);
        dirty = true;
      };
      const publishExploreView = () => {
        const direction = new THREE.Vector3();
        exploreCamera.getWorldDirection(direction);
        renderer.domElement.dataset.cameraView = JSON.stringify({
          mode: "explore",
          position: exploreCamera.position.toArray(),
          target: exploreCamera.position.clone().add(direction).toArray(),
          zoom: exploreCamera.zoom,
        });
        dirty = true;
      };
      const setExploreMode = (enabled: boolean, ref?: string | null) => {
        if (
          explorePointer &&
          renderer.domElement.hasPointerCapture(explorePointer.id)
        )
          renderer.domElement.releasePointerCapture(explorePointer.id);
        explorePointer = undefined;
        cancel();
        if (!enabled) {
          exploringRef.current = false;
          setExploring(false);
          setExploreNotice("");
          controls.enabled = true;
          interior.visible = false;
          setZoneLabelsVisible(true);
          preparation.setCamera(camera);
          renderer.domElement.dataset.viewMode = "overview";
          renderer.domElement.setAttribute(
            "aria-description",
            overviewDescription,
          );
          hand();
          controls.update();
          change();
          return;
        }
        const point = findExplorePosition(latestLayout.current, ref);
        if (!point) {
          setExploreNotice("No clear position is available on this floor.");
          return;
        }
        pauseRotation();
        exploringRef.current = true;
        setExploring(true);
        setExploreNotice("");
        controls.enabled = false;
        interior.visible = true;
        setZoneLabelsVisible(false);
        preparation.setCamera(exploreCamera);
        renderer.domElement.dataset.viewMode = "explore";
        renderer.domElement.dataset.interaction = "explore";
        renderer.domElement.style.cursor = "grab";
        renderer.domElement.title = "Drag to look; click equipment to select";
        renderer.domElement.setAttribute(
          "aria-description",
          "Explore the floor. The surrounding structure is illustrative. Drag to look, click equipment to select it, or use W, A, S and D to move. Arrow keys turn or look. Escape returns to overview. On-screen controls also move and turn the view.",
        );
        exploreCamera.position.set(point.x, 1.65, point.z);
        const selectedPlacement = latestLayout.current.placements.find(
          (placement) => placement.item.ref === ref,
        );
        const targetX = selectedPlacement?.x ?? 0;
        const targetZ = selectedPlacement?.z ?? 0;
        exploreCamera.lookAt(targetX, 1.4, targetZ);
        exploreCamera.updateMatrixWorld(true);
        publishExploreView();
      };
      const stepExplore = (forward: number, sideways: number) => {
        if (!exploringRef.current) return;
        const direction = new THREE.Vector3();
        exploreCamera.getWorldDirection(direction);
        direction.y = 0;
        direction.normalize();
        const right = new THREE.Vector3().crossVectors(
          direction,
          new THREE.Vector3(0, 1, 0),
        );
        const delta = direction
          .multiplyScalar(forward)
          .add(right.multiplyScalar(sideways));
        const next = moveExplorePosition(
          latestLayout.current,
          { x: exploreCamera.position.x, z: exploreCamera.position.z },
          delta.x,
          delta.z,
        );
        exploreCamera.position.set(next.x, 1.65, next.z);
        publishExploreView();
      };
      const lookExplore = (yaw: number, pitch: number) => {
        if (!exploringRef.current) return;
        const angles = new THREE.Euler().setFromQuaternion(
          exploreCamera.quaternion,
          "YXZ",
        );
        angles.y += yaw;
        angles.x = THREE.MathUtils.clamp(angles.x + pitch, -1.15, 1.15);
        exploreCamera.quaternion.setFromEuler(angles);
        publishExploreView();
      };
      const fit = () => {
        if (exploringRef.current) setExploreMode(false);
        pauseRotation();
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
        setExplore: setExploreMode,
        stepExplore,
        lookExplore,
        pauseRotation,
        connections: updateConnections,
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
            next.visible = !exploringRef.current;
            scene.remove(prior.sprite);
            disposeFactoryScene([prior.sprite]);
            scene.add(next);
            zoneLabels.set(index, { sprite: next, count: area.count });
            setZoneLabelsVisible(!exploringRef.current);
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
      let explorePointer:
        | { id: number; x: number; y: number; startX: number; startY: number }
        | undefined;
      let panModifier = false;
      let start:
        | {
            x: number;
            y: number;
            pointerId: number;
            select: boolean;
            mouse: boolean;
            wasRotating: boolean;
          }
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
        const activeCamera = exploringRef.current ? exploreCamera : camera;
        activeCamera.updateMatrixWorld();
        const rect = renderer.domElement.getBoundingClientRect();
        point.set(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        );
        ray.setFromCamera(point, activeCamera);
      };
      const picked = () => floorItemAtRay(scene, ray);
      const unlockView = () => {
        controls.enablePan = controls.enableRotate = controls.enableZoom = true;
      };
      const cancel = (releaseCapture = true) => {
        dragEvents.current.onItemDrag?.(null);
        pauseRotation();
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
        if (exploringRef.current) {
          if (!e.isPrimary || e.button !== 0) return;
          renderer.domElement.focus({ preventScroll: true });
          explorePointer = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            startX: e.clientX,
            startY: e.clientY,
          };
          renderer.domElement.setPointerCapture(e.pointerId);
          e.preventDefault();
          return;
        }
        const wasRotating = rotationActiveRef.current;
        pauseRotation();
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
        start = {
          x: e.clientX,
          y: e.clientY,
          pointerId: e.pointerId,
          select,
          mouse: e.pointerType === "mouse",
          wasRotating,
        };
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
          !rotateEnabledRef.current ||
          !rotationActiveRef.current ||
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
        if (exploringRef.current) {
          if (explorePointer?.id === e.pointerId) {
            const dx = THREE.MathUtils.clamp(
              e.clientX - explorePointer.x,
              -80,
              80,
            );
            const dy = THREE.MathUtils.clamp(
              e.clientY - explorePointer.y,
              -80,
              80,
            );
            explorePointer.x = e.clientX;
            explorePointer.y = e.clientY;
            lookExplore(-dx * 0.005, -dy * 0.005);
            e.preventDefault();
          } else if (!explorePointer && e.pointerType === "mouse") {
            setRay(e);
            const ref = picked();
            renderer.domElement.dataset.grabTarget = ref ?? "floor";
            renderer.domElement.title = ref
              ? `Select ${latestLayout.current.placements.find((placement) => placement.item.ref === ref)?.item.name ?? "equipment"}`
              : "Drag to look; click equipment to select";
          }
          return;
        }
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
            : rotateEnabledRef.current
              ? rotationActiveRef.current
                ? "Click to stop rotation"
                : "Click to rotate; drag to pan"
              : "Hold the left mouse button and drag to pan; release to stop";
        }
      };
      const up = (e: PointerEvent) => {
        if (exploringRef.current) {
          const began = explorePointer;
          explorePointer = undefined;
          if (renderer.domElement.hasPointerCapture(e.pointerId))
            renderer.domElement.releasePointerCapture(e.pointerId);
          if (
            began?.id === e.pointerId &&
            Math.hypot(e.clientX - began.startX, e.clientY - began.startY) <= 6
          ) {
            setRay(e);
            const ref = picked();
            choose.current(ref ?? "");
          }
          return;
        }
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
          else if (began.mouse && rotateEnabledRef.current) {
            const active = !began.wasRotating;
            setRotation(active);
            if (active) hoverPoint = { x: e.clientX, y: e.clientY };
          }
        }
        hand();
      };
      const focusEquipment = (e: MouseEvent) => {
        pauseRotation();
        setRay(e as PointerEvent);
        const ref = picked(),
          object = ref && objects.get(ref);
        if (!object) return;
        e.preventDefault();
        if (exploringRef.current && ref) {
          choose.current(ref);
          setExploreMode(true, ref);
          return;
        }
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
        if (exploringRef.current) {
          if (explorePointer?.id === e.pointerId) explorePointer = undefined;
          return;
        }
        const tracked = pointers.delete(e.pointerId);
        // OrbitControls releases capture after our pointer-up handler. That
        // normal release must not undo a click which just activated rotation.
        if (tracked || e.type === "pointercancel") cancel();
      };
      const blur = () => {
        explorePointer = undefined;
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
        if (
          pointers.size ||
          dragging ||
          explorePointer ||
          rotationActiveRef.current
        )
          blur();
      };
      const spaceDown = (e: KeyboardEvent) => {
        if (exploringRef.current) return;
        const target = e.target;
        if (
          e.code === "Space" &&
          renderer.domElement.matches(":hover") &&
          !(
            target instanceof HTMLElement &&
            (target.isContentEditable ||
              ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(
                target.tagName,
              ))
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
        if (exploringRef.current) {
          const actions: Record<string, () => void> = {
            KeyW: () => stepExplore(0.55, 0),
            KeyS: () => stepExplore(-0.55, 0),
            KeyA: () => stepExplore(0, -0.55),
            KeyD: () => stepExplore(0, 0.55),
            ArrowLeft: () => lookExplore(0.16, 0),
            ArrowRight: () => lookExplore(-0.16, 0),
            ArrowUp: () => lookExplore(0, 0.12),
            ArrowDown: () => lookExplore(0, -0.12),
            Escape: () => setExploreMode(false),
          };
          const action = actions[e.code];
          if (action) {
            e.preventDefault();
            action();
          }
          return;
        }
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
          if (rotationActiveRef.current) pauseRotation();
          else if (dragging) cancel();
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
      renderer.domElement.addEventListener("pointerleave", pauseRotation);
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
        if (document.hidden || !scenePrepared) return;
        if (!exploringRef.current) controls.update();
        if (dirty) {
          renderer.render(scene, exploringRef.current ? exploreCamera : camera);
          dirty = false;
          setReady(true);
        }
      };
      frame = requestAnimationFrame(tick);
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
        preparation.dispose();
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
        renderer.domElement.removeEventListener("pointerleave", pauseRotation);
        renderer.domElement.removeEventListener("keydown", keyDown);
        renderer.domElement.removeEventListener("pointerdown", down, true);
        renderer.domElement.removeEventListener("pointerup", up, true);
        renderer.domElement.removeEventListener("webglcontextlost", lost);
        // Disposing GPU resources preserves the cached CPU references for reuse.
        connectionLayer.dispose();
        disposeFactoryScene([scene, ...retired, ...pendingReferences], {
          materials: [contactMaterial, ...viewerMaterials.values()],
          textures: [
            metalGrain,
            ...viewerTextures.values(),
            ...(studio ? [studio] : []),
          ],
          geometries: [contactGeometry],
        });
        pendingReferences.clear();
        renderer.dispose();
        renderer.forceContextLoss();
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
    runtime.current?.connections();
  }, [connectionAppearances, key, dark]);
  useEffect(() => {
    runtime.current?.reset();
  }, [reset, zone]);
  return (
    <div className="relative h-full w-full">
      <div ref={host} className={`h-full w-full ${failed ? "hidden" : ""}`} />
      {!failed && (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2">
          <span
            className={
              ready && unavailable > 0
                ? "rounded-md border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground"
                : "sr-only"
            }
            role="status"
            title={
              ready
                ? `${loaded} detailed models ready${unavailable ? ` · ${unavailable} simplified` : ""}`
                : undefined
            }
          >
            {ready ? (
              <>
                <span className={unavailable > 0 ? "sr-only" : undefined}>
                  {`${layout.placements.length} items on floor · ${loaded} detailed models ready`}
                </span>
                {unavailable > 0 && <span>{`${unavailable} simplified`}</span>}
              </>
            ) : (
              "Preparing factory floor…"
            )}
          </span>
          <div className="pointer-events-auto ml-auto flex flex-wrap justify-end gap-2">
            {!isBenchHardwareLayout(layout) &&
              layout.width > 2 &&
              layout.depth > 2 && (
                <button
                  type="button"
                  aria-pressed={exploring}
                  aria-label={
                    exploring
                      ? "Exit factory exploration"
                      : "Explore factory at eye level"
                  }
                  onClick={() =>
                    runtime.current?.setExplore(
                      !exploringRef.current,
                      selection.current,
                    )
                  }
                  className="shrink-0 rounded-md border bg-background/95 px-3 py-2 text-xs font-medium shadow-sm"
                >
                  {exploring ? "Exit Explore" : "Explore"}
                </button>
              )}
            {!exploring && (
              <button
                type="button"
                aria-pressed={rotateEnabled}
                aria-label="Rotate with mouse movement"
                data-rotation-state={
                  !rotateEnabled ? "off" : rotationActive ? "active" : "paused"
                }
                title={
                  rotateEnabled
                    ? rotationActive
                      ? "Click the floor to stop rotation"
                      : "Click empty floor, then move the mouse to rotate"
                    : "Rotate off: hold the left mouse button and drag to pan"
                }
                onClick={() => {
                  runtime.current?.pauseRotation();
                  setRotateEnabled((value) => !value);
                }}
                className="shrink-0 rounded-md border bg-background/95 px-3 py-2 text-xs font-medium shadow-sm"
              >
                {rotateEnabled
                  ? rotationActive
                    ? "Rotate: Active"
                    : "Rotate: Paused"
                  : "Rotate: Off · Pan"}
              </button>
            )}
          </div>
        </div>
      )}
      {!failed && exploreNotice && (
        <p
          role="status"
          className="pointer-events-none absolute left-3 top-14 rounded-md border bg-background/95 px-2 py-1 text-xs"
        >
          {exploreNotice}
        </p>
      )}
      {!failed && exploring && (
        <div
          role="group"
          aria-label="Explore controls"
          className="absolute left-3 right-3 top-14 z-10 flex flex-wrap gap-1"
        >
          {[
            {
              label: "Move forward",
              text: "↑",
              action: () => runtime.current?.stepExplore(0.55, 0),
            },
            {
              label: "Move backward",
              text: "↓",
              action: () => runtime.current?.stepExplore(-0.55, 0),
            },
            {
              label: "Move left",
              text: "←",
              action: () => runtime.current?.stepExplore(0, -0.55),
            },
            {
              label: "Move right",
              text: "→",
              action: () => runtime.current?.stepExplore(0, 0.55),
            },
            {
              label: "Turn left",
              text: "↶",
              action: () => runtime.current?.lookExplore(0.2, 0),
            },
            {
              label: "Turn right",
              text: "↷",
              action: () => runtime.current?.lookExplore(-0.2, 0),
            },
          ].map(({ label, text, action }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              title={label}
              onClick={action}
              className="min-h-10 min-w-10 rounded-md border bg-background/95 px-2 text-sm font-medium shadow-sm"
            >
              {text}
            </button>
          ))}
          <button
            type="button"
            aria-label="Focus selected equipment"
            disabled={!selected}
            onClick={() => runtime.current?.setExplore(true, selected)}
            className="min-h-10 rounded-md border bg-background/95 px-2 text-xs font-medium shadow-sm disabled:opacity-50"
          >
            Focus
          </button>
        </div>
      )}
      {failed && (
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
      )}
    </div>
  );
}
