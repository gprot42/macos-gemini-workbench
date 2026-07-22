#!/bin/bash
set -e

APP_NAME="Gemini Workbench"
SCRIPT_DIR_EARLY="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR_EARLY/scripts/sync-version.mjs" >/dev/null
VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/')
ARCH=$(uname -m)
DMG_NAME="Gemini-Workbench_${VERSION}_${ARCH}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="gprot42/app-gemini-workbench"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --release    Create a GitHub release and upload the DMG"
    echo "  --help       Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0            Build DMG only"
    echo "  $0 --release  Build DMG and create GitHub release"
}

CREATE_RELEASE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --release)
            CREATE_RELEASE=true
            shift
            ;;
        --help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

echo "================================================"
echo "  Building ${APP_NAME} v${VERSION}"
echo "================================================"

cd "$SCRIPT_DIR"

echo ""
echo "[1/5] Checking dependencies..."
echo "------------------------------------------------"

if ! command -v cargo &> /dev/null; then
    echo "Error: Rust/Cargo not found. Install from https://rustup.rs"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "Error: Node.js not found. Install from https://nodejs.org"
    exit 1
fi

if [ "$CREATE_RELEASE" = true ] && ! command -v gh &> /dev/null; then
    echo "Error: GitHub CLI (gh) not found. Install from https://cli.github.com"
    exit 1
fi

if command -v bun &> /dev/null; then
    PKG_MGR="bun"
elif command -v pnpm &> /dev/null; then
    PKG_MGR="pnpm"
else
    PKG_MGR="npm"
fi

echo "Using package manager: $PKG_MGR"
echo "Rust version: $(rustc --version)"
echo "Node version: $(node --version)"

echo ""
echo "[2/5] Installing frontend dependencies..."
echo "------------------------------------------------"
$PKG_MGR install

echo ""
echo "[3/5] Building frontend..."
echo "------------------------------------------------"
$PKG_MGR run build

echo ""
echo "[4/5] Building Tauri application..."
echo "------------------------------------------------"
cd src-tauri

if [ ! -f "icons/icon.icns" ]; then
    echo "icon.icns missing — regenerating from icons/1024x1024.png..."
    if [ ! -f "icons/1024x1024.png" ]; then
        echo "ERROR: icons/1024x1024.png is required to build macOS icons." >&2
        exit 1
    fi
    python3 "$SCRIPT_DIR/scripts/regenerate-icons.py" || exit 1
fi

"${SCRIPT_DIR}/node_modules/.bin/tauri" build --bundles dmg --ignore-version-mismatches || echo "Warning: Tauri DMG bundling failed, will create DMG manually"

cd "$SCRIPT_DIR"

echo ""
echo "[5/5] Locating DMG..."
echo "------------------------------------------------"

FINAL_DMG="${SCRIPT_DIR}/${DMG_NAME}.dmg"
APP_BUNDLE="src-tauri/target/release/bundle/macos/${APP_NAME}.app"

DMG_PATH=$(find src-tauri/target/release/bundle/dmg -name "*.dmg" -not -name "rw.*" 2>/dev/null | head -1)

if [ -z "$DMG_PATH" ] && [ -d "$APP_BUNDLE" ]; then
    echo "Creating DMG manually from .app bundle..."
    mkdir -p src-tauri/target/release/bundle/dmg
    hdiutil create -volname "${APP_NAME}" -srcfolder "$APP_BUNDLE" -ov -format UDZO "$FINAL_DMG"
elif [ -n "$DMG_PATH" ]; then
    cp "$DMG_PATH" "$FINAL_DMG"
else
    echo "Error: Neither DMG nor .app bundle found in build output"
    echo "Check src-tauri/target/release/bundle/ for build artifacts"
    exit 1
fi

rm -f src-tauri/target/release/bundle/macos/rw.*.dmg 2>/dev/null || true

echo ""
echo "================================================"
echo "  Build Complete!"
echo "================================================"
echo ""
echo "DMG Location: $FINAL_DMG"
echo "Size: $(du -h "$FINAL_DMG" | cut -f1)"
echo ""
echo "The .dmg contains a self-contained .app bundle"
echo "with all frameworks and libraries embedded."
echo ""

if [ "$CREATE_RELEASE" = true ]; then
    echo ""
    echo "[6/6] Creating GitHub Release..."
    echo "------------------------------------------------"
    
    TAG="v${VERSION}"
    RELEASE_TITLE="${APP_NAME} ${TAG}"
    RELEASE_NOTES="## ${APP_NAME} ${TAG}

### Downloads
- **macOS (${ARCH})**: ${DMG_NAME}.dmg

### What's New
- Gemini 3.5 Flash-Lite on Vertex AI, AI Studio, OpenRouter, and Kilo Code
- Gemini 3.5 Flash Cyber for vulnerability find/patch workflows (limited pilot access)
- Coding agent support for 3.5 Flash-Lite and 3.5 Flash Cyber
- Minimal thinking level option for high-throughput models
- Gemini 3.6 Flash on Vertex AI, AI Studio, OpenRouter, and Kilo Code
- Claude 4.8 Opus and 4.6 Sonnet (Vertex AI, OpenRouter, Kilo Code)
- Vibe Coding Agent with multi-model support
- Safety guards for file operations
- Multiple prompt sessions with tabs
- Token tracking with cost estimation
- DevTools accessible from View menu

### Installation
1. Download the DMG file for your architecture
2. Open the DMG and drag Gemini Workbench to Applications
3. Launch from Applications folder

Built with Tauri, React, and Rust. No external dependencies required."

    echo "Creating release ${TAG}..."
    
    if gh release view "$TAG" --repo "$REPO" &> /dev/null; then
        echo "Release ${TAG} already exists, uploading asset..."
        gh release upload "$TAG" "$FINAL_DMG" --repo "$REPO" --clobber
    else
        gh release create "$TAG" "$FINAL_DMG" \
            --repo "$REPO" \
            --title "$RELEASE_TITLE" \
            --notes "$RELEASE_NOTES"
    fi
    
    echo ""
    echo "GitHub Release created: https://github.com/${REPO}/releases/tag/${TAG}"
else
    if command -v open &> /dev/null; then
        read -p "Open DMG? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            open "$FINAL_DMG"
        fi
    fi
fi
