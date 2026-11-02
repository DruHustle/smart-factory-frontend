/** Categories distinguish a recorded review from the separate technician assignment. */
export const incidentNoteCategories = [
  "note",
  "finding",
  "next_step",
  "outcome",
] as const;
export type IncidentNoteCategory = (typeof incidentNoteCategories)[number];

export const incidentNoteLabels: Record<IncidentNoteCategory, string> = {
  note: "Review note",
  finding: "Finding",
  next_step: "Next step",
  outcome: "Outcome",
};

export function incidentNoteLabel(category: unknown): string {
  return typeof category === "string" &&
    Object.prototype.hasOwnProperty.call(incidentNoteLabels, category)
    ? incidentNoteLabels[category as IncidentNoteCategory]
    : incidentNoteLabels.note;
}
