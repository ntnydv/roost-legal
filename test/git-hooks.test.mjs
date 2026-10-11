import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installer = join(source, ".githooks", "install.sh");
const zero = "0".repeat(40);

function findShell() {
  if (process.platform !== "win32") return "sh";
  const locations =
    spawnSync("where.exe", ["git.exe"], { encoding: "utf8" })
      .stdout?.trim()
      .split(/\r?\n/) ?? [];
  for (const location of locations) {
    for (const candidate of [
      join(dirname(location), "sh.exe"),
      join(dirname(location), "..", "bin", "sh.exe"),
    ]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error("Git for Windows sh.exe is required to test Git hooks");
}

const shell = findShell();
const shellPath = (path) => path.replaceAll("\\", "/");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 30_000,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function succeeded(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function rejected(result) {
  assert.notEqual(
    result.status,
    0,
    `Unexpected success: ${result.stdout}\n${result.stderr}`,
  );
}

const localGitEnvironmentNames = succeeded(
  run("git", ["rev-parse", "--local-env-vars"], { cwd: source }),
).split(/\r?\n/);

function fixture(
  t,
  {
    develop = true,
    main = true,
    install = true,
    environment = process.env,
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "roost-git-hooks-"));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("roost-git-hooks-"));
    rmSync(root, { recursive: true, force: true });
  });
  const work = join(root, "work");
  const remote = join(root, "remote.git");
  const env = {
    ...environment,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(root, "no-global-config"),
    GIT_TERMINAL_PROMPT: "0",
  };
  for (const name of localGitEnvironmentNames) delete env[name];
  const git = (...args) => run("git", args, { cwd: work, env });
  const bare = (...args) =>
    run("git", ["--git-dir", remote, ...args], { cwd: root, env });
  succeeded(run("git", ["init", "--bare", remote], { cwd: root, env }));
  succeeded(
    run("git", ["init", "--initial-branch=develop", work], { cwd: root, env }),
  );
  succeeded(git("config", "user.name", "Hook tests"));
  succeeded(git("config", "user.email", "hooks@example.invalid"));
  succeeded(git("config", "core.autocrlf", "false"));
  succeeded(git("remote", "add", "origin", remote));
  let commits = 0;
  const commit = () => {
    writeFileSync(join(work, "content.txt"), `change ${++commits}\n`);
    succeeded(git("add", "content.txt"));
    succeeded(git("commit", "-m", `Change ${commits}`));
    return succeeded(git("rev-parse", "HEAD"));
  };
  const base = commit();
  if (develop) succeeded(git("push", "origin", "develop"));
  if (main) succeeded(git("push", "origin", "develop:main"));
  const installHook = () =>
    run(shell, [shellPath(installer), shellPath(work)], { cwd: source, env });
  const hook = (input, url = remote) =>
    run(
      shell,
      [
        shellPath(join(work, ".githooks", "pre-push")),
        "origin",
        shellPath(url),
      ],
      { cwd: work, env, input },
    );
  if (install) succeeded(installHook());
  const remoteSha = (branch) =>
    succeeded(bare("rev-parse", `refs/heads/${branch}`));
  return {
    root,
    work,
    remote,
    env,
    git,
    bare,
    base,
    commit,
    installHook,
    hook,
    remoteSha,
  };
}

test("fixtures leave an inherited hook repository and index untouched", (t) => {
  const foreign = fixture(t, { install: false });
  const gitDirectory = join(foreign.work, ".git");
  const configPath = join(gitDirectory, "config");
  const indexPath = join(gitDirectory, "index");
  const originalConfig = readFileSync(configPath);
  const originalIndex = readFileSync(indexPath);
  const f = fixture(t, {
    environment: {
      ...process.env,
      GIT_DIR: gitDirectory,
      GIT_COMMON_DIR: gitDirectory,
      GIT_WORK_TREE: foreign.work,
      GIT_INDEX_FILE: indexPath,
      GIT_OBJECT_DIRECTORY: join(gitDirectory, "objects"),
      GIT_PREFIX: "test/",
    },
  });
  const next = f.commit();
  succeeded(f.git("push", "origin", "develop"));
  succeeded(f.git("push", "origin", "develop:main"));
  assert.equal(f.remoteSha("main"), next);
  assert.equal(succeeded(foreign.git("rev-parse", "HEAD")), foreign.base);
  assert.deepEqual(readFileSync(configPath), originalConfig);
  assert.deepEqual(readFileSync(indexPath), originalIndex);
});

test("feature pushes and develop creation and advancement remain allowed", (t) => {
  const f = fixture(t, { develop: false, main: false });
  succeeded(f.git("push", "origin", "HEAD:feature/example"));
  succeeded(f.git("push", "origin", "develop"));
  const next = f.commit();
  succeeded(f.git("push", "origin", "develop"));
  assert.equal(f.remoteSha("develop"), next);
  assert.equal(f.remoteSha("feature/example"), f.base);
});

test("main-only commits are rejected even when the checked-out branch is develop", (t) => {
  const f = fixture(t);
  const next = f.commit();
  rejected(f.git("push", "origin", "HEAD:refs/heads/main"));
  assert.equal(f.remoteSha("main"), f.base);
  succeeded(f.git("push", "origin", "develop"));
  succeeded(f.git("push", "origin", `${next}:refs/heads/main`));
  assert.equal(f.remoteSha("main"), next);
});

test("separate develop then main pushes preserve exact commit IDs", (t) => {
  const f = fixture(t);
  const next = f.commit();
  succeeded(f.git("push", "origin", "develop"));
  succeeded(f.git("push", "origin", "develop:main"));
  assert.equal(f.remoteSha("main"), next);
  assert.equal(f.remoteSha("develop"), next);
});

test("creating main requires its commit to be present on remote develop", (t) => {
  const f = fixture(t, { main: false });
  f.commit();
  rejected(f.git("push", "origin", "HEAD:main"));
  succeeded(f.git("push", "origin", `${f.base}:refs/heads/main`));
  assert.equal(f.remoteSha("main"), f.base);
});

test("main and develop cannot be advanced in one push", (t) => {
  const f = fixture(t);
  f.commit();
  rejected(f.git("push", "origin", "HEAD:main", "HEAD:develop"));
  assert.equal(f.remoteSha("main"), f.base);
  assert.equal(f.remoteSha("develop"), f.base);
});

test("protected branch deletion is rejected", (t) => {
  const f = fixture(t);
  for (const branch of ["main", "develop"]) {
    rejected(f.git("push", "origin", "--delete", branch));
    assert.equal(f.remoteSha(branch), f.base);
  }
});

test("force updates cannot rewind either protected branch", (t) => {
  const f = fixture(t);
  const next = f.commit();
  succeeded(f.git("push", "origin", "develop"));
  succeeded(f.git("push", "origin", "develop:main"));
  for (const branch of ["main", "develop"]) {
    rejected(f.git("push", "--force", "origin", `${f.base}:${branch}`));
    assert.equal(f.remoteSha(branch), next);
  }
});

test("main promotion fails closed when remote develop is missing", (t) => {
  const f = fixture(t, { develop: false });
  f.commit();
  rejected(f.git("push", "origin", "HEAD:main"));
  assert.equal(f.remoteSha("main"), f.base);
});

test("a stale tracking ref cannot authorize a commit absent from remote develop", (t) => {
  const f = fixture(t);
  const next = f.commit();
  succeeded(f.git("update-ref", "refs/remotes/origin/develop", next));
  rejected(f.git("push", "origin", "HEAD:main"));
  assert.equal(f.remoteSha("main"), f.base);
  assert.equal(
    succeeded(f.git("rev-parse", "refs/remotes/origin/develop")),
    next,
  );
});

test("a stale tracking ref does not reject a valid remote develop commit", (t) => {
  const f = fixture(t);
  const next = f.commit();
  succeeded(f.git("push", "origin", "develop"));
  succeeded(f.git("update-ref", "refs/remotes/origin/develop", f.base));
  succeeded(f.git("push", "origin", "develop:main"));
  assert.equal(f.remoteSha("main"), next);
  assert.equal(
    succeeded(f.git("rev-parse", "refs/remotes/origin/develop")),
    f.base,
  );
});

test("validation uses the actual push URL when it differs from the fetch URL", (t) => {
  const f = fixture(t);
  const alternate = join(f.root, "alternate.git");
  succeeded(
    run("git", ["clone", "--bare", f.remote, alternate], {
      cwd: f.root,
      env: f.env,
    }),
  );
  const next = f.commit();
  succeeded(f.git("push", "origin", "develop"));
  succeeded(f.git("config", "remote.origin.pushurl", alternate));
  rejected(f.git("push", "origin", "develop:main"));
  const alternateSha = (branch) =>
    succeeded(
      run(
        "git",
        ["--git-dir", alternate, "rev-parse", `refs/heads/${branch}`],
        { cwd: f.root, env: f.env },
      ),
    );
  assert.equal(alternateSha("main"), f.base);
  succeeded(f.git("push", "origin", "develop"));
  succeeded(f.git("push", "origin", "develop:main"));
  assert.equal(alternateSha("main"), next);
  assert.equal(f.remoteSha("main"), f.base);
});

test("guard fetches do not change FETCH_HEAD or tracking refs and remove temporary refs", (t) => {
  const f = fixture(t);
  const next = f.commit();
  succeeded(f.git("push", "origin", "develop"));
  succeeded(f.git("fetch", "origin"));
  const fetchHead = readFileSync(join(f.work, ".git", "FETCH_HEAD"), "utf8");
  const refs = succeeded(
    f.git("for-each-ref", "--format=%(refname) %(objectname)"),
  );
  succeeded(f.hook(`refs/heads/develop ${next} refs/heads/main ${f.base}\n`));
  assert.equal(
    readFileSync(join(f.work, ".git", "FETCH_HEAD"), "utf8"),
    fetchHead,
  );
  assert.equal(
    succeeded(f.git("for-each-ref", "--format=%(refname) %(objectname)")),
    refs,
  );
  rejected(
    f.hook(
      `refs/heads/develop ${next} refs/heads/main ${f.base}\n`,
      join(f.root, "missing.git"),
    ),
  );
  assert.equal(
    readFileSync(join(f.work, ".git", "FETCH_HEAD"), "utf8"),
    fetchHead,
  );
  assert.equal(
    succeeded(f.git("for-each-ref", "--format=%(refname) %(objectname)")),
    refs,
  );
});

test("installation preserves existing hooks, arguments, stdin and failures and is idempotent", (t) => {
  const f = fixture(t, { install: false });
  const hooks = join(f.work, ".githooks");
  mkdirSync(hooks);
  const previousHook =
    '#!/bin/sh\nfalse\nunset roost_legacy_optional\n: "$roost_legacy_optional"\nprintf "%s\\n" "$1" "$2" > .git/previous-hook-args\ncat > .git/previous-hook-input\nprintf "called\\n" >> .git/previous-hook-calls\nif test -f .git/previous-hook-exit; then exit "$(cat .git/previous-hook-exit)"; fi\n';
  const preCommit = '#!/bin/sh\nprintf "existing pre-commit\\n"\n';
  writeFileSync(join(hooks, "pre-push"), previousHook, { mode: 0o755 });
  writeFileSync(join(hooks, "pre-commit"), preCommit, { mode: 0o755 });
  succeeded(f.git("config", "core.hooksPath", ".githooks"));
  succeeded(f.installHook());
  const installed = readFileSync(join(hooks, "pre-push"), "utf8");
  succeeded(f.installHook());
  assert.equal(readFileSync(join(hooks, "pre-push"), "utf8"), installed);
  assert.equal(readFileSync(join(hooks, "pre-commit"), "utf8"), preCommit);
  assert.equal(
    succeeded(f.git("config", "--local", "core.hooksPath")),
    ".githooks",
  );
  const input = `refs/heads/develop ${f.base} refs/heads/feature/compatibility ${zero}\n`;
  succeeded(f.hook(input));
  assert.equal(
    readFileSync(join(f.work, ".git", "previous-hook-input"), "utf8"),
    input,
  );
  assert.equal(
    readFileSync(join(f.work, ".git", "previous-hook-args"), "utf8"),
    `origin\n${shellPath(f.remote)}\n`,
  );
  assert.equal(
    readFileSync(join(f.work, ".git", "previous-hook-calls"), "utf8"),
    "called\n",
  );
  writeFileSync(join(f.work, ".git", "previous-hook-exit"), "37\n");
  assert.equal(f.hook(input).status, 37);
  rejected(f.git("push", "origin", "HEAD:feature/compatibility"));
  rejected(f.bare("rev-parse", "--verify", "refs/heads/feature/compatibility"));
});

test("fresh clones keep hooks executable with LF line endings despite autocrlf=true", (t) => {
  const f = fixture(t);
  for (const file of ["pre-push", "develop-first.sh", "install.sh"]) {
    assert.match(
      succeeded(f.git("ls-files", "--stage", `.githooks/${file}`)),
      /^100755 /,
    );
  }
  succeeded(f.git("add", ".githooks"));
  succeeded(f.git("commit", "-m", "Track hook installation"));
  const fresh = join(f.root, "fresh");
  succeeded(
    run("git", ["-c", "core.autocrlf=true", "clone", f.work, fresh], {
      cwd: f.root,
      env: f.env,
    }),
  );
  const git = (...args) => run("git", args, { cwd: fresh, env: f.env });
  for (const file of ["pre-push", "develop-first.sh", "install.sh"]) {
    assert.equal(
      readFileSync(join(fresh, ".githooks", file), "utf8").includes("\r"),
      false,
      `${file} must retain LF endings`,
    );
    assert.match(
      succeeded(git("ls-files", "--stage", `.githooks/${file}`)),
      /^100755 /,
    );
  }
  succeeded(
    run(
      shell,
      [shellPath(join(fresh, ".githooks", "install.sh")), shellPath(fresh)],
      { cwd: fresh, env: f.env },
    ),
  );
  succeeded(git("remote", "set-url", "origin", f.remote));
  rejected(git("push", "origin", "develop:main"));
  succeeded(git("push", "origin", "develop"));
  succeeded(git("push", "origin", "develop:main"));
  assert.equal(f.remoteSha("main"), succeeded(git("rev-parse", "HEAD")));
});

test("shallow clones fail closed for protected branches while allowing feature pushes", (t) => {
  const f = fixture(t);
  const shallow = join(f.root, "shallow");
  succeeded(
    run(
      "git",
      [
        "clone",
        "--depth=1",
        "--branch=develop",
        pathToFileURL(f.remote).href,
        shallow,
      ],
      { cwd: f.root, env: f.env },
    ),
  );
  const git = (...args) => run("git", args, { cwd: shallow, env: f.env });
  succeeded(git("config", "user.name", "Hook tests"));
  succeeded(git("config", "user.email", "hooks@example.invalid"));
  succeeded(
    run(shell, [shellPath(installer), shellPath(shallow)], {
      cwd: source,
      env: f.env,
    }),
  );
  writeFileSync(join(shallow, "content.txt"), "shallow change\n");
  succeeded(git("add", "content.txt"));
  succeeded(git("commit", "-m", "Shallow change"));
  assert.equal(succeeded(git("rev-parse", "--is-shallow-repository")), "true");
  const result = git("push", "origin", "develop");
  rejected(result);
  assert.match(result.stderr, /full clone/i);
  assert.equal(f.remoteSha("develop"), f.base);
  succeeded(git("push", "origin", "HEAD:feature/shallow"));
});

test("unsupported existing hooks are rejected without replacing the hook or its configuration", (t) => {
  const f = fixture(t, { install: false });
  const hooks = join(f.work, ".githooks");
  mkdirSync(hooks);
  const previousHook = "#!/usr/bin/env python3\nraise SystemExit(37)\n";
  writeFileSync(join(hooks, "pre-push"), previousHook, { mode: 0o755 });
  succeeded(f.git("config", "core.hooksPath", ".githooks"));
  rejected(f.installHook());
  assert.equal(readFileSync(join(hooks, "pre-push"), "utf8"), previousHook);
  assert.equal(
    succeeded(f.git("config", "--local", "core.hooksPath")),
    ".githooks",
  );
  succeeded(f.git("config", "core.hooksPath", "custom-hooks"));
  rejected(f.installHook());
  assert.equal(
    succeeded(f.git("config", "--local", "core.hooksPath")),
    "custom-hooks",
  );
  assert.equal(readFileSync(join(hooks, "pre-push"), "utf8"), previousHook);
});

test("installation records executable modes without staging existing hook content changes", (t) => {
  const f = fixture(t, { install: false });
  mkdirSync(join(f.work, ".githooks"));
  const previousHook = '#!/bin/sh\nprintf "original hook\\n"\n';
  writeFileSync(join(f.work, ".githooks", "pre-push"), previousHook);
  succeeded(f.git("add", "--chmod=-x", ".githooks/pre-push"));
  succeeded(f.git("commit", "-m", "Existing hook"));
  const stagedBlob = succeeded(f.git("rev-parse", ":.githooks/pre-push"));
  writeFileSync(
    join(f.work, ".githooks", "pre-push"),
    `${previousHook}printf "working edit\\n"\n`,
  );
  succeeded(f.git("config", "core.hooksPath", ".githooks"));
  succeeded(f.installHook());
  assert.equal(
    succeeded(f.git("rev-parse", ":.githooks/pre-push")),
    stagedBlob,
  );
  for (const file of ["pre-push", "develop-first.sh", "install.sh"]) {
    assert.match(
      succeeded(f.git("ls-files", "--stage", `.githooks/${file}`)),
      /^100755 /,
    );
  }
  assert.match(
    readFileSync(join(f.work, ".githooks", "pre-push"), "utf8"),
    /working edit/,
  );
  const stagedDiff = succeeded(
    f.git("diff", "--cached", "--", ".githooks/pre-push"),
  );
  assert.match(stagedDiff, /old mode 100644\nnew mode 100755/);
  assert.doesNotMatch(stagedDiff, /@@/);
});
