import { assistantLink } from "@shared/assistant";
import { Fragment, type ReactNode } from "react";

const inlineTokenPattern =
  /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|\/|#\/)[^)\s]+\)|\[\d{1,2}\])/g;

function inlineContent(
  value: string,
  keyPrefix: string,
  renderCitation?: (n: number) => ReactNode,
): ReactNode[] {
  return value
    .split(inlineTokenPattern)
    .filter(Boolean)
    .map((part, index) => {
      const key = `${keyPrefix}-${index}`;
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={key}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code
            key={key}
            className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      const citation = part.match(/^\[(\d{1,2})\]$/);
      if (citation && renderCitation)
        return (
          <Fragment key={key}>{renderCitation(Number(citation[1]))}</Fragment>
        );
      const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/),
        destination = link ? assistantLink(link[2]) : null;
      if (link && destination)
        return (
          <a
            key={key}
            href={
              destination.kind === "internal"
                ? `#${destination.href}`
                : destination.href
            }
            target={destination.kind === "external" ? "_blank" : undefined}
            rel={
              destination.kind === "external"
                ? "noopener noreferrer"
                : undefined
            }
            className="font-medium text-primary underline underline-offset-4"
          >
            {link[1]}
          </a>
        );
      return <Fragment key={key}>{part}</Fragment>;
    });
}

function startsNewBlock(line: string) {
  return (
    !line.trim() ||
    /^```/.test(line) ||
    /^#{1,3}\s+/.test(line) ||
    /^[-*]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    /^>\s?/.test(line)
  );
}

/**
 * Small, safe renderer for the markdown subset used by assistant responses.
 * It deliberately renders React nodes instead of injecting HTML and avoids
 * loading diagram, math, and syntax-highlighting runtimes into the dashboard.
 */
export function SafeMarkdown({
  children,
  renderCitation,
}: {
  children: string;
  renderCitation?: (n: number) => ReactNode;
}) {
  const lines = children.split(/\r?\n/);
  const blocks: ReactNode[] = [];

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([\w+-]*)\s*$/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += index < lines.length ? 1 : 0;
      blocks.push(
        <pre
          key={`code-${index}`}
          aria-label={fence[1] ? `${fence[1]} code example` : "Code example"}
          className="overflow-x-auto rounded-lg border bg-muted/50 p-3 text-xs leading-5"
        >
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const content = inlineContent(
        heading[2],
        `heading-${index}`,
        renderCitation,
      );
      const className = "font-semibold tracking-tight text-foreground";
      blocks.push(
        heading[1].length === 1 ? (
          <h3 key={`heading-${index}`} className={`${className} text-base`}>
            {content}
          </h3>
        ) : heading[1].length === 2 ? (
          <h4 key={`heading-${index}`} className={`${className} text-sm`}>
            {content}
          </h4>
        ) : (
          <h5 key={`heading-${index}`} className={`${className} text-sm`}>
            {content}
          </h5>
        ),
      );
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^[-*]\s+(.+)$/);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      blocks.push(
        <ul key={`list-${index}`} className="list-disc space-y-1 pl-5">
          {items.map((item, itemIndex) => (
            <li key={`${itemIndex}-${item}`}>
              {inlineContent(
                item,
                `list-${index}-${itemIndex}`,
                renderCitation,
              )}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\d+\.\s+(.+)$/);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      blocks.push(
        <ol key={`ordered-${index}`} className="list-decimal space-y-1 pl-5">
          {items.map((item, itemIndex) => (
            <li key={`${itemIndex}-${item}`}>
              {inlineContent(
                item,
                `ordered-${index}-${itemIndex}`,
                renderCitation,
              )}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote
          key={`quote-${index}`}
          className="border-l-2 border-primary/50 pl-3 text-muted-foreground"
        >
          {inlineContent(quote.join("\n"), `quote-${index}`, renderCitation)}
        </blockquote>,
      );
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && !startsNewBlock(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${index}`} className="whitespace-pre-wrap leading-6">
        {inlineContent(
          paragraph.join("\n"),
          `paragraph-${index}`,
          renderCitation,
        )}
      </p>,
    );
  }

  return <div className="space-y-3 break-words">{blocks}</div>;
}
