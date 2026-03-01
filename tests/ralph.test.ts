import { describe, expect, it } from "bun:test";
import { checkTerminalPromise, getLastNonEmptyLine, tasksMarkdownAllComplete, filterGitLogIssues, mergePresetWithDefaults } from "../completion";

describe("checkTerminalPromise", () => {
  it("detects completion when promise tag is the final non-empty line", () => {
    const output = [
      "Implemented changes.",
      "All tests pass.",
      "<promise>LEGION_EPIC_DONE_2026_02_17</promise>",
      "",
    ].join("\n");

    expect(checkTerminalPromise(output, "LEGION_EPIC_DONE_2026_02_17")).toBe(true);
  });

  it("does not detect completion when promise appears earlier in output", () => {
    const output = [
      "Do not output <promise>LEGION_EPIC_DONE_2026_02_17</promise> yet.",
      "Still working on pending items.",
    ].join("\n");

    expect(checkTerminalPromise(output, "LEGION_EPIC_DONE_2026_02_17")).toBe(false);
  });

  it("does not detect completion when a different final promise is emitted", () => {
    const output = [
      "Task complete, moving to next task.",
      "<promise>READY_FOR_NEXT_TASK</promise>",
    ].join("\n");

    expect(checkTerminalPromise(output, "LEGION_EPIC_DONE_2026_02_17")).toBe(false);
  });

  it("accepts flexible whitespace inside promise tags", () => {
    const output = "<promise>   COMPLETE   </promise>";
    expect(checkTerminalPromise(output, "COMPLETE")).toBe(true);
  });
});

describe("getLastNonEmptyLine", () => {
  it("ignores empty trailing lines", () => {
    const output = "line 1\nline 2\n\n";
    expect(getLastNonEmptyLine(output)).toBe("line 2");
  });
});

describe("tasksMarkdownAllComplete", () => {
  it("requires at least one task", () => {
    expect(tasksMarkdownAllComplete("# Ralph Tasks\n\nNo tasks yet.")).toBe(false);
  });

  it("returns false when any task is todo or in-progress", () => {
    const markdown = [
      "# Ralph Tasks",
      "- [x] Completed task",
      "- [ ] Pending task",
      "  - [/] Subtask in progress",
    ].join("\n");

    expect(tasksMarkdownAllComplete(markdown)).toBe(false);
  });

  it("returns true only when all task checkboxes are complete", () => {
    const markdown = [
      "# Ralph Tasks",
      "- [x] Task 1",
      "- [X] Task 2",
      "  - [x] Subtask 2.1",
    ].join("\n");

    expect(tasksMarkdownAllComplete(markdown)).toBe(true);
  });
});

describe("filterGitLogIssues — keyword matching", () => {
  const KEYWORDS = ["TODO", "FIXME", "ERROR", "FAIL", "BROKEN", "BUG", "HACK"];

  it("detects TODO in a commit message", () => {
    const lines = ["abc1234 fix: TODO remove this before release", "def5678 feat: add login"];
    expect(filterGitLogIssues(lines, KEYWORDS)).toEqual(["abc1234 fix: TODO remove this before release"]);
  });

  it("returns empty array for clean log", () => {
    const lines = ["abc1234 feat: add auth", "def5678 fix: typo in README"];
    expect(filterGitLogIssues(lines, KEYWORDS)).toEqual([]);
  });

  it("is case-insensitive (lowercase keyword in commit)", () => {
    const lines = ["abc1234 fix: broken auth flow", "def5678 refactor: cleanup"];
    expect(filterGitLogIssues(lines, KEYWORDS)).toEqual(["abc1234 fix: broken auth flow"]);
  });

  it("detects FAIL keyword", () => {
    const lines = ["aaa0001 chore: tests fail on CI", "bbb0002 docs: update README"];
    expect(filterGitLogIssues(lines, KEYWORDS)).toEqual(["aaa0001 chore: tests fail on CI"]);
  });

  it("filters out blank lines", () => {
    const lines = ["", "  ", "abc1234 bug: null pointer"];
    const result = filterGitLogIssues(lines, KEYWORDS);
    expect(result).toEqual(["abc1234 bug: null pointer"]);
  });

  it("returns multiple matching lines", () => {
    const lines = [
      "aaa0001 fix: TODO leftover",
      "bbb0002 chore: hack around api limit",
      "ccc0003 feat: add dashboard",
    ];
    expect(filterGitLogIssues(lines, KEYWORDS)).toEqual([
      "aaa0001 fix: TODO leftover",
      "bbb0002 chore: hack around api limit",
    ]);
  });
});

describe("mergePresetWithDefaults — preset loading", () => {
  it("returns preset values when no defaults", () => {
    const result = mergePresetWithDefaults({}, { prompt: "hello", maxIterations: 5 });
    expect(result).toEqual({ prompt: "hello", maxIterations: 5 });
  });

  it("merges defaults under preset-specific values", () => {
    const defaults = { agent: "opencode", maxIterations: 50 };
    const preset = { prompt: "Build API", agent: "claude-code", maxIterations: 30 };
    const result = mergePresetWithDefaults(defaults, preset);
    expect(result.agent).toBe("claude-code");
    expect(result.maxIterations).toBe(30);
    expect(result.prompt).toBe("Build API");
  });

  it("fills in defaults for fields not in preset", () => {
    const defaults = { agent: "opencode", maxIterations: 50 };
    const preset = { prompt: "My task" };
    const result = mergePresetWithDefaults(defaults, preset);
    expect(result.agent).toBe("opencode");
    expect(result.maxIterations).toBe(50);
    expect(result.prompt).toBe("My task");
  });

  it("handles empty preset gracefully", () => {
    const defaults = { agent: "opencode" };
    const result = mergePresetWithDefaults(defaults, {});
    expect(result.agent).toBe("opencode");
  });
});
