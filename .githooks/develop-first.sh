#!/bin/sh
set -eu

reject() {
  printf 'Roost push blocked: %s\n' "$*" >&2
  exit 1
}

is_zero() {
  case "$1" in *[!0]*|'') return 1 ;; *) return 0 ;; esac
}

updates=$(cat)
main_new=
main_old=
develop_new=
develop_old=

while read -r local_ref local_sha remote_ref remote_sha extra; do
  [ -n "$local_ref" ] || continue
  [ -z "$extra" ] && [ -n "$remote_sha" ] || reject 'Invalid pre-push input.'
  case "$remote_ref" in
    refs/heads/main)
      main_new=$local_sha
      main_old=$remote_sha
      ;;
    refs/heads/develop)
      develop_new=$local_sha
      develop_old=$remote_sha
      ;;
  esac
done <<EOF
$updates
EOF

[ -n "$main_new$develop_new" ] || exit 0
[ -z "$main_new" ] || [ -z "$develop_new" ] ||
  reject 'Push develop first, then promote main in a separate push.'

if [ -n "$main_new" ]; then
  is_zero "$main_new" && reject 'Deleting main is prohibited.'
fi
if [ -n "$develop_new" ]; then
  is_zero "$develop_new" && reject 'Deleting develop is prohibited.'
fi

[ "$(git rev-parse --is-shallow-repository)" = false ] ||
  reject 'Protected branches require a full clone. Fetch the complete history first.'
[ "$#" -ge 2 ] || reject 'The push destination is missing.'

namespace="refs/roost-push-check/$$"
cleanup() {
  git update-ref -d "$namespace/main" >/dev/null 2>&1 || :
  git update-ref -d "$namespace/develop" >/dev/null 2>&1 || :
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

fetch_branch() {
  GIT_TERMINAL_PROMPT=0 git fetch --quiet --no-tags --no-write-fetch-head \
    --no-recurse-submodules --no-auto-maintenance --refmap= -- "$2" \
    "+refs/heads/$1:$namespace/$1" </dev/null ||
    reject "Cannot verify remote $1. Check access and that the branch exists."
}

if [ -n "$develop_new" ]; then
  if ! is_zero "$develop_old"; then
    fetch_branch develop "$2"
    [ "$(git rev-parse "$namespace/develop")" = "$develop_old" ] ||
      reject 'Remote develop changed during verification. Fetch and retry.'
    git merge-base --is-ancestor "$develop_old" "$develop_new" ||
      reject 'Rewriting develop history is prohibited.'
  fi
  exit 0
fi

fetch_branch develop "$2"
git merge-base --is-ancestor "$main_new" "$namespace/develop" ||
  reject 'Every commit on main must already exist on remote develop. Push develop first.'

if ! is_zero "$main_old"; then
  fetch_branch main "$2"
  [ "$(git rev-parse "$namespace/main")" = "$main_old" ] ||
    reject 'Remote main changed during verification. Fetch and retry.'
  git merge-base --is-ancestor "$main_old" "$main_new" ||
    reject 'Rewriting main history is prohibited. Reconcile through develop first.'
fi
