#!/bin/bash
# Uninstall script for Ralph Wiggum CLI

echo "Uninstalling Ralph Wiggum CLI..."
echo ""

removed=0

# ── Remove bun-linked binaries from ~/.bun/bin ────────────────────────────────
# bun link drops the binary here; bun unlink is not yet implemented
BUN_BIN="$HOME/.bun/bin"
for file in ralph ralph.bunx ralph.exe; do
  target="$BUN_BIN/$file"
  if [ -f "$target" ]; then
    rm -f "$target"
    echo "  Removed $target"
    removed=1
  fi
done

# ── Remove npm global install ─────────────────────────────────────────────────
if command -v npm &>/dev/null; then
  if npm list -g --depth=0 2>/dev/null | grep -q "@flywalk4/ralph-wiggum"; then
    echo "  Removing npm global package..."
    npm uninstall -g @flywalk4/ralph-wiggum 2>/dev/null
    removed=1
  fi
fi

# ── Remove any remaining ralph shim on PATH ───────────────────────────────────
RALPH_PATH="$(command -v ralph 2>/dev/null || true)"
if [ -n "$RALPH_PATH" ] && [ -f "$RALPH_PATH" ]; then
  rm -f "$RALPH_PATH"
  echo "  Removed $RALPH_PATH"
  removed=1
fi

echo ""
if [ "$removed" -eq 1 ]; then
  echo "Uninstall complete!"
else
  echo "Nothing to uninstall (ralph was not found on this system)."
fi
echo "You may also delete the cloned repository folder."
