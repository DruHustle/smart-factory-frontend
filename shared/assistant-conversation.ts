import { metrics } from "./measurements";

type History = Array<{ role: "user" | "assistant"; content: string }>;

export function requestedAssistantMetric(question: string) {
  const current = question.split("\nConversation subject:")[0];
  const requested = (text: string) =>
    metrics.find((m) => new RegExp(`\\b${m}\\b`, "i").test(text));
  return requested(current) ?? requested(question);
}

// These aliases select reviewed guide sections; they never supply live facts.
export const conversationTopics = [
  { heading: "FX", aliases: /\b(?:fx|uafx|field exchange|fieldexchange)\b/i },
  { heading: "TSN", aliases: /\b(?:tsn|time[- ]sensitive networking)\b/i },
  { heading: "AAS", aliases: /\b(?:aas|asset administration shell)\b/i },
  { heading: "AASX", aliases: /\b(?:aasx)\b/i },
  { heading: "MQTT", aliases: /\b(?:mqtt)\b/i },
  { heading: "OPC UA", aliases: /\bopc[- ]?ua\b/i },
  { heading: "Gateway", aliases: /\bgateways?\b/i },
  { heading: "Telemetry", aliases: /\btelemetry\b/i },
  {
    heading: "Demo and Live data",
    aliases: /\b(?:demo|simulation|simulated|live data|live mode)\b/i,
  },
  {
    heading: "Incidents and acknowledgement",
    aliases:
      /\b(?:incidents?|alerts?|acknowledg(?:e|ement|ed|ing)|resolved?)\b/i,
  },
  {
    heading: "Unknown and stale status",
    aliases: /\b(?:unknown|stale|offline)\b/i,
  },
  { heading: "3D models", aliases: /\b(?:3d|digital twin|equipment model)\b/i },
  { heading: "Cybersecurity", aliases: /\b(?:cybersecurity|security)\b/i },
  ...metrics.map((metric) => ({
    heading: metric[0].toUpperCase() + metric.slice(1),
    aliases: new RegExp(`\\b${metric}\\b`, "i"),
  })),
] as const;

function normalized(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\bwhats\b/g, "what is")
    .replace(/\bwhat's\b/g, "what is")
    .replace(/\s+/g, " ");
}

export function isDefinitionQuestion(question: string) {
  const q = normalized(question);
  if (
    requestedAssistantMetric(q) &&
    !/^(?:please\s+)?(?:what (?:is|are)|define|explain|tell me about)\s+(?:the\s+)?(?:temperature|humidity|vibration|pressure|power|rpm)(?:\s+(?:mean|measurement|units?))?[?. ]*$/.test(
      q,
    ) &&
    !/\b(?:meaning|definition|difference between|measured in|unit of)\b/.test(q)
  )
    return false;
  return (
    /^(?:please\s+)?(?:what (?:is|are|does|do)\b|define\b|explain\b|tell me about\b|what.*\bmean\b|(?:what is the )?difference\b)/.test(
      q,
    ) &&
    !/\b(?:latest|current|right now|how many|reading|measurements?|value|need attention|status of|state of|our .* (?:status|state)|my .* (?:status|state))\b/.test(
      q,
    )
  );
}

export function planAssistantConversation(
  question: string,
  history: History = [],
  selectedAssetId?: string,
) {
  const q = normalized(question);
  const prior = history
    .slice(-12)
    .filter((m) => m.role === "user")
    .map((m) => m.content.slice(0, 1200))
    .reverse();
  const topicsFor = (text: string) => {
    const found = conversationTopics
      .filter(
        (t) =>
          t.aliases.test(text) &&
          (!metrics.some((m) => m === t.heading.toLowerCase()) ||
            isDefinitionQuestion(text)),
      )
      .map((t) => t.heading);
    return found.includes("FX") &&
      !/\b(?:compare|difference|versus|vs)\b/i.test(text)
      ? found.filter((t) => t !== "OPC UA")
      : found;
  };
  let topics: string[] = topicsFor(q);
  const style = /\b(?:example|analogy)\b/.test(q)
    ? "example"
    : /\b(?:tell me more|more detail|go deeper|in depth|technical detail)\b/.test(
          q,
        )
      ? "detail"
      : /\b(?:simple|simpler|simply|plain english|beginner|don't understand|doesn't make sense|not what i asked|rubbish)\b/.test(
            q,
          )
        ? "simple"
        : /\b(?:related|relationship|together|difference|both|same|compare)\b/.test(
              q,
            )
          ? "comparison"
          : /\b(?:our factory|our system|using it|using them|are we using|is (?:it|that) live|real hardware|physical)\b/.test(
                q,
              )
            ? "application"
            : "overview";
  const followup =
    /\b(?:it|that|this|they|them|those|both|one|same)\b/.test(q) ||
    /^(?:and\b|why\??$|how\??$|tell me more|go on|continue|give (?:me )?an? example|explain (?:more|simply)|in simple terms)/.test(
      q,
    ) ||
    style === "simple" ||
    style === "example";
  let previousQuestion: string | undefined;
  if (followup && topics.length === 0) {
    for (const item of prior) {
      const found = topicsFor(item);
      if (found.length) {
        topics = [...new Set([...topics, ...found])];
        previousQuestion ??= item;
        if (style !== "comparison" || topics.length >= 2) break;
      }
    }
    previousQuestion ??= prior.find(
      (item) => !/^(?:hi|hello|thanks|thank you)[!. ]*$/i.test(item.trim()),
    );
  }
  const resolvedQuestion = previousQuestion
    ? `${question}\nConversation subject: ${topics.length ? topics.join(" and ") : previousQuestion}`
    : question;
  const direct =
    /^(?:hi|hello|hey|good morning|good afternoon|good evening)[!.? ]*$/.test(q)
      ? "Hello! What would you like to understand about the factory? You can ask about equipment, FX and TSN, telemetry, or a task you want help with."
      : /^(?:thanks|thank you|cheers|great thanks|ok thanks)[!.? ]*$/.test(q)
        ? "You’re welcome. You can ask a follow-up about the same topic or start a new question."
        : /^(?:stop|start|restart|reset|shut down|emergency stop|turn (?:on|off))\b/.test(
              q,
            )
          ? "I can explain the approved procedure, but I can’t operate equipment or perform an emergency stop. Use the machine’s approved controls and site procedure for a physical action. Which equipment or procedure do you need help understanding?"
          : undefined;
  const procedure =
    /\b(?:how (?:(?:do|can|should) (?:i|we)|to)|steps|import|export|configure|install|provision|troubleshoot|investigate)\b/.test(
      q,
    );
  const operational =
    Boolean(requestedAssistantMetric(q) && !isDefinitionQuestion(q)) ||
    /\b(?:latest|current|right now|how many|readings?|measurements?|value|status|state|health|need(?:s)? attention|troubleshoot|investigate|why|our factory|our system)\b/.test(
      q,
    ) ||
    /\b(?:temperature|humidity|vibration|pressure|power|rpm)\b.*\b(?:of|on|for|from)\b/.test(
      q,
    );
  const contextualEvidence = previousQuestion && !topics.length;
  const selectedMeasurement =
    selectedAssetId &&
    requestedAssistantMetric(q) &&
    !/\b(?:define|explain|mean|meaning|definition|unit)\b/.test(q);
  const concept =
    !selectedMeasurement &&
    topics.length > 0 &&
    !procedure &&
    (isDefinitionQuestion(question) ||
      style !== "overview" ||
      (!operational && (followup || q.split(/\s+/).length <= 7)));
  return {
    resolvedQuestion,
    topics,
    style,
    direct,
    concept,
    includeEvidence:
      !direct &&
      !concept &&
      (operational ||
        Boolean(contextualEvidence) ||
        Boolean(selectedAssetId && !procedure)),
    needsSubject: followup && !topics.length && !previousQuestion,
  };
}
