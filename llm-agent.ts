#!/usr/bin/env bun
/**
 * llm-agent.ts — Built-in LLM agent for Ralph Wiggum.
 *
 * Calls any OpenAI-compatible API directly (Ollama, LM Studio, Groq, OpenAI, etc.),
 * parses <file path="..."> blocks from the response, writes them to disk, and
 * outputs clean text to stdout so Ralph can detect the completion promise.
 *
 * Usage:
 *   bun llm-agent.ts --message PROMPT [--model MODEL] [--base-url URL]
 *
 * Environment:
 *   OPENAI_API_KEY   API key (defaults to "local" for local servers)
 *   OPENAI_BASE_URL  Base URL override (overridden by --base-url flag)
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";

// ── Parse CLI arguments ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
let message = "";
let model = "";
let baseUrl = "";
let optimizeMode = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--message") {
    message = args[++i] ?? "";
  } else if (arg === "--model") {
    model = args[++i] ?? "";
  } else if (arg === "--base-url") {
    baseUrl = args[++i] ?? "";
  } else if (arg === "--optimize") {
    optimizeMode = true;
  }
}

if (!message) {
  console.error("Error: --message is required");
  process.exit(1);
}

// ── Resolve base URL ─────────────────────────────────────────────────────────

// Precedence: --base-url flag > OPENAI_BASE_URL env > default
const resolvedBase = (baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com")
  .replace(/\/+$/, ""); // strip trailing slash

// Ensure the path ends with /v1
const apiBase = resolvedBase.endsWith("/v1") ? resolvedBase : `${resolvedBase}/v1`;

const resolvedModel = model || process.env.OPENAI_MODEL || "gpt-4o";
const apiKey = process.env.OPENAI_API_KEY || "local";

// ── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert software engineer working inside an autonomous coding loop.
Your job is to read the task description and implement the required changes.

## How to output file edits

When you need to create or modify a file, use this exact format:

<file path="relative/path/to/file">
file contents here
</file>

Rules for file outputs:
- Paths must be relative to the current working directory (project root)
- Always output the COMPLETE file contents — not diffs or partial edits
- You may output as many files as needed
- The system will automatically write them to disk

## How to signal completion

After finishing your work, output the completion signal that was included in the prompt.
It will look like: <promise>TOKEN</promise>

Do NOT output the completion token early — only emit it when all work is genuinely done.

## Format notes

- Use markdown for explanations and summaries
- Do not use any other XML-like tags besides <file> and <promise> — they will be misinterpreted`;

// Stripped-down system prompt for small/weak models — fewer rules = less confusion
const SYSTEM_PROMPT_OPTIMIZED = `Complete the coding task given by the user.

To write a file use this format:
<file path="relative/path">
file contents here
</file>

Output the completion signal from the task when you are done. Do not output it early.`;

// ── Call the API ─────────────────────────────────────────────────────────────

const endpoint = `${apiBase}/chat/completions`;
let responseText = "";

try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: resolvedModel,
      messages: [
        { role: "system", content: optimizeMode ? SYSTEM_PROMPT_OPTIMIZED : SYSTEM_PROMPT },
        { role: "user", content: message },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`API error (HTTP ${response.status}): ${body}`);
    process.exit(1);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message: string };
  };

  if (data.error) {
    console.error(`API error: ${data.error.message}`);
    process.exit(1);
  }

  responseText = data.choices?.[0]?.message?.content ?? "";
} catch (err) {
  console.error(`Failed to connect to ${endpoint}: ${err}`);
  process.exit(1);
}

// ── Parse and apply <file> blocks ────────────────────────────────────────────

const FILE_BLOCK_RE = /<file\s+path="([^"]+)">([\s\S]*?)<\/file>/g;
let blockMatch: RegExpExecArray | null;

while ((blockMatch = FILE_BLOCK_RE.exec(responseText)) !== null) {
  const [, filePath, rawContent] = blockMatch;
  // Strip a single leading newline that models commonly add after the opening tag
  const content = rawContent.replace(/^\n/, "");
  const fullPath = resolve(process.cwd(), filePath);
  try {
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
    // Emit a marker line so Ralph's parseToolOutput can pick it up
    process.stdout.write(`[file] ${filePath}\n`);
  } catch (err) {
    console.error(`Failed to write ${filePath}: ${err}`);
  }
}

// ── Output clean text (file blocks removed) ──────────────────────────────────

const cleanText = responseText
  .replace(/<file\s+path="[^"]*">[\s\S]*?<\/file>/g, "")
  .trim();

if (cleanText) {
  process.stdout.write(cleanText + "\n");
}
