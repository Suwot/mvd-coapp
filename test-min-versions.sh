#!/bin/bash
set -euo pipefail

# Test script to check minimum required versions for built binaries
# Run from coapp/ directory

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$ROOT_DIR/build"

# Tools
OTOOL="otool"
GOBJDUMP="/opt/homebrew/opt/binutils/bin/gobjdump"
LLVM_READOBJ="/opt/homebrew/opt/llvm/bin/llvm-readobj"

log_info() { echo -e "\033[32m[INFO]\033[0m $1"; }
log_warn() { echo -e "\033[33m[WARN]\033[0m $1"; }
log_error() { echo -e "\033[31m[ERROR]\033[0m $1"; }

check_mac_binary() {
  local path="$1"

  # Prefer LC_BUILD_VERSION (modern) -> minos/sdk; fallback to LC_VERSION_MIN_MACOSX (legacy) -> version/sdk.
  local minos=""
  local sdk=""

  read -r minos sdk < <(otool -l "$path" 2>/dev/null | awk '
    $1=="cmd" && $2=="LC_BUILD_VERSION" {mode="build"; next}
    $1=="cmd" && $2=="LC_VERSION_MIN_MACOSX" {mode="min"; next}
    mode=="build" && $1=="minos" {m=$2}
    mode=="build" && $1=="sdk" {s=$2; print m, s; exit}
    mode=="min" && $1=="version" {m=$2}
    mode=="min" && $1=="sdk" {s=$2; print m, s; exit}
  ')

  if [[ -n "${minos:-}" ]]; then
    if [[ -n "${sdk:-}" ]]; then
      echo "$path: macOS $minos (sdk $sdk)"
    else
      echo "$path: macOS $minos"
    fi
  else
    echo "$path: unknown macOS min version"
  fi
}

check_linux_binary() {
  local path="$1"

  if ! file "$path" 2>/dev/null | grep -q ELF; then
    echo "$path: not ELF (wrong format)"
    return 0
  fi

  local glibc_ver=""
  glibc_ver=$($GOBJDUMP -T "$path" 2>/dev/null | grep -o 'GLIBC_[0-9.]*' | sort -Vu | tail -n1 | sed 's/GLIBC_//' || true)

  local interp=""
  interp=$( /opt/homebrew/opt/binutils/bin/greadelf -l "$path" 2>/dev/null \
    | awk '/interpreter/ {for(i=1;i<=NF;i++) if ($i ~ /^\//) {gsub(/\]$/, "", $i); print $i; exit}}' \
    || true )

  if [[ -n "$glibc_ver" ]]; then
    if [[ -n "$interp" ]]; then
      echo "$path: glibc $glibc_ver (interp $interp)"
    else
      echo "$path: glibc $glibc_ver"
    fi
  else
    if [[ -n "$interp" ]]; then
      echo "$path: glibc (no GLIBC_ symbols found) (interp $interp)"
    else
      echo "$path: glibc (no GLIBC_ symbols found)"
    fi
  fi
}

check_win_binary() {
  local path="$1"

  if ! command -v "$LLVM_READOBJ" >/dev/null 2>&1; then
    echo "$path: unknown Windows version (llvm-readobj not found)"
    return 0
  fi

  local out
  out=$($LLVM_READOBJ -h "$path" 2>/dev/null || true)

  local machine=""
  local maj=""
  local min=""

  machine=$(echo "$out" | awk -F': ' '/Machine:/ {print $2; exit}')
  maj=$(echo "$out" | awk -F': ' '/MajorSubsystemVersion:/ {print $2; exit}')
  min=$(echo "$out" | awk -F': ' '/MinorSubsystemVersion:/ {print $2; exit}')

  if [[ -n "$maj" && -n "$min" ]]; then
    if [[ -n "$machine" ]]; then
      echo "$path: Windows subsystem $maj.$min ($machine)"
    else
      echo "$path: Windows subsystem $maj.$min"
    fi
  else
    echo "$path: unknown Windows version"
  fi
}

for target_dir in "$BUILD_DIR"/*; do
  [[ -d "$target_dir" ]] || continue
  target=$(basename "$target_dir")
  log_info "Checking target: $target"
  for bin in "$target_dir"/*; do
    if [[ -f "$bin" && -x "$bin" ]]; then
      case "$target" in
        mac-*)
          check_mac_binary "$bin"
          ;;
        linux-*)
          check_linux_binary "$bin"
          ;;
        win*)
          check_win_binary "$bin"
          ;;
        *)
          echo "$bin: unknown target type"
          ;;
      esac
    fi
  done
done

log_info "Done."