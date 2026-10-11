# Develop-first Git hooks

Changes must reach the destination remote's `develop` branch before `main`.
The `pre-push` hook checks the pushed destination refs, even when the checked-out
branch has another name. It preserves existing pre-push checks and other hooks.

## Installation

From the repository root, use Git Bash on Windows or a POSIX shell:

```sh
sh .githooks/install.sh
```

Install in every clone and worktree. Git does not activate versioned hooks on a
new clone automatically. The installer is safe to run again and keeps
`core.hooksPath=.githooks`. Older branches may not contain the new hook files;
install again when working from an older checkout. Only Git and a POSIX shell
are required by this guard; existing quality hooks retain their own requirements.

To install in another existing checkout from this one:

```sh
sh .githooks/install.sh /path/to/checkout
```

The installer copies the guard and installer, wraps an existing POSIX shell
pre-push hook, and leaves pre-commit and other hooks unchanged. It refuses to
replace a different configured hooks directory or an unsupported existing hook.
It records executable permissions with Git's intent-to-add flag so Windows
commits preserve runnable hooks on macOS/Linux. Existing hook edits remain
unstaged; the installer does not commit or push anything. The attributes file
keeps shell scripts in LF format even with `core.autocrlf=true`.

## Promotion

After committing and validating the changes on `develop`:

```sh
git push origin develop
# Continue only if the first push succeeded.
git push origin develop:main
```

The second push preserves the exact commit IDs. The guard rejects:

- A proposed main tip that is not an ancestor of the remote develop tip.
- Non-fast-forward updates or deletion of either protected branch.
- Updating both protected branches in a single push.
- Verification failures, including a missing remote develop or shallow history.

Creating `develop` is allowed. Creating `main` requires its entire history to
already be present on remote `develop`. Existing divergence is not repaired by
installation: reconcile it through `develop` before promoting. A failed fetch
blocks promotion rather than trusting an old `origin/develop` tracking ref.

Verification fetches from the push destination into temporary refs. It does not
change the working tree, local branches, remote-tracking refs, or `FETCH_HEAD`.
Normal completion and handled signals remove the temporary refs.

## Limits

These are free local safeguards, not GitHub server protections. `--no-verify`,
disabled hooks, other clones, GitHub web/API operations, and automation without
installation can bypass them. A local check also cannot lock remote branches
against concurrent updates. No GitHub Actions or paid service is used.
