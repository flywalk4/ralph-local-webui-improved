#!/usr/bin/env bun
/**
 * Ralph Wiggum Dashboard — Bun HTTP server for monitoring & intervention
 * Serves a minimal HTML UI (no client-side JS, pure forms).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// ─── Path helpers ───────────────────────────────────────────────────────────

function stateDir(cwd: string): string { return join(cwd, ".ralph"); }
function statePath(cwd: string): string { return join(stateDir(cwd), "ralph-loop.state.json"); }
function historyPath(cwd: string): string { return join(stateDir(cwd), "ralph-history.json"); }
function contextPath(cwd: string): string { return join(stateDir(cwd), "ralph-context.md"); }
function planPath(cwd: string): string { return join(cwd, "IMPLEMENTATION_PLAN.md"); }
function activityPath(cwd: string): string { return join(cwd, "activity.md"); }

// README is always read from the ralph package directory, not the project cwd.
// This way the dashboard always shows ralph's own docs regardless of what project
// you're running it from.
const RALPH_README_PATH = join(import.meta.dir, "README.md");

// ─── Data loaders ────────────────────────────────────────────────────────────

function loadState(cwd: string): Record<string, unknown> | null {
  const p = statePath(cwd);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
}

function loadHistory(cwd: string): Record<string, unknown> | null {
  const p = historyPath(cwd);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
}

function loadContext(cwd: string): string {
  const p = contextPath(cwd);
  if (!existsSync(p)) return "";
  try { return readFileSync(p, "utf-8").trim(); } catch { return ""; }
}

function readFileSafe(path: string): string {
  if (!existsSync(path)) return "";
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

function lastNLines(text: string, n: number): string {
  return text.split("\n").slice(-n).join("\n");
}

// ─── Markdown → HTML ─────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Process inline Markdown: code spans, images (alt only), links, bold, italic.
 * Escapes HTML in text content first so user content can't inject markup.
 */
function inlineMarkdown(raw: string): string {
  let s = escapeHtml(raw);

  // Protect inline code from further processing
  const codeSpans: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_, code) => {
    const idx = codeSpans.length;
    codeSpans.push(`<code>${code}</code>`);
    return `\x00CODE${idx}\x00`;
  });

  // Images → show alt text only (no broken external image requests)
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => alt ? `<em>${alt}</em>` : "");

  // Links → open in new tab
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    (_, text, href) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`);

  // Bold + italic: ***text***
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  // Bold: **text**
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic: *text* (avoid false positives on bullet items)
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");

  // Restore code spans
  s = s.replace(/\x00CODE(\d+)\x00/g, (_, idx) => codeSpans[parseInt(idx)]);

  return s;
}

/**
 * Full Markdown → HTML renderer used for the README.
 * Handles: HTML passthrough, fenced code blocks, tables, ordered/unordered
 * lists (including indented sublists), headings, horizontal rules, links,
 * images (alt text only), bold, italic, inline code.
 */
function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];

  let inCode = false;
  let inHtmlBlock = false;
  let inTable = false;
  let tableHeaderDone = false;
  let inUl = false;
  let inOl = false;

  function closeContainers() {
    if (inUl)    { out.push("</ul>");          inUl = false; }
    if (inOl)    { out.push("</ol>");          inOl = false; }
    if (inTable) { out.push("</tbody></table>"); inTable = false; tableHeaderDone = false; }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // ── Fenced code block ───────────────────────────────────────────────────
    if (trimmed.startsWith("```")) {
      if (inCode) {
        out.push("</code></pre>");
        inCode = false;
      } else {
        closeContainers();
        inHtmlBlock = false;
        out.push("<pre><code>");
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      out.push(escapeHtml(line));
      continue;
    }

    // ── Blank line ──────────────────────────────────────────────────────────
    if (trimmed === "") {
      closeContainers();
      inHtmlBlock = false;
      out.push("");
      continue;
    }

    // ── HTML passthrough block ──────────────────────────────────────────────
    // The ralph README uses <p align="center">, badge <img> tags, etc.
    // Pass these through as-is; replace <img> with alt text to avoid broken images.
    if (trimmed.startsWith("<") || inHtmlBlock) {
      closeContainers();
      inHtmlBlock = true;
      // Replace external images with their alt text
      const safe = line.replace(/<img([^>]*)>/gi, (_, attrs) => {
        const alt = attrs.match(/alt="([^"]*)"/i)?.[1] ?? "";
        return alt ? `<em>${escapeHtml(alt)}</em>` : "";
      });
      out.push(safe);
      continue;
    }

    // ── Horizontal rule ─────────────────────────────────────────────────────
    if (/^[-*_]{3,}$/.test(trimmed)) {
      closeContainers();
      out.push("<hr>");
      continue;
    }

    // ── Headings ─────────────────────────────────────────────────────────────
    const headingMatch = trimmed.match(/^(#{1,4}) (.+)/);
    if (headingMatch) {
      closeContainers();
      const level = headingMatch[1].length;
      out.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    // ── Table row ─────────────────────────────────────────────────────────────
    if (trimmed.startsWith("|")) {
      // Separator row: |---|---| — skip it (we already emitted </thead><tbody>)
      if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
        if (inTable && !tableHeaderDone) {
          tableHeaderDone = true;
        }
        continue;
      }

      const cells = trimmed.slice(1, trimmed.endsWith("|") ? -1 : undefined)
        .split("|")
        .map(c => c.trim());

      if (!inTable) {
        closeContainers();
        out.push('<table><thead><tr>');
        out.push(cells.map(c => `<th>${inlineMarkdown(c)}</th>`).join(""));
        out.push('</tr></thead><tbody>');
        inTable = true;
        tableHeaderDone = false;
        // Peek ahead: skip separator row
        if (lines[i + 1] && /^\|[\s\-:|]+\|$/.test(lines[i + 1].trim())) {
          i++;
          tableHeaderDone = true;
        }
      } else {
        out.push("<tr>" + cells.map(c => `<td>${inlineMarkdown(c)}</td>`).join("") + "</tr>");
      }
      continue;
    } else if (inTable) {
      // Non-table line closes the table
      out.push("</tbody></table>");
      inTable = false;
      tableHeaderDone = false;
    }

    // ── Unordered list (top-level and indented) ──────────────────────────────
    const ulMatch = line.match(/^(\s*)[-*+] (.+)/);
    if (ulMatch) {
      const indent = ulMatch[1].length;
      const content = inlineMarkdown(ulMatch[2]);
      if (inOl) { out.push("</ol>"); inOl = false; }
      if (!inUl) { out.push("<ul>"); inUl = true; }
      if (indent >= 2) {
        out.push(`<li style="margin-left:${indent * 6}px">${content}</li>`);
      } else {
        out.push(`<li>${content}</li>`);
      }
      continue;
    }

    // ── Ordered list ─────────────────────────────────────────────────────────
    const olMatch = line.match(/^(\s*)\d+\. (.+)/);
    if (olMatch) {
      const indent = olMatch[1].length;
      const content = inlineMarkdown(olMatch[2]);
      if (inUl) { out.push("</ul>"); inUl = false; }
      if (!inOl) { out.push("<ol>"); inOl = true; }
      if (indent >= 2) {
        out.push(`<li style="margin-left:${indent * 6}px">${content}</li>`);
      } else {
        out.push(`<li>${content}</li>`);
      }
      continue;
    }

    // Close any open list/table if we hit a plain paragraph
    closeContainers();

    // ── Paragraph ─────────────────────────────────────────────────────────────
    out.push(`<p>${inlineMarkdown(trimmed)}</p>`);
  }

  closeContainers();
  if (inCode) out.push("</code></pre>");

  return out.join("\n");
}

/** Simpler variant used for agent-generated plan/activity files (no HTML passthrough). */
function simpleMarkdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inCode = false;
  let inUl = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCode) { out.push("</code></pre>"); inCode = false; }
      else { if (inUl) { out.push("</ul>"); inUl = false; } out.push("<pre><code>"); inCode = true; }
      continue;
    }
    if (inCode) { out.push(escapeHtml(line)); continue; }
    if (inUl && !/^[-*] /.test(trimmed)) { out.push("</ul>"); inUl = false; }

    if (/^#{1,4} /.test(trimmed)) {
      const lvl = trimmed.match(/^(#+)/)?.[1].length ?? 2;
      out.push(`<h${lvl}>${inlineMarkdown(trimmed.replace(/^#+\s/, ""))}</h${lvl}>`);
    } else if (/^[-*] /.test(trimmed)) {
      if (!inUl) { out.push("<ul>"); inUl = true; }
      out.push(`<li>${inlineMarkdown(trimmed.slice(2))}</li>`);
    } else if (trimmed === "" || /^[-*_]{3,}$/.test(trimmed)) {
      out.push(trimmed === "" ? "" : "<hr>");
    } else {
      out.push(`<p>${inlineMarkdown(trimmed)}</p>`);
    }
  }
  if (inCode) out.push("</code></pre>");
  if (inUl) out.push("</ul>");
  return out.join("\n");
}

// ─── HTML layout ─────────────────────────────────────────────────────────────

function htmlPage(title: string, body: string, activePath = ""): string {
  const navLink = (href: string, label: string) =>
    `<a href="${href}" ${activePath === href ? 'style="color:#f0f6fc;font-weight:bold;border-bottom:2px solid #58a6ff;padding-bottom:2px"' : ""}>${label}</a>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — Ralph Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0d1117; color: #c9d1d9; line-height: 1.6; }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    nav { background: #161b22; border-bottom: 1px solid #30363d; padding: 12px 24px;
          display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
    nav strong { color: #f0f6fc; margin-right: 4px; font-size: 1.1em; }
    nav .sep { color: #30363d; }
    main { max-width: 960px; margin: 32px auto; padding: 0 24px 48px; }
    h1, h2, h3, h4 { color: #f0f6fc; margin: 24px 0 10px; }
    h1 { font-size: 1.6em; }
    h2 { font-size: 1.25em; border-bottom: 1px solid #30363d; padding-bottom: 6px; margin-top: 32px; }
    h3 { font-size: 1.05em; margin-top: 20px; }
    h4 { font-size: 0.95em; margin-top: 16px; color: #8b949e; }
    p { margin: 8px 0; }
    ul, ol { margin: 8px 0 8px 24px; }
    li { margin: 4px 0; }
    hr { border: none; border-top: 1px solid #30363d; margin: 24px 0; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 0.9em; }
    th { background: #161b22; color: #f0f6fc; padding: 8px 12px; border: 1px solid #30363d; text-align: left; }
    td { padding: 7px 12px; border: 1px solid #21262d; }
    tr:nth-child(even) td { background: #161b22; }
    pre { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 16px;
          overflow-x: auto; font-size: 0.85em; white-space: pre-wrap; margin: 12px 0; }
    code { background: #161b22; padding: 2px 6px; border-radius: 4px; font-size: 0.88em; }
    pre code { background: none; padding: 0; font-size: inherit; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold; }
    .badge-green { background: #1f6feb; color: #fff; }
    .badge-gray  { background: #30363d; color: #8b949e; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin: 16px 0; }
    .card-row { display: flex; gap: 8px; margin: 6px 0; }
    .card-label { color: #8b949e; min-width: 160px; font-size: 0.9em; }
    .card-value { color: #c9d1d9; }
    textarea { width: 100%; min-height: 120px; background: #161b22; border: 1px solid #30363d;
               border-radius: 6px; color: #c9d1d9; padding: 10px; font-family: monospace;
               font-size: 0.9em; resize: vertical; }
    button[type=submit] { margin-top: 12px; padding: 8px 20px; background: #238636; border: none;
                          border-radius: 6px; color: #fff; cursor: pointer; font-size: 0.95em; }
    button[type=submit]:hover { background: #2ea043; }
    .iter-row { display: flex; gap: 12px; font-size: 0.85em; padding: 6px 0; border-bottom: 1px solid #21262d; }
    .iter-num  { color: #8b949e; min-width: 36px; }
    .success   { color: #3fb950; }
    .failure   { color: #f85149; }
    .empty-state { color: #8b949e; font-style: italic; padding: 16px 0; }
    /* README-specific overrides */
    .readme-body p[align=center], .readme-body div[align=center] { text-align: center; }
    .readme-body h1[align=center], .readme-body h3[align=center] { text-align: center; }
    .readme-body p { margin: 10px 0; }
    details summary { cursor: pointer; color: #8b949e; }
  </style>
</head>
<body>
  <nav>
    <strong>🎠 Ralph</strong>
    <span class="sep">|</span>
    ${navLink("/status", "Status")}
    ${navLink("/plan", "Plan")}
    ${navLink("/activity", "Activity")}
    ${navLink("/logs", "Logs")}
    ${navLink("/intervene", "Intervene")}
    ${navLink("/readme", "Docs")}
  </nav>
  <main>
    ${body}
  </main>
</body>
</html>`;
}

// ─── Route handlers ──────────────────────────────────────────────────────────

function routeStatus(cwd: string): string {
  const state = loadState(cwd);
  const history = loadHistory(cwd);

  let statusBadge = `<span class="badge badge-gray">No active loop</span>`;
  let stateHtml = `<p class="empty-state">No active Ralph loop detected.</p>`;

  if (state && state.active) {
    const started = String(state.startedAt ?? "");
    const elapsed = started ? Math.floor((Date.now() - new Date(started).getTime()) / 1000) : 0;
    const elapsedStr = elapsed > 3600
      ? `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`
      : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

    statusBadge = `<span class="badge badge-green">ACTIVE</span>`;
    stateHtml = `
      <div class="card">
        <div class="card-row"><span class="card-label">Iteration</span><span class="card-value">${escapeHtml(String(state.iteration ?? "?"))}${state.maxIterations ? ` / ${state.maxIterations}` : " (unlimited)"}</span></div>
        <div class="card-row"><span class="card-label">Started</span><span class="card-value">${escapeHtml(started)}</span></div>
        <div class="card-row"><span class="card-label">Elapsed</span><span class="card-value">${elapsedStr}</span></div>
        <div class="card-row"><span class="card-label">Agent</span><span class="card-value">${escapeHtml(String(state.agent ?? "unknown"))}</span></div>
        ${state.model   ? `<div class="card-row"><span class="card-label">Model</span><span class="card-value">${escapeHtml(String(state.model))}</span></div>` : ""}
        ${state.baseUrl ? `<div class="card-row"><span class="card-label">Base URL</span><span class="card-value">${escapeHtml(String(state.baseUrl))}</span></div>` : ""}
        <div class="card-row"><span class="card-label">Completion Promise</span><span class="card-value"><code>${escapeHtml(String(state.completionPromise ?? "COMPLETE"))}</code></span></div>
        ${state.tasksMode ? `<div class="card-row"><span class="card-label">Tasks Mode</span><span class="card-value"><span class="badge badge-green">ENABLED</span></span></div>` : ""}
        ${state.planMode  ? `<div class="card-row"><span class="card-label">Plan Mode</span><span class="card-value"><span class="badge badge-green">ENABLED</span></span></div>` : ""}
        <div class="card-row"><span class="card-label">Prompt</span><span class="card-value">${escapeHtml(String(state.prompt ?? "").substring(0, 120))}${String(state.prompt ?? "").length > 120 ? "…" : ""}</span></div>
      </div>`;
  }

  let historyHtml = `<p class="empty-state">No iteration history yet.</p>`;
  if (history && Array.isArray((history as { iterations?: unknown[] }).iterations)) {
    const iters = (history as { iterations: Record<string, unknown>[] }).iterations.slice(-10).reverse();
    if (iters.length > 0) {
      historyHtml = iters.map(it => {
        const sec = Math.floor(Number(it.durationMs ?? 0) / 1000);
        const dur = sec > 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`;
        const ok = it.completionDetected;
        const tools = Object.entries(it.toolsUsed as Record<string, number> ?? {})
          .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}(${v})`).join(" ") || "—";
        return `<div class="iter-row">
          <span class="iter-num">#${it.iteration}</span>
          <span style="min-width:70px">${dur}</span>
          <span class="${ok ? "success" : "failure"}" style="min-width:20px">${ok ? "✓" : "✗"}</span>
          <span style="color:#8b949e">${escapeHtml(tools)}</span>
        </div>`;
      }).join("\n");
    }
  }

  return htmlPage("Status", `
    <h1>Loop Status ${statusBadge}</h1>
    ${stateHtml}
    <h2>Recent Iterations</h2>
    ${historyHtml}
  `, "/status");
}

function routePlan(cwd: string): string {
  const p = planPath(cwd);
  if (!existsSync(p)) {
    return htmlPage("Plan", `<h1>IMPLEMENTATION_PLAN.md</h1>
      <p class="empty-state">No <code>IMPLEMENTATION_PLAN.md</code> found in project root.
      Run ralph with <code>--plan</code> to have the agent create one.</p>`, "/plan");
  }
  const content = readFileSafe(p);
  return htmlPage("Plan",
    `<h1>IMPLEMENTATION_PLAN.md</h1><div class="card">${simpleMarkdownToHtml(content)}</div>`,
    "/plan");
}

function routeActivity(cwd: string): string {
  const p = activityPath(cwd);
  if (!existsSync(p)) {
    return htmlPage("Activity", `<h1>activity.md</h1>
      <p class="empty-state">No <code>activity.md</code> found.
      Run ralph with <code>--plan</code> to have the agent create it.</p>`, "/activity");
  }
  const content = lastNLines(readFileSafe(p), 100);
  return htmlPage("Activity",
    `<h1>activity.md <small style="color:#8b949e;font-size:0.7em">(last 100 lines)</small></h1>
     <pre>${escapeHtml(content)}</pre>`,
    "/activity");
}

function routeLogs(cwd: string): string {
  const history = loadHistory(cwd);
  if (!history || !Array.isArray((history as { iterations?: unknown[] }).iterations)) {
    return htmlPage("Logs", `<h1>Iteration Logs</h1><p class="empty-state">No history yet.</p>`, "/logs");
  }
  const iters = (history as { iterations: Record<string, unknown>[] }).iterations.slice(-10).reverse();
  if (iters.length === 0) {
    return htmlPage("Logs", `<h1>Iteration Logs</h1><p class="empty-state">No iterations recorded.</p>`, "/logs");
  }

  const cards = iters.map(it => {
    const sec = Math.floor(Number(it.durationMs ?? 0) / 1000);
    const dur = sec > 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`;
    const tools = JSON.stringify(it.toolsUsed ?? {}, null, 2);
    const files = Array.isArray(it.filesModified) ? (it.filesModified as string[]).join(", ") || "none" : "none";
    const errors = Array.isArray(it.errors) ? (it.errors as string[]).join("\n") : "";
    return `<div class="card">
      <h3>Iteration #${it.iteration}
        <span class="${it.completionDetected ? "success" : "failure"}">
          ${it.completionDetected ? "✓ completed" : "✗ not completed"}
        </span>
      </h3>
      <div class="card-row"><span class="card-label">Duration</span><span class="card-value">${dur}</span></div>
      <div class="card-row"><span class="card-label">Agent / Model</span><span class="card-value">${escapeHtml(String(it.agent ?? "?"))} / ${escapeHtml(String(it.model ?? "?"))}</span></div>
      <div class="card-row"><span class="card-label">Exit Code</span><span class="card-value">${it.exitCode}</span></div>
      <div class="card-row"><span class="card-label">Files Modified</span><span class="card-value">${escapeHtml(files)}</span></div>
      ${errors ? `<div class="card-row"><span class="card-label">Errors</span><span class="card-value"><pre style="margin:0">${escapeHtml(errors)}</pre></span></div>` : ""}
      <details style="margin-top:12px"><summary>Tool usage</summary><pre>${escapeHtml(tools)}</pre></details>
    </div>`;
  }).join("\n");

  return htmlPage("Logs",
    `<h1>Iteration Logs <small style="color:#8b949e;font-size:0.7em">(last 10)</small></h1>${cards}`,
    "/logs");
}

function routeInterveneGet(cwd: string): string {
  const current = loadContext(cwd);
  const currentHtml = current
    ? `<div class="card"><h3>Pending context (injected into next iteration):</h3><pre>${escapeHtml(current)}</pre></div>`
    : `<p class="empty-state">No pending context note.</p>`;

  return htmlPage("Intervene", `
    <h1>Intervene</h1>
    <p>Add a note to <code>.ralph/ralph-context.md</code> — it will be injected into
       the next iteration's prompt, then cleared automatically.</p>
    ${currentHtml}
    <div class="card">
      <form method="POST" action="/intervene">
        <label for="ctx"><strong>Context note:</strong></label><br><br>
        <textarea name="context" id="ctx"
          placeholder="e.g. The test failure is in tests/auth.test.ts line 42. Try the singleton pattern."
          >${escapeHtml(current)}</textarea>
        <button type="submit">Save context</button>
      </form>
    </div>
  `, "/intervene");
}

async function routeIntervenePost(req: Request, cwd: string): Promise<Response> {
  let body = "";
  try { body = await req.text(); } catch { return new Response("Bad request", { status: 400 }); }
  const context = new URLSearchParams(body).get("context") ?? "";
  const dir = stateDir(cwd);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ralph-context.md"), context.trim());
  return new Response(null, { status: 302, headers: { Location: "/intervene" } });
}

function routeReadme(): string {
  if (!existsSync(RALPH_README_PATH)) {
    return htmlPage("Docs", `
      <h1>README not found</h1>
      <p class="empty-state">Could not find <code>README.md</code> at:<br>
        <code>${escapeHtml(RALPH_README_PATH)}</code>
      </p>`, "/readme");
  }

  const raw = readFileSafe(RALPH_README_PATH);
  const body = `
    <div class="readme-body">
      <p style="color:#8b949e;font-size:0.85em;margin-bottom:24px">
        Source: <code>${escapeHtml(RALPH_README_PATH)}</code>
      </p>
      ${markdownToHtml(raw)}
    </div>`;

  return htmlPage("Docs", body, "/readme");
}

// ─── Server ───────────────────────────────────────────────────────────────────

export async function startDashboard(port: number, openBrowser: boolean, cwd: string): Promise<void> {
  const server = Bun.serve({
    port,
    async fetch(req: Request): Promise<Response> {
      const path = new URL(req.url).pathname;
      const html = (s: string) => new Response(s, { headers: { "Content-Type": "text/html; charset=utf-8" } });

      if (path === "/" || path === "")    return new Response(null, { status: 302, headers: { Location: "/status" } });
      if (path === "/status")             return html(routeStatus(cwd));
      if (path === "/plan")               return html(routePlan(cwd));
      if (path === "/activity")           return html(routeActivity(cwd));
      if (path === "/logs")               return html(routeLogs(cwd));
      if (path === "/readme")             return html(routeReadme());
      if (path === "/intervene") {
        if (req.method === "POST") return routeIntervenePost(req, cwd);
        return html(routeInterveneGet(cwd));
      }
      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║           Ralph Dashboard running                               ║`);
  console.log(`║  http://localhost:${port}${" ".repeat(Math.max(0, 46 - String(port).length))}║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝`);
  console.log(`  /status    — active loop state & iteration history`);
  console.log(`  /plan      — IMPLEMENTATION_PLAN.md viewer`);
  console.log(`  /activity  — activity.md log (last 100 lines)`);
  console.log(`  /logs      — detailed iteration logs`);
  console.log(`  /intervene — inject a context note into the next iteration`);
  console.log(`  /readme    — how ralph works, all commands & examples`);
  console.log(`\nPress Ctrl+C to stop.`);

  if (openBrowser) {
    const url = `http://localhost:${port}/status`;
    const cmd = process.platform === "win32" ? ["cmd", "/c", "start", url]
              : process.platform === "darwin" ? ["open", url]
              : ["xdg-open", url];
    try { Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }); } catch { /* best-effort */ }
  }

  await new Promise<void>(() => {
    process.on("SIGINT", () => { server.stop(); console.log("\nDashboard stopped."); process.exit(0); });
  });
}
