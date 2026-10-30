import { useEffect, useRef, useState } from "react";
import { FloorPlan } from "./FactoryFloorPlan";
import {
  constrainFloorPosition,
  type FloorInteraction,
  type FloorMove,
} from "./floor-arrangement";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createWorkshop, createEquipmentProxy } from "./FactoryEnvironment";
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
        roughness: 0.38,
        metalness: 0.5,
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

export default function FactoryFloorScene({
  layout,
  links,
  selected,
  onSelect,
  dark,
  reset,
  zone,
  interaction,
  onMove,
}: {
  layout: Layout;
  links: FloorLink[];
  selected: string | null;
  onSelect: (ref: string) => void;
  dark: boolean;
  reset: number;
  zone: string;
  interaction: FloorInteraction;
  onMove: FloorMove;
}) {
  const host = useRef<HTMLDivElement>(null),
    choose = useRef(onSelect),
    selection = useRef(selected),
    mode = useRef(interaction),
    move = useRef(onMove);
  const runtime = useRef<{
    focus: (ref: string | null) => void;
    reset: () => void;
    statuses: (items: Layout["placements"]) => void;
    positions: (items: Layout["placements"]) => void;
    zones: (zones: Layout["zones"]) => void;
    interaction: (mode: FloorInteraction) => void;
  } | null>(null);
  const [failed, setFailed] = useState(false),
    [ready, setReady] = useState(false),
    [loaded, setLoaded] = useState(0);
  choose.current = onSelect;
  selection.current = selected;
  mode.current = interaction;
  move.current = onMove;
  const key =
    layout.placements.map((p) => `${p.item.ref}:${p.model}`).join("|") +
    links.map((l) => `${l.from}:${l.to}`).join("|") +
    `${layout.width}:${layout.depth}:` +
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
      let disposed = false,
        dirty = true,
        frame = 0;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(dark ? "#182532" : "#dce3e6");
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = dark ? 0.95 : 1.05;
      const environment = new RoomEnvironment();
      const pmrem = new THREE.PMREMGenerator(renderer);
      const roomMap = pmrem.fromScene(environment, 0.04);
      scene.environment = roomMap.texture;
      environment.dispose();
      pmrem.dispose();
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.setAttribute(
        "aria-label",
        "Interactive 3D factory floor",
      );
      renderer.domElement.setAttribute("role", "img");
      renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute(
        "aria-description",
        "Use the floor interaction controls to rotate, move the floor, or rearrange an item. Arrow keys move the selected item in Move item mode.",
      );
      renderer.domElement.dataset.floorNodeCount = String(
        layout.placements.length,
      );
      element.appendChild(renderer.domElement);
      const camera = new THREE.OrthographicCamera(
        -20,
        20,
        15,
        -15,
        0.1,
        Math.max(500, Math.max(layout.width, layout.depth) * 8),
      );
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.maxPolarAngle = Math.PI * 0.48;
      controls.minZoom = 0.4;
      controls.maxZoom = 10;
      controls.screenSpacePanning = true;
      scene.add(new THREE.HemisphereLight(0xdcefff, 0x566674, 1.8));
      const sun = new THREE.DirectionalLight(0xfff5e8, 3.2);
      sun.position.set(12, 28, 18);
      sun.castShadow = true;
      sun.shadow.mapSize.set(
        innerWidth < 768 ? 1024 : 2048,
        innerWidth < 768 ? 1024 : 2048,
      );
      sun.shadow.normalBias = 0.025;
      sun.shadow.bias = -0.00015;
      sun.shadow.camera.left = -40;
      sun.shadow.camera.right = 40;
      sun.shadow.camera.top = 40;
      sun.shadow.camera.bottom = -40;
      scene.add(sun);
      scene.add(createWorkshop(layout, dark));
      const objects = new Map<string, THREE.Group>(),
        hits: THREE.Object3D[] = [],
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
        const body = createEquipmentProxy(p.model, p.item.itemType);
        group.add(body);
        const name = label(p.item.name, "#203c4b");
        name.position.set(0, 3.05, 0);
        name.visible = p.item.ref === selection.current;
        labels.set(p.item.ref, name);
        group.add(name);
        const marker = new THREE.Mesh(
          new THREE.CylinderGeometry(0.13, 0.13, 0.1, 16),
          new THREE.MeshBasicMaterial({
            color: indicatorColor(p.item),
          }),
        );
        marker.position.set(-0.64, 2.55, 0);
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
        halo.rotation.x = -Math.PI / 2;
        halo.position.y = 0.025;
        halo.visible = false;
        group.add(halo);
        indicators.set(p.item.ref, halo);
        scene.add(group);
        objects.set(p.item.ref, group);
        hits.push(group);
        if (p.model && (p.model !== "raspberry-pi-4b" || p.item.equipmentId))
          void referenceModel(p.model)
            .then((model) => {
              if (disposed) return;
              const copy = model.clone(true),
                box = new THREE.Box3().setFromObject(copy),
                size = box.getSize(new THREE.Vector3()),
                center = box.getCenter(new THREE.Vector3());
              const scale = 2.7 / Math.max(size.x, size.y, size.z, 0.001);
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
              retired.push(body);
              group.add(normalized);
              setLoaded((n) => n + 1);
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
        const width = element.clientWidth,
          height = element.clientHeight,
          aspect = width / Math.max(height, 1);
        camera.updateMatrixWorld(true);
        let halfWidth = 0,
          halfHeight = 0;
        // Fit the projected bounds, including the outermost equipment labels.
        // A width/depth heuristic clips corners after an isometric rotation.
        for (const x of [-layout.width / 2 - 2, layout.width / 2 + 2])
          for (const y of [-0.5, 5])
            for (const z of [-layout.depth / 2 - 2, layout.depth / 2 + 2]) {
              const point = new THREE.Vector3(x, y, z).applyMatrix4(
                camera.matrixWorldInverse,
              );
              halfWidth = Math.max(halfWidth, Math.abs(point.x));
              halfHeight = Math.max(halfHeight, Math.abs(point.y));
            }
        const extent =
          Math.max(halfWidth / Math.max(aspect, 0.1), halfHeight, 9) * 1.06;
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
            if (object) {
              object.position.set(p.x, 0, p.z);
              object.rotation.y = THREE.MathUtils.degToRad(p.rotation ?? 0);
            }
          }
          updateConnections();
        },
        interaction: (next) => {
          cancel();
          controls.enableDamping = false;
          controls.update();
          controls.enableDamping = next !== "item";
          controls.enabled = next !== "item";
          controls.mouseButtons.LEFT =
            next === "pan" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
          controls.touches.ONE =
            next === "pan" ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
          renderer.domElement.style.cursor = next === "item" ? "move" : "grab";
          renderer.domElement.dataset.interaction = next;
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
      const change = () => {
        dirty = true;
        renderer.domElement.dataset.cameraView = JSON.stringify({
          position: camera.position.toArray(),
          target: controls.target.toArray(),
          zoom: camera.zoom,
        });
      };
      controls.addEventListener("change", change);
      controls.listenToKeyEvents(renderer.domElement);
      change();
      const ray = new THREE.Raycaster(),
        point = new THREE.Vector2();
      let start: { x: number; y: number; pointerId: number } | undefined;
      let dragging:
        | {
            ref: string;
            point: THREE.Vector3;
            original: THREE.Vector3;
            pointerId: number;
          }
        | undefined;
      const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const setRay = (e: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        point.set(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        );
        ray.setFromCamera(point, camera);
      };
      const picked = () => {
        let node: THREE.Object3D | null =
          ray.intersectObjects(hits, true)[0]?.object ?? null;
        while (node && !node.userData.ref) node = node.parent;
        return node?.userData.ref as string | undefined;
      };
      const down = (e: PointerEvent) => {
        if (!e.isPrimary || e.button !== 0) {
          cancel();
          return;
        }
        // A second finger starts an orbit/zoom gesture, never a selection.
        start = e.isPrimary
          ? { x: e.clientX, y: e.clientY, pointerId: e.pointerId }
          : undefined;
        renderer.domElement.style.cursor = "grabbing";
        if (mode.current === "item") {
          setRay(e);
          const ref = picked(),
            ground = ray.ray.intersectPlane(floorPlane, new THREE.Vector3());
          const object = ref && objects.get(ref);
          if (ref && object && ground) {
            dragging = {
              ref,
              point: ground.clone(),
              original: object.position.clone(),
              pointerId: e.pointerId,
            };
            runtime.current?.focus(ref);
            renderer.domElement.setPointerCapture(e.pointerId);
            e.preventDefault();
          }
        }
      };
      const pointerMove = (e: PointerEvent) => {
        if (!dragging || dragging.pointerId !== e.pointerId) return;
        setRay(e);
        const ground = ray.ray.intersectPlane(floorPlane, new THREE.Vector3());
        if (!ground) return;
        const next = constrainFloorPosition(
          layout,
          dragging.original.x + ground.x - dragging.point.x,
          dragging.original.z + ground.z - dragging.point.z,
        );
        objects.get(dragging.ref)?.position.set(next.x, 0, next.z);
        updateConnections();
        e.preventDefault();
      };
      const up = (e: PointerEvent) => {
        const began = start;
        start = undefined;
        renderer.domElement.style.cursor =
          mode.current === "item" ? "move" : "grab";
        if (dragging && dragging.pointerId === e.pointerId) {
          const ended = dragging;
          dragging = undefined;
          if (renderer.domElement.hasPointerCapture(e.pointerId))
            renderer.domElement.releasePointerCapture(e.pointerId);
          const position = objects.get(ended.ref)?.position;
          if (position && position.distanceTo(ended.original) > 0.001)
            move.current(ended.ref, position.x, position.z);
          choose.current(ended.ref);
          return;
        }
        if (mode.current === "pan") return;
        if (
          !began ||
          began.pointerId !== e.pointerId ||
          Math.hypot(e.clientX - began.x, e.clientY - began.y) > 6
        )
          return;
        setRay(e);
        const ref = picked();
        if (ref) choose.current(ref);
      };
      const cancel = () => {
        start = undefined;
        if (dragging) {
          objects.get(dragging.ref)?.position.copy(dragging.original);
          const id = dragging.pointerId;
          dragging = undefined;
          if (renderer.domElement.hasPointerCapture(id))
            renderer.domElement.releasePointerCapture(id);
          updateConnections();
        }
        renderer.domElement.style.cursor =
          mode.current === "item" ? "move" : "grab";
      };
      const keyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && dragging) {
          e.preventDefault();
          cancel();
          return;
        }
        if (
          mode.current !== "item" ||
          !selection.current ||
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
        )
          return;
        const object = objects.get(selection.current);
        if (!object) return;
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
        const next = constrainFloorPosition(
          layout,
          object.position.x + offset.x,
          object.position.z + offset.z,
        );
        object.position.set(next.x, 0, next.z);
        updateConnections();
        move.current(selection.current, next.x, next.z);
      };
      renderer.domElement.addEventListener("pointercancel", cancel);
      renderer.domElement.addEventListener("pointermove", pointerMove);
      renderer.domElement.addEventListener("keydown", keyDown);
      renderer.domElement.addEventListener("pointerdown", down);
      renderer.domElement.addEventListener("pointerup", up);
      runtime.current.interaction(mode.current);
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
        disposed = true;
        cancel();
        cancelAnimationFrame(frame);
        observer.disconnect();
        controls.dispose();
        runtime.current = null;
        renderer.domElement.removeEventListener("pointercancel", cancel);
        renderer.domElement.removeEventListener("pointermove", pointerMove);
        renderer.domElement.removeEventListener("keydown", keyDown);
        renderer.domElement.removeEventListener("pointerdown", down);
        renderer.domElement.removeEventListener("pointerup", up);
        renderer.domElement.removeEventListener("webglcontextlost", lost);
        // Disposing GPU resources preserves the cached CPU references for reuse.
        retired.forEach(disposeObject);
        disposeObject(scene);
        roomMap.dispose();
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
  useEffect(() => {
    runtime.current?.interaction(interaction);
  }, [interaction]);
  return (
    <div className="relative h-full w-full">
      <div ref={host} className={`h-full w-full ${failed ? "hidden" : ""}`} />
      {failed ? (
        <>
          <FloorPlan
            layout={layout}
            links={links}
            selected={selected}
            onSelect={onSelect}
            interaction={interaction}
            onMove={onMove}
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
          <span className="pointer-events-none absolute right-3 top-3 rounded-md border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground">
            {interaction === "pan"
              ? "Drag to move the floor · scroll to zoom"
              : interaction === "item"
                ? "Drag an item to move it"
                : "Drag to orbit · scroll to zoom"}
          </span>
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
