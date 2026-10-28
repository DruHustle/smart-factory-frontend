import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { measureOrbit } from "./benchmark";
import { pollGpuFrame } from "./gpuFrame";
import { scheduleDrawingFrame } from "./drawingFrame";
import { frameBounds, visibleBounds } from "./framing";
import { moveCamera } from "./cameraMotion";
import { hitVisible } from "./visibility";
import { Button } from "@/components/ui/button";
import { referencePreview } from "./ModelLoadingPreview";
import {
  createStudioEnvironment,
  preloadStudioEnvironment,
} from "./studioEnvironment";
export { preloadStudioEnvironment };
import {
  descends,
  InspectionScene,
  defaultInspection,
  type InspectionState,
  type InspectionPart,
} from "./inspection";
export type Viewpoint = {
  eye: number[];
  target: number[];
  viewer?: InspectionState;
};
export type LocalRendererHandle = {
  capture: () => Viewpoint | null;
  restore: (v: Viewpoint) => void;
};
type Component = InspectionPart & {
  installedComponentId: string;
  nodePath: string;
  nodeIndex: number;
  name: string;
};
type Observation = {
  componentId: string;
  freshness: string;
  sourceQuality: unknown;
  value: number | null;
  alarmActive?: boolean;
};
type Props = {
  preview?: boolean;
  modelRevision?: string;
  initialViewDirection?: [number, number, number];
  modelUrl: string;
  components: Component[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  observations: Observation[];
  annotations: Array<{ componentId: string; text: string }>;
  focusComponentId?: string;
  securityFindings?: Array<{
    id: string;
    componentId: string;
    title: string;
    mode: string;
  }>;
};
function disposeObject(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>(),
    materials = new Set<THREE.Material>(),
    geometries = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material)
      for (const m of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]) {
        materials.add(m);
        for (const value of Object.values(m))
          if (value instanceof THREE.Texture) textures.add(value);
      }
  });
  textures.forEach((t) => {
    const source = t.source?.data;
    if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap)
      source.close();
    t.dispose();
  });
  materials.forEach((m) => m.dispose());
  geometries.forEach((g) => g.dispose());
}
const LocalEquipmentRenderer = forwardRef<LocalRendererHandle, Props>(
  function LocalEquipmentRenderer(props, ref) {
    const host = useRef<HTMLDivElement>(null),
      runtime = useRef<{
        camera: THREE.PerspectiveCamera;
        controls: OrbitControls;
        fit: () => void;
        render: () => void;
        nodes: Map<string, THREE.Object3D>;
        scene: THREE.Scene;
        model: THREE.Group;
        focus: (node: THREE.Object3D) => void;
        markers: THREE.Group;
        inspector: InspectionScene;
        renderer: THREE.WebGLRenderer;
        indicatorScale: number;
      } | null>(null);
    const cameraMotion = useRef<(() => void) | null>(null);
    const [cameraMoving, setCameraMoving] = useState(false);
    const label = useRef<HTMLDivElement>(null);
    const [inspection, setInspection] = useState<InspectionState>({
      ...defaultInspection,
    });
    const [sectionNotice, setSectionNotice] = useState("");
    const [performanceReport, setPerformanceReport] = useState("");
    const [measuring, setMeasuring] = useState(false);
    const inspectionRef = useRef(inspection);
    inspectionRef.current = inspection;
    const latest = useRef(props);
    latest.current = props;
    const [state, setState] = useState<
        "loading" | "ready" | "error" | "unsupported" | "lost"
      >("loading"),
      [progress, setProgress] = useState(0),
      [loadPhase, setLoadPhase] = useState("Starting 3D view"),
      [message, setMessage] = useState(""),
      [attempt, setAttempt] = useState(0),
      [hidden, setHidden] = useState<string[]>([]),
      [isolated, setIsolated] = useState<string | null>(null);
    const transparent = (inspection.opacity ?? 1) < 1;
    const poster = referencePreview(props.modelRevision);
    const hiddenRef = useRef(hidden);
    hiddenRef.current = hidden;
    const isolatedRef = useRef(isolated);
    isolatedRef.current = isolated;
    useImperativeHandle(
      ref,
      () => ({
        capture: () => {
          const r = runtime.current;
          return r
            ? {
                eye: r.camera.position.toArray(),
                target: r.controls.target.toArray(),
                viewer: {
                  ...inspectionRef.current,
                  selected: latest.current.selected,
                  hidden: hiddenRef.current,
                  isolated: isolatedRef.current,
                },
              }
            : null;
        },
        restore: (v) => {
          const r = runtime.current;
          if (
            r &&
            v.eye.length === 3 &&
            v.target.length === 3 &&
            [...v.eye, ...v.target].every(Number.isFinite)
          ) {
            if (v.viewer) {
              setInspection({
                ...defaultInspection,
                ...v.viewer,
                immediate: true,
              });
              setHidden(v.viewer.hidden);
              setIsolated(v.viewer.isolated);
              latest.current.onSelect(v.viewer.selected);
            }
            cameraMotion.current?.();
            host.current?.setAttribute("data-camera-moving", "true");
            setCameraMoving(true);
            cameraMotion.current = moveCamera(
              r.camera,
              r.controls,
              new THREE.Vector3().fromArray(v.eye),
              new THREE.Vector3().fromArray(v.target),
              r.render,
              300,
              () => {
                host.current?.setAttribute("data-camera-moving", "false");
                setCameraMoving(false);
              },
            );
          }
        },
      }),
      [],
    );
    useEffect(() => {
      const container = host.current;
      if (!container) return;
      let disposed = false,
        cancelFrame: (() => void) | undefined,
        scenePrepared = false;
      let renderer: THREE.WebGLRenderer | undefined,
        controls: OrbitControls | undefined,
        scene: THREE.Scene | undefined,
        observer: ResizeObserver | undefined,
        loaded: THREE.Group | undefined;
      let firstModelRender: (() => void) | undefined;
      let initialFrameComplete = false;
      const loadStarted = performance.now();
      const timing: Record<string, number> = {};
      const mark = (phase: string) => {
        timing[phase] = Math.round(performance.now() - loadStarted);
        container.dataset.loadTimings = JSON.stringify(timing);
      };
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 20000);
      const cleanupCallbacks: Array<() => void> = [];
      cleanupCallbacks.push(() => {
        firstModelRender?.();
        firstModelRender = undefined;
      });
      setState("loading");
      delete container.dataset.modelBytes;
      delete container.dataset.loadInteractiveMs;
      setProgress(0);
      setLoadPhase("Starting 3D view");
      setHidden([]);
      setIsolated(null);
      setInspection({ ...defaultInspection });
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: container.clientWidth >= 600,
          alpha: false,
          stencil: true,
          powerPreference: "low-power",
        });
      } catch {
        setState("unsupported");
        setMessage(
          "WebGL2 is unavailable. Use the component list, measurements and documents below.",
        );
        clearTimeout(timeout);
        return;
      }
      let gl = renderer.getContext() as WebGL2RenderingContext;
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      const graphics = debug
        ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
        : "unknown";
      const software = /swiftshader|llvmpipe|software/i.test(graphics);
      // Software WebGL retains every mesh and component, but avoids expensive
      // multisampling. Hardware keeps its existing antialiasing and lighting.
      if (software && gl.getContextAttributes()?.antialias) {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer = new THREE.WebGLRenderer({
          antialias: false,
          alpha: false,
          stencil: true,
          powerPreference: "low-power",
        });
        gl = renderer.getContext() as WebGL2RenderingContext;
      }
      // Start delivery alongside lighting setup. This retains the same
      // authenticated, same-origin route and 20 MiB admission limit below.
      const responsePromise = (async () => {
        const url = new URL(props.modelUrl, window.location.origin);
        if (
          url.origin !== window.location.origin ||
          !url.pathname.startsWith("/api/equipment/")
        )
          throw new Error(
            "Model must use authorized Smart Factory file delivery",
          );
        mark("downloadStarted");
        setLoadPhase("Downloading 3D model");
        return fetch(url, { credentials: "same-origin", signal: abort.signal });
      })();
      void responsePromise.catch(() => {});
      renderer.localClippingEnabled = true;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = container.clientWidth >= 600 && !software;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const canvas = renderer.domElement;
      canvas.setAttribute("aria-label", "Interactive 3D equipment model");
      canvas.setAttribute("role", "img");
      canvas.tabIndex = 0;
      canvas.className = "block h-full w-full touch-none rounded";
      container.appendChild(canvas);
      scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
      controls = new OrbitControls(camera, canvas);
      const cancelCameraMotion = () => cameraMotion.current?.();
      controls.addEventListener("start", cancelCameraMotion);
      cleanupCallbacks.push(() =>
        controls?.removeEventListener("start", cancelCameraMotion),
      );
      controls.enableDamping = false;
      controls.enablePan = true;
      controls.screenSpacePanning = true;
      const currentRenderer = renderer,
        currentScene = scene,
        currentControls = controls;
      let gpuFence: WebGLSync | null = null;
      let submittedFrames = 0,
        submittedAt = 0,
        synchronizedFrames = 0,
        maxSynchronizedMs = 0;
      const renderStatus = (phase: string, detail?: number) => {
        container.dataset.renderStatus = JSON.stringify({
          phase,
          submittedFrames,
          detail,
          software,
          synchronizedFrames,
          maxSynchronizedMs,
          contextLost: gl.isContextLost(),
        });
      };
      const render = () => {
        if (runtime.current)
          container.dataset.inspectionApplied = JSON.stringify(
            runtime.current.inspector.diagnostics(),
          );
        if (disposed || cancelFrame || !scenePrepared) return;
        renderStatus("queued");
        const queueDraw = () => {
          cancelFrame = scheduleDrawingFrame(() => {
            cancelFrame = undefined;
            if (!disposed && !document.hidden) draw();
          });
        };
        const draw = () => {
          if (gpuFence && !gl.isContextLost()) {
            const waitStarted = performance.now();
            const { status, synchronized } = pollGpuFrame(
              gl,
              gpuFence,
              submittedAt,
              software,
            );
            if (synchronized) {
              synchronizedFrames++;
              maxSynchronizedMs = Math.max(
                maxSynchronizedMs,
                performance.now() - waitStarted,
              );
            }
            if (status === gl.TIMEOUT_EXPIRED) {
              if (!container.dataset.renderStatus?.includes("waiting"))
                renderStatus("waiting", status);
              queueDraw();
              return;
            }
            gl.deleteSync(gpuFence);
            gpuFence = null;
            if (status === gl.WAIT_FAILED) {
              renderStatus("failed", status);
              setState(gl.isContextLost() ? "lost" : "error");
              setMessage(
                "Graphics synchronization failed. Retry the 3D view or use the component list.",
              );
              return;
            }
          }
          if (!disposed) {
            const r = runtime.current;
            if (r) {
              const selected = latest.current.selected
                ? r.nodes.get(latest.current.selected)
                : null;

              for (const marker of r.markers.children) {
                const node = r.nodes.get(marker.userData.installedComponentId);
                if (node) {
                  const b = new THREE.Box3().setFromObject(node);
                  marker.position.copy(b.getCenter(new THREE.Vector3()));
                  marker.position.y =
                    b.max.y +
                    (marker.userData.security ? 0.12 : 0.06) * r.indicatorScale;
                  if (marker.userData.security)
                    marker.quaternion.copy(camera.quaternion);
                }
              }
              if (label.current) {
                label.current.textContent =
                  latest.current.components.find(
                    (p) => p.installedComponentId === latest.current.selected,
                  )?.name ?? "";
                if (selected) {
                  const point = new THREE.Box3()
                    .setFromObject(selected)
                    .getCenter(new THREE.Vector3())
                    .project(camera);
                  label.current.style.left = `${Math.max(4, Math.min(80, (point.x + 1) * 50))}%`;
                  label.current.style.top = `${Math.max(3, Math.min(90, (-point.y + 1) * 50))}%`;
                }
              }
              container.dataset.viewpoint = JSON.stringify({
                eye: camera.position.toArray(),
                target: currentControls.target.toArray(),
              });
              container.dataset.inspection = JSON.stringify(
                r.inspector.diagnostics(),
              );
            }
            currentRenderer.render(currentScene, camera);
            submittedFrames++;
            renderStatus("drawn");
            if (loaded?.parent === currentScene && !gl.isContextLost()) {
              firstModelRender?.();
              firstModelRender = undefined;
            }
            if (software && !gl.isContextLost()) {
              gpuFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
              submittedAt = performance.now();
              gl.flush();
            }
          }
        };
        queueDraw();
      };
      const resumeDrawing = () => {
        if (!document.hidden) render();
      };
      document.addEventListener("visibilitychange", resumeDrawing);
      cleanupCallbacks.push(() =>
        document.removeEventListener("visibilitychange", resumeDrawing),
      );
      cleanupCallbacks.push(() => {
        if (gpuFence && !gl.isContextLost()) gl.deleteSync(gpuFence);
      });
      const theme = () => {
        const light = !document.documentElement.classList.contains("dark");
        currentScene.background = new THREE.Color(
          light ? "#edf2f7" : "#101a2a",
        );
        render();
      };
      theme();
      const themeObserver = new MutationObserver(theme);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
      cleanupCallbacks.push(() => themeObserver.disconnect());
      const environmentPromise = createStudioEnvironment()
        .then((texture) => {
          if (disposed) {
            texture.dispose();
            return;
          }
          currentScene.environment = texture;
          cleanupCallbacks.push(() => texture.dispose());
          container.dataset.environment = "baked-hdr-studio";
          mark("lightingReady");
        })
        .catch(() => {
          // Direct lights preserve inspection if the public atlas/decoder fails.
          // Rebuilding PMREM here can stall a driver during startup.
          if (disposed) return;
          container.dataset.environment = "direct-light-fallback";
          mark("lightingReady");
        });
      void environmentPromise.catch(() => {});
      scene.environmentIntensity = 0.8;
      scene.add(new THREE.HemisphereLight(0xe8f1ff, 0x495260, 0.65));
      const key = new THREE.DirectionalLight(0xfff2e2, 2.8);
      key.position.set(3, 5, 4);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = -2;
      key.shadow.camera.right = 2;
      key.shadow.camera.top = 2;
      key.shadow.camera.bottom = -2;
      key.shadow.bias = -0.0001;
      const fill = new THREE.DirectionalLight(0xc7dfff, 0.7);
      fill.position.set(-3, 2, -4);
      scene.add(key, key.target, fill, fill.target);
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        new THREE.ShadowMaterial({ opacity: 0.18, depthWrite: false }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = 0.003;
      ground.receiveShadow = true;
      scene.add(ground);
      // A small ambient contact patch grounds the object on mobile/software too.
      const shadowCanvas = document.createElement("canvas");
      shadowCanvas.width = shadowCanvas.height = 64;
      const shadowContext = shadowCanvas.getContext("2d")!;
      const gradient = shadowContext.createRadialGradient(
        32,
        32,
        3,
        32,
        32,
        32,
      );
      gradient.addColorStop(0, "rgba(0,0,0,0.26)");
      gradient.addColorStop(0.45, "rgba(0,0,0,0.17)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      shadowContext.fillStyle = gradient;
      shadowContext.fillRect(0, 0, 64, 64);
      const contact = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: new THREE.CanvasTexture(shadowCanvas),
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      contact.rotation.x = -Math.PI / 2;
      scene.add(contact);

      const markers = new THREE.Group();
      scene.add(markers);
      const resize = () => {
        const w = Math.max(1, container.clientWidth),
          h = Math.max(1, container.clientHeight);
        currentRenderer.setPixelRatio(
          Math.min(window.devicePixelRatio || 1, w < 600 || software ? 1 : 1.5),
        );
        currentRenderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        render();
      };
      observer = new ResizeObserver(resize);
      observer.observe(container);
      resize();
      currentControls.addEventListener("change", render);
      const lost = (e: Event) => {
        e.preventDefault();
        if (!disposed) {
          setState("lost");
          setMessage(
            "Graphics context lost. Your equipment data and saved work remain available.",
          );
        }
      };
      canvas.addEventListener("webglcontextlost", lost);
      cleanupCallbacks.push(() =>
        canvas.removeEventListener("webglcontextlost", lost),
      );
      const click = (event: PointerEvent) => {
        const r = runtime.current;
        if (!r) return;
        const rect = canvas.getBoundingClientRect();
        const point = new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        const ray = new THREE.Raycaster();
        camera.updateMatrixWorld(true);
        ray.setFromCamera(point, camera);
        const visible = (o: THREE.Object3D): boolean =>
          o.visible && (!o.parent || visible(o.parent));
        const hit = ray
          .intersectObjects([r.model, r.markers, r.inspector.pickObjects], true)
          .find(
            (h) =>
              visible(h.object) &&
              hitVisible(h) &&
              r.inspector.accepts(h.point),
          );
        let object = hit?.object;
        while (object) {
          const id = object.userData.installedComponentId;
          if (typeof id === "string" && r.nodes.has(id)) {
            latest.current.onSelect(id);
            break;
          }
          object = object.parent ?? undefined;
        }
      };
      let down: { x: number; y: number } | null = null;
      const pointerDown = (e: PointerEvent) => {
        down = { x: e.clientX, y: e.clientY };
      };
      const pointerUp = (e: PointerEvent) => {
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5)
          click(e);
        down = null;
      };
      canvas.addEventListener("pointerdown", pointerDown);
      canvas.addEventListener("pointerup", pointerUp);
      cleanupCallbacks.push(() => {
        canvas.removeEventListener("pointerdown", pointerDown);
        canvas.removeEventListener("pointerup", pointerUp);
      });
      const keyboard = (e: KeyboardEvent) => {
        if (e.key === "Home") {
          e.preventDefault();
          runtime.current?.fit();
        }
      };
      canvas.addEventListener("keydown", keyboard);
      cleanupCallbacks.push(() =>
        canvas.removeEventListener("keydown", keyboard),
      );
      void (async () => {
        try {
          const response = await responsePromise;
          if (!response.ok)
            throw new Error(`Model delivery returned HTTP ${response.status}`);
          const reader = response.body?.getReader();
          if (!reader) throw new Error("Model data missing");
          const chunks: Uint8Array[] = [];
          let received = 0;
          // A compressed Content-Length is not the decoded GLB byte count.
          const total =
            response.headers.get("content-encoding") &&
            response.headers.get("content-encoding") !== "identity"
              ? 0
              : Number(response.headers.get("content-length"));
          while (true) {
            const item = await reader.read();
            if (item.done) break;
            received += item.value.byteLength;
            if (received > 20 * 1024 * 1024) {
              await reader.cancel();
              throw new Error("Model exceeds 20 MiB budget");
            }
            chunks.push(item.value);
            if (!disposed)
              setProgress(
                total > 0
                  ? Math.min(100, Math.round((received / total) * 100))
                  : 0,
              );
          }
          container.dataset.modelBytes = String(received);
          mark("downloadCompleted");
          setLoadPhase("Preparing model geometry");
          const bytes = new Uint8Array(received);
          let offset = 0;
          chunks.forEach((c) => {
            bytes.set(c, offset);
            offset += c.length;
          });
          const loader = new GLTFLoader();
          loader.manager.setURLModifier((resource) => {
            if (resource.startsWith("blob:")) return resource;
            throw new Error("External model resources are prohibited");
          });
          const gltf = await loader.parseAsync(bytes.buffer, "");
          mark("geometryParsed");
          loaded = gltf.scene;
          if (disposed) {
            disposeObject(loaded);
            return;
          }
          const nodes = new Map<string, THREE.Object3D>();
          for (const component of props.components) {
            const parts = component.nodePath.split("/").filter(Boolean);
            let children: THREE.Object3D[] = loaded.children,
              node: THREE.Object3D | undefined;
            for (const part of parts) {
              const matches = children.filter((c) => c.name === part);
              if (matches.length !== 1)
                throw new Error("Missing or ambiguous scene mapping");
              node = matches[0];
              children = node.children;
            }
            if (
              !node ||
              gltf.parser.associations.get(node)?.nodes !== component.nodeIndex
            )
              throw new Error("Model revision/node mapping mismatch");
            node.userData.installedComponentId = component.installedComponentId;
            nodes.set(component.installedComponentId, node);
          }
          loaded.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh) {
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              // The original reference's painted casing is a dielectric coating.
              // Uploaded models retain their authored material properties.
              if (
                gltf.asset.generator?.startsWith(
                  "Smart Factory original constructive reference",
                )
              )
                for (const material of Array.isArray(mesh.material)
                  ? mesh.material
                  : [mesh.material]) {
                  if (
                    material.name === "Ceramic blue" &&
                    material instanceof THREE.MeshStandardMaterial
                  ) {
                    material.metalness = 0.08;
                    material.roughness = 0.34;
                    material.color.setRGB(0.018, 0.1, 0.18);
                  }
                }
            }
          });
          currentScene.add(loaded);
          const modelBounds = new THREE.Box3().setFromObject(loaded),
            modelExtent = modelBounds.getSize(new THREE.Vector3()).length(),
            indicatorScale = modelExtent < 0.5 ? modelExtent / 2 : 1;
          ground.position.y = modelBounds.min.y - modelExtent * 0.002;
          const centre = modelBounds.getCenter(new THREE.Vector3());
          const dimensions = modelBounds.getSize(new THREE.Vector3());
          contact.position.set(
            centre.x,
            ground.position.y + modelExtent * 0.0001,
            centre.z,
          );
          contact.scale.set(dimensions.x * 1.2, dimensions.z * 1.5, 1);
          key.position
            .copy(centre)
            .addScaledVector(
              new THREE.Vector3(3, 5, 4).normalize(),
              modelExtent * 3,
            );
          key.target.position.copy(centre);
          fill.position
            .copy(centre)
            .addScaledVector(
              new THREE.Vector3(-3, 2, -4).normalize(),
              modelExtent * 3,
            );
          fill.target.position.copy(centre);
          const shadowExtent = modelExtent * 0.8;
          key.shadow.camera.left = key.shadow.camera.bottom = -shadowExtent;
          key.shadow.camera.right = key.shadow.camera.top = shadowExtent;
          key.shadow.camera.near = modelExtent * 0.01;
          key.shadow.camera.far = modelExtent * 8;
          key.shadow.normalBias = modelExtent * 0.0003;
          key.shadow.camera.updateProjectionMatrix();
          const fitBox = (box: THREE.Box3, direction?: THREE.Vector3) => {
            cameraMotion.current?.();
            const previousEye = camera.position.clone(),
              previousTarget = currentControls.target.clone();
            if (
              !frameBounds(
                camera,
                currentControls.target,
                box,
                direction ??
                  (props.initialViewDirection
                    ? new THREE.Vector3(...props.initialViewDirection)
                    : undefined),
              )
            )
              return;
            const size = box.getSize(new THREE.Vector3()).length();
            currentControls.minDistance = Math.max(0.00001, size * 0.025);
            currentControls.maxDistance = size * 30;
            if (runtime.current && initialFrameComplete) {
              const eye = camera.position.clone(),
                target = currentControls.target.clone();
              camera.position.copy(previousEye);
              currentControls.target.copy(previousTarget);
              host.current?.setAttribute("data-camera-moving", "true");
              setCameraMoving(true);
              cameraMotion.current = moveCamera(
                camera,
                currentControls,
                eye,
                target,
                render,
                300,
                () => {
                  host.current?.setAttribute("data-camera-moving", "false");
                  setCameraMoving(false);
                },
              );
            } else {
              currentControls.update();
              render();
            }
          };
          const fit = () =>
            fitBox(
              visibleBounds(
                loaded!,
                inspectionRef.current.section !== "off"
                  ? runtime.current?.inspector.plane
                  : undefined,
              ),
            );
          const focus = (node: THREE.Object3D) =>
            fitBox(
              visibleBounds(
                node,
                inspectionRef.current.section !== "off"
                  ? runtime.current?.inspector.plane
                  : undefined,
              ),
              camera.position.clone().sub(currentControls.target),
            );
          const inspector = new InspectionScene(
            loaded,
            currentScene,
            nodes,
            props.components,
            () => {
              currentRenderer.shadowMap.needsUpdate = true;
              render();
            },
            ({ openContours, degenerateContours }) =>
              setSectionNotice(
                openContours || degenerateContours
                  ? `${openContours} open and ${degenerateContours} ambiguous surfaces could not be capped. Clipping remains available.`
                  : "",
              ),
          );
          cleanupCallbacks.push(() => inspector.dispose());
          runtime.current = {
            camera,
            controls: currentControls,
            fit,
            render,
            nodes,
            scene: currentScene,
            model: loaded,
            focus,
            markers,
            inspector,
            renderer: currentRenderer,
            indicatorScale,
          };
          // On-demand Metal rendering must have linked PBR programs and an
          // initialized shadow map before its first visible frame.
          mark("inspectionPrepared");
          setLoadPhase("Preparing 3D graphics");
          await environmentPromise;
          if (disposed) return;
          await currentRenderer.compileAsync(currentScene, camera);
          mark("graphicsCompiled");
          if (disposed) return;
          scenePrepared = true;
          currentRenderer.shadowMap.needsUpdate =
            currentRenderer.shadowMap.enabled;
          const initialFrame = new Promise<void>((resolve) => {
            firstModelRender = resolve;
          });
          setLoadPhase("Drawing 3D model");
          fit();
          await initialFrame;
          if (disposed) return;
          mark("firstDrawSubmitted");
          // Keep the preview until GPU completion and the following presentation
          // frame. Submitting draw commands alone can briefly expose a blank view.
          const presented = await new Promise<boolean>((resolve) => {
            const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
            if (!fence) {
              resolve(false);
              return;
            }
            const firstSubmittedAt = performance.now();
            let waiting = 0,
              finished = false;
            const finish = (ok: boolean) => {
              if (finished) return;
              finished = true;
              cancelAnimationFrame(waiting);
              if (!gl.isContextLost()) gl.deleteSync(fence);
              resolve(ok);
            };
            cleanupCallbacks.push(() => finish(false));
            const poll = () => {
              if (disposed || gl.isContextLost()) {
                finish(false);
                return;
              }
              const { status, synchronized } = pollGpuFrame(
                gl,
                fence,
                firstSubmittedAt,
                software,
              );
              if (synchronized) synchronizedFrames++;
              if (status === gl.TIMEOUT_EXPIRED) {
                waiting = requestAnimationFrame(poll);
              } else if (status === gl.WAIT_FAILED) finish(false);
              else waiting = requestAnimationFrame(() => finish(true));
            };
            gl.flush();
            waiting = requestAnimationFrame(poll);
          });
          if (disposed || gl.isContextLost()) return;
          if (!presented)
            throw new Error(
              "The first 3D frame could not be presented. Retry the view.",
            );
          initialFrameComplete = true;
          mark("firstFrame");
          container.dataset.loadInteractiveMs = String(
            performance.now() - loadStarted,
          );
          setProgress(100);
          setState("ready");
        } catch (error) {
          if (!disposed) {
            setState("error");
            setMessage(
              error instanceof Error ? error.message : "Model loading failed",
            );
          }
        } finally {
          clearTimeout(timeout);
        }
      })();
      return () => {
        disposed = true;
        cameraMotion.current?.();
        abort.abort();
        clearTimeout(timeout);
        cancelFrame?.();
        runtime.current = null;
        observer?.disconnect();
        cleanupCallbacks.forEach((f) => f());
        controls?.dispose();
        if (scene) disposeObject(scene);
        if (loaded && !loaded.parent) disposeObject(loaded);
        renderer?.dispose();
        renderer?.forceContextLoss();
        canvas.remove();
      };
    }, [props.modelUrl, attempt]);
    useEffect(() => {
      const r = runtime.current;
      if (!r || state !== "ready") return;
      r.inspector.set({
        ...inspection,
        selected: props.selected,
        hidden,
        isolated,
      });
      for (const child of [...r.markers.children]) {
        r.markers.remove(child);
        disposeObject(child);
      }
      r.nodes.forEach((node, id) => {
        const obs = props.observations.filter((o) => o.componentId === id),
          note = props.annotations.some((a) => a.componentId === id);
        if (!obs.length && !note) return;
        const alarm = obs.some((o) => o.alarmActive),
          color = alarm
            ? 0xef4444
            : obs.some(
                  (o) =>
                    o.freshness === "stale" || o.freshness === "disconnected",
                )
              ? 0xf59e0b
              : obs.some(
                    (o) =>
                      o.value !== null &&
                      o.freshness === "fresh" &&
                      o.sourceQuality === "good",
                  )
                ? 0x16a34a
                : 0x94a3b8;
        const box = new THREE.Box3().setFromObject(node),
          center = box.getCenter(new THREE.Vector3());
        center.y = box.max.y + 0.06 * r.indicatorScale;
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(
            (note ? 0.035 : 0.025) * r.indicatorScale,
            12,
            8,
          ),
          new THREE.MeshBasicMaterial({
            color: note && !alarm ? 0x8b5cf6 : color,
          }),
        );
        marker.position.copy(center);
        marker.userData.installedComponentId = id;
        let visible = true;
        for (
          let parent: THREE.Object3D | null = node;
          parent;
          parent = parent.parent
        )
          visible = visible && parent.visible;
        if (isolated && !descends(node, r.nodes.get(isolated)!))
          visible = false;
        marker.visible = visible;
        r.markers.add(marker);
      });
      const markedSecurityComponents = new Set<string>();
      for (const finding of props.securityFindings ?? []) {
        if (markedSecurityComponents.has(finding.componentId)) continue;
        markedSecurityComponents.add(finding.componentId);
        const node = r.nodes.get(finding.componentId);
        if (!node) continue;
        const box = new THREE.Box3().setFromObject(node),
          marker = new THREE.Mesh(
            new THREE.RingGeometry(
              0.035 * r.indicatorScale,
              0.045 * r.indicatorScale,
              24,
            ),
            new THREE.MeshBasicMaterial({
              color: 0x38bdf8,
              side: THREE.DoubleSide,
            }),
          );
        marker.position.copy(box.getCenter(new THREE.Vector3()));
        marker.position.y = box.max.y + 0.12 * r.indicatorScale;
        marker.quaternion.copy(r.camera.quaternion);
        marker.userData = {
          installedComponentId: finding.componentId,
          security: true,
        };
        let visible = true;
        for (let p: THREE.Object3D | null = node; p; p = p.parent)
          visible &&= p.visible;
        marker.visible = visible;
        r.markers.add(marker);
      }
      r.render();
    }, [
      props.selected,
      props.observations,
      props.securityFindings,
      props.annotations,
      hidden,
      isolated,
      transparent,
      inspection,
      state,
    ]);
    useEffect(() => {
      const r = runtime.current;
      if (state === "ready" && props.focusComponentId) {
        const n = r?.nodes.get(props.focusComponentId);
        if (n) r?.focus(n);
      }
    }, [state, props.focusComponentId]);
    const focus = () => {
      const r = runtime.current,
        node = props.selected ? r?.nodes.get(props.selected) : null;
      if (r && node) r.focus(node);
    };
    const viewport = (
      <div
        className={
          props.preview
            ? "relative h-64 overflow-hidden rounded border sm:h-80"
            : "relative h-[320px] overflow-hidden rounded border sm:h-[420px] lg:h-[500px]"
        }
        ref={host}
        data-state={state}
      >
        <div
          ref={label}
          hidden={!inspection.labels}
          className="pointer-events-none absolute z-[1] max-w-[75%] rounded bg-background/90 px-2 py-1 text-xs shadow"
          aria-hidden="true"
        />
        {state !== "ready" && (
          <>
            {state === "loading" && poster && (
              <img
                src={poster}
                alt=""
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-[2] h-full w-full bg-[#edf2f7] object-contain dark:hidden"
                decoding="async"
              />
            )}
            {state === "loading" && poster && (
              <img
                src={referencePreview(props.modelRevision, true)}
                alt=""
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-[2] hidden h-full w-full bg-[#101a2a] object-contain dark:block"
                decoding="async"
              />
            )}
            <div
              className={
                state === "loading" && poster
                  ? "absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-3 bg-background/90 px-3 py-2 text-center text-xs"
                  : "absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/95 p-5 text-center text-sm"
              }
              role={state === "loading" ? "status" : "alert"}
            >
              {state === "loading" ? (
                <>
                  <span>
                    {poster ? "Model preview · " : ""}
                    {loadPhase}
                    {loadPhase === "Downloading 3D model" && progress > 0
                      ? ` · ${progress}%`
                      : ""}
                  </span>
                  <progress
                    className={poster ? "w-16 shrink-0" : undefined}
                    aria-label="Model loading progress"
                    max={100}
                    value={
                      loadPhase === "Downloading 3D model" && progress > 0
                        ? progress
                        : undefined
                    }
                  />
                </>
              ) : (
                <>
                  <span>{message}</span>
                  <Button
                    variant="outline"
                    onClick={() => setAttempt((a) => a + 1)}
                  >
                    Retry graphics
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    );
    if (props.preview)
      return (
        <div className="space-y-2">
          {viewport}
          <Button
            variant="outline"
            size="sm"
            disabled={state !== "ready"}
            onClick={() => runtime.current?.fit()}
          >
            Reset model preview
          </Button>
        </div>
      );
    return (
      <div className="space-y-3">
        {viewport}
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label="Local 3D controls"
        >
          <Button
            variant="outline"
            disabled={state !== "ready"}
            onClick={() => runtime.current?.fit()}
          >
            Fit / reset
          </Button>
          <Button
            variant="outline"
            disabled={state !== "ready" || !props.selected}
            data-security-focus
            onClick={focus}
          >
            Focus selected
          </Button>
          <Button
            variant="outline"
            disabled={
              state !== "ready" || !props.components.some((c) => c.explode)
            }
            onClick={() =>
              setInspection((v) => ({
                ...v,
                explode: v.explode ? 0 : 100,
                immediate: false,
              }))
            }
          >
            {inspection.explode ? "Reassemble" : "Explode"}
          </Button>
          <details className="rounded-md border px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">
              Framing and visibility
            </summary>
            <div className="mt-3 flex max-h-72 flex-wrap gap-2 overflow-auto">
              <Button
                variant="outline"
                disabled={state !== "ready" || !props.selected}
                onClick={() => latest.current.onSelect(null)}
              >
                Clear selection
              </Button>

              <Button
                variant="outline"
                disabled={state !== "ready" || !props.selected}
                onClick={() =>
                  props.selected &&
                  setHidden((v) =>
                    v.includes(props.selected!)
                      ? v.filter((x) => x !== props.selected)
                      : [...v, props.selected!],
                  )
                }
              >
                {props.selected && hidden.includes(props.selected)
                  ? "Show selected"
                  : "Hide selected"}
              </Button>
              <Button
                variant="outline"
                disabled={state !== "ready" || !props.selected}
                aria-pressed={!!isolated}
                onClick={() => setIsolated((v) => (v ? null : props.selected))}
              >
                Isolate selected
              </Button>
              <Button
                variant="outline"
                disabled={state !== "ready"}
                onClick={() => {
                  setHidden([]);
                  setIsolated(null);
                  setInspection((v) => ({ ...v, covers: false, ghost: false }));
                }}
              >
                Show all
              </Button>
              <Button
                variant="outline"
                disabled={state !== "ready"}
                aria-pressed={transparent}
                onClick={() =>
                  setInspection((v) => ({
                    ...v,
                    opacity: transparent ? 1 : 0.32,
                  }))
                }
              >
                Transparency
              </Button>
            </div>
          </details>
        </div>
        {sectionNotice && (
          <p role="status" className="text-sm">
            {sectionNotice}
          </p>
        )}
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Explode, section and inspection tools
          </summary>
          <div
            className="mt-3 grid max-h-[50dvh] gap-3 overflow-y-auto text-sm sm:grid-cols-2"
            aria-label="Internal inspection"
          >
            {props.components.some((c) => c.explode) ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      setInspection((v) => ({
                        ...v,
                        explode: v.explode ? 0 : 100,
                        immediate: false,
                      }))
                    }
                  >
                    {inspection.explode
                      ? "Reassemble inspection"
                      : "Explode inspection"}
                  </Button>
                  <label>
                    Explode {inspection.explode}%
                    <input
                      className="block w-full"
                      aria-label="Explosion percentage"
                      type="range"
                      min="0"
                      max="100"
                      value={inspection.explode}
                      onChange={(e) =>
                        setInspection((v) => ({
                          ...v,
                          explode: +e.target.value,
                          immediate: true,
                        }))
                      }
                    />
                  </label>
                </div>
                <label>
                  Explosion scope
                  <select
                    aria-label="Explosion scope"
                    className="block max-w-full rounded border bg-background p-2"
                    value={inspection.scope ?? ""}
                    onChange={(e) =>
                      setInspection((v) => ({
                        ...v,
                        scope: e.target.value || null,
                      }))
                    }
                  >
                    <option value="">Whole assembly</option>
                    {props.components
                      .filter((p) => p.role === "group")
                      .map((p) => (
                        <option
                          key={p.installedComponentId}
                          value={p.installedComponentId}
                        >
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={inspection.guides}
                    onChange={(e) =>
                      setInspection((v) => ({ ...v, guides: e.target.checked }))
                    }
                  />{" "}
                  Explosion guides
                </label>
              </>
            ) : (
              <p>Authored explosion unavailable for this model.</p>
            )}
            {props.components.some((c) => c.solid) ? (
              <>
                <label>
                  Section axis
                  <select
                    aria-label="Section axis"
                    className="ml-2 rounded border bg-background p-2"
                    value={inspection.section}
                    onChange={(e) =>
                      setInspection((v) => ({
                        ...v,
                        section: e.target.value as InspectionState["section"],
                      }))
                    }
                  >
                    {["off", "X", "Y", "Z"].map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Section position {inspection.cut}%
                  <input
                    className="block w-full"
                    aria-label="Section position"
                    type="range"
                    min="0"
                    max="100"
                    value={inspection.cut}
                    onChange={(e) =>
                      setInspection((v) => ({ ...v, cut: +e.target.value }))
                    }
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      setInspection((v) => ({ ...v, flip: !v.flip }))
                    }
                  >
                    Reverse section
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setInspection((v) => ({
                        ...v,
                        section: "off",
                        cut: 50,
                        flip: false,
                      }))
                    }
                  >
                    Reset section
                  </Button>
                </div>
              </>
            ) : (
              <p>Solid section caps unavailable for this model.</p>
            )}
            <label>
              <input
                type="checkbox"
                aria-label="Ghost housings"
                checked={inspection.ghost}
                onChange={(e) =>
                  setInspection((v) => ({ ...v, ghost: e.target.checked }))
                }
              />{" "}
              Ghost housings
            </label>
            <label>
              <input
                type="checkbox"
                aria-label="Hide covers"
                checked={inspection.covers}
                onChange={(e) =>
                  setInspection((v) => ({ ...v, covers: e.target.checked }))
                }
              />{" "}
              Hide covers
            </label>
            <Button
              variant="outline"
              onClick={() => {
                setInspection({ ...defaultInspection });
                setHidden([]);
                setIsolated(null);
              }}
            >
              Restore assembly
            </Button>
            <Button
              variant="outline"
              disabled={measuring || cameraMoving || state !== "ready"}
              onClick={async () => {
                const r = runtime.current;
                if (!r) return;
                setMeasuring(true);
                setPerformanceReport("");
                host.current?.scrollIntoView({
                  block: "center",
                  behavior: "instant",
                });
                try {
                  const result = await measureOrbit(
                    r,
                    () => runtime.current === r,
                    500,
                    2500,
                  );
                  if (runtime.current === r)
                    setPerformanceReport(
                      JSON.stringify({
                        ...result,
                        ...r.inspector.diagnostics(),
                        modelBytes: Number(host.current?.dataset.modelBytes),
                        externalModelTextureBytes: 0,
                        generatedEnvironmentTextureBytes: null,
                        loadInteractiveMs: Number(
                          host.current?.dataset.loadInteractiveMs,
                        ),
                      }),
                    );
                } finally {
                  setMeasuring(false);
                }
              }}
            >
              {measuring ? "Measuring…" : "Measure render"}
            </Button>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={inspection.labels ?? false}
                onChange={(e) =>
                  setInspection((v) => ({ ...v, labels: e.target.checked }))
                }
              />
              Selection label
            </label>
            <Button
              variant="outline"
              disabled={measuring || cameraMoving || state !== "ready"}
              onClick={async () => {
                const r = runtime.current;
                if (!r) return;
                const original = {
                    ...inspection,
                    hidden: [...hidden],
                    isolated,
                    selected: props.selected,
                  },
                  eye = r.camera.position.clone(),
                  target = r.controls.target.clone();
                setMeasuring(true);
                setPerformanceReport("");
                host.current?.scrollIntoView({
                  block: "center",
                  behavior: "instant",
                });
                const part = (name: string) =>
                  props.components.find((p) => p.name === name)
                    ?.installedComponentId ?? null;
                const base = {
                  ...defaultInspection,
                  hidden: [] as string[],
                  selected: null,
                };
                const stages = [
                  { name: "assembled orbit", state: base },
                  {
                    name: "whole assembly explosion and immediate scrub",
                    state: { ...base, explode: 100 },
                  },
                  {
                    name: "motor subassembly inspection",
                    state: {
                      ...base,
                      explode: 65,
                      scope: part("Motor"),
                      isolated: part("Motor"),
                    },
                  },
                  {
                    name: "moving hollow section",
                    state: { ...base, section: "Y" as const, cut: 50 },
                  },
                  {
                    name: "transparent housings",
                    state: { ...base, ghost: true },
                  },
                  {
                    name: "focused winding bundles",
                    state: {
                      ...base,
                      isolated: part("Stator assembly"),
                      hidden: [
                        part("Stator laminated core"),
                        part("Stator teeth"),
                      ].filter(Boolean) as string[],
                    },
                  },
                  { name: "exact restoration", state: base },
                ];
                const results = [];
                try {
                  for (const stage of stages) {
                    if (runtime.current !== r) break;
                    const apply = (state: InspectionState) => {
                      setHidden(state.hidden);
                      setIsolated(state.isolated);
                      setInspection(state);
                    };
                    apply(stage.state);
                    await new Promise((resolve) => setTimeout(resolve, 600));
                    if (stage.name === "focused winding bundles") {
                      const node = r.nodes.get(part("Stator assembly") ?? "");
                      if (node) r.focus(node);
                    } else r.fit();
                    let last = 0;
                    const result = await measureOrbit(
                      r,
                      () => runtime.current === r,
                      1500,
                      8000,
                      (elapsed) => {
                        if (elapsed - last < 120) return;
                        last = elapsed;
                        if (stage.name === "moving hollow section")
                          apply({
                            ...stage.state,
                            cut: 50 + 25 * Math.sin(elapsed / 1800),
                          });
                        if (
                          stage.name ===
                          "whole assembly explosion and immediate scrub"
                        )
                          apply({
                            ...stage.state,
                            explode: 50 + 50 * Math.cos(elapsed / 1500),
                            immediate: true,
                          });
                      },
                    );
                    results.push({
                      stage: stage.name,
                      ...result,
                      ...r.inspector.diagnostics(),
                    });
                  }
                  if (runtime.current === r)
                    setPerformanceReport(
                      JSON.stringify({
                        protocol: "smart-factory-inspection-v2",
                        modelBytes: Number(host.current?.dataset.modelBytes),
                        externalModelTextureBytes: 0,
                        generatedEnvironmentTextureBytes: null,
                        loadInteractiveMs: Number(
                          host.current?.dataset.loadInteractiveMs,
                        ),
                        stages: results,
                      }),
                    );
                } finally {
                  if (runtime.current === r) {
                    setInspection(original);
                    setHidden(original.hidden);
                    setIsolated(original.isolated);
                    r.camera.position.copy(eye);
                    r.controls.target.copy(target);
                    r.controls.update();
                    r.render();
                  }
                  setMeasuring(false);
                }
              }}
            >
              Run inspection benchmark
            </Button>
            <details className="sm:col-span-2">
              <summary className="cursor-pointer text-xs">
                Render measurement details
              </summary>
              <output
                className="block max-h-40 overflow-auto break-all text-xs"
                aria-label="Render measurement"
              >
                {performanceReport}
              </output>
            </details>
          </div>
        </details>
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Model and inspection help
          </summary>
          <p className="text-xs text-muted-foreground">
            Explosion is authored inspection choreography. Sections show
            existing solids; open or ambiguous contours are left uncapped.
            Critical internals are retained on mobile. Restore assembly resets
            reveal controls.
          </p>
          <p className="text-xs text-muted-foreground">
            Drag to orbit · right-drag / two fingers to pan · scroll / pinch to
            zoom · Home to fit. Component buttons provide keyboard selection.
            Markers: fresh observation green, stale amber, unknown gray, source
            alarm red, annotation violet. Geometry is illustrative.
          </p>
        </details>
      </div>
    );
  },
);
export default LocalEquipmentRenderer;
