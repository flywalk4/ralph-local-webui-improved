#!/usr/bin/env bun
/**
 * Ralph Wiggum Dashboard — Full-featured web UI for launching and monitoring Ralph loops.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync } from "fs";
import { join, resolve, dirname } from "path";

// ─── Path constants ───────────────────────────────────────────────────────────

const RALPH_README_PATH = join(import.meta.dir, "README.md");
const RALPH_SCRIPT_PATH = join(import.meta.dir, "ralph.ts");
const RALPH_LOGO_PATH   = join(import.meta.dir, "ralph-logo.png");

// ─── Path helpers ─────────────────────────────────────────────────────────────

function stateDir(cwd: string): string { return join(cwd, ".ralph"); }
function statePath(cwd: string): string { return join(stateDir(cwd), "ralph-loop.state.json"); }
function historyPath(cwd: string): string { return join(stateDir(cwd), "ralph-history.json"); }
function contextPath(cwd: string): string { return join(stateDir(cwd), "ralph-context.md"); }
function planPath(cwd: string): string { return join(cwd, "IMPLEMENTATION_PLAN.md"); }
function activityPath(cwd: string): string { return join(cwd, "activity.md"); }
function pidPath(cwd: string): string { return join(stateDir(cwd), "dashboard-pid.json"); }
function logPath(cwd: string): string { return join(stateDir(cwd), "ralph-output.log"); }

// ─── Data loaders ─────────────────────────────────────────────────────────────

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

/** Parse activity.md into sections [{heading, items[]}], newest first. */
function parseActivityMd(content: string): Array<{ heading: string; items: string[] }> {
  const sections: Array<{ heading: string; items: string[] }> = [];
  let current: { heading: string; items: string[] } | null = null;
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (/^#{1,3} /.test(t)) {
      if (current) sections.push(current);
      current = { heading: t.replace(/^#+\s*/, ""), items: [] };
    } else if (t.startsWith("- ") && current) {
      current.items.push(t.slice(2));
    } else if (t && current && !/^[-*_]{3,}$/.test(t)) {
      current.items.push(t);
    }
  }
  if (current) sections.push(current);
  // newest first — last section (most recent iteration) goes to top
  return sections.reverse();
}

/** Parse IMPLEMENTATION_PLAN.md into sections with task statuses.
 *  Preserves heading structure; tasks inside each section get done/active/pending. */
function parsePlanSections(content: string, isActive: boolean): {
  sections: Array<{
    heading: string;
    level: number;
    tasks: Array<{ text: string; status: "done" | "active" | "pending" }>;
    notes: string[];
  }>;
  total: number;
  done: number;
} {
  type Sec = { heading: string; level: number; tasks: Array<{ text: string; status: "done" | "active" | "pending" }>; notes: string[] };
  const sections: Sec[] = [];
  let current: Sec | null = null;
  let markedActive = false;

  for (const line of content.split("\n")) {
    const hm = line.match(/^(#{1,4})\s+(.+)/);
    const dm = line.match(/^\s*[-*]\s+\[x\]\s+(.+)/i);
    const tm = line.match(/^\s*[-*]\s+\[ \]\s+(.+)/);
    if (hm) {
      current = { heading: hm[2].trim(), level: hm[1].length, tasks: [], notes: [] };
      sections.push(current);
    } else if (dm) {
      if (!current) { current = { heading: "", level: 0, tasks: [], notes: [] }; sections.push(current); }
      current.tasks.push({ text: dm[1].trim(), status: "done" });
    } else if (tm) {
      if (!current) { current = { heading: "", level: 0, tasks: [], notes: [] }; sections.push(current); }
      const status: "active" | "pending" = isActive && !markedActive ? "active" : "pending";
      if (status === "active") markedActive = true;
      current.tasks.push({ text: tm[1].trim(), status });
    } else {
      const t = line.trim();
      if (t && current && !t.match(/^[-=*]{3,}$/) && !t.startsWith("```") && !t.startsWith("|")) {
        current.notes.push(t);
      }
    }
  }

  const allTasks = sections.flatMap(s => s.tasks);
  return { sections, total: allTasks.length, done: allTasks.filter(t => t.status === "done").length };
}

/** Render IMPLEMENTATION_PLAN.md content as a beautiful sectioned task list. */
function buildPlanContentHtml(planContent: string, isActive: boolean, archivedCycles: Array<{ cycle: number; content: string }>): string {
  const renderPlan = (content: string, active: boolean): string => {
    if (!content.trim()) return `<p class="empty-state">Plan file is empty.</p>`;
    const { sections, total, done } = parsePlanSections(content, active);
    if (total === 0) return `<div class="card plan-markdown">${simpleMarkdownToHtml(content)}</div>`;

    const pct = Math.round((done / total) * 100);
    const progressHtml = `
    <div class="progress-wrap">
      <div class="progress-meta">
        <span>Tasks complete: <strong>${done} / ${total}</strong></span>
        <strong>${pct}%</strong>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>`;

    const sectionsHtml = sections.map(sec => {
      if (sec.tasks.length === 0 && !sec.heading && sec.notes.length === 0) return "";
      const tag = sec.level <= 1 ? "h2" : sec.level === 2 ? "h3" : "h4";
      const headingHtml = sec.heading
        ? `<div class="plan-sec-heading level-${sec.level}"><${tag}>${escapeHtml(sec.heading)}</${tag}></div>` : "";
      const notesHtml = sec.notes.length
        ? `<p class="plan-sec-note">${sec.notes.map(n => escapeHtml(n)).join(" ")}</p>` : "";
      const tasksHtml = sec.tasks.map(t => {
        const icon = t.status === "done" ? "✓" : t.status === "active" ? "▶" : "○";
        const label = t.status === "done" ? "done" : t.status === "active" ? "in progress" : "pending";
        return `<div class="task-item ${t.status}">
          <div class="task-icon-wrap ${t.status}">${icon}</div>
          <span class="task-text">${escapeHtml(t.text)}</span>
          <span class="task-status-label">${label}</span>
        </div>`;
      }).join("");
      return `<div class="plan-section">
        ${headingHtml}${notesHtml}
        ${tasksHtml ? `<div class="task-list">${tasksHtml}</div>` : ""}
      </div>`;
    }).join("");

    return `${progressHtml}<div class="plan-sections">${sectionsHtml}</div>`;
  };

  const currentHtml = planContent
    ? renderPlan(planContent, isActive)
    : `<p class="empty-state">No <code>IMPLEMENTATION_PLAN.md</code> found. Run Ralph with <code>--plan</code> to have the agent create one.</p>`;

  const archivedHtml = archivedCycles.length > 0
    ? archivedCycles.map(a => `
      <details class="plan-archived">
        <summary class="plan-archived-summary">📦 Archived — Cycle ${a.cycle}</summary>
        <div class="plan-archived-body">${renderPlan(a.content, false)}</div>
      </details>`).join("")
    : "";

  return `<div id="plan-content">${currentHtml}</div>${archivedHtml}`;
}

/** Parse IMPLEMENTATION_PLAN.md checkboxes for progress.
 *  Each task gets status: "done" | "active" | "pending".
 *  When isActive=true the first unchecked item becomes "active". */
function parsePlanProgress(content: string, isActive = false): {
  done: number; total: number;
  tasks: Array<{ text: string; status: "done" | "active" | "pending" }>;
} {
  const tasks: Array<{ text: string; status: "done" | "active" | "pending" }> = [];
  let markedActive = false;
  for (const line of content.split("\n")) {
    const done = line.match(/[-*]\s+\[x\]\s+(.+)/i);
    const todo = line.match(/[-*]\s+\[ \]\s+(.+)/);
    if (done) {
      tasks.push({ text: done[1].trim(), status: "done" });
    } else if (todo) {
      if (isActive && !markedActive) {
        tasks.push({ text: todo[1].trim(), status: "active" });
        markedActive = true;
      } else {
        tasks.push({ text: todo[1].trim(), status: "pending" });
      }
    }
  }
  return { done: tasks.filter(t => t.status === "done").length, total: tasks.length, tasks };
}

// ─── PID helpers ──────────────────────────────────────────────────────────────

function storePid(serverCwd: string, pid: number, projectCwd: string): void {
  const dir = stateDir(serverCwd);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(pidPath(serverCwd), JSON.stringify({
    pid,
    startedAt: new Date().toISOString(),
    projectCwd,
  }));
  // Also update the globally-active project so all pages switch automatically
  saveCurrentProject(serverCwd, projectCwd);
}

function loadPid(cwd: string): number | null {
  const p = pidPath(cwd);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf-8")).pid ?? null; } catch { return null; }
}

/**
 * Returns the project cwd where ralph was last launched from the dashboard.
 * Falls back to serverCwd if no pid file exists.
 */
function loadProjectCwd(serverCwd: string): string {
  const p = pidPath(serverCwd);
  if (!existsSync(p)) return serverCwd;
  try { return JSON.parse(readFileSync(p, "utf-8")).projectCwd ?? serverCwd; } catch { return serverCwd; }
}

function currentProjectFile(serverCwd: string): string {
  return join(stateDir(serverCwd), "current-project.json");
}

/** Persist a project as the globally-active project for the dashboard. */
function saveCurrentProject(serverCwd: string, projectCwd: string): void {
  mkdirSync(stateDir(serverCwd), { recursive: true });
  writeFileSync(currentProjectFile(serverCwd), JSON.stringify({ cwd: projectCwd }), "utf-8");
}

/**
 * Single source of truth for which project all pages display.
 * Priority: current-project.json → PID file (last launched) → serverCwd.
 */
function loadCurrentProject(serverCwd: string): string {
  const f = currentProjectFile(serverCwd);
  if (existsSync(f)) {
    try {
      const v = JSON.parse(readFileSync(f, "utf-8")).cwd;
      if (v && existsSync(v)) return v;
    } catch {}
  }
  return loadProjectCwd(serverCwd);
}

// ─── Launch / Stop ────────────────────────────────────────────────────────────

async function launchRalph(formData: URLSearchParams, serverCwd: string): Promise<string | null> {
  const prompt = formData.get("prompt")?.trim() ?? "";
  const improvingChecked = formData.get("improving") === "on";
  // Prompt is optional when --improving is set (ralph starts in improvement cycle 1)
  if (!prompt && !improvingChecked) return "Prompt is required";

  // Use process.execPath (absolute path to the current bun binary) so
  // Bun.spawn can find it without relying on PATH, which is not inherited
  // from the shell on Windows.
  const args: string[] = [process.execPath, RALPH_SCRIPT_PATH];
  if (prompt) args.push(prompt);

  const add = (flag: string, val: string | null) => {
    if (val?.trim()) args.push(flag, val.trim());
  };
  const addBool = (flag: string, key: string) => {
    if (formData.get(key) === "on") args.push(flag);
  };

  add("--agent", formData.get("agent"));
  add("--model", formData.get("model"));
  add("--base-url", formData.get("base-url"));
  add("--max-iterations", formData.get("max-iterations"));
  add("--min-iterations", formData.get("min-iterations"));
  add("--completion-promise", formData.get("completion-promise"));
  add("--abort-promise", formData.get("abort-promise"));
  add("--max-prompt-tokens", formData.get("max-prompt-tokens"));
  add("--rotation", formData.get("rotation"));
  add("--preset", formData.get("preset"));

  addBool("--plan", "plan");
  addBool("--tasks", "tasks");
  addBool("--optimize", "optimize");
  addBool("--diff", "diff");
  if (formData.get("improving") === "on") {
    const cycles = formData.get("improving-cycles")?.trim();
    args.push("--improving");
    if (cycles && /^\d+$/.test(cycles)) args.push(cycles);
  }
  addBool("--no-commit", "no-commit");
  addBool("--allow-all", "allow-all");
  addBool("--no-plugins", "no-plugins");
  addBool("--no-stream", "no-stream");
  addBool("--verbose-tools", "verbose-tools");
  addBool("--no-questions", "no-questions");

  const extraCwd = formData.get("cwd")?.trim() || serverCwd;

  // Create the project directory and its .ralph folder if they don't exist
  mkdirSync(stateDir(extraCwd), { recursive: true });

  // Write stdout+stderr to a log file so the dashboard can display them
  const lp = logPath(extraCwd);
  writeFileSync(lp, `=== Ralph started at ${new Date().toISOString()} ===\n`);
  const { openSync, closeSync } = await import("fs");
  const logFd = openSync(lp, "a");

  const proc = Bun.spawn(args, {
    cwd: extraCwd,
    detached: true,
    stdout: logFd,
    stderr: logFd,
    stdin: "ignore",
  });

  closeSync(logFd);
  storePid(serverCwd, proc.pid, extraCwd);

  // Print to the dashboard terminal so the user knows ralph is running
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ⚡ Ralph launched  (PID ${proc.pid})`);
  console.log(`  📁 Project:  ${extraCwd}`);
  console.log(`  📄 Log:      ${lp}`);
  console.log(`  🌐 Monitor:  http://localhost:${(globalThis as any).__dashboardPort ?? 5000}/status`);
  console.log(`${"─".repeat(60)}\n`);

  return null; // success
}

async function stopRalph(cwd: string): Promise<boolean> {
  const pid = loadPid(cwd);
  if (!pid) return false;
  try {
    if (process.platform === "win32") {
      Bun.spawn(["taskkill", "/PID", String(pid), "/F", "/T"], {
        stdout: "ignore",
        stderr: "ignore",
      });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch { /* process may already be dead — still clean up the pid file */ }
  const p = pidPath(cwd);
  if (existsSync(p)) unlinkSync(p);
  return true;
}

// ─── HTML utils ───────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Markdown → HTML ──────────────────────────────────────────────────────────

function inlineMarkdown(raw: string): string {
  let s = escapeHtml(raw);
  const codeSpans: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_, code) => {
    const idx = codeSpans.length;
    codeSpans.push(`<code>${code}</code>`);
    return `\x00CODE${idx}\x00`;
  });
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => alt ? `<em>${alt}</em>` : "");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    (_, text, href) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`);
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  s = s.replace(/\x00CODE(\d+)\x00/g, (_, idx) => codeSpans[parseInt(idx)]);
  return s;
}

function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inCode = false, inHtmlBlock = false, inTable = false, tableHeaderDone = false;
  let inUl = false, inOl = false;

  function closeContainers() {
    if (inUl)    { out.push("</ul>"); inUl = false; }
    if (inOl)    { out.push("</ol>"); inOl = false; }
    if (inTable) { out.push("</tbody></table>"); inTable = false; tableHeaderDone = false; }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCode) { out.push("</code></pre>"); inCode = false; }
      else { closeContainers(); inHtmlBlock = false; out.push("<pre><code>"); inCode = true; }
      continue;
    }
    if (inCode) { out.push(escapeHtml(line)); continue; }
    if (trimmed === "") { closeContainers(); inHtmlBlock = false; out.push(""); continue; }
    if (trimmed.startsWith("<") || inHtmlBlock) {
      closeContainers(); inHtmlBlock = true;
      const safe = line.replace(/<img([^>]*)>/gi, (_, attrs) => {
        const alt = attrs.match(/alt="([^"]*)"/i)?.[1] ?? "";
        return alt ? `<em>${escapeHtml(alt)}</em>` : "";
      });
      out.push(safe); continue;
    }
    if (/^[-*_]{3,}$/.test(trimmed)) { closeContainers(); out.push("<hr>"); continue; }
    const headingMatch = trimmed.match(/^(#{1,4}) (.+)/);
    if (headingMatch) {
      closeContainers();
      const level = headingMatch[1].length;
      out.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }
    if (trimmed.startsWith("|")) {
      if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
        if (inTable && !tableHeaderDone) tableHeaderDone = true;
        continue;
      }
      const cells = trimmed.slice(1, trimmed.endsWith("|") ? -1 : undefined)
        .split("|").map(c => c.trim());
      if (!inTable) {
        closeContainers();
        out.push('<table><thead><tr>');
        out.push(cells.map(c => `<th>${inlineMarkdown(c)}</th>`).join(""));
        out.push('</tr></thead><tbody>');
        inTable = true; tableHeaderDone = false;
        if (lines[i + 1] && /^\|[\s\-:|]+\|$/.test(lines[i + 1].trim())) {
          i++; tableHeaderDone = true;
        }
      } else {
        out.push("<tr>" + cells.map(c => `<td>${inlineMarkdown(c)}</td>`).join("") + "</tr>");
      }
      continue;
    } else if (inTable) {
      out.push("</tbody></table>"); inTable = false; tableHeaderDone = false;
    }
    const ulMatch = line.match(/^(\s*)[-*+] (.+)/);
    if (ulMatch) {
      const indent = ulMatch[1].length;
      const content = inlineMarkdown(ulMatch[2]);
      if (inOl) { out.push("</ol>"); inOl = false; }
      if (!inUl) { out.push("<ul>"); inUl = true; }
      out.push(indent >= 2 ? `<li style="margin-left:${indent * 6}px">${content}</li>` : `<li>${content}</li>`);
      continue;
    }
    const olMatch = line.match(/^(\s*)\d+\. (.+)/);
    if (olMatch) {
      const indent = olMatch[1].length;
      const content = inlineMarkdown(olMatch[2]);
      if (inUl) { out.push("</ul>"); inUl = false; }
      if (!inOl) { out.push("<ol>"); inOl = true; }
      out.push(indent >= 2 ? `<li style="margin-left:${indent * 6}px">${content}</li>` : `<li>${content}</li>`);
      continue;
    }
    closeContainers();
    out.push(`<p>${inlineMarkdown(trimmed)}</p>`);
  }
  closeContainers();
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

function simpleMarkdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inCode = false, inUl = false;
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

// ─── Global CSS ───────────────────────────────────────────────────────────────

const GLOBAL_CSS = `
  :root {
    --bg:          #0d1117;
    --surface:     #161b22;
    --surface-2:   #1c2128;
    --surface-3:   #22272e;
    --border:      #30363d;
    --border-sub:  #21262d;
    --text:        #e6edf3;
    --text-muted:  #848d97;
    --accent:      #58a6ff;
    --accent-dim:  #1f4f99;
    --success:     #3fb950;
    --success-dim: #1a4a22;
    --danger:      #f85149;
    --danger-dim:  #5c1a1a;
    --warning:     #d29922;
    --warning-dim: #4a3500;
    --radius:      8px;
    --radius-sm:   4px;
    --sidebar-w:   230px;
    --font-mono:   'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    font-size: 14px;
    min-height: 100vh;
  }

  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* ── Layout ──────────────────────────────────────────────────── */
  .layout { display: flex; min-height: 100vh; }

  .sidebar {
    position: fixed;
    top: 0; left: 0; bottom: 0;
    width: var(--sidebar-w);
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    z-index: 100;
    overflow-y: auto;
  }

  .sidebar-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 18px 16px;
    border-bottom: 1px solid var(--border);
    font-weight: 700;
    font-size: 15px;
    color: var(--text);
    flex-shrink: 0;
  }

  .brand-icon { font-size: 20px; }
  .brand-logo {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    object-position: center top;
    border: 2px solid var(--border);
    flex-shrink: 0;
  }

  .status-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--border);
    margin-left: auto;
    flex-shrink: 0;
    transition: background 0.3s, box-shadow 0.3s;
  }
  .status-dot.active {
    background: var(--success);
    box-shadow: 0 0 8px var(--success);
    animation: pulse-dot 2.5s ease-in-out infinite;
  }
  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }

  .sidebar-nav {
    padding: 8px;
    flex: 1;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: 13px;
    transition: background 0.12s, color 0.12s;
    margin-bottom: 1px;
    cursor: pointer;
  }
  .nav-item:hover { background: var(--surface-2); color: var(--text); text-decoration: none; }
  .nav-item.active { background: var(--surface-3); color: var(--text); font-weight: 500; }
  .nav-icon { font-size: 14px; width: 18px; text-align: center; flex-shrink: 0; }

  .sidebar-sep {
    border: none;
    border-top: 1px solid var(--border-sub);
    margin: 6px 8px;
  }

  .sidebar-footer {
    padding: 12px 16px;
    border-top: 1px solid var(--border-sub);
    font-size: 11px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .main {
    margin-left: var(--sidebar-w);
    flex: 1;
    padding: 28px 32px 60px;
    max-width: 900px;
  }

  /* ── Typography ──────────────────────────────────────────────── */
  h1 { font-size: 20px; font-weight: 600; color: var(--text); margin-bottom: 6px; }
  h2 { font-size: 15px; font-weight: 600; color: var(--text); margin: 24px 0 10px;
       padding-bottom: 6px; border-bottom: 1px solid var(--border-sub); }
  h3 { font-size: 13px; font-weight: 600; color: var(--text); margin: 16px 0 8px; }
  h4 { font-size: 12px; font-weight: 600; color: var(--text-muted); margin: 12px 0 6px; }
  p  { margin: 6px 0; color: var(--text-muted); font-size: 13px; }
  ul, ol { margin: 6px 0 6px 20px; }
  li { margin: 3px 0; font-size: 13px; }
  hr { border: none; border-top: 1px solid var(--border-sub); margin: 20px 0; }

  .page-header { margin-bottom: 20px; }
  .page-subtitle { font-size: 12px; color: var(--text-muted); margin-top: 3px; }

  /* ── Cards ───────────────────────────────────────────────────── */
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px 18px;
    margin: 12px 0;
  }
  .card-title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin-bottom: 12px;
  }
  .card-row {
    display: flex;
    gap: 10px;
    padding: 5px 0;
    border-bottom: 1px solid var(--border-sub);
    font-size: 13px;
  }
  .card-row:last-child { border-bottom: none; }
  .card-label { color: var(--text-muted); min-width: 150px; flex-shrink: 0; }
  .card-value { color: var(--text); word-break: break-all; }

  /* ── Badges ──────────────────────────────────────────────────── */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.03em;
  }
  .badge-green  { background: var(--success-dim); color: var(--success); }
  .badge-gray   { background: var(--surface-3); color: var(--text-muted); }
  .badge-blue   { background: var(--accent-dim); color: var(--accent); }
  .badge-red    { background: var(--danger-dim); color: var(--danger); }
  .badge-yellow { background: var(--warning-dim); color: var(--warning); }

  /* ── Code & Pre ──────────────────────────────────────────────── */
  code {
    background: var(--surface-2);
    border: 1px solid var(--border-sub);
    padding: 1px 5px;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  pre {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px 16px;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: 12px;
    white-space: pre-wrap;
    margin: 10px 0;
    line-height: 1.5;
  }
  pre code { background: none; border: none; padding: 0; font-size: inherit; }

  /* ── Tables ──────────────────────────────────────────────────── */
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
  th { background: var(--surface-2); color: var(--text); padding: 7px 12px;
       border: 1px solid var(--border); text-align: left; font-weight: 600; font-size: 12px; }
  td { padding: 6px 12px; border: 1px solid var(--border-sub); color: var(--text); }
  tr:nth-child(even) td { background: var(--surface-2); }

  /* ── Form elements ───────────────────────────────────────────── */
  .form-section {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px 18px;
    margin-bottom: 12px;
  }
  .form-section-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin-bottom: 14px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 10px;
  }
  .form-row.single { grid-template-columns: 1fr; }
  .form-row.triple { grid-template-columns: 1fr 1fr 1fr; }
  .form-group { display: flex; flex-direction: column; gap: 4px; }
  .form-group label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
  }
  .form-group label span.required { color: var(--danger); margin-left: 2px; }

  input[type="text"],
  input[type="number"],
  input[type="url"],
  select,
  textarea {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: 13px;
    padding: 7px 10px;
    font-family: inherit;
    transition: border-color 0.15s;
    width: 100%;
    outline: none;
  }
  input[type="text"]:focus,
  input[type="number"]:focus,
  input[type="url"]:focus,
  select:focus,
  textarea:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.12);
  }
  input::placeholder, textarea::placeholder { color: var(--text-muted); opacity: 0.6; }
  select { appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23848d97'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; padding-right: 28px; cursor: pointer; }
  textarea { min-height: 100px; resize: vertical; font-family: var(--font-mono); line-height: 1.5; }

  .checkbox-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 8px;
  }
  .checkbox-label {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    cursor: pointer;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-sub);
    background: var(--surface-2);
    transition: border-color 0.12s, background 0.12s;
  }
  .checkbox-label:hover { border-color: var(--accent); background: var(--surface-3); }
  .checkbox-label input[type="checkbox"] {
    width: 14px; height: 14px;
    margin-top: 1px;
    accent-color: var(--accent);
    flex-shrink: 0;
    cursor: pointer;
  }
  .checkbox-label .cb-text { display: flex; flex-direction: column; }
  .checkbox-label .cb-name { font-size: 12px; font-weight: 500; color: var(--text); }
  .checkbox-label .cb-desc { font-size: 11px; color: var(--text-muted); margin-top: 1px; }

  /* ── Buttons ─────────────────────────────────────────────────── */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 500;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.12s;
    font-family: inherit;
    white-space: nowrap;
    text-decoration: none;
  }
  .btn-primary { background: var(--accent); color: #000; border-color: var(--accent); }
  .btn-primary:hover { background: #79c0ff; border-color: #79c0ff; text-decoration: none; }
  .btn-danger  { background: var(--danger-dim); color: var(--danger); border-color: #5c2b2b; }
  .btn-danger:hover  { background: #7a1f1f; text-decoration: none; }
  .btn-ghost   { background: transparent; color: var(--text-muted); border-color: var(--border); }
  .btn-ghost:hover   { background: var(--surface-2); color: var(--text); text-decoration: none; }
  .btn-sm      { padding: 5px 10px; font-size: 12px; }
  .btn-launch  { padding: 10px 24px; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; }

  .btn-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

  /* ── Model fetch row ─────────────────────────────────────────── */
  .input-row { display: flex; gap: 6px; }
  .input-row input { flex: 1; }

  /* ── Iteration history ───────────────────────────────────────── */
  .iter-row {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 12px;
    padding: 6px 0;
    border-bottom: 1px solid var(--border-sub);
  }
  .iter-row:last-child { border-bottom: none; }
  .iter-num  { color: var(--text-muted); width: 28px; flex-shrink: 0; font-family: var(--font-mono); }
  .iter-dur  { color: var(--text-muted); width: 55px; flex-shrink: 0; }
  .iter-ok   { color: var(--success); width: 16px; flex-shrink: 0; }
  .iter-fail { color: var(--danger);  width: 16px; flex-shrink: 0; }
  .iter-tools { color: var(--text-muted); font-family: var(--font-mono); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ── Misc ────────────────────────────────────────────────────── */
  .empty-state {
    color: var(--text-muted);
    font-style: italic;
    padding: 20px 0;
    font-size: 13px;
  }
  .alert {
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    margin: 10px 0;
  }
  .alert-success { background: var(--success-dim); border: 1px solid #2a6030; color: var(--success); }
  .alert-error   { background: var(--danger-dim);  border: 1px solid #6b2222; color: var(--danger); }
  .alert-warning { background: var(--warning-dim); border: 1px solid #5a4000; color: var(--warning); }
  .alert-info    { background: var(--accent-dim);  border: 1px solid #1a3a6e; color: var(--accent); }

  .tag {
    display: inline-block;
    padding: 2px 7px;
    border-radius: 20px;
    font-size: 11px;
    font-family: var(--font-mono);
    background: var(--surface-3);
    color: var(--text-muted);
    border: 1px solid var(--border-sub);
  }

  details summary { cursor: pointer; color: var(--text-muted); font-size: 12px; user-select: none; }
  details summary:hover { color: var(--text); }

  /* ── Activity timeline ───────────────────────────────── */
  .activity-status-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 16px;
    margin-bottom: 14px;
    font-size: 13px;
  }
  .activity-status-bar .sep { color: var(--border); }

  .progress-wrap {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px 16px;
    margin-bottom: 16px;
  }
  .progress-meta {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 8px;
  }
  .progress-meta strong { color: var(--text); }
  .progress-track {
    height: 8px;
    background: var(--surface-3);
    border-radius: 4px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    border-radius: 4px;
    background: linear-gradient(90deg, var(--accent) 0%, var(--success) 100%);
    transition: width 0.6s ease;
    min-width: 2px;
  }
  /* ── Task status list ───────────────────────────────────── */
  .task-list { display: flex; flex-direction: column; gap: 3px; margin-top: 14px; }
  .task-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 14px;
    border-radius: 8px;
    font-size: 13px;
    border: 1px solid transparent;
    transition: background 0.2s;
  }
  .task-item.done { color: var(--text-muted); }
  .task-item.done .task-text { text-decoration: line-through; opacity: 0.55; }
  .task-item.active {
    background: var(--warning-dim);
    border-color: rgba(210,153,34,0.35);
    color: var(--text);
    font-weight: 500;
  }
  .task-item.pending { color: var(--text-muted); }
  .task-icon-wrap {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    flex-shrink: 0;
  }
  .task-icon-wrap.done { background: var(--success-dim); color: var(--success); }
  .task-icon-wrap.active {
    background: var(--warning-dim);
    color: var(--warning);
    border: 1.5px solid var(--warning);
    animation: pulse-dot 2s ease-in-out infinite;
  }
  .task-icon-wrap.pending { background: var(--surface-3); color: var(--text-muted); }
  .task-status-label {
    margin-left: auto;
    font-size: 10px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    opacity: 0.6;
    flex-shrink: 0;
  }
  .task-item.active .task-status-label { opacity: 1; color: var(--warning); }

  /* ── Plan page sections ──────────────────────────────────── */
  .plan-sections { display: flex; flex-direction: column; gap: 6px; }
  .plan-section {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px 10px;
  }
  .plan-sec-heading { margin-bottom: 6px; }
  .plan-sec-heading h2 { font-size: 14px; font-weight: 700; color: var(--text); margin: 0; }
  .plan-sec-heading h3 { font-size: 13px; font-weight: 600; color: var(--text); margin: 0; }
  .plan-sec-heading h4 { font-size: 12px; font-weight: 600; color: var(--text-muted); margin: 0; }
  .plan-sec-heading.level-1 h2 { font-size: 15px; color: var(--accent); }
  .plan-sec-note {
    font-size: 12px;
    color: var(--text-muted);
    margin: 0 0 8px;
    line-height: 1.5;
  }
  .plan-section .task-list { margin-top: 8px; }
  .plan-markdown { font-size: 13px; line-height: 1.7; }
  .plan-archived {
    margin-top: 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .plan-archived-summary {
    padding: 10px 14px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    cursor: pointer;
    background: var(--surface);
    user-select: none;
    list-style: none;
  }
  .plan-archived-summary:hover { color: var(--text); background: var(--surface-2); }
  .plan-archived-body { padding: 14px 16px; }
  .plan-archived-body .progress-wrap { margin-bottom: 10px; }

  .timeline { display: flex; flex-direction: column; gap: 0; }
  .tl-item {
    display: flex;
    gap: 14px;
    position: relative;
  }
  .tl-left {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
    width: 20px;
  }
  .tl-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--border);
    border: 2px solid var(--surface);
    flex-shrink: 0;
    margin-top: 4px;
    z-index: 1;
    transition: background 0.3s;
  }
  .tl-dot.active {
    background: var(--success);
    box-shadow: 0 0 8px var(--success);
    animation: pulse-dot 2s ease-in-out infinite;
  }
  .tl-dot.done { background: var(--accent); }
  .tl-line {
    width: 2px;
    flex: 1;
    background: var(--border-sub);
    margin: 3px 0;
    min-height: 16px;
  }
  .tl-body {
    flex: 1;
    padding-bottom: 20px;
  }
  .tl-heading {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  .tl-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .tl-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0;
  }
  .tl-list li {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .tl-list li::before {
    content: "›";
    color: var(--accent);
    font-size: 14px;
    line-height: 1.3;
    flex-shrink: 0;
  }
  .tl-para {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
    margin: 3px 0;
  }
  .tl-empty {
    color: var(--text-muted);
    font-size: 12px;
    font-style: italic;
    padding: 6px 0;
  }

  /* ── Project selector bar ───────────────────────────────────── */
  .project-selector {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 12px;
    margin-bottom: 16px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .project-selector strong { color: var(--text); font-family: monospace; font-size: 12px; }
  .project-selector .btn { margin-left: auto; flex-shrink: 0; }

  /* ── Project info card ───────────────────────────────────────── */
  .project-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius);
    padding: 14px 16px;
    margin-top: 10px;
    font-size: 13px;
  }
  .project-card-loading { color: var(--text-muted); font-size: 12px; margin: 0; }
  .project-info-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 4px;
  }
  .project-name { font-weight: 600; color: var(--text); font-size: 14px; }
  .project-version { font-size: 11px; color: var(--text-muted); background: var(--surface-3); padding: 1px 6px; border-radius: 10px; }
  .project-desc { color: var(--text-muted); font-size: 12px; margin: 4px 0 0; }
  .project-last-run {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--border-sub);
  }
  .project-last-prompt {
    font-size: 12px;
    color: var(--text-muted);
    background: var(--surface-3);
    border-radius: 6px;
    padding: 7px 10px;
    margin-top: 6px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* ── Directory browser modal ─────────────────────────────────── */
  .dir-modal-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.65);
    z-index: 500;
    align-items: center;
    justify-content: center;
  }
  .dir-modal-overlay.open { display: flex; }
  .dir-modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 520px;
    max-width: 94vw;
    max-height: 72vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 16px 48px rgba(0,0,0,0.5);
  }
  .dir-modal-header {
    padding: 13px 16px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 600;
    font-size: 14px;
    flex-shrink: 0;
  }
  .dir-modal-close {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
    padding: 0 4px;
  }
  .dir-modal-close:hover { color: var(--text); }
  .dir-modal-path {
    padding: 8px 14px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-sub);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    word-break: break-all;
    flex-shrink: 0;
    min-height: 30px;
  }
  .dir-modal-list {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
  }
  .dir-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 13px;
    color: var(--text);
    user-select: none;
    transition: background 0.1s;
  }
  .dir-item:hover { background: var(--surface-2); }
  .dir-item-icon { flex-shrink: 0; font-size: 14px; }
  .dir-item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dir-item-up { color: var(--text-muted); }
  .dir-modal-footer {
    padding: 11px 14px;
    border-top: 1px solid var(--border-sub);
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  .readme-body p[align=center], .readme-body div[align=center] { text-align: center; }
  .readme-body h1[align=center], .readme-body h3[align=center] { text-align: center; }
  .readme-body p { margin: 8px 0; color: var(--text); }
`;

// ─── HTML layout ──────────────────────────────────────────────────────────────

function htmlPage(
  title: string,
  body: string,
  activePath: string,
  extraHead = "",
  state?: Record<string, unknown> | null,
  _unused?: string   // kept for API compat, no longer used
): string {
  const isActive = state?.active === true;
  const dotClass = isActive ? "status-dot active" : "status-dot";
  const dotTitle = isActive ? `Active — iteration ${state?.iteration ?? "?"}` : "No active loop";

  const navItem = (href: string, icon: string, label: string) => {
    const cls = activePath === href ? "nav-item active" : "nav-item";
    return `<a href="${href}" class="${cls}">
      <span class="nav-icon">${icon}</span>
      <span>${label}</span>
    </a>`;
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — Ralph</title>
  <link rel="icon" type="image/png" href="/logo.png">
  <style>${GLOBAL_CSS}</style>
  ${extraHead}
</head>
<body>
<div class="layout">
  <aside class="sidebar">
    <div class="sidebar-brand">
      <img src="/logo.png" alt="Ralph" class="brand-logo">
      <span>Ralph</span>
      <span class="${dotClass}" id="status-dot" title="${dotTitle}"></span>
    </div>
    <nav class="sidebar-nav">
      ${navItem("/launch", "⚡", "Launch")}
      ${navItem("/status", "◉", "Status")}
      <hr class="sidebar-sep">
      ${navItem("/plan", "📋", "Plan")}
      ${navItem("/activity", "📝", "Activity")}
      ${navItem("/logs", "🗂", "Logs")}
      <hr class="sidebar-sep">
      ${navItem("/intervene", "✦", "Intervene")}
      ${navItem("/console", "🖥", "Console")}
      ${navItem("/readme", "📖", "Docs")}
    </nav>
    <div class="sidebar-footer">Ralph Wiggum</div>
  </aside>
  <main class="main">
    ${body}
  </main>
</div>
</body>
</html>`;
}

// ─── Route: Launch ────────────────────────────────────────────────────────────

function routeLaunchGet(cwd: string, flash?: { type: string; message: string }): string {
  const state = loadState(cwd);
  const isActive = state?.active === true;

  const agentWarning = isActive
    ? `<div class="alert alert-warning">
        ⚠ A loop is already running (iteration ${state?.iteration ?? "?"}). Launching another may cause conflicts.
        <a href="/status" style="margin-left:8px">View Status →</a>
       </div>`
    : "";

  const flashHtml = flash
    ? `<div class="alert alert-${flash.type}">${escapeHtml(flash.message)}</div>`
    : "";

  return htmlPage("Launch", `
    <div class="page-header">
      <h1>⚡ Launch Ralph</h1>
      <p class="page-subtitle">Start a new agentic loop with your chosen configuration.</p>
    </div>
    ${flashHtml}
    ${agentWarning}

    <form method="POST" action="/launch" id="launch-form">

      <!-- PROMPT -->
      <div class="form-section">
        <div class="form-section-title">✏ Prompt</div>
        <div class="form-group">
          <label for="prompt" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            Task description
            <span class="required" id="prompt-required">*</span>
            <span id="prompt-optional" style="display:none;font-size:11px;color:var(--text-muted);font-weight:400">(optional with --improving)</span>
            <button type="button" id="enrich-btn" class="btn btn-ghost btn-sm" style="margin-left:auto"
              onclick="enrichPrompt()" title="Enrich prompt using the selected model + project context">✨ Enrich</button>
          </label>
          <textarea name="prompt" id="prompt" rows="6"
            placeholder="e.g. Fix the failing tests in tests/auth.test.ts and make sure all assertions pass"></textarea>
          <div id="enrich-status" style="display:none;font-size:11px;margin-top:4px"></div>
        </div>
      </div>

      <!-- AGENT & MODEL -->
      <div class="form-section">
        <div class="form-section-title">🤖 Agent &amp; Model</div>
        <div class="form-row">
          <div class="form-group">
            <label for="agent">Agent</label>
            <select name="agent" id="agent">
              <option value="">Default (opencode)</option>
              <option value="opencode">opencode</option>
              <option value="claude-code">claude-code</option>
              <option value="codex">codex</option>
              <option value="copilot">copilot</option>
              <option value="aider">aider</option>
              <option value="llm">llm (built-in)</option>
            </select>
          </div>
          <div class="form-group">
            <label for="model">Model</label>
            <input type="text" name="model" id="model"
              placeholder="e.g. claude-sonnet-4-6, qwen2.5-coder:32b"
              list="model-suggestions" autocomplete="off">
            <datalist id="model-suggestions"></datalist>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="base-url">Base URL <span style="font-size:11px;font-weight:400;color:var(--text-muted)">(OpenAI-compatible, e.g. Ollama)</span></label>
            <div class="input-row">
              <input type="text" name="base-url" id="base-url"
                placeholder="http://localhost:11434/v1">
              <button type="button" class="btn btn-ghost btn-sm" id="fetch-models-btn"
                onclick="fetchModels()" title="Fetch available models from the endpoint">↓ Models</button>
            </div>
          </div>
          <div class="form-group">
            <label for="rotation">Rotation <span style="font-size:11px;font-weight:400;color:var(--text-muted)">(cycle agents per iteration)</span></label>
            <input type="text" name="rotation" id="rotation"
              placeholder="opencode:claude-sonnet-4,claude-code:gpt-4o">
          </div>
        </div>
      </div>

      <!-- ITERATION CONTROL -->
      <div class="form-section">
        <div class="form-section-title">🔁 Iteration Control</div>
        <div class="form-row triple">
          <div class="form-group">
            <label for="max-iterations">Max iterations</label>
            <input type="number" name="max-iterations" id="max-iterations"
              min="1" placeholder="unlimited">
          </div>
          <div class="form-group">
            <label for="min-iterations">Min iterations</label>
            <input type="number" name="min-iterations" id="min-iterations"
              min="1" placeholder="1">
          </div>
          <div class="form-group">
            <label for="max-prompt-tokens">Max prompt tokens</label>
            <input type="number" name="max-prompt-tokens" id="max-prompt-tokens"
              min="100" placeholder="unlimited">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="completion-promise">Completion signal</label>
            <input type="text" name="completion-promise" id="completion-promise"
              placeholder="COMPLETE">
          </div>
          <div class="form-group">
            <label for="abort-promise">Abort signal</label>
            <input type="text" name="abort-promise" id="abort-promise"
              placeholder="GIVE_UP (optional)">
          </div>
        </div>
      </div>

      <!-- MODES -->
      <div class="form-section">
        <div class="form-section-title">🎛 Modes</div>
        <div class="checkbox-grid">
          <label class="checkbox-label">
            <input type="checkbox" name="plan">
            <span class="cb-text">
              <span class="cb-name">--plan</span>
              <span class="cb-desc">Maintain IMPLEMENTATION_PLAN.md</span>
            </span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" name="tasks">
            <span class="cb-text">
              <span class="cb-name">--tasks</span>
              <span class="cb-desc">Work through ralph-tasks.md checklist</span>
            </span>
          </label>
          <label class="checkbox-label" id="optimize-label">
            <input type="checkbox" name="optimize" id="optimize-cb">
            <span class="cb-text">
              <span class="cb-name">--optimize</span>
              <span class="cb-desc">Minimal prompt for small/weak models</span>
            </span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" name="diff">
            <span class="cb-text">
              <span class="cb-name">--diff</span>
              <span class="cb-desc">Inject git diff into each iteration</span>
            </span>
          </label>
        </div>
        <!-- Improving mode row -->
        <div class="form-row" style="margin-top:12px;align-items:flex-end">
          <div class="form-group" style="flex:0 0 auto">
            <label class="checkbox-label" style="margin:0">
              <input type="checkbox" name="improving" id="improving-cb"
                onchange="document.getElementById('improving-cycles').disabled=!this.checked;document.getElementById('prompt-required').style.display=this.checked?'none':'';document.getElementById('prompt-optional').style.display=this.checked?'':'none'">
              <span class="cb-text">
                <span class="cb-name">--improving</span>
                <span class="cb-desc">Keep running after completion — ralph autonomously
                  picks and implements improvements (design, performance, tests, features, etc.)</span>
              </span>
            </label>
          </div>
          <div class="form-group" style="flex:0 0 140px">
            <label for="improving-cycles">Improvement cycles</label>
            <input type="number" name="improving-cycles" id="improving-cycles"
              min="1" placeholder="unlimited" disabled>
          </div>
        </div>
      </div>

      <!-- OPTIONS -->
      <div class="form-section">
        <div class="form-section-title">⚙ Options</div>
        <div class="checkbox-grid">
          <label class="checkbox-label">
            <input type="checkbox" name="allow-all" checked>
            <span class="cb-text">
              <span class="cb-name">--allow-all</span>
              <span class="cb-desc">Auto-approve all permissions</span>
            </span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" name="no-commit">
            <span class="cb-text">
              <span class="cb-name">--no-commit</span>
              <span class="cb-desc">Skip auto-commit after each iteration</span>
            </span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" name="no-plugins">
            <span class="cb-text">
              <span class="cb-name">--no-plugins</span>
              <span class="cb-desc">Disable OpenCode plugins</span>
            </span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" name="no-stream">
            <span class="cb-text">
              <span class="cb-name">--no-stream</span>
              <span class="cb-desc">Buffer output, print at end</span>
            </span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" name="verbose-tools">
            <span class="cb-text">
              <span class="cb-name">--verbose-tools</span>
              <span class="cb-desc">Print every tool call in detail</span>
            </span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" name="no-questions">
            <span class="cb-text">
              <span class="cb-name">--no-questions</span>
              <span class="cb-desc">Disable interactive questions</span>
            </span>
          </label>
        </div>
      </div>

      <!-- ADVANCED -->
      <div class="form-section">
        <div class="form-section-title">🔧 Advanced</div>
        <div class="form-row">
          <div class="form-group">
            <label for="preset">Preset name</label>
            <input type="text" name="preset" id="preset"
              placeholder="Load from .ralph/presets.json">
          </div>
          <div class="form-group">
            <label for="cwd">Project directory</label>
            <div class="input-row">
              <input type="text" name="cwd" id="cwd"
                value="${escapeHtml(loadCurrentProject(cwd))}"
                placeholder="${escapeHtml(cwd)}">
              <button type="button" class="btn btn-ghost btn-sm" onclick="openDirModal()"
                title="Browse for a directory">📁 Browse</button>
            </div>
            <div id="project-card" style="display:none" class="project-card"></div>
          </div>
        </div>
      </div>

      <!-- SUBMIT -->
      <div class="btn-row" style="margin-top:4px">
        <button type="submit" class="btn btn-primary btn-launch" id="launch-btn">⚡ Launch Ralph</button>
        <a href="/status" class="btn btn-ghost">View Status</a>
      </div>

    </form>

    <!-- Directory browser modal -->
    <div class="dir-modal-overlay" id="dir-modal">
      <div class="dir-modal">
        <div class="dir-modal-header">
          📁 Select Project Directory
          <button class="dir-modal-close" onclick="closeDirModal()">×</button>
        </div>
        <div class="dir-modal-path" id="dir-current-path"></div>
        <div class="dir-modal-list" id="dir-list"></div>
        <div class="dir-modal-footer">
          <button class="btn btn-primary btn-sm" onclick="selectCurrentDir()">Select this folder</button>
          <button class="btn btn-ghost btn-sm" onclick="closeDirModal()">Cancel</button>
        </div>
      </div>
    </div>

    <script>
      const initialCwd = ${JSON.stringify(loadCurrentProject(cwd))};
      let currentBrowsePath = initialCwd;

      // ── Directory browser ─────────────────────────────────────────
      const IS_WINDOWS = ${JSON.stringify(process.platform === "win32")};

      async function openDirModal() {
        if (IS_WINDOWS) {
          // Use native Windows folder picker dialog
          const btn = document.querySelector('[onclick="openDirModal()"]');
          if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
          try {
            const resp = await fetch('/api/browse-native');
            const data = await resp.json();
            if (data.path) {
              document.getElementById('cwd').value = data.path;
              fetch('/api/set-project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: data.path }) }).catch(() => {});
              loadProjectInfo(data.path);
            }
            // if cancelled, do nothing
          } catch (e) {
            alert('Could not open folder picker: ' + e.message);
          } finally {
            if (btn) { btn.textContent = '📁 Browse'; btn.disabled = false; }
          }
          return;
        }
        // Non-Windows fallback: custom modal browser
        const cwdInput = document.getElementById('cwd').value.trim() || initialCwd;
        document.getElementById('dir-modal').classList.add('open');
        browseTo(cwdInput);
      }
      function closeDirModal() {
        document.getElementById('dir-modal').classList.remove('open');
      }
      function selectCurrentDir() {
        document.getElementById('cwd').value = currentBrowsePath;
        closeDirModal();
        fetch('/api/set-project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: currentBrowsePath }) }).catch(() => {});
        loadProjectInfo(currentBrowsePath);
      }
      async function browseTo(path) {
        const pathEl = document.getElementById('dir-current-path');
        const listEl = document.getElementById('dir-list');
        pathEl.textContent = 'Loading…';
        listEl.innerHTML = '';
        try {
          const resp = await fetch('/api/browse?path=' + encodeURIComponent(path));
          const data = await resp.json();
          if (data.error) { pathEl.textContent = 'Error: ' + data.error; return; }
          currentBrowsePath = data.current;
          pathEl.textContent = data.current;
          if (data.parent) {
            const up = document.createElement('div');
            up.className = 'dir-item dir-item-up';
            up.innerHTML = '<span class="dir-item-icon">⬆</span><span class="dir-item-name">.. (parent)</span>';
            up.onclick = () => browseTo(data.parent);
            listEl.appendChild(up);
          }
          if (data.dirs.length === 0 && !data.parent) {
            listEl.innerHTML = '<p style="color:var(--text-muted);padding:12px;font-size:13px">No subdirectories.</p>';
          } else {
            data.dirs.forEach(d => {
              const item = document.createElement('div');
              item.className = 'dir-item';
              const icon = d.name.startsWith('.') ? '📂' : '📁';
              item.innerHTML = '<span class="dir-item-icon">' + icon + '</span>'
                             + '<span class="dir-item-name">' + d.name + '</span>';
              item.ondblclick = () => browseTo(d.path);
              item.onclick = () => {
                listEl.querySelectorAll('.dir-item').forEach(el => el.style.background = '');
                item.style.background = 'var(--accent-dim)';
                currentBrowsePath = d.path;
                document.getElementById('dir-current-path').textContent = d.path;
              };
              listEl.appendChild(item);
            });
          }
        } catch (e) {
          pathEl.textContent = 'Failed to load: ' + e.message;
        }
      }
      // Close modal on overlay click
      document.getElementById('dir-modal').addEventListener('click', function(e) {
        if (e.target === this) closeDirModal();
      });

      // ── Optimize toggle ───────────────────────────────────────────
      const agentSel = document.getElementById('agent');
      const optimizeLabel = document.getElementById('optimize-label');
      function updateOptimize() {
        const v = agentSel.value;
        const dim = v !== '' && v !== 'llm';
        optimizeLabel.style.opacity = dim ? '0.4' : '1';
        optimizeLabel.querySelector('input').disabled = dim;
      }
      agentSel.addEventListener('change', updateOptimize);
      updateOptimize();

      // ── Ollama model fetch ────────────────────────────────────────
      async function fetchModels() {
        const url = document.getElementById('base-url').value.trim();
        if (!url) { alert('Enter a Base URL first (e.g. http://localhost:11434/v1)'); return; }
        const btn = document.getElementById('fetch-models-btn');
        btn.textContent = '⏳ Fetching…';
        btn.disabled = true;
        try {
          const resp = await fetch('/api/models?url=' + encodeURIComponent(url));
          const models = await resp.json();
          const dl = document.getElementById('model-suggestions');
          dl.innerHTML = '';
          if (models.length === 0) { alert('No models found at that URL.'); return; }
          models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            dl.appendChild(opt);
          });
          btn.textContent = '✓ ' + models.length + ' models';
        } catch (e) {
          alert('Failed to fetch models: ' + e.message);
          btn.textContent = '↓ Models';
        } finally {
          btn.disabled = false;
        }
      }

      // ── Prompt enrichment ─────────────────────────────────────────
      async function enrichPrompt() {
        const btn = document.getElementById('enrich-btn');
        const status = document.getElementById('enrich-status');
        const ta = document.getElementById('prompt');
        const rawPrompt = ta.value.trim();
        if (!rawPrompt) { ta.focus(); return; }

        const baseUrl = document.getElementById('base-url').value.trim();
        const model   = document.getElementById('model').value.trim();

        btn.disabled = true;
        btn.textContent = '⏳ Enriching…';
        status.style.display = 'block';
        status.style.color = 'var(--text-muted)';
        status.textContent = 'Sending to LLM…';

        try {
          const agent = document.getElementById('agent').value.trim();
          const resp = await fetch('/api/enrich-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt:  rawPrompt,
              agent:   agent   || undefined,
              model:   model   || undefined,
              baseUrl: baseUrl || undefined,
            }),
          });
          const d = await resp.json();
          if (d.error) {
            status.style.color = 'var(--danger)';
            status.textContent = '✗ ' + d.error;
          } else {
            ta.value = d.prompt;
            status.style.color = 'var(--success)';
            status.textContent = '✓ Prompt enriched';
            setTimeout(() => { status.style.display = 'none'; }, 3000);
          }
        } catch (e) {
          status.style.color = 'var(--danger)';
          status.textContent = '✗ Request failed: ' + e.message;
        } finally {
          btn.disabled = false;
          btn.textContent = '✨ Enrich';
        }
      }

      // ── Warn if loop already running ──────────────────────────────
      document.getElementById('launch-form').addEventListener('submit', function(e) {
        if (document.querySelector('.alert-warning')) {
          if (!confirm('A loop is already running. Launch another anyway?')) {
            e.preventDefault();
          }
        }
      });

      // ── Project info card ─────────────────────────────────────────
      let _projInfoTimer = null;
      document.getElementById('cwd').addEventListener('input', function() {
        clearTimeout(_projInfoTimer);
        const path = this.value.trim();
        _projInfoTimer = setTimeout(() => {
          fetch('/api/set-project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: path }) }).catch(() => {});
          loadProjectInfo(path);
        }, 700);
      });

      async function loadProjectInfo(path) {
        if (!path) return;
        const card = document.getElementById('project-card');
        card.style.display = 'block';
        card.innerHTML = '<p class="project-card-loading">⏳ Loading project info…</p>';
        try {
          const resp = await fetch('/api/project-info?cwd=' + encodeURIComponent(path));
          const d = await resp.json();
          if (d.error) { card.innerHTML = '<p class="project-card-loading" style="color:var(--text-muted)">⚠ ' + esc(d.error) + '</p>'; return; }
          let html = '<div class="project-info-header">'
            + '<span class="project-name">' + esc(d.name) + '</span>';
          if (d.version) html += '<span class="project-version">v' + esc(d.version) + '</span>';
          if (d.gitBranch) html += '<span class="badge badge-gray" style="font-size:10px">⎇ ' + esc(d.gitBranch) + '</span>';
          if (d.hasPlan)     html += '<span class="badge badge-blue" style="font-size:10px">📋 Plan</span>';
          if (d.hasActivity) html += '<span class="badge badge-blue" style="font-size:10px">📝 Activity</span>';
          html += '</div>';
          if (d.description) html += '<p class="project-desc">' + esc(d.description) + '</p>';
          if (d.lastRun) {
            const ago = d.lastRun.startedAt ? timeAgo(new Date(d.lastRun.startedAt)) : '';
            html += '<div class="project-last-run">'
              + '<span style="font-size:11px;color:var(--text-muted)">Last run' + (ago ? ' · ' + ago : '') + ':</span>'
              + ' <strong style="font-size:11px">' + esc(d.lastRun.agent || '?') + '</strong>'
              + (d.lastRun.iteration ? ' · <span style="font-size:11px">' + d.lastRun.iteration + ' iterations</span>' : '');
            if (d.lastRun.prompt) {
              const p = String(d.lastRun.prompt);
              const safeP = p.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
              html += '<div class="project-last-prompt">' + esc(p.substring(0, 140)) + (p.length > 140 ? '…' : '') + '</div>'
                + '<button type="button" class="btn btn-ghost btn-sm" style="margin-top:8px" '
                + 'data-prompt="' + safeP + '" onclick="resumeLastRun(this.dataset.prompt)">↩ Resume last run</button>';
            }
            html += '</div>';
          } else {
            html += '<p class="project-desc" style="margin-top:6px">No previous runs in this directory.</p>';
          }
          html += '<p style="font-size:11px;color:var(--text-muted);margin-top:8px">📄 Project summary saved to <code>.ralph/project-summary.md</code></p>';
          card.innerHTML = html;
        } catch (e) {
          card.style.display = 'none';
        }
      }

      function resumeLastRun(prompt) {
        document.getElementById('prompt').value = prompt;
        document.getElementById('prompt').focus();
        document.getElementById('prompt').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      function timeAgo(date) {
        const s = Math.floor((Date.now() - date.getTime()) / 1000);
        if (s < 60) return s + 's ago';
        if (s < 3600) return Math.floor(s / 60) + 'm ago';
        if (s < 86400) return Math.floor(s / 3600) + 'h ago';
        return Math.floor(s / 86400) + 'd ago';
      }

      function esc(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      }

      // Load project info on initial page load
      loadProjectInfo(initialCwd);
    </script>
  `, "/launch", "", state);
}

// ─── Route: Status ────────────────────────────────────────────────────────────

function routeStatus(cwd: string): string {
  const projectCwd = loadCurrentProject(cwd);
  const state = loadState(projectCwd);
  const history = loadHistory(projectCwd);
  const isActive = state?.active === true;
  // Clean up stale pid file when loop is no longer active
  const pidFile = pidPath(cwd);
  if (!isActive && existsSync(pidFile)) { try { unlinkSync(pidFile); } catch {} }
  const hasPid = isActive && existsSync(pidFile);

  let statusBadge = `<span class="badge badge-gray">No active loop</span>`;
  let stateHtml = `<p class="empty-state">No active Ralph loop found. Use <a href="/launch">Launch</a> to start one.</p>`;

  if (isActive) {
    const started = String(state!.startedAt ?? "");
    const elapsed = started ? Math.floor((Date.now() - new Date(started).getTime()) / 1000) : 0;
    const elapsedStr = elapsed > 3600
      ? `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`
      : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

    statusBadge = `<span class="badge badge-green">● ACTIVE</span>`;
    const rowOf = (label: string, val: string, code = false) =>
      `<div class="card-row"><span class="card-label">${label}</span><span class="card-value">${code ? `<code>${val}</code>` : val}</span></div>`;

    stateHtml = `
      <div class="card">
        ${rowOf("Iteration", `${state!.iteration ?? "?"}${state!.maxIterations ? ` / ${state!.maxIterations}` : " (unlimited)"}`)}
        ${rowOf("Agent", escapeHtml(String(state!.agent ?? "unknown")))}
        ${state!.model   ? rowOf("Model",    escapeHtml(String(state!.model)), true) : ""}
        ${state!.baseUrl ? rowOf("Base URL", escapeHtml(String(state!.baseUrl)), true) : ""}
        ${rowOf("Started",  escapeHtml(started))}
        ${rowOf("Elapsed",  elapsedStr)}
        ${rowOf("Completion signal", escapeHtml(String(state!.completionPromise ?? "COMPLETE")), true)}
        ${state!.planMode  ? rowOf("Plan mode",  '<span class="badge badge-blue">ON</span>') : ""}
        ${state!.tasksMode ? rowOf("Tasks mode", '<span class="badge badge-blue">ON</span>') : ""}
        ${state!.improvingMode ? rowOf("Improving mode",
          `<span class="badge badge-blue">Cycle ${state!.improvingCycle ?? 0}${state!.improvingMax ? ` / ${state!.improvingMax}` : " (unlimited)"}</span>`) : ""}
        ${rowOf("Prompt", escapeHtml(String(state!.prompt ?? "").substring(0, 160)) + (String(state!.prompt ?? "").length > 160 ? "…" : ""))}
      </div>`;
  }

  let historyHtml = `<p class="empty-state">No iteration history yet.</p>`;
  if (history && Array.isArray((history as { iterations?: unknown[] }).iterations)) {
    const iters = (history as { iterations: Record<string, unknown>[] }).iterations.slice(-15).reverse();
    if (iters.length > 0) {
      historyHtml = `<div class="card" style="padding:12px 16px">` + iters.map(it => {
        const sec = Math.floor(Number(it.durationMs ?? 0) / 1000);
        const dur = sec > 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`;
        const ok = it.completionDetected;
        const tools = Object.entries(it.toolsUsed as Record<string, number> ?? {})
          .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}×${v}`).join(" ") || "—";
        return `<div class="iter-row">
          <span class="iter-num">#${it.iteration}</span>
          <span class="iter-dur">${dur}</span>
          <span class="${ok ? "iter-ok" : "iter-fail"}">${ok ? "✓" : "✗"}</span>
          <span class="iter-tools">${escapeHtml(tools)}</span>
        </div>`;
      }).join("") + `</div>`;
    }
  }

  const stopBtn = hasPid
    ? `<form method="POST" action="/stop" style="display:inline">
         <button type="submit" class="btn btn-danger btn-sm"
           onclick="return confirm('Stop the running Ralph loop?')">⏹ Stop Loop</button>
       </form>`
    : "";

  const extraHead = isActive
    ? `<script>
        // Request notification permission early
        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
        function notifyDone(iterations) {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Ralph Wiggum — Loop complete', {
              body: 'Finished after ' + iterations + ' iteration' + (iterations !== 1 ? 's' : '') + '.',
              icon: '/logo.png',
            });
          }
        }
        setInterval(async () => {
          try {
            const r = await fetch('/api/status');
            const s = await r.json();
            // Update status dot
            const dot = document.getElementById('status-dot');
            if (dot) {
              dot.className = s.active ? 'status-dot active' : 'status-dot';
              dot.title = s.active ? 'Active — iteration ' + (s.iteration ?? '?') : 'No active loop';
            }
            if (!s.active) {
              notifyDone(s.iteration ?? 0);
              window.location.reload();
            } else {
              const itEl = document.getElementById('iter-display');
              if (itEl) itEl.textContent = (s.iteration ?? '?') + (s.maxIterations ? ' / ' + s.maxIterations : ' (unlimited)');
            }
          } catch {}
        }, 5000);
      </script>`
    : "";

  const IS_WIN = process.platform === "win32";
  return htmlPage("Status", `
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <h1>Loop Status ${statusBadge}</h1>
        ${stopBtn}
        <button class="btn btn-ghost btn-sm" onclick="location.reload()">↻ Refresh</button>
      </div>
    </div>
    ${projectSelectorBar(projectCwd, IS_WIN)}
    ${stateHtml}
    <h2>Recent Iterations</h2>
    ${historyHtml}
  `, "/status", extraHead, state);
}

// ─── Route: Plan ─────────────────────────────────────────────────────────────

/** Compact bar shown on all project pages to switch the active project globally. */
function projectSelectorBar(projectCwd: string, isWindows: boolean): string {
  const basename = projectCwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? projectCwd;
  return `
  <div class="project-selector" id="proj-selector">
    <span>📁 Project:</span>
    <strong title="${escapeHtml(projectCwd)}">${escapeHtml(basename)}</strong>
    <span style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px"
          title="${escapeHtml(projectCwd)}">${escapeHtml(projectCwd)}</span>
    <button class="btn btn-ghost btn-sm" onclick="switchProject()"
      title="Switch project — affects all pages">📁 Change</button>
  </div>
  <script>
    const _IS_WINDOWS_SEL = ${JSON.stringify(isWindows)};
    async function switchProject() {
      let path = null;
      if (_IS_WINDOWS_SEL) {
        const btn = document.querySelector('#proj-selector .btn');
        if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
        try {
          const r = await fetch('/api/browse-native');
          const d = await r.json();
          path = d.path ?? null;
        } catch {}
        if (btn) { btn.textContent = '📁 Change'; btn.disabled = false; }
      } else {
        path = prompt('Enter project directory path:');
      }
      if (path) await setProject(path);
    }
    async function setProject(path) {
      try {
        await fetch('/api/set-project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cwd: path }),
        });
        location.reload();
      } catch (e) { alert('Failed to switch project: ' + e.message); }
    }
  </script>`;
}

function loadArchivedCycles(projectCwd: string): Array<{ cycle: number; content: string }> {
  const result: Array<{ cycle: number; content: string }> = [];
  try {
    for (const f of readdirSync(projectCwd)) {
      const m = f.match(/^IMPLEMENTATION_PLAN\.cycle(\d+)\.md$/);
      if (m) result.push({ cycle: parseInt(m[1]), content: readFileSafe(join(projectCwd, f)) });
    }
    result.sort((a, b) => b.cycle - a.cycle);
  } catch { /* ignore read errors */ }
  return result;
}

function routePlan(cwd: string): string {
  const projectCwd = loadCurrentProject(cwd);
  const state = loadState(projectCwd);
  const isActive = state?.active === true;
  const IS_WIN = process.platform === "win32";
  const selectorBar = projectSelectorBar(projectCwd, IS_WIN);
  const planContent = readFileSafe(planPath(projectCwd));
  const archived = loadArchivedCycles(projectCwd);

  return htmlPage("Plan", `
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <h1>📋 Implementation Plan</h1>
        ${isActive ? `<span class="badge badge-green" style="font-size:11px">● Live — updates every 3s</span>` : ""}
        <button class="btn btn-ghost btn-sm" onclick="location.reload()">↻ Refresh</button>
      </div>
      <p class="page-subtitle">IMPLEMENTATION_PLAN.md — maintained by the agent</p>
    </div>
    ${selectorBar}
    ${buildPlanContentHtml(planContent, isActive, archived)}
    <script>
      ${isActive ? `
      let _planRefresh = setInterval(async () => {
        try {
          const resp = await fetch('/api/plan-data');
          const d = await resp.json();
          document.getElementById('plan-content').innerHTML = d.planHtml;
          if (!d.isActive) clearInterval(_planRefresh);
        } catch {}
      }, 3000);` : ""}
    </script>
  `, "/plan", "", state, projectCwd);
}

// ─── Route: Activity ─────────────────────────────────────────────────────────

function buildActivityHtml(projectCwd: string, state: Record<string, unknown> | null): string {
  const isActive = state?.active === true;
  const iter = Number(state?.iteration ?? 0);
  const maxIter = Number(state?.maxIterations ?? 0);
  const agent = String(state?.agent ?? "");
  const started = state?.startedAt ? String(state.startedAt) : "";
  const elapsed = started
    ? (() => {
        const s = Math.floor((Date.now() - new Date(started).getTime()) / 1000);
        return s > 3600 ? `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m` : `${Math.floor(s/60)}m ${s%60}s`;
      })()
    : "";

  // ── Status bar ────────────────────────────────────────────────────────────
  const improvingCycle = Number(state?.improvingCycle ?? 0);
  const improvingMax   = Number(state?.improvingMax ?? 0);
  const improvingBadge = state?.improvingMode
    ? `<span class="sep">|</span><span class="badge badge-blue" style="font-size:10px">🔧 Cycle ${improvingCycle}${improvingMax > 0 ? ` / ${improvingMax}` : ""}</span>`
    : "";
  const statusBar = isActive ? `
    <div class="activity-status-bar">
      <span class="badge badge-green" id="act-status">● ACTIVE</span>
      <span class="sep">|</span>
      <span>Iteration <strong id="act-iter">${iter}</strong>${maxIter > 0 ? `&nbsp;/&nbsp;${maxIter}` : ""}</span>
      <span class="sep">|</span>
      <span>Agent: <strong>${escapeHtml(agent)}</strong></span>
      ${elapsed ? `<span class="sep">|</span><span>Elapsed: <strong id="act-elapsed">${elapsed}</strong></span>` : ""}
      ${improvingBadge}
    </div>` : "";

  // ── Task list from IMPLEMENTATION_PLAN.md ─────────────────────────────────
  const planContent = readFileSafe(planPath(projectCwd));
  const progress = planContent ? parsePlanProgress(planContent, isActive) : null;
  const progressHtml = progress && progress.total > 0 ? (() => {
    const pct = Math.round((progress.done / progress.total) * 100);
    const taskRows = progress.tasks.map(t => {
      const icon = t.status === "done" ? "✓" : t.status === "active" ? "▶" : "○";
      const label = t.status === "done" ? "done" : t.status === "active" ? "in progress" : "pending";
      return `<div class="task-item ${t.status}">
        <div class="task-icon-wrap ${t.status}">${icon}</div>
        <span class="task-text">${escapeHtml(t.text)}</span>
        <span class="task-status-label">${label}</span>
      </div>`;
    }).join("");
    return `
    <div class="progress-wrap" id="progress-wrap">
      <div class="progress-meta">
        <span>Tasks complete: <strong id="prog-label">${progress.done} / ${progress.total}</strong></span>
        <strong id="prog-pct">${pct}%</strong>
      </div>
      <div class="progress-track">
        <div class="progress-fill" id="prog-fill" style="width:${pct}%"></div>
      </div>
      <div class="task-list" id="task-list">${taskRows}</div>
    </div>`;
  })() : "";

  // ── Timeline ──────────────────────────────────────────────────────────────
  const actContent = readFileSafe(activityPath(projectCwd));
  const sections = actContent ? parseActivityMd(actContent) : [];

  const timelineHtml = sections.length === 0
    ? `<p class="empty-state">No activity yet. Run ralph with <code>--plan</code> to generate an activity log.</p>`
    : `<div class="timeline" id="timeline">${sections.map((sec, idx) => {
        const isFirst = idx === 0;
        const dotClass = isFirst && isActive ? "tl-dot active" : "tl-dot done";
        const badge = isFirst && isActive
          ? `<span class="badge badge-green" style="font-size:10px">● Running</span>`
          : "";
        const items = sec.items.map(item =>
          `<li>${escapeHtml(item)}</li>`
        ).join("");
        return `
        <div class="tl-item">
          <div class="tl-left">
            <div class="${dotClass}"></div>
            ${idx < sections.length - 1 ? `<div class="tl-line"></div>` : ""}
          </div>
          <div class="tl-body">
            <div class="tl-heading">
              <span class="tl-title">${escapeHtml(sec.heading)}</span>
              ${badge}
            </div>
            ${items ? `<ul class="tl-list">${items}</ul>` : `<p class="tl-empty">No entries.</p>`}
          </div>
        </div>`;
      }).join("")}</div>`;

  return `
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <h1>📝 Activity</h1>
        ${isActive ? `<span class="badge badge-green" style="font-size:11px">● Live — updates every 3s</span>` : ""}
        <button class="btn btn-ghost btn-sm" onclick="location.reload()">↻ Refresh</button>
      </div>
    </div>
    ${statusBar}
    ${progressHtml}
    ${timelineHtml}`;
}

function routeActivity(cwd: string): string {
  const projectCwd = loadCurrentProject(cwd);
  const state = loadState(projectCwd);
  const isActive = state?.active === true;

  const extraHead = isActive ? `<script>
    // Request notification permission early
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    function notifyDone(iterations) {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Ralph Wiggum — Loop complete', {
          body: 'Finished after ' + iterations + ' iteration' + (iterations !== 1 ? 's' : '') + '.',
          icon: '/logo.png',
        });
      }
    }
    let lastRev = '';
    setInterval(async () => {
      try {
        const r = await fetch('/api/activity-data');
        const d = await r.json();
        const rev = JSON.stringify(d);
        if (rev === lastRev) return;
        lastRev = rev;

        // Update status bar
        const iterEl = document.getElementById('act-iter');
        if (iterEl && d.state?.iteration != null) iterEl.textContent = d.state.iteration;

        // Update progress bar + task list
        if (d.progress && d.progress.total > 0) {
          const pct = Math.round(d.progress.done / d.progress.total * 100);
          const fill = document.getElementById('prog-fill');
          const label = document.getElementById('prog-label');
          const pctEl = document.getElementById('prog-pct');
          if (fill) fill.style.width = pct + '%';
          if (label) label.textContent = d.progress.done + ' / ' + d.progress.total;
          if (pctEl) pctEl.textContent = pct + '%';
          // Rebuild task list
          const taskList = document.getElementById('task-list');
          if (taskList) {
            taskList.innerHTML = d.progress.tasks.map(t => {
              const icon = t.status === 'done' ? '✓' : t.status === 'active' ? '▶' : '○';
              const lbl  = t.status === 'done' ? 'done' : t.status === 'active' ? 'in progress' : 'pending';
              return '<div class="task-item ' + t.status + '">'
                + '<div class="task-icon-wrap ' + t.status + '">' + icon + '</div>'
                + '<span class="task-text">' + esc(t.text) + '</span>'
                + '<span class="task-status-label">' + lbl + '</span>'
                + '</div>';
            }).join('');
          }
        }

        // Rebuild timeline
        if (d.sections) {
          const tl = document.getElementById('timeline');
          if (tl) {
            tl.innerHTML = d.sections.map((sec, idx) => {
              const isFirst = idx === 0;
              const dotClass = isFirst && d.state?.active ? 'tl-dot active' : 'tl-dot done';
              const badge = isFirst && d.state?.active
                ? '<span class="badge badge-green" style="font-size:10px">● Running</span>' : '';
              const items = sec.items.map(i => '<li>' + esc(i) + '</li>').join('');
              const hasLine = idx < d.sections.length - 1;
              return '<div class="tl-item">'
                + '<div class="tl-left"><div class="' + dotClass + '"></div>'
                + (hasLine ? '<div class="tl-line"></div>' : '')
                + '</div>'
                + '<div class="tl-body"><div class="tl-heading">'
                + '<span class="tl-title">' + esc(sec.heading) + '</span>' + badge
                + '</div>'
                + (items ? '<ul class="tl-list">' + items + '</ul>'
                         : '<p class="tl-empty">No entries.</p>')
                + '</div></div>';
            }).join('');
          }
        }

        // If loop ended, notify and reload
        if (!d.state?.active) {
          notifyDone(d.state?.iteration ?? 0);
          location.reload();
        }
      } catch {}
    }, 3000);

    function esc(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
  </script>` : "";

  const IS_WIN = process.platform === "win32";
  const selectorBar = projectSelectorBar(projectCwd, IS_WIN);
  const bodyHtml = selectorBar + buildActivityHtml(projectCwd, state);
  return htmlPage("Activity", bodyHtml, "/activity", extraHead, state, projectCwd);
}

// ─── Route: Logs ──────────────────────────────────────────────────────────────

function routeLogs(cwd: string): string {
  const projectCwd = loadCurrentProject(cwd);
  const state = loadState(projectCwd);
  const history = loadHistory(projectCwd);
  if (!history || !Array.isArray((history as { iterations?: unknown[] }).iterations)) {
    return htmlPage("Logs", `
      <div class="page-header"><h1>🗂 Iteration Logs</h1></div>
      <p class="empty-state">No history yet.</p>
    `, "/logs", "", state);
  }
  const iters = (history as { iterations: Record<string, unknown>[] }).iterations.slice(-10).reverse();
  if (iters.length === 0) {
    return htmlPage("Logs", `
      <div class="page-header"><h1>🗂 Iteration Logs</h1></div>
      <p class="empty-state">No iterations recorded.</p>
    `, "/logs", "", state);
  }

  const cards = iters.map(it => {
    const sec = Math.floor(Number(it.durationMs ?? 0) / 1000);
    const dur = sec > 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`;
    const tools = JSON.stringify(it.toolsUsed ?? {}, null, 2);
    const files = Array.isArray(it.filesModified)
      ? (it.filesModified as string[]).map(f => `<code>${escapeHtml(f)}</code>`).join(" ") || "none"
      : "none";
    const errors = Array.isArray(it.errors) ? (it.errors as string[]).join("\n") : "";
    const ok = it.completionDetected;
    return `<div class="card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span style="font-size:15px;font-weight:600;color:var(--text)">Iteration #${it.iteration}</span>
        ${ok ? '<span class="badge badge-green">✓ completed</span>' : '<span class="badge badge-red">✗ not completed</span>'}
      </div>
      <div class="card-row">
        <span class="card-label">Duration</span>
        <span class="card-value">${dur}</span>
      </div>
      <div class="card-row">
        <span class="card-label">Agent / Model</span>
        <span class="card-value"><code>${escapeHtml(String(it.agent ?? "?"))}</code> / <code>${escapeHtml(String(it.model ?? "?"))}</code></span>
      </div>
      <div class="card-row">
        <span class="card-label">Exit code</span>
        <span class="card-value"><code>${it.exitCode}</code></span>
      </div>
      <div class="card-row">
        <span class="card-label">Files modified</span>
        <span class="card-value" style="font-size:12px">${files}</span>
      </div>
      ${errors ? `<div class="card-row">
        <span class="card-label">Errors</span>
        <span class="card-value"><pre style="margin:0;font-size:11px">${escapeHtml(errors)}</pre></span>
      </div>` : ""}
      <details style="margin-top:10px">
        <summary>Tool usage</summary>
        <pre style="margin-top:6px">${escapeHtml(tools)}</pre>
      </details>
    </div>`;
  }).join("\n");

  return htmlPage("Logs", `
    <div class="page-header">
      <h1>🗂 Iteration Logs</h1>
      <p class="page-subtitle">Last 10 iterations</p>
    </div>
    ${cards}
  `, "/logs", "", state);
}

// ─── Route: Intervene ─────────────────────────────────────────────────────────

function routeInterveneGet(cwd: string, flash?: { type: string; message: string }): string {
  const projectCwd = loadCurrentProject(cwd);
  const state = loadState(projectCwd);
  const current = loadContext(projectCwd);
  const flashHtml = flash
    ? `<div class="alert alert-${flash.type}">${escapeHtml(flash.message)}</div>`
    : "";

  const pendingHtml = current
    ? `<div class="alert alert-info">⏳ Pending context note — will be injected into the next iteration then cleared automatically.</div>
       <pre style="margin-bottom:16px">${escapeHtml(current)}</pre>`
    : `<p style="color:var(--text-muted);margin-bottom:16px;font-size:13px">No pending context note.</p>`;

  return htmlPage("Intervene", `
    <div class="page-header">
      <h1>✦ Intervene</h1>
      <p class="page-subtitle">Inject a context note into the next iteration's prompt, then it's cleared automatically.</p>
    </div>
    ${flashHtml}
    ${pendingHtml}
    <div class="form-section">
      <div class="form-section-title">Context note</div>
      <form method="POST" action="/intervene">
        <div class="form-group" style="margin-bottom:12px">
          <textarea name="context" rows="6"
            placeholder="e.g. The test failure is in tests/auth.test.ts line 42. Try using the singleton pattern instead of a new instance each call."
            >${escapeHtml(current)}</textarea>
        </div>
        <div class="btn-row">
          <button type="submit" class="btn btn-primary">Save context note</button>
          ${current ? `<button type="submit" formaction="/intervene/clear" class="btn btn-ghost">Clear</button>` : ""}
        </div>
      </form>
    </div>
  `, "/intervene", "", state);
}

async function routeIntervenePost(req: Request, cwd: string): Promise<Response> {
  const projectCwd = loadCurrentProject(cwd);
  let body = "";
  try { body = await req.text(); } catch { return new Response("Bad request", { status: 400 }); }
  const context = new URLSearchParams(body).get("context") ?? "";
  const dir = stateDir(projectCwd);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ralph-context.md"), context.trim());
  return new Response(null, { status: 302, headers: { Location: "/intervene?saved=1" } });
}

function routeInterveneClear(cwd: string): Response {
  const p = contextPath(loadCurrentProject(cwd));
  if (existsSync(p)) writeFileSync(p, "");
  return new Response(null, { status: 302, headers: { Location: "/intervene?cleared=1" } });
}

// ─── Route: README ────────────────────────────────────────────────────────────

function routeConsole(cwd: string): string {
  const projectCwd = loadCurrentProject(cwd);
  const state = loadState(projectCwd);
  const isActive = state?.active === true;
  const lp = logPath(projectCwd);
  const content = existsSync(lp) ? lastNLines(readFileSafe(lp), 200) : "";

  const extra = isActive
    ? `<script>
        setInterval(async () => {
          try {
            const r = await fetch('/api/console-log');
            const t = await r.text();
            const el = document.getElementById('console-out');
            if (el && el.dataset.content !== t) {
              el.dataset.content = t;
              el.textContent = t;
              el.scrollTop = el.scrollHeight;
            }
          } catch {}
        }, 2000);
      </script>`
    : "";

  return htmlPage("Console", `
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:12px">
        <h1>🖥 Console Output</h1>
        <button class="btn btn-ghost btn-sm" onclick="location.reload()">↻ Refresh</button>
        ${isActive ? `<span class="badge badge-green">● Live — updating every 2s</span>` : ""}
      </div>
      <p class="page-subtitle">${escapeHtml(lp)} — last 200 lines</p>
    </div>
    ${content
      ? `<pre id="console-out" style="max-height:72vh;overflow-y:auto">${escapeHtml(content)}</pre>
         <script>
           const el = document.getElementById('console-out');
           el.scrollTop = el.scrollHeight;
         </script>`
      : `<p class="empty-state">No output yet. Launch a Ralph loop first.</p>`}
  `, "/console", extra, state);
}

function routeReadme(cwd: string): string {
  const state = loadState(loadCurrentProject(cwd));
  if (!existsSync(RALPH_README_PATH)) {
    return htmlPage("Docs", `
      <div class="page-header"><h1>📖 Docs</h1></div>
      <p class="empty-state">README.md not found at <code>${escapeHtml(RALPH_README_PATH)}</code></p>
    `, "/readme", "", state);
  }
  const raw = readFileSafe(RALPH_README_PATH);
  return htmlPage("Docs", `
    <div class="page-header">
      <h1>📖 Docs</h1>
      <p class="page-subtitle">Ralph Wiggum — README</p>
    </div>
    <div class="readme-body card">${markdownToHtml(raw)}</div>
  `, "/readme", "", state);
}

// ─── Route: GET /api/browse-native (Windows folder picker dialog) ────────────

function routeApiBrowseNative(serverCwd: string): Response {
  if (process.platform !== "win32") {
    return new Response(JSON.stringify({ error: "not-windows" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Run a PowerShell FolderBrowserDialog synchronously.
  // The server blocks on this call until the user picks a folder or cancels.
  const startPath = serverCwd.replace(/'/g, "''");
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.Form
$f.TopMost = $true
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Select project directory for Ralph'
$d.SelectedPath = '${startPath}'
$d.ShowNewFolderButton = $true
$r = $d.ShowDialog($f)
if ($r -eq 'OK') { Write-Output $d.SelectedPath }
`.trim();

  try {
    const proc = Bun.spawnSync(
      ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
      { stdout: "pipe", stderr: "pipe" }
    );
    const output = new TextDecoder().decode(proc.stdout).trim();
    if (output) {
      return new Response(JSON.stringify({ path: output }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    // User cancelled — return empty path
    return new Response(JSON.stringify({ cancelled: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ─── Route: GET /api/browse ───────────────────────────────────────────────────

function routeApiBrowse(req: Request): Response {
  const requested = new URL(req.url).searchParams.get("path") ?? process.cwd();
  let targetPath: string;
  try {
    targetPath = resolve(requested);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid path" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const entries = readdirSync(targetPath, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory())
      .map(e => ({ name: e.name, path: join(targetPath, e.name) }))
      .sort((a, b) => {
        // hidden dirs (dot) go last
        const aHidden = a.name.startsWith(".");
        const bHidden = b.name.startsWith(".");
        if (aHidden !== bHidden) return aHidden ? 1 : -1;
        return a.name.localeCompare(b.name);
      });

    const parent = dirname(targetPath);
    return new Response(
      JSON.stringify({
        current: targetPath,
        parent: parent !== targetPath ? parent : null,
        dirs,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ─── Route: POST /launch ──────────────────────────────────────────────────────

async function routeLaunchPost(req: Request, cwd: string): Promise<Response> {
  let body = "";
  try { body = await req.text(); } catch {
    return new Response("Bad request", { status: 400 });
  }
  const formData = new URLSearchParams(body);
  const error = await launchRalph(formData, cwd);
  if (error) {
    const html = routeLaunchGet(cwd, { type: "error", message: error });
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  return new Response(null, { status: 302, headers: { Location: "/status" } });
}

// ─── Route: POST /stop ────────────────────────────────────────────────────────

async function routeStop(cwd: string): Promise<Response> {
  const ok = await stopRalph(cwd);
  if (!ok) {
    return new Response(null, { status: 302, headers: { Location: "/status?stop_error=1" } });
  }
  return new Response(null, { status: 302, headers: { Location: "/status?stopped=1" } });
}

// ─── Route: GET /api/status ───────────────────────────────────────────────────

function routeApiStatus(cwd: string): Response {
  const state = loadState(loadCurrentProject(cwd));
  return new Response(JSON.stringify(state ?? { active: false }), {
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Route: GET /api/activity-data ───────────────────────────────────────────

function routeApiActivityData(cwd: string): Response {
  const projectCwd = loadCurrentProject(cwd);
  const state = loadState(projectCwd);
  const actContent = readFileSafe(activityPath(projectCwd));
  const planContent = readFileSafe(planPath(projectCwd));
  const sections = actContent ? parseActivityMd(actContent) : [];
  const progress = planContent ? parsePlanProgress(planContent, state?.active === true) : null;
  return new Response(
    JSON.stringify({ state, sections, progress }),
    { headers: { "Content-Type": "application/json" } }
  );
}

// ─── Route: GET /api/plan-data ────────────────────────────────────────────────

function routeApiPlanData(cwd: string): Response {
  const projectCwd = loadCurrentProject(cwd);
  const state = loadState(projectCwd);
  const isActive = state?.active === true;
  const planContent = readFileSafe(planPath(projectCwd));
  // Return just the inner plan content HTML (the #plan-content div's innerHTML)
  const { sections, total, done } = planContent
    ? parsePlanSections(planContent, isActive)
    : { sections: [], total: 0, done: 0 };

  let planHtml: string;
  if (!planContent.trim()) {
    planHtml = `<p class="empty-state">No <code>IMPLEMENTATION_PLAN.md</code> found.</p>`;
  } else if (total === 0) {
    planHtml = `<div class="card plan-markdown">${simpleMarkdownToHtml(planContent)}</div>`;
  } else {
    const pct = Math.round((done / total) * 100);
    const progressHtml = `
    <div class="progress-wrap">
      <div class="progress-meta">
        <span>Tasks complete: <strong>${done} / ${total}</strong></span>
        <strong>${pct}%</strong>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>`;
    const sectionsHtml = sections.map(sec => {
      if (sec.tasks.length === 0 && !sec.heading && sec.notes.length === 0) return "";
      const tag = sec.level <= 1 ? "h2" : sec.level === 2 ? "h3" : "h4";
      const headingHtml = sec.heading
        ? `<div class="plan-sec-heading level-${sec.level}"><${tag}>${escapeHtml(sec.heading)}</${tag}></div>` : "";
      const notesHtml = sec.notes.length
        ? `<p class="plan-sec-note">${sec.notes.map(n => escapeHtml(n)).join(" ")}</p>` : "";
      const tasksHtml = sec.tasks.map(t => {
        const icon = t.status === "done" ? "✓" : t.status === "active" ? "▶" : "○";
        const label = t.status === "done" ? "done" : t.status === "active" ? "in progress" : "pending";
        return `<div class="task-item ${t.status}">
          <div class="task-icon-wrap ${t.status}">${icon}</div>
          <span class="task-text">${escapeHtml(t.text)}</span>
          <span class="task-status-label">${label}</span>
        </div>`;
      }).join("");
      return `<div class="plan-section">
        ${headingHtml}${notesHtml}
        ${tasksHtml ? `<div class="task-list">${tasksHtml}</div>` : ""}
      </div>`;
    }).join("");
    planHtml = `${progressHtml}<div class="plan-sections">${sectionsHtml}</div>`;
  }

  return new Response(JSON.stringify({ planHtml, isActive }), {
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Route: GET /api/console-log ─────────────────────────────────────────────

function routeApiConsoleLog(cwd: string): Response {
  const lp = logPath(loadCurrentProject(cwd));
  const content = existsSync(lp) ? lastNLines(readFileSafe(lp), 200) : "";
  return new Response(content, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

// ─── Route: POST /api/set-project ────────────────────────────────────────────

async function routeApiSetProject(req: Request, serverCwd: string): Promise<Response> {
  try {
    const body = await req.text();
    const data = JSON.parse(body);
    const cwd = String(data.cwd ?? "").trim();
    if (!cwd) return new Response(JSON.stringify({ error: "cwd required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    if (!existsSync(cwd)) return new Response(JSON.stringify({ error: "Directory not found" }), { status: 400, headers: { "Content-Type": "application/json" } });
    saveCurrentProject(serverCwd, cwd);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
}

// ─── Route: GET /api/project-info ────────────────────────────────────────────

/** Generate (or load) a human-readable project summary at .ralph/project-summary.md */
function generateProjectSummary(cwd: string): void {
  const summaryFile = join(stateDir(cwd), "project-summary.md");
  // Gather project metadata
  const dirName = cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? cwd;
  let name = dirName, version = "", description = "";
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSafe(pkgPath));
      name = pkg.name ?? dirName;
      version = pkg.version ?? "";
      description = pkg.description ?? "";
    } catch {}
  }
  // README excerpt
  let readmeExcerpt = "";
  const readmePath = join(cwd, "README.md");
  if (existsSync(readmePath)) readmeExcerpt = readFileSafe(readmePath).substring(0, 700).trim();
  // Git info
  let gitBranch = "", gitLog = "";
  try {
    const br = Bun.spawnSync(["git", "branch", "--show-current"], { cwd, stdout: "pipe", stderr: "ignore" });
    gitBranch = new TextDecoder().decode(br.stdout).trim();
    const lg = Bun.spawnSync(["git", "log", "--oneline", "-5"], { cwd, stdout: "pipe", stderr: "ignore" });
    gitLog = new TextDecoder().decode(lg.stdout).trim();
  } catch {}
  // Key files (top-level, non-hidden)
  let keyFiles: string[] = [];
  try {
    keyFiles = readdirSync(cwd, { withFileTypes: true })
      .filter(e => e.isFile() && !e.name.startsWith("."))
      .map(e => e.name).slice(0, 20);
  } catch {}

  const lines: string[] = [
    `# Project: ${name}`, "",
    `**Path:** \`${cwd}\``,
    version     ? `**Version:** ${version}`      : "",
    description ? `**Description:** ${description}` : "",
    "",
  ];
  if (gitBranch || gitLog) {
    lines.push("## Git");
    if (gitBranch) lines.push(`**Branch:** ${gitBranch}`, "");
    if (gitLog) {
      lines.push("**Recent commits:**");
      gitLog.split("\n").forEach(l => lines.push(`- ${l}`));
      lines.push("");
    }
  }
  if (keyFiles.length) {
    lines.push("## Key Files");
    keyFiles.forEach(f => lines.push(`- ${f}`));
    lines.push("");
  }
  if (readmeExcerpt) {
    lines.push("## README Excerpt", "");
    lines.push(readmeExcerpt);
    if (readmeExcerpt.length >= 700) lines.push("…");
    lines.push("");
  }
  mkdirSync(stateDir(cwd), { recursive: true });
  writeFileSync(summaryFile, lines.filter(l => l !== undefined).join("\n"), "utf-8");
}

async function routeApiProjectInfo(req: Request): Promise<Response> {
  const cwd = decodeURIComponent(new URL(req.url).searchParams.get("cwd") ?? "").trim();
  if (!cwd) return new Response(JSON.stringify({ error: "cwd required" }), { headers: { "Content-Type": "application/json" } });
  if (!existsSync(cwd)) return new Response(JSON.stringify({ error: "Directory not found" }), { headers: { "Content-Type": "application/json" } });

  const dirName = cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? cwd;
  let name = dirName, version = "", description = "";
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSafe(pkgPath));
      name = pkg.name ?? dirName;
      version = pkg.version ?? "";
      description = pkg.description ?? "";
    } catch {}
  }
  let gitBranch = "";
  try {
    const r = Bun.spawnSync(["git", "branch", "--show-current"], { cwd, stdout: "pipe", stderr: "ignore" });
    gitBranch = new TextDecoder().decode(r.stdout).trim();
  } catch {}

  const state = loadState(cwd);
  generateProjectSummary(cwd);

  return new Response(JSON.stringify({
    name, version, description, gitBranch,
    lastRun: state ? {
      iteration: state.iteration,
      agent:     state.agent,
      prompt:    state.prompt,
      startedAt: state.startedAt,
      active:    state.active,
    } : null,
    hasPlan:     existsSync(planPath(cwd)),
    hasActivity: existsSync(activityPath(cwd)),
  }), { headers: { "Content-Type": "application/json" } });
}

// ─── Route: POST /api/enrich-prompt ──────────────────────────────────────────

/** Collect lightweight project context for prompt enrichment (not sent to user). */
function buildEnrichmentContext(projectCwd: string): string {
  const parts: string[] = [];

  // package.json
  const pkgPath = join(projectCwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSafe(pkgPath));
      if (pkg.name)        parts.push(`Project: ${pkg.name}${pkg.version ? ` v${pkg.version}` : ""}`);
      if (pkg.description) parts.push(`Description: ${pkg.description}`);
      const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
      if (deps.length) parts.push(`Tech stack: ${deps.slice(0, 25).join(", ")}${deps.length > 25 ? "…" : ""}`);
    } catch {}
  }

  // README first 25 lines
  for (const name of ["README.md", "readme.md", "Readme.md"]) {
    const rp = join(projectCwd, name);
    if (existsSync(rp)) {
      try {
        const excerpt = readFileSafe(rp).split("\n").slice(0, 25).join("\n").trim();
        if (excerpt) parts.push(`\nREADME (excerpt):\n${excerpt}`);
      } catch {}
      break;
    }
  }

  // Top-level structure
  try {
    const skip = new Set(["node_modules", ".git", ".next", "dist", "build", "__pycache__", ".venv", "venv"]);
    const entries = readdirSync(projectCwd, { withFileTypes: true })
      .filter(e => !skip.has(e.name) && !e.name.startsWith("."))
      .map(e => e.isDirectory() ? `${e.name}/` : e.name)
      .slice(0, 30);
    if (entries.length) parts.push(`\nProject files:\n${entries.join("\n")}`);
  } catch {}

  return parts.join("\n");
}

async function routeApiEnrichPrompt(req: Request, serverCwd: string): Promise<Response> {
  let body: { prompt?: string; baseUrl?: string; model?: string; agent?: string } = {};
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const rawPrompt = String(body.prompt ?? "").trim();
  if (!rawPrompt) {
    return new Response(JSON.stringify({ error: "prompt is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const baseUrl  = String(body.baseUrl ?? "").trim().replace(/\/+$/, "");
  const agent    = String(body.agent  ?? "").trim();
  const modelRaw = String(body.model  ?? "").trim();

  // Determine backend: base-url → OpenAI-compat; claude-code / claude-* model → Anthropic; fallback → OpenAI
  const useAnthropicKey =
    !baseUrl &&
    (agent === "claude-code" || modelRaw.toLowerCase().startsWith("claude")) &&
    !!process.env.ANTHROPIC_API_KEY;

  const useOpenAICompat = !!baseUrl || (!useAnthropicKey && !!process.env.OPENAI_API_KEY);

  if (!useAnthropicKey && !useOpenAICompat) {
    const hint = (agent === "claude-code" || modelRaw.toLowerCase().startsWith("claude"))
      ? "Set ANTHROPIC_API_KEY, or enter a Base URL."
      : "Enter a Base URL (e.g. http://localhost:11434/v1) or set OPENAI_API_KEY.";
    return new Response(JSON.stringify({ error: `No LLM API configured. ${hint}` }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const projectCwd = loadCurrentProject(serverCwd);
  const context = buildEnrichmentContext(projectCwd);

  const systemPrompt = `You are a software task specification assistant.

Below is project context (for your understanding only — do NOT include it in the output):
${context}

Your job: rewrite the user's rough task description into a clear, specific, actionable task.
Rules:
- Return ONLY the improved task description as plain text — no preamble, no explanations, no project context
- Be specific: reference the relevant files, functions, or components from the project context
- Keep the same intent as the original
- Use imperative mood ("Fix…", "Add…", "Refactor…")
- 2–6 sentences is ideal`;

  try {
    let enriched = "";

    if (useAnthropicKey) {
      // ── Anthropic Messages API ────────────────────────────────────
      const model = modelRaw || "claude-haiku-4-5-20251001";
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 600,
          system: systemPrompt,
          messages: [{ role: "user", content: rawPrompt }],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        return new Response(JSON.stringify({ error: `Anthropic API error ${resp.status}: ${txt.slice(0, 200)}` }), {
          status: 502, headers: { "Content-Type": "application/json" },
        });
      }
      const data = await resp.json() as { content?: Array<{ type: string; text?: string }> };
      enriched = data?.content?.find(b => b.type === "text")?.text?.trim() ?? "";
    } else {
      // ── OpenAI-compatible API ─────────────────────────────────────
      const apiBase = baseUrl ? (baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`) : "https://api.openai.com/v1";
      const apiKey  = process.env.OPENAI_API_KEY ?? "local";
      const model   = modelRaw || (baseUrl ? undefined : "gpt-4o-mini");
      const resp = await fetch(`${apiBase}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: model ?? "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: rawPrompt },
          ],
          max_tokens: 600,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        return new Response(JSON.stringify({ error: `LLM API error ${resp.status}: ${txt.slice(0, 200)}` }), {
          status: 502, headers: { "Content-Type": "application/json" },
        });
      }
      const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
      enriched = data?.choices?.[0]?.message?.content?.trim() ?? "";
    }

    if (!enriched) {
      return new Response(JSON.stringify({ error: "Empty response from LLM" }), { status: 502, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ prompt: enriched }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: `Request failed: ${String(e)}` }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}

// ─── Route: GET /api/models ───────────────────────────────────────────────────

async function routeApiModels(req: Request): Promise<Response> {
  const url = new URL(req.url).searchParams.get("url") ?? "";
  if (!url) {
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
    });
  }
  const base = url.replace(/\/+$/, "").replace(/\/v1$/, "");
  try {
    const resp = await fetch(`${base}/api/tags`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json() as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map(m => m.name);
    return new Response(JSON.stringify(models), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ─── Server ───────────────────────────────────────────────────────────────────

export async function startDashboard(port: number, openBrowser: boolean, cwd: string): Promise<void> {
  (globalThis as any).__dashboardPort = port;
  const server = Bun.serve({
    port,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;
      const html = (s: string) => new Response(s, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const q = url.searchParams;

      if (path === "/logo.png") {
        if (existsSync(RALPH_LOGO_PATH)) {
          return new Response(Bun.file(RALPH_LOGO_PATH));
        }
        return new Response("Not Found", { status: 404 });
      }
      if (path === "/" || path === "")    return new Response(null, { status: 302, headers: { Location: "/launch" } });
      if (path === "/launch") {
        if (req.method === "POST") return routeLaunchPost(req, cwd);
        let flash: { type: string; message: string } | undefined;
        if (q.get("error"))   flash = { type: "error",   message: q.get("error")! };
        return html(routeLaunchGet(cwd, flash));
      }
      if (path === "/status")             return html(routeStatus(cwd));
      if (path === "/plan")               return html(routePlan(cwd));
      if (path === "/activity")           return html(routeActivity(cwd));
      if (path === "/logs")               return html(routeLogs(cwd));
      if (path === "/readme")             return html(routeReadme(cwd));
      if (path === "/console")            return html(routeConsole(cwd));
      if (path === "/api/console-log")    return routeApiConsoleLog(cwd);
      if (path === "/api/activity-data")  return routeApiActivityData(cwd);
      if (path === "/api/plan-data")      return routeApiPlanData(cwd);
      if (path === "/api/set-project" && req.method === "POST") return routeApiSetProject(req, cwd);
      if (path === "/intervene") {
        if (req.method === "POST") return routeIntervenePost(req, cwd);
        let flash: { type: string; message: string } | undefined;
        if (q.get("saved"))   flash = { type: "success", message: "Context note saved. It will be injected into the next iteration." };
        if (q.get("cleared")) flash = { type: "success", message: "Context note cleared." };
        return html(routeInterveneGet(cwd, flash));
      }
      if (path === "/intervene/clear")    return routeInterveneClear(cwd);
      if (path === "/stop" && req.method === "POST") return routeStop(cwd);
      if (path === "/api/status")         return routeApiStatus(cwd);
      if (path === "/api/models")         return routeApiModels(req);
      if (path === "/api/browse")         return routeApiBrowse(req);
      if (path === "/api/browse-native")  return routeApiBrowseNative(cwd);
      if (path === "/api/project-info")   return routeApiProjectInfo(req);
      if (path === "/api/enrich-prompt" && req.method === "POST") return routeApiEnrichPrompt(req, cwd);

      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║           Ralph Dashboard                                        ║`);
  console.log(`║  http://localhost:${port}${" ".repeat(Math.max(0, 46 - String(port).length))}║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝`);
  console.log(`  /launch    — compose & start a new Ralph loop`);
  console.log(`  /status    — active loop state & iteration history`);
  console.log(`  /plan      — IMPLEMENTATION_PLAN.md viewer`);
  console.log(`  /activity  — activity.md log (last 120 lines)`);
  console.log(`  /logs      — detailed per-iteration logs`);
  console.log(`  /intervene — inject a context note into the next iteration`);
  console.log(`  /readme    — documentation`);
  console.log(`\nPress Ctrl+C to stop.`);

  if (openBrowser) {
    const launchUrl = `http://localhost:${port}/launch`;
    const cmd = process.platform === "win32" ? ["cmd", "/c", "start", launchUrl]
              : process.platform === "darwin" ? ["open", launchUrl]
              : ["xdg-open", launchUrl];
    try { Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }); } catch { /* best-effort */ }
  }

  await new Promise<void>(() => {
    process.on("SIGINT", () => { server.stop(); console.log("\nDashboard stopped."); process.exit(0); });
  });
}
