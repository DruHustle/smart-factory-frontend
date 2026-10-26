import { PageHeader } from "@/components/workspace/Primitives";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Bot, BookOpen, ChevronDown, Clock3, LoaderCircle, Send, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SafeMarkdown } from "@/components/SafeMarkdown";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type AnswerSource = { title: string; section: string; path: string; excerpt: string; kind?: "documentation" | "live-data" };
type Answer = { answer: string; sources: AnswerSource[]; contextAt: string };
type Exchange = { question: string; result: Answer };

const SUGGESTED_QUESTIONS = [
  "How do I create an asset and provision its AAS?",
  "What is the difference between an asset and a gateway?",
  "How does telemetry reach the dashboard?",
  "Which active incidents need attention?",
  "How do user roles control access?",
  "How do I configure OIDC for an AAS repository?",
];

function answerBody(answer: string) {
  return answer.replace(/^\s*#{1,3}\s*(?:answer|response)\s*(?:\r?\n)+/i, "");
}

function SourceDisclosure({ sources }: { sources: AnswerSource[] }) {
  if (sources.length === 0) return null;
  return <details className="group border-t">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted/30 [&::-webkit-details-marker]:hidden">
      <span className="flex items-center gap-2 font-medium"><BookOpen className="h-4 w-4" />Sources and current context<Badge variant="outline" className="h-5 px-1.5 text-[10px]">{sources.length}</Badge></span>
      <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
    </summary>
    <div className="grid gap-2 border-t bg-muted/10 p-4 sm:grid-cols-2">
      {sources.map((source) => <section key={`${source.path}-${source.section}`} className="min-w-0 rounded-lg border bg-card p-3">
        <Badge variant={source.kind === "live-data" ? "secondary" : "outline"}>{source.kind === "live-data" ? "Current system data" : source.title}</Badge>
        <h3 className="mb-1 mt-2 text-sm font-medium leading-5">{source.section}</h3>
        <p className="line-clamp-5 whitespace-pre-line break-words text-xs leading-5 text-muted-foreground">{source.excerpt}</p>
      </section>)}
    </div>
  </details>;
}

export default function Assistant() {
  const [question, setQuestion] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState("automatic");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const questionTooLong = question.length > 500;
  const ask = trpc.assistant.ask.useMutation();
  const { data: assets = [] } = trpc.assets.list.useQuery();
  const conversationEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [exchanges.length, ask.isPending]);

  const submit = async (event?: FormEvent, suggestedQuestion?: string) => {
    event?.preventDefault();
    if (ask.isPending) return;
    const rawQuestion = suggestedQuestion ?? question;
    if (rawQuestion.length > 500) return;
    const submittedQuestion = rawQuestion.trim();
    if (submittedQuestion.length < 3) return;
    try {
      const history = exchanges.slice(-6).flatMap((exchange) => [
        { role: "user" as const, content: exchange.question },
        { role: "assistant" as const, content: exchange.result.answer.slice(0, 1200) },
      ]);
      const result = await ask.mutateAsync({ question: submittedQuestion, selectedAssetId: selectedAssetId === "automatic" ? undefined : selectedAssetId, history });
      setExchanges((current) => [...current, { question: submittedQuestion, result }]);
      setQuestion((current) => current === submittedQuestion ? "" : current);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The assistant could not answer that question");
    }
  };

  return <div className="mx-auto w-full max-w-5xl pb-8">
    <div className="mb-5"><PageHeader title="Assistant" description="Ask about factory evidence, operations and workflows."/></div>
    <Card className="flex min-h-[calc(100vh-8rem)] max-h-[calc(100vh-4rem)] flex-col gap-0 overflow-hidden rounded-lg border-border bg-card/95 shadow-none">
      <CardHeader className="flex flex-row items-center gap-3 border-b px-4 py-2.5 sm:px-6 sm:py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Bot className="h-4 w-4" /></span>
        <CardTitle className="min-w-0 truncate text-base sm:text-lg">Chat with the Factory Assistant</CardTitle>
        <div className="ml-auto flex items-center gap-2">
          {exchanges.length > 0 && <Badge variant="secondary" className="hidden whitespace-nowrap sm:inline-flex">{exchanges.length} question{exchanges.length === 1 ? "" : "s"}</Badge>}
          <Badge variant="outline" className="gap-1.5 border-emerald-500/40 px-2 py-1 text-emerald-600 dark:text-emerald-400"><span className="h-2 w-2 rounded-full bg-emerald-500 " />Available</Badge>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <section aria-label="Conversation" aria-live="polite" aria-busy={ask.isPending} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-7">
          {exchanges.length === 0 ? <div className="flex min-h-full flex-col justify-end gap-5">
            <div className="max-w-2xl rounded-lg rounded-bl-md border border-primary/35 bg-muted/30 px-5 py-4 text-sm leading-6 sm:text-base">I can help with gateway connectivity, AAS assets, telemetry, incidents, and dashboard workflows. What would you like to check?</div>
            <div><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Suggested questions</p><div className="flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((suggestion) => <button key={suggestion} type="button" disabled={ask.isPending} onClick={() => void submit(undefined, suggestion)} className="rounded-full border bg-background px-4 py-2 text-left text-xs transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:text-sm">{suggestion}</button>)}
            </div></div>
          </div> : <div className="space-y-6">
            {exchanges.map((exchange, index) => <article key={`${index}-${exchange.question}`} className="space-y-3">
              <div className="flex items-start justify-end gap-2.5"><div className="max-w-[88%] rounded-lg rounded-br-md border border-border bg-primary/10 px-5 py-3 text-sm leading-6">{exchange.question}</div><UserRound className="mt-3 h-4 w-4 shrink-0 text-muted-foreground" /></div>
              <Card className="max-w-[94%] gap-0 overflow-hidden rounded-lg rounded-tl-md border-border sm:max-w-[88%]">
                <CardHeader className="flex flex-row items-center gap-3 border-b bg-muted/15 px-5 py-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Bot className="h-4 w-4" /></span>
                  <div className="min-w-0"><CardTitle className="text-sm">Answer</CardTitle><CardDescription>Smart Factory Assistant</CardDescription></div>
                  <time className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground" dateTime={exchange.result.contextAt} title={new Date(exchange.result.contextAt).toLocaleString()}><Clock3 className="h-3.5 w-3.5" /><span className="hidden sm:inline">Snapshot · </span>{new Date(exchange.result.contextAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
                </CardHeader>
                <CardContent className="px-5 py-5 sm:px-6"><div data-testid="assistant-answer-content" className="min-w-0 text-sm"><SafeMarkdown>{answerBody(exchange.result.answer)}</SafeMarkdown></div></CardContent>
                <SourceDisclosure sources={exchange.result.sources} />
              </Card>
            </article>)}
            {ask.isPending && <div role="status" className="flex items-center gap-3 text-sm text-muted-foreground"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10"><LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin text-primary" /></span>Thinking…</div>}
            <div ref={conversationEndRef} />
          </div>}
        </section>

        <form onSubmit={(event) => void submit(event)} className="border-t bg-background/70 p-4 backdrop-blur sm:p-6">
          <div className="rounded-2xl border bg-background p-2 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
            <Textarea id="assistant-question" aria-label="Ask the Smart Factory Assistant" aria-invalid={questionTooLong || undefined} aria-describedby={questionTooLong ? "assistant-question-limit" : undefined} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} rows={3} placeholder="Ask about your factory…" className="min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0" />
            <div className="flex flex-col gap-2 border-t px-1 pt-2 sm:flex-row sm:items-center">
              <Select value={selectedAssetId} onValueChange={setSelectedAssetId}><SelectTrigger id="assistant-asset-context" aria-label="Assistant asset context" className="h-9 min-w-0 flex-1 border-0 bg-muted/50 shadow-none sm:max-w-72"><SelectValue placeholder="Automatic asset context" /></SelectTrigger><SelectContent><SelectItem value="automatic">Automatic asset context</SelectItem>{assets.map((asset) => <SelectItem key={asset.assetId} value={asset.assetId}>{asset.name}{asset.isDemo ? " · simulated" : ""}</SelectItem>)}</SelectContent></Select>
              <div className="ml-auto flex items-center gap-3">{questionTooLong && <p id="assistant-question-limit" role="alert" className="text-xs text-destructive">Max 500 characters</p>}<Button type="submit" aria-label="Ask" disabled={ask.isPending || questionTooLong || question.trim().length < 3} className="min-w-28 rounded-full">{ask.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{ask.isPending ? "Thinking…" : "Send"}</Button></div>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  </div>;
}
