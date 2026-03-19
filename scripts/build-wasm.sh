#!/bin/bash
set -euo pipefail

echo "🔨 Building ghostty-vt.wasm..."

ROOT_DIR=$(pwd)
GHOSTTY_DIR="$ROOT_DIR/ghostty"
PATCH_FILE="$ROOT_DIR/patches/ghostty-wasm-api.patch"

# Check for Zig
if ! command -v zig &> /dev/null; then
    echo "❌ Error: Zig not found"
    echo ""
    echo "Install Zig 0.15.2+:"
    echo "  macOS:   brew install zig"
    echo "  Linux:   https://ziglang.org/download/"
    echo ""
    exit 1
fi

ZIG_VERSION=$(zig version)
echo "✓ Found Zig $ZIG_VERSION"

# Initialize/update submodule
if [ ! -e "ghostty/.git" ]; then
    echo "📦 Initializing Ghostty submodule..."
    git submodule update --init --recursive
else
    echo "📦 Ghostty submodule already initialized"
fi

# Apply patch
echo "🔧 Applying WASM API patch..."
if ! git -C "$GHOSTTY_DIR" diff --quiet --ignore-submodules -- || ! git -C "$GHOSTTY_DIR" diff --cached --quiet --ignore-submodules --; then
    echo "❌ Ghostty submodule has local changes"
    echo "Commit, stash, or restore the submodule before rebuilding ghostty-vt.wasm"
    exit 1
fi

cleanup() {
    git -C "$GHOSTTY_DIR" apply -R "$PATCH_FILE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

git -C "$GHOSTTY_DIR" apply --check "$PATCH_FILE" || {
    echo "❌ Patch doesn't apply cleanly"
    echo "Ghostty may have changed. Check patches/ghostty-wasm-api.patch"
    exit 1
}
git -C "$GHOSTTY_DIR" apply "$PATCH_FILE"

# Build WASM
echo "⚙️  Building WASM (takes ~20 seconds)..."
(
    cd "$GHOSTTY_DIR"
    zig build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall
)

# Copy to project root
cp "$GHOSTTY_DIR/zig-out/bin/ghostty-vt.wasm" "$ROOT_DIR/"

SIZE=$(du -h ghostty-vt.wasm | cut -f1)
echo "✅ Built ghostty-vt.wasm ($SIZE)"
