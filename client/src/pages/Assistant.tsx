import { useFactorySelection } from "@/lib/factory-selection";
import { useWorkspaceLocation } from "@/lib/hashLocation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Bot,
  UserRound,
  Send,
  Plus,
  ArrowDown,
  BookOpen,
  LoaderCircle,
  Square,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  captureDemoAssistantContext,
  useDemoSandbox,
} from "@/lib/demo-sandbox";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { trpc } from "@/lib/trpc";
import {
  validatedAssistantPresentation,
  type AssistantAnswer,
} from "@shared/assistant";
import {
  useAssistantSession,
  readAssistantSession,
  updateAssistantSession,
  resetAssistantSession,
  registerAssistantCancellation,
  type AssistantTurn,
  type TurnContext,
} from "@/lib/assistant-session";
import { PageHeader } from "@/components/workspace/Primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { SafeMarkdown } from "@/components/SafeMarkdown";
import { EvidenceInspector } from "@/components/assistant/EvidenceInspector";
import { AnswerVisual } from "@/components/assistant/AnswerVisual";
import { EquipmentContextSelect } from "@/components/assistant/EquipmentContextSelect";
import { AssistantModelSelect } from "@/components/assistant/AssistantModelSelect";
import { assistantProviderLabels } from "@shared/assistant-providers";
import { useRuntimeCapability } from "@/components/RuntimeBoundary";
import { userFacingApiError } from "@/lib/errors";
import {
  announceSessionExpired,
  isUnauthorizedError,
} from "@/lib/session-expiry";

function time(value: string) {
  const at = Date.parse(value);
  return Number.isFinite(at)
    ? new Date(at).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Time unavailable";
}
function prose(value: string) {
  return value.replace(/^\s*#{1,3}\s*(?:answer|response)\s*(?:\r?\n)+/i, "");
}
export default function Assistant() {
  const { user } = useAuth(),
    wide = useMediaQuery("(min-width:1280px)"),
    active = useDocumentActive(),
    reduce = useMediaQuery("(prefers-reduced-motion: reduce)");
  const { id: factoryId, demo: factoryDemo } = useFactorySelection();
  const [location] = useWorkspaceLocation();
  const sandbox = useDemoSandbox();
  const owner = `${factoryId ?? "all"}:${user?.id ?? "signed-out"}:${user?.role ?? ""}:${user?.access?.demoOnly ? "demo" : (user?.access?.workspaceView ?? "configured")}`;
  const [session, setSession] = useAssistantSession(owner),
    [inspectorOpen, setInspectorOpen] = useState(false),
    [citation, setCitation] = useState<{ number: number; key: number } | null>(
      null,
    ),
    [showLatest, setShowLatest] = useState(!session.followLatest),
    [attempted, setAttempted] = useState(false),
    [viewportHeight, setViewportHeight] = useState(
      () => window.visualViewport?.height ?? window.innerHeight,
    );
  const pane = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    requestPending = useRef(false),
    runningRequest = useRef<{
      controller: AbortController;
      cancel: () => void;
    } | null>(null),
    composing = useRef(false),
    follow = useRef(session.followLatest),
    position = useRef(session.scrollTop),
    latest = useRef(session),
    citationSequence = useRef(0),
    completedTurn = useRef<string | null>(null),
    inspectorAside = useRef<HTMLElement>(null),
    inspectorOpener = useRef<HTMLElement | null>(null);
  latest.current = session;
  const busy = session.turns.some((t) => t.status === "pending"),
    invalid = session.draft.length > 500 || session.draft.trim().length < 1;
  const localSelected = factoryDemo
    ? sandbox?.items.find((i) => i.identifier === session.selectedAssetId)
    : undefined;
  const contextQuery = trpc.assistant.context.useQuery(
    { assetId: session.selectedAssetId },
    {
      enabled: session.selectedAssetId !== "automatic" && !localSelected,
      staleTime: 60000,
    },
  );
  const selectedContext: TurnContext =
    session.selectedAssetId === "automatic"
      ? null
      : {
          assetId: session.selectedAssetId,
          name:
            localSelected?.name ??
            contextQuery.data?.name ??
            session.selectedAssetName ??
            "Selected equipment",
        };
  const selectedTurn =
    session.turns.find((t) => t.id === session.selectedTurnId) ??
    session.turns.at(-1);
  const utils = trpc.useUtils();
  const selectionSupported = useRuntimeCapability(
    "assistant-provider-selection-v1",
  );
  const scrollToLatest = (smooth = true) => {
    follow.current = true;
    setShowLatest(false);
    const element = pane.current;
    if (element)
      element.scrollTo({
        top: element.scrollHeight,
        behavior: smooth && !reduce ? "smooth" : "auto",
      });
  };
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () =>
      setViewportHeight(viewport?.height ?? window.innerHeight);
    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
    };
  }, []);
  // Navigation, account changes and workspace changes must stop remote work as
  // well as discard its result. Cancelled turns remain retryable in memory.
  useEffect(() => () => runningRequest.current?.cancel(), [owner]);
  useLayoutEffect(() => {
    if (input.current) {
      input.current.style.height = "0px";
      input.current.style.height =
        Math.min(128, Math.max(44, input.current.scrollHeight)) + "px";
    }
  }, [session.draft]);
  useLayoutEffect(() => {
    const last = session.turns.at(-1);
    if (last?.status === "complete" && completedTurn.current !== last.id) {
      completedTurn.current = last.id;
      if (follow.current && pane.current) {
        const response = pane.current.querySelector<HTMLElement>(
          "article:last-child [data-assistant-response]",
        );
        if (response) {
          pane.current.scrollTo({
            top: Math.max(0, response.offsetTop - 8),
            behavior: "auto",
          });
          return;
        }
      }
    }
    if (follow.current) scrollToLatest(false);
  }, [session.turns.length, session.turns.at(-1)?.status, viewportHeight]);
  useLayoutEffect(() => {
    if (pane.current) {
      pane.current.scrollTop = session.followLatest
        ? pane.current.scrollHeight
        : session.scrollTop;
    }
  }, [owner]);
  useEffect(
    () => () => {
      updateAssistantSession(
        owner,
        (s) => ({
          ...s,
          scrollTop: position.current,
          followLatest: follow.current,
        }),
        latest.current.generation,
      );
    },
    [owner],
  );
  useEffect(() => {
    const requested = new URLSearchParams(location.split("?")[1] ?? "").get(
      "asset",
    );
    if (!requested || requested.length < 3 || requested.length > 128) return;
    if (readAssistantSession(owner)?.selectedAssetId === requested) return;
    // An explicit item link changes the next question's context. Earlier turns
    // keep their captured evidence, and navigation never submits the draft.
    runningRequest.current?.cancel();
    setSession((s) => ({
      ...s,
      selectedAssetId: requested,
      selectedAssetName: null,
    }));
  }, [owner, location]);
  const inspect = (id: string, n?: number) => {
    inspectorOpener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setSession((s) => ({ ...s, selectedTurnId: id }));
    setCitation(n ? { number: n, key: ++citationSequence.current } : null);
    follow.current = false;
    const panel = pane.current;
    setShowLatest(
      id !== session.turns.at(-1)?.id ||
        (!!panel &&
          panel.scrollHeight - panel.scrollTop - panel.clientHeight >= 72),
    );
    if (!wide) setInspectorOpen(true);
    else if (!n) inspectorAside.current?.focus({ preventScroll: true });
  };
  const perform = async (turn: AssistantTurn, draftAtSubmission: string) => {
    if (requestPending.current) return;
    requestPending.current = true;
    const generation = readAssistantSession(owner)?.generation;
    if (generation === undefined) {
      requestPending.current = false;
      return;
    }
    const controller = new AbortController();
    const cancel = () => {
      controller.abort();
      updateAssistantSession(
        owner,
        (s) => ({
          ...s,
          turns: s.turns.map((t) =>
            t.id === turn.id && t.status === "pending"
              ? { ...t, status: "cancelled", error: undefined }
              : t,
          ),
        }),
        generation,
      );
    };
    runningRequest.current = { controller, cancel };
    const unregisterCancellation = registerAssistantCancellation(cancel);
    try {
      // The separate additive endpoint fails visibly if the API rolls back while
      // this page is open. An older ask schema must never drop an explicit choice.
      const raw = await (turn.request.selection
          ? utils.client.assistant.askSelected.mutate(turn.request, {
              signal: controller.signal,
            })
          : utils.client.assistant.ask.mutate(turn.request, {
              signal: controller.signal,
            })),
        presentation = validatedAssistantPresentation(
          (raw as AssistantAnswer).presentation,
          raw.sources.length,
        ),
        result: AssistantAnswer = {
          ...raw,
          presentation,
        };
      controller.signal.throwIfAborted();
      updateAssistantSession(
        owner,
        (s) => ({
          ...s,
          turns: s.turns.map((t) =>
            t.id === turn.id
              ? { ...t, status: "complete", result, error: undefined }
              : t,
          ),
          draft: s.draft === draftAtSubmission ? "" : s.draft,
          ...(s.selectedAssetId === "automatic" &&
          result.presentation?.format === "operational" &&
          result.presentation.context
            ? {
                selectedAssetId: result.presentation.context.assetId,
                selectedAssetName: result.presentation.context.name,
              }
            : {}),
        }),
        generation,
      );
    } catch (error) {
      if (controller.signal.aborted) {
        cancel();
        return;
      }
      // Direct client calls allow cancellation; preserve the shared mutation
      // policy for expired sessions and avoid exposing proxy/parser failures.
      if (isUnauthorizedError(error)) announceSessionExpired();
      if (
        error instanceof Error &&
        error.message.includes("selected AI provider or model")
      )
        void utils.assistant.providers.invalidate();
      updateAssistantSession(
        owner,
        (s) => ({
          ...s,
          turns: s.turns.map((t) =>
            t.id === turn.id
              ? {
                  ...t,
                  status: "failed",
                  error: userFacingApiError(
                    error,
                    "The answer could not be loaded. Retry when the service is available.",
                  ),
                }
              : t,
          ),
        }),
        generation,
      );
    } finally {
      unregisterCancellation();
      if (runningRequest.current?.controller === controller) {
        runningRequest.current = null;
        requestPending.current = false;
      }
    }
  };
  const submit = (event?: FormEvent, suggestion?: string) => {
    event?.preventDefault();
    if (requestPending.current || busy) return;
    const current = readAssistantSession(owner) ?? session,
      raw = suggestion ?? current.draft,
      question = raw.trim();
    setAttempted(true);
    if (raw.length > 500 || question.length < 1) return;
    const history = current.turns
      .filter((t) => t.status === "complete" && t.result)
      .slice(-6)
      .flatMap((t) => [
        { role: "user" as const, content: t.question.slice(0, 1200) },
        {
          role: "assistant" as const,
          content: t.result!.answer.slice(0, 1200),
        },
      ]);
    const selectedDemoItem = factoryDemo
      ? sandbox?.items.find(
          (item) => item.identifier === current.selectedAssetId,
        )
      : undefined;
    const context =
      current.selectedAssetId === "automatic"
        ? null
        : {
            assetId: current.selectedAssetId,
            name:
              selectedDemoItem?.name ??
              contextQuery.data?.name ??
              current.selectedAssetName ??
              "Selected equipment",
          };
    const turn: AssistantTurn = {
      id: crypto.randomUUID(),
      question,
      submittedAt: new Date().toISOString(),
      context,
      request: {
        question,
        factoryId: factoryId ?? undefined,
        selectedAssetId: context?.assetId,
        history,
        ...(selectionSupported && current.selection.provider !== "auto"
          ? { selection: current.selection }
          : {}),
        ...(factoryDemo
          ? {
              demoContext: captureDemoAssistantContext(
                question,
                history,
                context?.assetId,
                factoryId ?? undefined,
              ),
            }
          : {}),
      },
      status: "pending",
    };
    setSession((s) => ({
      ...s,
      draft: suggestion ?? s.draft,
      turns: [...s.turns, turn],
      selectedTurnId: turn.id,
    }));
    setCitation(null);
    follow.current = true;
    setShowLatest(false);
    setAttempted(false);
    void perform(turn, raw);
  };
  const retry = (turn: AssistantTurn) => {
    if (requestPending.current || busy) return;
    const { selection: _previousSelection, ...original } = turn.request;
    const selection = (readAssistantSession(owner) ?? session).selection;
    const request = {
      ...original,
      ...(selectionSupported && selection.provider !== "auto"
        ? { selection }
        : {}),
    };
    setSession((s) => ({
      ...s,
      turns: s.turns.map((t) =>
        t.id === turn.id
          ? { ...t, request, status: "pending", error: undefined }
          : t,
      ),
    }));
    void perform(
      { ...turn, request },
      session.draft === turn.question ? session.draft : "",
    );
  };
  const newConversation = () => {
    if (busy || requestPending.current) return;
    resetAssistantSession(owner);
    setCitation(null);
    setAttempted(false);
    follow.current = true;
    position.current = 0;
    setShowLatest(false);
    input.current?.focus({ preventScroll: true });
  };
  const suggestions = selectedContext
    ? [
        `Why does ${selectedContext.name} need attention?`,
        `Show the latest observations for ${selectedContext.name}.`,
        `How can I inspect this equipment?`,
      ]
    : [
        "Which active incidents need attention?",
        "How do I import an AASX package?",
        user?.access?.canEngineer
          ? "How do I create an asset and provision its AAS?"
          : "How do I review source freshness?",
      ];
  const inspectorContext = selectedTurn
    ? selectedTurn.context
    : selectedContext;
  const inspector = (
    <EvidenceInspector
      turn={selectedTurn}
      context={inspectorContext}
      citation={citation}
    />
  );
  return (
    <div
      className="flex min-h-0 w-full flex-col gap-3"
      style={{ height: `max(14rem,calc(${viewportHeight}px - 8.5rem))` }}
    >
      <PageHeader
        title="Assistant"
        description="Understand equipment through evidence."
        action={
          <div className="flex items-center gap-2">
            <Badge className="hidden sm:inline-flex" variant="outline">
              Read-only
            </Badge>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={newConversation}
              aria-label="New conversation"
              title="New conversation"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">New conversation</span>
            </Button>
          </div>
        }
      />
      {selectionSupported && (
        <AssistantModelSelect
          value={session.selection}
          disabled={busy}
          onChange={(selection) => setSession((s) => ({ ...s, selection }))}
        />
      )}
      <section
        aria-label="Conversation"
        className={`grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_21rem] ${session.turns.length ? "items-stretch" : "items-start"}`}
      >
        <div
          className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card ${session.turns.length ? "h-full" : "max-h-full"}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
            <span>
              {selectedTurn?.result
                ? `${wide ? "Inspecting answer snapshot" : "Snapshot"} · ${time(selectedTurn.result.contextAt)}`
                : user?.access?.demoOnly
                  ? "Isolated simulation workspace"
                  : "Authorized workspace · advisory"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                if (selectedTurn) inspect(selectedTurn.id);
                else {
                  inspectorOpener.current =
                    document.activeElement instanceof HTMLElement
                      ? document.activeElement
                      : null;
                  if (wide)
                    inspectorAside.current?.focus({ preventScroll: true });
                  else setInspectorOpen(true);
                }
              }}
            >
              <BookOpen className="size-4" />
              {wide ? "Evidence & context" : "Evidence & context"}
              {selectedTurn?.result?.sources.length
                ? ` (${selectedTurn.result.sources.length})`
                : ""}
            </Button>
          </div>
          <div
            ref={pane}
            aria-label="Conversation history"
            className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 [scrollbar-gutter:stable] sm:px-6"
            onScroll={() => {
              const p = pane.current;
              if (!p) return;
              position.current = p.scrollTop;
              const bottom = p.scrollHeight - p.scrollTop - p.clientHeight < 72;
              follow.current = bottom;
              setShowLatest(!bottom);
            }}
          >
            {!session.turns.length ? (
              <div className="mx-auto flex max-w-2xl flex-col gap-5 py-3 sm:py-7">
                <div className="flex items-start gap-3">
                  <span className="rounded-xl bg-primary/10 p-2 text-primary">
                    <Bot className="size-6" />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold">
                      What would you like to understand?
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Ask about equipment observations, source evidence or an
                      application workflow. Answers are advisory and link to
                      their supporting records.
                    </p>
                    {selectedContext && (
                      <p className="mt-2 text-sm">
                        Selected equipment ·{" "}
                        <strong>{selectedContext.name}</strong>
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:items-start">
                  {suggestions.map((s) => (
                    <Button
                      key={s}
                      type="button"
                      variant="outline"
                      className="h-auto justify-start whitespace-normal py-2 text-left text-sm"
                      onClick={() => submit(undefined, s)}
                    >
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-7">
                {session.turns.map((turn, index) => {
                  const cite = (number: number) =>
                    turn.result?.sources[number - 1] ? (
                      <button
                        key={number}
                        type="button"
                        className="mx-0.5 rounded px-0.5 text-sm font-medium text-info underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
                        aria-label={`Source ${number}: ${turn.result.sources[number - 1].title}`}
                        onClick={() => inspect(turn.id, number)}
                      >
                        [{number}]
                      </button>
                    ) : (
                      `[${number}]`
                    );
                  const written = turn.result ? (
                    <div
                      data-testid="assistant-answer-content"
                      className="min-w-0 text-sm leading-6"
                    >
                      <SafeMarkdown renderCitation={cite}>
                        {prose(turn.result.answer)}
                      </SafeMarkdown>
                    </div>
                  ) : null;
                  return (
                    <article
                      key={turn.id}
                      aria-label={`Question ${index + 1}: ${turn.question}`}
                      className="min-w-0 space-y-4"
                    >
                      <div className="flex justify-end gap-2">
                        <div className="max-w-[90%] space-y-1">
                          <p className="whitespace-pre-wrap break-words rounded-lg bg-primary/10 px-3 py-2 text-sm leading-6">
                            {turn.question}
                          </p>
                          <p className="text-right text-xs text-muted-foreground">
                            {turn.context
                              ? `Context: ${turn.context.name}`
                              : "Automatic context"}{" "}
                            ·{" "}
                            <time dateTime={turn.submittedAt}>
                              {time(turn.submittedAt)}
                            </time>
                          </p>
                        </div>
                        <UserRound
                          aria-hidden
                          className="mt-3 size-4 shrink-0 text-muted-foreground"
                        />
                      </div>
                      <div
                        data-assistant-response
                        className={`min-w-0 border-l-2 pl-3 sm:pl-4 ${selectedTurn?.id === turn.id ? "border-info" : "border-transparent"}`}
                      >
                        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Bot className="size-4 text-primary" />
                          <strong className="font-medium text-foreground">
                            Smart Factory Assistant
                          </strong>
                          {turn.result && (
                            <time
                              dateTime={turn.result.contextAt}
                              title={`Answer snapshot ${new Date(turn.result.contextAt).toLocaleString()}`}
                            >
                              {time(turn.result.contextAt)}
                            </time>
                          )}
                          {turn.result?.execution && (
                            <span data-testid="assistant-execution">
                              {turn.result.execution.provider === "local"
                                ? "Local knowledge"
                                : `${assistantProviderLabels[turn.result.execution.provider]} · ${turn.result.execution.model}`}
                            </span>
                          )}
                        </div>
                        {turn.status === "pending" ? (
                          <div
                            role="status"
                            className="flex items-center gap-2 py-3 text-sm text-muted-foreground"
                          >
                            <LoaderCircle
                              aria-hidden
                              className={`size-4 text-primary ${active ? "motion-safe:animate-spin" : ""}`}
                            />
                            Checking authorized evidence…
                          </div>
                        ) : turn.status === "failed" ||
                          turn.status === "cancelled" ? (
                          <div
                            role={
                              turn.status === "cancelled" ? "status" : "alert"
                            }
                            className={`space-y-3 rounded-md border p-3 ${turn.status === "failed" ? "border-destructive/40" : "border-border"}`}
                          >
                            <p className="text-sm">
                              {turn.status === "cancelled"
                                ? "Answer stopped. Your draft is retained."
                                : turn.error}
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() => retry(turn)}
                            >
                              Retry this question
                            </Button>
                          </div>
                        ) : (
                          <div
                            className={
                              active ? "workflow-change space-y-4" : "space-y-4"
                            }
                          >
                            <span role="status" className="sr-only">
                              Answer ready. {turn.result?.sources.length ?? 0}{" "}
                              sources attached.
                            </span>
                            {turn.result?.presentation && (
                              <AnswerVisual
                                presentation={turn.result.presentation}
                                cite={cite}
                              />
                            )}{" "}
                            {turn.result?.presentation?.trend &&
                            turn.result.answer.length > 1400 ? (
                              <details open>
                                <summary className="cursor-pointer text-sm font-medium">
                                  Written explanation and guidance
                                </summary>
                                <div className="mt-3">{written}</div>
                              </details>
                            ) : (
                              written
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-pressed={selectedTurn?.id === turn.id}
                              onClick={() => inspect(turn.id)}
                            >
                              <BookOpen className="size-4" />
                              Sources & context ·{" "}
                              {turn.result?.sources.length ?? 0}
                            </Button>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
          {showLatest && session.turns.length > 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-36 flex justify-center">
              <Button
                className="pointer-events-auto shadow-sm"
                size="sm"
                variant="secondary"
                onClick={() => {
                  const last = session.turns.at(-1);
                  if (last)
                    setSession((s) => ({ ...s, selectedTurnId: last.id }));
                  setCitation(null);
                  scrollToLatest();
                }}
              >
                <ArrowDown className="size-4" />
                Latest
              </Button>
            </div>
          )}
          <form
            aria-label="Ask a question"
            aria-busy={busy}
            onSubmit={submit}
            className="shrink-0 border-t bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          >
            <div className="rounded-lg border bg-background p-2 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20">
              <div className="flex items-end gap-2">
                <Textarea
                  ref={input}
                  id="assistant-question"
                  aria-label="Ask the Smart Factory Assistant"
                  aria-invalid={
                    session.draft.length > 500 ||
                    (attempted && invalid) ||
                    undefined
                  }
                  aria-describedby="assistant-question-help"
                  value={session.draft}
                  onChange={(e) =>
                    setSession((s) => ({ ...s, draft: e.target.value }))
                  }
                  onCompositionStart={() => {
                    composing.current = true;
                  }}
                  onCompositionEnd={() => {
                    composing.current = false;
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.altKey &&
                      !e.ctrlKey &&
                      !e.metaKey &&
                      !composing.current &&
                      !e.nativeEvent.isComposing &&
                      e.nativeEvent.keyCode !== 229
                    ) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  rows={1}
                  placeholder={
                    selectedContext
                      ? `Ask about ${selectedContext.name}…`
                      : "Ask about equipment or a workflow…"
                  }
                  className="min-h-11 max-h-32 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:ring-0"
                />
                <Button
                  type="submit"
                  aria-label="Ask"
                  disabled={busy || invalid}
                  size="icon"
                  className="mb-1 size-10 shrink-0"
                >
                  <Send aria-hidden className="size-4" />
                </Button>
                {busy && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mb-1 h-10 shrink-0"
                    onClick={() => runningRequest.current?.cancel()}
                    aria-label="Stop answer"
                  >
                    <Square aria-hidden className="size-3" /> Stop
                  </Button>
                )}
              </div>
              <div className="mt-2 flex min-w-0 items-center justify-between gap-2 border-t pt-1">
                <EquipmentContextSelect
                  value={session.selectedAssetId}
                  label={selectedContext?.name ?? "Equipment context"}
                  onChange={(assetId, name) =>
                    setSession((s) => ({
                      ...s,
                      selectedAssetId: assetId,
                      selectedAssetName: name,
                    }))
                  }
                />
                <span
                  className={`shrink-0 text-xs tabular-nums ${session.draft.length > 500 ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {session.draft.length}/500
                </span>
              </div>
            </div>
            <p
              id="assistant-question-help"
              className={`mt-2 text-xs ${session.draft.length > 500 || (attempted && invalid) ? "text-destructive" : "text-muted-foreground"}`}
            >
              {session.draft.length > 500
                ? "Use no more than 500 characters. Your draft is retained."
                : attempted && session.draft.trim().length < 1
                  ? "Enter a question."
                  : "Enter to send · Shift+Enter for a new line · Advisory and read-only"}
            </p>
          </form>
        </div>
        {wide && (
          <aside
            ref={inspectorAside}
            tabIndex={-1}
            aria-label="Evidence and equipment inspector"
            className="min-h-0 min-w-0 overflow-y-auto rounded-lg border bg-card p-4"
          >
            {inspector}
          </aside>
        )}
      </section>
      {!wide && (
        <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
          <SheetContent
            side="bottom"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (inspectorOpener.current?.isConnected)
                inspectorOpener.current.focus({ preventScroll: true });
            }}
            className="max-h-[85dvh] overflow-y-auto motion-reduce:animate-none motion-reduce:transition-none"
          >
            <SheetHeader>
              <SheetTitle>Evidence & equipment</SheetTitle>
              <SheetDescription>
                {selectedTurn
                  ? `Inspecting: ${selectedTurn.question}`
                  : "Selected equipment and approved answer sources"}
              </SheetDescription>
            </SheetHeader>
            <div className="min-w-0 px-4 pb-5">{inspector}</div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
