#!/bin/sh
set -eu

source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
target_dir=${1:-.}
cd -- "$target_dir"
root=$(git rev-parse --show-toplevel)
cd -- "$root"

configured=$(git config --get core.hooksPath || :)
case "$configured" in
  .githooks) ;;
  '')
    default_hooks=$(git rev-parse --git-path hooks)
    for hook in "$default_hooks"/*; do
      case "$hook" in *.sample) continue ;; esac
      if [ -f "$hook" ] && [ -x "$hook" ]; then
        printf 'Existing hook %s must be integrated before installation.\n' "$hook" >&2
        exit 1
      fi
    done
    ;;
  *)
    printf 'Refusing to replace the existing hooks directory: %s\n' "$configured" >&2
    exit 1
    ;;
esac

mkdir -p .githooks
destination=$(CDPATH= cd .githooks && pwd)
if [ "$source_dir" != "$destination" ]; then
  cp "$source_dir/develop-first.sh" "$destination/develop-first.sh"
  cp "$source_dir/install.sh" "$destination/install.sh"
  cp "$source_dir/.gitattributes" "$destination/.gitattributes"
fi

hook=.githooks/pre-push
marker='# Roost develop-first pre-push v1'
if ! [ -f "$hook" ] || ! grep -Fqx "$marker" "$hook"; then
  if [ -f "$hook" ]; then
    first_line=$(head -n 1 "$hook" | tr -d '\r')
    case "$first_line" in
      '#!/bin/sh'|'#!/usr/bin/env sh') ;;
      *)
        printf 'Existing pre-push is not a POSIX shell hook; integrate it manually.\n' >&2
        exit 1
        ;;
    esac
  fi
  temporary=$(mktemp .githooks/pre-push.XXXXXX)
  trap 'rm -f "$temporary"' EXIT
  cat > "$temporary" <<'HEADER'
#!/bin/sh
# Roost develop-first pre-push v1
set -eu

roost_hook_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
roost_push_input=$(cat)
printf '%s\n' "$roost_push_input" | sh "$roost_hook_dir/develop-first.sh" "$@" || exit $?

roost_existing_pre_push() {
  set +eu
HEADER
  if [ -f "$hook" ]; then
    tr -d '\r' < "$hook" >> "$temporary"
    printf '\n' >> "$temporary"
  else
    printf '  :\n' >> "$temporary"
  fi
  cat >> "$temporary" <<'FOOTER'
}

printf '%s\n' "$roost_push_input" | roost_existing_pre_push "$@"
FOOTER
  mv "$temporary" "$hook"
  trap - EXIT
fi

chmod +x "$hook" .githooks/develop-first.sh .githooks/install.sh
git config --local core.hooksPath .githooks
if [ "$(git config --get core.hooksPath)" != .githooks ]; then
  printf 'A worktree configuration overrides core.hooksPath; installation is incomplete.\n' >&2
  exit 1
fi
git add --intent-to-add --chmod=+x -- \
  .githooks/pre-push .githooks/develop-first.sh .githooks/install.sh
printf 'Develop-first hook installed: %s\n' "$root"
