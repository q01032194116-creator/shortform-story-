/** JSON Schemas handed to `claude -p --json-schema`, which enforces the shape. */

const str = { type: "string" } as const;

export const topicsSchema = {
  type: "object",
  properties: {
    topics: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          title: str,
          angle: str,
          whyNow: str,
          targetKeyword: str,
          sourceIds: { type: "array", items: str },
          score: { type: "number" },
          competitionNote: str,
        },
        required: ["title", "angle", "whyNow", "targetKeyword", "sourceIds", "score", "competitionNote"],
        additionalProperties: false,
      },
    },
  },
  required: ["topics"],
  additionalProperties: false,
} as const;

export const outlineSchema = {
  type: "object",
  properties: {
    titleCandidates: { type: "array", minItems: 1, maxItems: 3, items: str },
    hook: str,
    sections: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          heading: str,
          points: { type: "array", minItems: 1, items: str },
          imageHint: str,
        },
        required: ["heading", "points", "imageHint"],
        additionalProperties: false,
      },
    },
    tags: { type: "array", minItems: 5, maxItems: 15, items: str },
  },
  required: ["titleCandidates", "hook", "sections", "tags"],
  additionalProperties: false,
} as const;

export const postSchema = {
  type: "object",
  properties: {
    title: str,
    blocks: {
      type: "array",
      minItems: 6,
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["heading", "paragraph", "quote", "list", "divider", "image"] },
          text: str,
          items: { type: "array", items: str },
          hint: str,
        },
        required: ["type"],
        additionalProperties: false,
      },
    },
    tags: { type: "array", minItems: 5, maxItems: 15, items: str },
  },
  required: ["title", "blocks", "tags"],
  additionalProperties: false,
} as const;

export const imageQuerySchema = {
  type: "object",
  properties: {
    queries: { type: "array", minItems: 1, maxItems: 4, items: str },
  },
  required: ["queries"],
  additionalProperties: false,
} as const;

export const imageVerdictSchema = {
  type: "object",
  properties: {
    score: { type: "number" },
    fits: { type: "boolean" },
    reason: str,
    altText: str,
    caption: str,
  },
  required: ["score", "fits", "reason", "altText", "caption"],
  additionalProperties: false,
} as const;
