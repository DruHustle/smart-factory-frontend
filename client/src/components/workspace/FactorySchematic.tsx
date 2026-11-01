import {
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Focus, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InventoryItem } from "@shared/inventory";
import {
  DIAGRAM_KIND_LABELS,
  type DiagramConnectionKind,
  type FactoryDiagram,
} from "./factory-diagrams";
import {
  layoutSchematic,
  SCHEMATIC_NODE_HEIGHT,
  SCHEMATIC_NODE_WIDTH,
} from "./factory-schematic-layout";

const styles: Record<DiagramConnectionKind, { color: string; dash?: string }> =
  {
    process: { color: "var(--info)" },
    instrument: { color: "var(--warning)", dash: "7 4" },
    power: { color: "var(--destructive)" },
    control: { color: "var(--info)", dash: "8 4" },
    earth: { color: "var(--success)", dash: "9 3 2 3" },
    communication: { color: "var(--muted-foreground)", dash: "2 5" },
  };
type Camera = { x: number; y: number; zoom: number };
type Point = { x: number; y: number };
type Gesture = {
  camera: Camera;
  matrix: DOMMatrix;
  origin: Point;
  clientOrigin: Point;
  distance: number;
  moved: boolean;
  item?: string;
  connection?: string;
};
const initialCamera: Camera = { x: 0, y: 0, zoom: 1 };
const clampZoom = (zoom: number) => Math.max(0.25, Math.min(32, zoom));
const shorten = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text;
const svgPoint = (point: Point, matrix: DOMMatrix) =>
  new DOMPoint(point.x, point.y).matrixTransform(matrix);
function nameLines(text: string) {
  const words = text.trim().split(/\s+/);
  let first = words.shift() ?? "";
  if (first.length > 18)
    return [
      shorten(first, 18),
      ...(words.length ? [shorten(words.join(" "), 18)] : []),
    ];
  while (words.length && first.length + words[0].length + 1 <= 18)
    first += ` ${words.shift()}`;
  return [first, ...(words.length ? [shorten(words.join(" "), 18)] : [])];
}

function statusColor(item: InventoryItem) {
  if (item.status === "error" || item.status === "offline")
    return "var(--destructive)";
  if (item.status === "maintenance" || item.status === "stale")
    return "var(--warning)";
  if (item.mode === "simulated") return "var(--info)";
  return item.status === "live" ? "var(--success)" : "var(--muted-foreground)";
}

/** Familiar schematic shapes; drawing symbols do not assert unrecorded internal parts. */
function EquipmentSymbol({ item }: { item: InventoryItem }) {
  const type = item.itemType.toLowerCase();
  if (/valve/.test(type))
    return (
      <>
        <path d="M-27 0h54M-18 -13L18 13V-13L-18 13ZM0 -13v-10M-10 -23h20" />
      </>
    );
  if (/tank|vessel|mixer/.test(type))
    return (
      <>
        <path d="M-20 -18v36c0 9 40 9 40 0v-36M-20 -18c0 9 40 9 40 0M-20 18c0-9 40-9 40 0" />
        <ellipse cy="-18" rx="20" ry="7" />
        <path d="M-27 0h7M20 0h7" />
      </>
    );
  if (/motor/.test(type))
    return (
      <>
        <circle r="22" />
        <path d="M-27 0h5M22 0h5" />
        <text
          y="6"
          textAnchor="middle"
          fill="currentColor"
          stroke="none"
          fontSize="19"
        >
          M
        </text>
      </>
    );
  if (/pump|compressor/.test(type))
    return (
      <>
        <circle r="21" />
        <path d="M-10 -13L14 0 -10 13ZM-27 0h6M21 0h6M-15 22h30" />
      </>
    );
  if (/sensor|transmitter|instrument|meter/.test(type))
    return (
      <>
        <circle r="21" />
        <path d="M-21 0h42M0 21v7M-8 -10L0 -15 8 -10" />
      </>
    );
  if (/conveyor/.test(type))
    return (
      <>
        <rect x="-27" y="-14" width="54" height="28" rx="11" />
        {[-16, 0, 16].map((x) => (
          <circle key={x} cx={x} r="6" />
        ))}
      </>
    );
  if (/cabinet|controller|plc|drive|gateway|switch|edge|raspberry/.test(type))
    return (
      <>
        <rect x="-23" y="-25" width="46" height="50" rx="2" />
        <path d="M-13 -15h26M-13 -2h26M-13 11h15M-27 0h4M23 0h4" />
        <circle cx="13" cy="14" r="3" />
      </>
    );
  return (
    <>
      <rect x="-24" y="-20" width="48" height="40" rx="3" />
      <path d="M-27 0h3M24 0h3M-12 -7h24M-12 7h24" />
    </>
  );
}

export function FactorySchematic({
  document,
  items,
  selected,
  onSelect,
  selectedConnection,
  onSelectConnection,
  reset,
}: {
  document: FactoryDiagram;
  items: InventoryItem[];
  selected: string | null;
  onSelect: (ref: string) => void;
  selectedConnection: string | null;
  onSelectConnection: (id: string) => void;
  reset: number;
}) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const portrait = viewport.width > 0 && viewport.width < 600;
  const layout = useMemo(
    () => layoutSchematic(document, items, portrait),
    [document, items, portrait],
  );
  const aspect =
    viewport.width > 0 && viewport.height > 0
      ? viewport.width / viewport.height
      : layout.width / layout.height;
  const frame = useMemo(() => {
    const width = Math.max(layout.width, layout.height * aspect);
    return { width, height: width / aspect };
  }, [layout.width, layout.height, aspect]);
  const svg = useRef<SVGSVGElement>(null);
  const [camera, setCamera] = useState<Camera>(initialCamera);
  const cameraRef = useRef(camera);
  const [grabbed, setGrabbed] = useState(false);
  const [focused, setFocused] = useState("");
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const updateCamera = (next: Camera) => {
    cameraRef.current = next;
    setCamera(next);
  };
  const clearGesture = () => {
    pointers.current.clear();
    gesture.current = null;
    setGrabbed(false);
  };
  const fit = (readable = false) => {
    clearGesture();
    const fitScale = viewport.width > 0 ? viewport.width / frame.width : 1;
    const readableScale = Math.min(
      1.2,
      Math.max(0.5, (viewport.width - 24) / (SCHEMATIC_NODE_WIDTH + 80)),
    );
    const zoom = readable
      ? clampZoom(Math.max(1, readableScale / fitScale))
      : 1;
    const width = frame.width / zoom,
      height = frame.height / zoom;
    const node =
      layout.nodes.find((entry) => entry.item.ref === selected) ??
      layout.nodes[0];
    const centered = (extent: number, windowSize: number, target: number) =>
      extent > windowSize
        ? Math.max(0, Math.min(extent - windowSize, target - windowSize / 2))
        : (extent - windowSize) / 2;
    updateCamera({
      zoom,
      x:
        zoom > 1 && node
          ? centered(layout.width, width, node.x + SCHEMATIC_NODE_WIDTH / 2)
          : (layout.width - width) / 2,
      y:
        zoom > 1 && node
          ? centered(layout.height, height, node.y + SCHEMATIC_NODE_HEIGHT / 2)
          : (layout.height - height) / 2,
    });
  };
  useLayoutEffect(() => {
    const element = svg.current;
    if (!element) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      setViewport((previous) =>
        Math.abs(previous.width - bounds.width) < 1 &&
        Math.abs(previous.height - bounds.height) < 1
          ? previous
          : { width: bounds.width, height: bounds.height },
      );
    };
    // Initialize before the first paint: keyboard selection must not race the
    // observer's first delivery and suddenly refit an already visible drawing.
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Telemetry updates do not reset the view. Topology edits or Fit do.
  const topology = JSON.stringify([
    document.mode,
    layout.nodes.map((node) => node.item.ref),
    layout.edges.map((edge) => [
      edge.connection.id,
      edge.connection.from,
      edge.connection.to,
      edge.connection.direction,
    ]),
  ]);
  const previousFrame = useRef({ reset, topology, width: 0, height: 0, frame });
  useLayoutEffect(() => {
    const previous = previousFrame.current;
    const explicitFit = previous.reset !== reset;
    if (
      explicitFit ||
      previous.topology !== topology ||
      previous.width !== viewport.width ||
      !previous.height
    ) {
      fit(!explicitFit);
    } else if (previous.height !== viewport.height && viewport.width > 0) {
      // Opening a connection summary or the unconnected list changes available
      // height, not the user's intended pan or magnification. Preserve both the
      // world point at the center and the effective pixel scale.
      const current = cameraRef.current;
      const worldPerPixel =
        previous.frame.width / current.zoom / previous.width;
      const zoom = clampZoom(frame.width / (viewport.width * worldPerPixel));
      const centerY = current.y + previous.frame.height / current.zoom / 2;
      updateCamera({ ...current, zoom, y: centerY - frame.height / zoom / 2 });
    }
    previousFrame.current = {
      reset,
      topology,
      width: viewport.width,
      height: viewport.height,
      frame,
    };
  }, [reset, topology, viewport.width, viewport.height]);
  useEffect(() => {
    window.addEventListener("blur", clearGesture);
    return () => window.removeEventListener("blur", clearGesture);
  }, []);

  const zoomAt = (factor: number, client?: Point) => {
    const current = cameraRef.current,
      drawing = frameRef.current;
    const inverse = svg.current?.getScreenCTM()?.inverse();
    const anchor =
      client && inverse
        ? svgPoint(client, inverse)
        : {
            x: current.x + drawing.width / current.zoom / 2,
            y: current.y + drawing.height / current.zoom / 2,
          };
    const zoom = clampZoom(current.zoom * factor),
      ratio = current.zoom / zoom;
    updateCamera({
      x: anchor.x - (anchor.x - current.x) * ratio,
      y: anchor.y - (anchor.y - current.y) * ratio,
      zoom,
    });
  };
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (pointers.current.size) return;
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1);
      zoomAt(Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.002), {
        x: event.clientX,
        y: event.clientY,
      });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);

  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const matrix = event.currentTarget.getScreenCTM()?.inverse();
    if (!matrix) return;
    event.preventDefault();
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    const points = [...pointers.current.values()];
    const origin =
      points.length === 1
        ? points[0]
        : {
            x: (points[0].x + points[1].x) / 2,
            y: (points[0].y + points[1].y) / 2,
          };
    const target = event.target instanceof Element ? event.target : null;
    gesture.current = {
      camera: cameraRef.current,
      matrix,
      origin: svgPoint(origin, matrix),
      clientOrigin: origin,
      distance:
        points.length > 1
          ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
          : 0,
      moved: points.length > 1,
      item:
        target
          ?.closest("[data-diagram-item]")
          ?.getAttribute("data-diagram-item") ?? undefined,
      connection:
        target
          ?.closest("[data-diagram-connection]")
          ?.getAttribute("data-diagram-connection") ?? undefined,
    };
    setGrabbed(true);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const active = gesture.current;
    if (!active || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const points = [...pointers.current.values()];
    const center =
      points.length === 1
        ? points[0]
        : {
            x: (points[0].x + points[1].x) / 2,
            y: (points[0].y + points[1].y) / 2,
          };
    if (
      Math.hypot(
        center.x - active.clientOrigin.x,
        center.y - active.clientOrigin.y,
      ) > 4
    )
      active.moved = true;
    if (!active.moved) return;
    const point = svgPoint(center, active.matrix);
    const zoom =
      points.length > 1 && active.distance > 0
        ? clampZoom(
            (active.camera.zoom *
              Math.hypot(
                points[0].x - points[1].x,
                points[0].y - points[1].y,
              )) /
              active.distance,
          )
        : active.camera.zoom;
    const ratio = active.camera.zoom / zoom;
    updateCamera({
      x: active.origin.x - (point.x - active.camera.x) * ratio,
      y: active.origin.y - (point.y - active.camera.y) * ratio,
      zoom,
    });
  };
  const up = (event: PointerEvent<SVGSVGElement>) => {
    const active = gesture.current;
    if (!active || !pointers.current.has(event.pointerId)) return;
    if (!active.moved && pointers.current.size === 1) {
      if (active.item) onSelect(active.item);
      else if (active.connection) onSelectConnection(active.connection);
    }
    // Finish the entire gesture when one finger lifts; another gesture starts
    // only with a fresh press. A pinch cannot leave a stuck grab or select a node.
    clearGesture();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const activate = (event: KeyboardEvent<SVGGElement>, action: () => void) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      action();
    }
  };
  const reveal = (x: number, y: number, width: number, height: number) => {
    const current = cameraRef.current,
      visible = frameRef.current;
    const visibleWidth = visible.width / current.zoom,
      visibleHeight = visible.height / current.zoom;
    const margin = 12;
    if (
      x - margin >= current.x &&
      x + width + margin <= current.x + visibleWidth &&
      y - margin >= current.y &&
      y + height + margin <= current.y + visibleHeight
    )
      return;
    // Tab focus must bring clipped equipment/lines into view at the current zoom.
    updateCamera({
      ...current,
      x: x + width / 2 - visibleWidth / 2,
      y: y + height / 2 - visibleHeight / 2,
    });
  };
  const modeTitle =
    document.mode === "process"
      ? "Process and instrumentation diagram"
      : "Electrical wiring diagram";
  const prefix = `schematic-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const kinds = [...new Set(layout.edges.map((edge) => edge.connection.kind))];
  const chosenUnconnected = layout.unconnected.some(
    (item) => item.ref === selected,
  );
  const chosenEdge = layout.edges.find(
    (edge) => edge.connection.id === selectedConnection,
  );
  const directionSymbol = (direction: string) =>
    direction === "both"
      ? "↔"
      : direction === "reverse"
        ? "←"
        : direction === "forward"
          ? "→"
          : "—";

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col bg-muted/20"
      data-testid="factory-schematic"
      data-diagram-kind={document.mode}
    >
      <div className="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b bg-background/90 px-3 py-1.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium" title={document.title}>
            {document.title}
          </p>
          <p className="text-[10px] text-muted-foreground">
            Schematic · not to scale · {layout.edges.length} connections
          </p>
        </div>
        <div
          className="flex shrink-0 items-center gap-0.5"
          role="group"
          aria-label="Diagram navigation"
        >
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Zoom out diagram"
            title="Zoom out (−)"
            onClick={() => zoomAt(1 / 1.25)}
            disabled={camera.zoom <= 0.25}
          >
            <ZoomOut className="size-4" />
          </Button>
          <span
            className="w-10 text-center text-[10px] tabular-nums"
            aria-label="Diagram zoom"
          >
            {Math.round(
              camera.zoom *
                (viewport.width > 0 ? viewport.width / frame.width : 1) *
                100,
            )}
            %
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Zoom in diagram"
            title="Zoom in (+)"
            onClick={() => zoomAt(1.25)}
            disabled={camera.zoom >= 32}
          >
            <ZoomIn className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Fit diagram"
            title="Fit diagram (Home)"
            onClick={() => fit()}
          >
            <Focus className="size-4" />
          </Button>
        </div>
      </div>
      <div className="relative min-h-24 min-w-0 flex-1">
        <svg
          ref={svg}
          role="group"
          aria-label={modeTitle}
          aria-description="Select equipment or a connection to inspect it. Hold and drag to pan; scroll, pinch or use the zoom buttons. Arrow keys pan, plus and minus zoom, and Home fits the drawing."
          tabIndex={0}
          className="h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          viewBox={`${camera.x} ${camera.y} ${frame.width / camera.zoom} ${frame.height / camera.zoom}`}
          data-viewbox={`${camera.x},${camera.y},${camera.zoom}`}
          data-grab-state={grabbed ? "grabbing" : "idle"}
          style={{ touchAction: "none", cursor: grabbed ? "grabbing" : "grab" }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={clearGesture}
          onLostPointerCapture={clearGesture}
          onKeyDown={(event) => {
            if (event.key === "+" || event.key === "=") {
              event.preventDefault();
              zoomAt(1.25);
            } else if (event.key === "-") {
              event.preventDefault();
              zoomAt(1 / 1.25);
            } else if (event.key === "Home" || event.key === "0") {
              event.preventDefault();
              fit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              clearGesture();
              onSelectConnection("");
              onSelect("");
            } else if (
              ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                event.key,
              )
            ) {
              event.preventDefault();
              const c = cameraRef.current,
                step = 40 / c.zoom;
              updateCamera({
                ...c,
                x:
                  c.x +
                  (event.key === "ArrowLeft"
                    ? -step
                    : event.key === "ArrowRight"
                      ? step
                      : 0),
                y:
                  c.y +
                  (event.key === "ArrowUp"
                    ? -step
                    : event.key === "ArrowDown"
                      ? step
                      : 0),
              });
            }
          }}
        >
          <defs>
            {kinds.map((kind) => (
              <marker
                key={kind}
                id={`${prefix}-${kind}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
                markerUnits="userSpaceOnUse"
              >
                <path d="M0 0L10 5 0 10Z" fill={styles[kind].color} />
              </marker>
            ))}
          </defs>
          {layout.edges.map((edge) => {
            const connection = edge.connection,
              appearance = styles[connection.kind];
            const chosen = selectedConnection === connection.id,
              focus = focused === `edge:${connection.id}`;
            return (
              <g
                key={connection.id}
                role="button"
                tabIndex={0}
                aria-label={`Connection ${connection.label}`}
                aria-pressed={chosen}
                data-diagram-connection={connection.id}
                data-connection-kind={connection.kind}
                data-direction={connection.direction}
                className="outline-none"
                style={{ cursor: "pointer" }}
                onFocus={() => {
                  setFocused(`edge:${connection.id}`);
                  reveal(edge.labelX - 45, edge.labelY - 15, 90, 45);
                }}
                onBlur={() => setFocused("")}
                onClick={(event) => {
                  if (event.detail === 0) onSelectConnection(connection.id);
                }}
                onKeyDown={(event) =>
                  activate(event, () => onSelectConnection(connection.id))
                }
              >
                <title>{`${connection.label}: ${edge.from.item.name}${connection.fromTerminal ? `, terminal ${connection.fromTerminal}` : ""} ${directionSymbol(connection.direction)} ${edge.to.item.name}${connection.toTerminal ? `, terminal ${connection.toTerminal}` : ""}. ${DIAGRAM_KIND_LABELS[connection.kind]}; direction: ${connection.direction}.`}</title>
                {(chosen || focus) && (
                  <path
                    d={edge.path}
                    fill="none"
                    stroke="var(--ring)"
                    strokeWidth="9"
                    opacity=".22"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <path
                  d={edge.path}
                  fill="none"
                  stroke={appearance.color}
                  strokeWidth={chosen ? 3 : 1.8}
                  strokeDasharray={appearance.dash}
                  vectorEffect="non-scaling-stroke"
                  markerStart={
                    connection.direction === "reverse" ||
                    connection.direction === "both"
                      ? `url(#${prefix}-${connection.kind})`
                      : undefined
                  }
                  markerEnd={
                    connection.direction === "forward" ||
                    connection.direction === "both"
                      ? `url(#${prefix}-${connection.kind})`
                      : undefined
                  }
                />
                <path
                  d={edge.path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="18"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={edge.labelX}
                  y={edge.labelY}
                  textAnchor={edge.labelAnchor}
                  fontSize="10"
                  fill={appearance.color}
                  stroke="var(--card)"
                  strokeWidth="4"
                  paintOrder="stroke"
                  strokeLinejoin="round"
                >
                  {shorten(connection.designation || connection.label, 23)}
                </text>
                {[
                  [
                    edge.fromX,
                    edge.fromY,
                    connection.fromTerminal,
                    edge.fromX <= edge.toX,
                  ],
                  [
                    edge.toX,
                    edge.toY,
                    connection.toTerminal,
                    edge.toX < edge.fromX,
                  ],
                ].map(([x, y, terminal, right], index) =>
                  terminal ? (
                    <g key={index} aria-label={`Terminal ${terminal}`}>
                      <circle
                        cx={Number(x)}
                        cy={Number(y)}
                        r="3.5"
                        stroke={appearance.color}
                        fill="var(--card)"
                        strokeWidth="1.5"
                      />
                      <text
                        x={Number(x) + (edge.vertical ? 7 : right ? 6 : -6)}
                        y={Number(y) + (edge.vertical && index === 1 ? -7 : 14)}
                        textAnchor={edge.vertical || right ? "start" : "end"}
                        fontSize="9"
                        fill="var(--foreground)"
                        stroke="var(--card)"
                        strokeWidth="3"
                        paintOrder="stroke"
                      >
                        {shorten(String(terminal), 18)}
                      </text>
                    </g>
                  ) : null,
                )}
              </g>
            );
          })}
          {layout.nodes.map(({ item, x, y }) => {
            const chosen = selected === item.ref,
              focus = focused === `item:${item.ref}`;
            const name = nameLines(item.name);
            return (
              <g
                key={item.ref}
                transform={`translate(${x},${y})`}
                role="button"
                tabIndex={0}
                aria-label={`Select ${item.name}`}
                aria-pressed={chosen}
                data-diagram-item={item.ref}
                className="outline-none"
                style={{ cursor: "pointer" }}
                onFocus={() => {
                  setFocused(`item:${item.ref}`);
                  reveal(x, y, SCHEMATIC_NODE_WIDTH, SCHEMATIC_NODE_HEIGHT);
                }}
                onBlur={() => setFocused("")}
                onClick={(event) => {
                  if (event.detail === 0) onSelect(item.ref);
                }}
                onKeyDown={(event) => activate(event, () => onSelect(item.ref))}
              >
                <title>{`${item.name} · ${item.factoryTag || item.identifier} · ${item.status} · ${item.mode}`}</title>
                <rect
                  width={SCHEMATIC_NODE_WIDTH}
                  height={SCHEMATIC_NODE_HEIGHT}
                  rx="5"
                  fill="var(--card)"
                  stroke={
                    focus
                      ? "var(--ring)"
                      : chosen
                        ? "var(--info)"
                        : "var(--border)"
                  }
                  strokeWidth={chosen || focus ? 3 : 1}
                  vectorEffect="non-scaling-stroke"
                />
                {chosen && (
                  <rect
                    x="5"
                    y="5"
                    width={SCHEMATIC_NODE_WIDTH - 10}
                    height={SCHEMATIC_NODE_HEIGHT - 10}
                    rx="2"
                    fill="none"
                    stroke="var(--info)"
                    strokeWidth="1"
                    strokeDasharray="4 3"
                  />
                )}
                <g
                  transform="translate(38,42)"
                  fill="none"
                  stroke="currentColor"
                  color="var(--foreground)"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                >
                  <EquipmentSymbol item={item} />
                </g>
                <text
                  x="75"
                  y="32"
                  fill="var(--foreground)"
                  fontSize="10.5"
                  fontWeight="600"
                >
                  {name.map((line, index) => (
                    <tspan key={index} x="75" dy={index ? 14 : 0}>
                      {line}
                    </tspan>
                  ))}
                </text>
                <text x="75" y="64" fontSize="9" fill="var(--muted-foreground)">
                  {shorten(item.itemType.replaceAll("_", " "), 19)}
                </text>
                <text
                  x="13"
                  y="86"
                  fontSize="9.5"
                  fill="var(--foreground)"
                  fontFamily="monospace"
                >
                  {shorten(item.factoryTag || item.identifier, 27)}
                </text>
                <circle cx="16" cy="98" r="2.5" fill={statusColor(item)} />
                <text
                  x="23"
                  y="101"
                  fontSize="8.5"
                  fill="var(--muted-foreground)"
                >
                  {item.status} · {item.mode}
                </text>
              </g>
            );
          })}
        </svg>
        {!layout.nodes.length && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <p className="text-sm font-medium">
              No {document.mode === "process" ? "process" : "electrical"}{" "}
              connections defined
            </p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Define connections or import a drawing to show this equipment as a
              schematic.
            </p>
          </div>
        )}
      </div>
      {!!kinds.length && (
        <div
          className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-t px-3 py-1 text-[10px] text-muted-foreground"
          aria-label="Diagram connection legend"
        >
          {kinds.map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <svg width="24" height="8" aria-hidden="true">
                <path
                  d="M0 4h24"
                  stroke={styles[kind].color}
                  strokeDasharray={styles[kind].dash}
                  strokeWidth="2"
                />
              </svg>
              {DIAGRAM_KIND_LABELS[kind]}
            </span>
          ))}
        </div>
      )}
      {chosenEdge && (
        <div
          className="min-w-0 shrink-0 border-t bg-info/5 px-3 py-1.5 text-xs"
          role="status"
          aria-label="Selected diagram connection summary"
        >
          <p className="truncate font-medium">
            {chosenEdge.connection.designation
              ? `${chosenEdge.connection.designation} · `
              : ""}
            {chosenEdge.connection.label}
          </p>
          <p className="mt-0.5 line-clamp-2 break-words text-[11px] text-muted-foreground">
            {chosenEdge.from.item.name}
            {chosenEdge.connection.fromTerminal
              ? ` · ${chosenEdge.connection.fromTerminal}`
              : ""}{" "}
            {directionSymbol(chosenEdge.connection.direction)}{" "}
            {chosenEdge.to.item.name}
            {chosenEdge.connection.toTerminal
              ? ` · ${chosenEdge.connection.toTerminal}`
              : ""}
          </p>
        </div>
      )}
      {!!layout.unconnected.length && (
        <details
          key={`${document.mode}:${chosenUnconnected}`}
          open={!layout.nodes.length || chosenUnconnected || undefined}
          className="min-w-0 shrink-0 border-t bg-background/90 px-3 py-1.5"
        >
          <summary className="cursor-pointer text-xs font-medium">
            Unconnected equipment · {layout.unconnected.length}
          </summary>
          <div
            className="mt-2 grid max-h-24 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3"
            aria-label="Equipment without diagram connections"
          >
            {layout.unconnected.map((item) => (
              <button
                key={item.ref}
                type="button"
                aria-label={`Select ${item.name}`}
                aria-pressed={selected === item.ref}
                onClick={() => onSelect(item.ref)}
                className={`min-h-9 min-w-0 rounded border px-2 py-1 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring ${selected === item.ref ? "border-info bg-info/10" : "border-transparent"}`}
              >
                <span className="block truncate">{item.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {item.factoryTag || item.identifier}
                </span>
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
