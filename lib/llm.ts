import type { Diagnosis, Play } from "./types";

export function llmConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);
}

export type PolishInput = {
  customer: string;
  cause: string;
  narrative: string;
  script?: string;
  language: string;
};

export type PolishOutput = {
  narrative: string;
  script?: string;
  provider: "openai" | "gemini" | "template";
};

async function openaiPolish(input: PolishInput): Promise<PolishOutput | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content:
              "You rewrite collections diagnosis and Hinglish recovery scripts for India. Keep facts. Be warm, not threatening. JSON only: {\"narrative\":\"...\",\"script\":\"...\"}",
          },
          {
            role: "user",
            content: JSON.stringify(input),
          },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? "";
    const json = extractJson(text);
    if (!json) return null;
    return { narrative: json.narrative ?? input.narrative, script: json.script ?? input.script, provider: "openai" };
  } catch {
    return null;
  }
}

async function geminiPolish(input: PolishInput): Promise<PolishOutput | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Rewrite this collections diagnosis. Keep facts. Warm Hinglish script if present. JSON {"narrative","script"}.\n${JSON.stringify(input)}`,
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const json = extractJson(text);
    if (!json) return null;
    return { narrative: json.narrative ?? input.narrative, script: json.script ?? input.script, provider: "gemini" };
  } catch {
    return null;
  }
}

function extractJson(text: string): { narrative?: string; script?: string } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as { narrative?: string; script?: string };
  } catch {
    return null;
  }
}

export async function polishCopy(input: PolishInput): Promise<PolishOutput> {
  const fallback: PolishOutput = {
    narrative: input.narrative,
    script: input.script,
    provider: "template",
  };
  try {
    if (process.env.OPENAI_API_KEY) {
      const openai = await openaiPolish(input);
      if (openai) return openai;
    }
  } catch {
    /* try Gemini */
  }
  try {
    if (process.env.GEMINI_API_KEY) {
      return (await geminiPolish(input)) ?? fallback;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

export function polishInputFrom(diagnosis: Diagnosis, play?: Play, customer?: string, language?: string): PolishInput {
  return {
    customer: customer ?? "customer",
    cause: diagnosis.label,
    narrative: diagnosis.narrative,
    script: play?.script,
    language: language ?? "hinglish",
  };
}
