#!/usr/bin/env bash
#
# MooshieUI fork — one-shot installer for a PORTABLE ComfyUI.
#
# Idempotent. Installs every custom node + Python dependency MooshieUI needs
# into an existing ComfyUI_windows_portable installation, so the app works
# out of the box on a clean portable without opening the in-app setup wizard.
#
# Mirrors the nodes the app auto-installs on startup (nodes.rs) so a pre-built
# binary can also be pointed at this portable ComfyUI.
#
# Usage:
#   bash scripts/install-portable-comfyui.sh --portable C:/AI/comfyui-portable/ComfyUI_windows_portable
#
# Flags:
#   --portable <dir>   Path to the portable root (contains python_embeded/ and ComfyUI/).
#   --python <path>    (optional) Override the python.exe to install deps with.
#                      Defaults to python_embeded/python.exe inside --portable.
#
set -euo pipefail

# --- Resolve portable root -------------------------------------------------
PORTABLE=""
PYTHON=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --portable) PORTABLE="$2"; shift 2 ;;
    --python)   PYTHON="$2";  shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$PORTABLE" ]]; then
  echo "Missing --portable <dir>" >&2; exit 2
fi
PORTABLE="$(cd "$PORTABLE" 2>/dev/null && pwd || echo "$PORTABLE")"
COMFY="$PORTABLE/ComfyUI"
EMBED="$PORTABLE/python_embeded"
PYTHON="${PYTHON:-$EMBED/python.exe}"

if [[ ! -f "$COMFY/main.py" ]]; then
  echo "ERROR: no ComfyUI at '$COMFY/main.py'" >&2; exit 1
fi
if [[ ! -f "$PYTHON" ]]; then
  echo "ERROR: python not found at '$PYTHON'" >&2; exit 1
fi

CUSTOM_NODES="$COMFY/custom_nodes"
mkdir -p "$CUSTOM_NODES"
echo "★ Portable:      $PORTABLE"
echo "★ ComfyUI:       $COMFY"
echo "★ Python:        $PYTHON"
echo "★ Custom nodes:  $CUSTOM_NODES"

# --- 1. Core Python deps (ComfyUI ≥0.30 + GGUF + tiled upscale) ------------
echo ""
echo "▶ Installing core Python dependencies into portable Python..."
"$PYTHON" -m pip install --no-warn-script-location \
  sqlalchemy gguf numpy pillow

# --- 2. Git-clone every custom node MooshieUI requires ---------------------
# (mirrors REQUIRED_* packages in src-tauri/src/comfyui/nodes.rs)
declare -A NODES=(
  # ControlNet aux (preprocessors)
  [comfyui_controlnet_aux]="https://github.com/Fannovel16/comfyui_controlnet_aux.git"
  # GGUF quantized models
  [ComfyUI-GGUF]="https://github.com/city96/ComfyUI-GGUF.git"
  # Style transfer
  [ComfyUi-Untwisting-RoPE]="https://github.com/BigStationW/ComfyUi-Untwisting-RoPE.git"
  [ComfyUi-Scale-Image-to-Total-Pixels-Advanced]="https://github.com/BigStationW/ComfyUi-Scale-Image-to-Total-Pixels-Advanced.git"
  # Frame interpolation (RIFE) for video
  [ComfyUI-Frame-Interpolation]="https://github.com/Fannovel16/ComfyUI-Frame-Interpolation.git"
  # Video H3 turbo variant
  [ComfyUI-MiniMax-H3-Turbo]="https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo.git"
)

echo ""
echo "▶ Cloning required custom nodes..."
for name in "${!NODES[@]}"; do
  target="$CUSTOM_NODES/$name"
  url="${NODES[$name]}"
  if [[ -d "$target/.git" ]]; then
    echo "  • $name — already present, skipping"
    continue
  fi
  echo "  • $name"
  rm -rf "$target"
  git clone --depth=1 "$url" "$target" || {
    echo "    ✗ clone failed for $name (continuing)" >&2
  }
done

# --- 3. Deploy MooshieUI's own custom nodes --------------------------------
echo ""
echo "▶ Deploying MooshieUI custom nodes..."
MN_SRC="$(cd "$(dirname "$0")/../comfyui-nodes" && pwd)"  # repo comfyui-nodes/
MN_DST="$CUSTOM_NODES/mooshie-nodes"
mkdir -p "$MN_DST"
if [[ -d "$MN_SRC" ]]; then
  cp -f "$MN_SRC"/nodes_*.py "$MN_SRC"/sdxl_flux2vae_init.py "$MN_DST"/ 2>/dev/null || true
  if [[ ! -f "$MN_DST/__init__.py" ]]; then
    # The app injects __init__.py at runtime; provide a fallback stub so the
    # pack is importable even before first app launch.
    cat > "$MN_DST/__init__.py" <<'PY'
# Auto-generated stub — MooshieUI rewrites this __init__.py with its full node
# registry at first launch.
PY
  fi
  echo "  • copied nodes into $MN_DST"
else
  echo "  • comfyui-nodes/ source not found; app will deploy at first launch"
fi

# --- 4. Install requirements of the cloned packs ---------------------------
echo ""
echo "▶ Installing requirements for cloned custom nodes..."
install_reqs() {
  local dir="$1" file="$2"
  [[ -f "$dir/$file" ]] || return 0
  echo "  • $dir/$file"
  "$PYTHON" -m pip install --no-warn-script-location -r "$dir/$file" || {
    echo "    ✗ requirements failed for $dir (continuing)" >&2
  }
}
for name in "${!NODES[@]}"; do
  target="$CUSTOM_NODES/$name"
  install_reqs "$target" "requirements.txt"
done
# Frame-Interpolation splits deps; RIFE only needs the no-cupy set.
install_reqs "$CUSTOM_NODES/ComfyUI-Frame-Interpolation" "requirements-no-cupy.txt"

# --- 5. Clear bytecode caches so ComfyUI reloads fresh nodes ---------------
echo ""
echo "▶ Clearing stale __pycache__..."
find "$CUSTOM_NODES" -type d -name "__pycache__" -prune -exec rm -rf {} + 2>/dev/null || true

echo ""
echo "✅ Done. Restart MooshieUI (or start ComfyUI) to load the new nodes."
echo "   ComfyUI:  $COMFY"
echo "   Python:   $PYTHON"