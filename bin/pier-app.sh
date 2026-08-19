#!/bin/sh
# Packaged Pier CLI. Resolves PATH symlinks, then runs pier.mjs with the
# app's Electron as Node so a system Node install is not required.
set -eu

resolve_symlink() {
  target=$1
  while [ -L "$target" ]; do
    dir=$(CDPATH= cd -- "$(dirname -- "$target")" && pwd)
    link=$(readlink "$target")
    case $link in
      /*) target=$link ;;
      *) target=$dir/$link ;;
    esac
  done
  dir=$(CDPATH= cd -- "$(dirname -- "$target")" && pwd)
  printf '%s/%s\n' "$dir" "$(basename -- "$target")"
}

self=$(resolve_symlink "$0")
bin_dir=$(dirname -- "$self")
cli=$bin_dir/pier.mjs
contents_dir=$(dirname -- "$(dirname -- "$bin_dir")")
electron=$contents_dir/MacOS/Pier

if [ ! -f "$cli" ]; then
  printf 'pier: missing %s\n' "$cli" >&2
  exit 127
fi

if [ -x "$electron" ]; then
  ELECTRON_RUN_AS_NODE=1 exec "$electron" "$cli" "$@"
fi

if command -v node >/dev/null 2>&1; then
  exec node "$cli" "$@"
fi

printf 'pier: Pier app binary not found at %s, and node is not on PATH\n' "$electron" >&2
exit 127
