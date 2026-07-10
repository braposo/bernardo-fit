// Shared analysis call — used by both the public /api/analyze endpoint
// and the admin regenerate endpoint, so the Anthropic call + JSON parsing
// only lives in one place.

import { buildSystemPrompt } from "./_profile.js";

export async function runAnalysis(jobDescription) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error("Server is missing ANTHROPIC_API_KEY."), { status: 500 });
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      system: buildSystemPrompt(),
      messages: [
        {
          role: "user",
          content: `Here's the job description. Write my fit analysis:\n\n${jobDescription}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error("Analysis service error"), { status: 502, detail: text.slice(0, 500) });
  }

  const data = await response.json();
  if (data.stop_reason === "max_tokens") {
    console.error("Model response hit max_tokens before completing.");
  }
  const raw = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  let clean = raw.replace(/```json|```/g, "").trim();
  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    clean = clean.slice(first, last + 1);
  }

  try {
    return JSON.parse(clean);
  } catch {
    console.error("Failed to parse model output as JSON:", raw);
    throw Object.assign(new Error("Could not parse the analysis. Try again."), { status: 502 });
  }
}
