import { useEffect, useRef, useState } from "react";

/** Keep the same scene mounted while enlarging it, including in embedded browsers. */
export function useFloorFullscreen() {
  const panel = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const native = useRef(false);
  const wanted = useRef(false);
  const enteringNative = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const exit = async () => {
    wanted.current = false;
    enteringNative.current = false;
    if (document.fullscreenElement === panel.current) {
      try {
        await document.exitFullscreen();
      } catch {
        /* The page view can still close. */
      }
    }
    native.current = false;
    setExpanded(false);
  };
  const toggle = async () => {
    if (pending) return;
    setPending(true);
    try {
      if (expanded) {
        await exit();
        return;
      }
      const element = panel.current;
      if (!element) return;
      wanted.current = true;
      setExpanded(true);
      try {
        if (element.requestFullscreen) {
          enteringNative.current = true;
          await element.requestFullscreen();
        }
      } catch {
        enteringNative.current = false;
        /* Full-window page view remains available when native fullscreen is blocked. */
      }
      if (!wanted.current) {
        if (document.fullscreenElement === element)
          await document.exitFullscreen().catch(() => {});
        return;
      }
      if (document.fullscreenElement === element) {
        native.current = true;
        enteringNative.current = false;
      } else if (enteringNative.current) {
        // The browser can consume Escape before delivering its enter event.
        enteringNative.current = false;
        wanted.current = false;
        setExpanded(false);
        return;
      }
      element
        .querySelector<HTMLElement>(".overview-floor-viewport [tabindex='0']")
        ?.focus({ preventScroll: true });
    } finally {
      setPending(false);
    }
  };
  useEffect(() => {
    const element = panel.current;
    const changed = () => {
      if (document.fullscreenElement === element) {
        if (!wanted.current) {
          native.current = false;
          enteringNative.current = false;
          setExpanded(false);
          void document.exitFullscreen().catch(() => {});
          return;
        }
        native.current = true;
        enteringNative.current = false;
        setExpanded(true);
      } else if (native.current || enteringNative.current) {
        native.current = false;
        enteringNative.current = false;
        wanted.current = false;
        setExpanded(false);
      }
    };
    document.addEventListener("fullscreenchange", changed);
    return () => {
      wanted.current = false;
      document.removeEventListener("fullscreenchange", changed);
      if (document.fullscreenElement === element)
        void document.exitFullscreen().catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        void exit();
      } else if (event.key === "Tab") {
        const controls = [
          ...(panel.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),select:not(:disabled),a[href],input:not(:disabled),[tabindex='0']",
          ) ?? []),
        ].filter(
          (node) =>
            node.getClientRects().length &&
            node.getAttribute("aria-hidden") !== "true",
        );
        const first = controls[0],
          last = controls.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !panel.current?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !panel.current?.contains(document.activeElement))
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      document.body.style.overflow = overflow;
      requestAnimationFrame(() =>
        button.current?.focus({ preventScroll: true }),
      );
    };
  }, [expanded]);
  return { panel, button, expanded, pending, toggle };
}
