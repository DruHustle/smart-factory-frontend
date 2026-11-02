import {
  Component,
  lazy,
  Suspense,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import type FactoryFloorScene from "./FactoryFloorScene";
import { FloorPlan } from "./FactoryFloorPlan";

const Scene = lazy(() => import("./FactoryFloorScene"));
type SceneProps = ComponentProps<typeof FactoryFloorScene>;
type Phase = "loading" | "ready" | "failed";

class SceneBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Keep a usable floor plan present until the first 3D frame is ready. */
export function FactorySceneStage(props: SceneProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [pointerActive, setPointerActive] = useState(false);
  const [planFocused, setPlanFocused] = useState(false);
  const scene = useRef<HTMLDivElement>(null);
  const plan = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const focusScene = useRef(false);
  const sceneFocused = useRef(false);
  const pointers = useRef(new Set<number>());
  const pointerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const showPlan = phase !== "ready" || pointerActive || planFocused;

  useLayoutEffect(() => {
    if (phase !== "ready" && restoreFocus.current) {
      restoreFocus.current = false;
      plan.current?.focus();
    }
  }, [phase]);
  useLayoutEffect(() => {
    if (!showPlan && focusScene.current) {
      focusScene.current = false;
      scene.current
        ?.querySelector<HTMLCanvasElement>("canvas")
        ?.focus({ preventScroll: true });
    }
  }, [showPlan]);
  useLayoutEffect(() => {
    const finish = (event: PointerEvent) => {
      if (!pointers.current.delete(event.pointerId)) return;
      // Let the pointer-up's subsequent click or drop finish before unmounting.
      if (pointerTimer.current !== undefined)
        clearTimeout(pointerTimer.current);
      pointerTimer.current = setTimeout(
        () => setPointerActive(pointers.current.size > 0),
        0,
      );
    };
    const blur = () => {
      pointers.current.clear();
      sceneFocused.current = false;
      focusScene.current = false;
      if (pointerTimer.current !== undefined)
        clearTimeout(pointerTimer.current);
      setPointerActive(false);
    };
    const focus = (event: FocusEvent) => {
      const target = event.target as Node;
      sceneFocused.current = !!scene.current?.contains(target);
      if (!sceneFocused.current && !plan.current?.contains(target))
        focusScene.current = false;
    };
    const focusOut = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!scene.current?.contains(target)) return;
      if (event.relatedTarget) {
        sceneFocused.current = !!scene.current.contains(
          event.relatedTarget as Node,
        );
      } else {
        queueMicrotask(() => {
          if (
            scene.current?.contains(target) &&
            document.activeElement !== target
          )
            sceneFocused.current = false;
        });
      }
    };
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", blur);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", focusOut);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", blur);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", focusOut);
      if (pointerTimer.current !== undefined)
        clearTimeout(pointerTimer.current);
    };
  }, []);
  const reportPhase = (next: Phase) => {
    if (next !== "ready" && sceneFocused.current) restoreFocus.current = true;
    setPhase(next);
  };
  return (
    <div className="relative h-full w-full">
      <div
        ref={scene}
        className="absolute inset-0"
        style={{ visibility: showPlan ? "hidden" : "visible" }}
        aria-hidden={showPlan || undefined}
        inert={showPlan}
      >
        <SceneBoundary onFailure={() => reportPhase("failed")}>
          <Suspense fallback={null}>
            <Scene
              {...props}
              onPresentationState={reportPhase}
              managedFallback
            />
          </Suspense>
        </SceneBoundary>
      </div>
      {showPlan && (
        <div
          ref={plan}
          tabIndex={-1}
          className="absolute inset-0 bg-background"
          data-floor-preview={phase}
          onPointerDownCapture={(event) => {
            if (pointerTimer.current !== undefined)
              clearTimeout(pointerTimer.current);
            pointers.current.add(event.pointerId);
            setPointerActive(true);
          }}
          onLostPointerCapture={(event) => {
            if (!pointers.current.delete(event.pointerId)) return;
            if (pointerTimer.current !== undefined)
              clearTimeout(pointerTimer.current);
            pointerTimer.current = setTimeout(
              () => setPointerActive(pointers.current.size > 0),
              0,
            );
          }}
          onFocusCapture={() => setPlanFocused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              setPlanFocused(false);
          }}
        >
          <FloorPlan
            layout={props.layout}
            links={props.links}
            selected={props.selected}
            onSelect={props.onSelect}
            onMove={props.onMove}
            onItemDrag={props.onItemDrag}
            onItemDrop={props.onItemDrop}
            onDelete={props.onDelete}
            reset={props.reset}
          />
          {phase === "failed" && (
            <p
              role="status"
              className="pointer-events-none absolute left-3 top-3 rounded-md border bg-background/95 px-2 py-1 text-xs text-muted-foreground"
            >
              3D unavailable on this device · Showing floor plan
            </p>
          )}
          {phase === "ready" && (
            <button
              type="button"
              className="absolute bottom-3 right-3 rounded-md border bg-background/95 px-3 py-2 text-xs font-medium"
              onClick={() => {
                focusScene.current = true;
                setPointerActive(pointers.current.size > 0);
                setPlanFocused(false);
              }}
            >
              Show 3D
            </button>
          )}
        </div>
      )}
    </div>
  );
}
