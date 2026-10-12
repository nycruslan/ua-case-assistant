/**
 * Both launchers must pick the first Node that is NEW ENOUGH, not the first
 * Node found. ☠️ An old system or Homebrew Node used to shadow a current one
 * from a version manager, and the server refused to start (CI's first run hit
 * exactly this: the runner's Node 22 in /usr/local/bin).
 *
 * Fake `node` executables in a throwaway HOME answer the version probe and,
 * when actually launched, record which one was chosen. PATH holds only the
 * utilities the launchers use, so no real Node on PATH can interfere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const repo = join(import.meta.dirname, "..", "..", "..");
const SHIPPED = join(repo, "plugins", "ua-case-assistant", "scripts", "ua-legal-sources.sh");
const DEV = join(repo, "mcp", "ua-legal-sources", "bin", "start.sh");

/** A real Node at a system path the launchers also search would win before HOME-less fakes. */
function systemNodeAtLeast(min: number): boolean {
  return ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"].some((p) => {
    if (!existsSync(p)) return false;
    const r = spawnSync(p, ["-p", "process.versions.node.split('.')[0]"], { encoding: "utf8" });
    return Number(r.stdout) >= min;
  });
}

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), "ua-launcher-"));
  const bin = join(home, "pathbin");
  mkdirSync(bin);
  for (const tool of ["sed", "sort", "cut", "dirname"]) {
    const where = spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
    symlinkSync(where, join(bin, tool));
  }
  const fake = (rel: string, major: number) => {
    const file = join(home, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      `#!/bin/sh\ncase "$1" in -p) echo ${major} ;; -v) echo v${major}.0.0 ;; *) echo "${rel}" > "$MARK" ;; esac\n`,
    );
    chmodSync(file, 0o755);
  };
  const run = (launcher: string) => {
    const mark = join(home, "chosen");
    const r = spawnSync(launcher, [], {
      encoding: "utf8",
      env: { HOME: home, PATH: bin, MARK: mark },
    });
    return { code: r.status, stderr: r.stderr, chosen: existsSync(mark) ? readFileSync(mark, "utf8").trim() : null };
  };
  return { home, fake, run, done: () => rmSync(home, { recursive: true, force: true }) };
}

test("the shipped launcher skips a Node older than 20 and takes the next one", () => {
  const s = sandbox();
  s.fake(".local/share/mise/shims/node", 18);
  s.fake(".volta/bin/node", 22);
  assert.equal(s.run(SHIPPED).chosen, ".volta/bin/node");
  s.done();
});

test("the dev launcher skips a Node older than 24 and takes the next one", () => {
  const s = sandbox();
  s.fake(".local/share/mise/shims/node", 22);
  s.fake(".local/bin/node", 24);
  assert.equal(s.run(DEV).chosen, ".local/bin/node");
  s.done();
});

test("nvm versions are tried newest first, including a path with a space", { skip: systemNodeAtLeast(20) }, () => {
  const s = sandbox();
  s.fake(".nvm/versions/node/v20.9.0/bin/node", 20);
  s.fake(".nvm/versions/node/v22.11.0/bin/node", 22);
  s.fake("Library/Application Support/fnm/node-versions/v21.1.0/installation/bin/node", 21);
  assert.equal(s.run(SHIPPED).chosen, ".nvm/versions/node/v22.11.0/bin/node");
  s.done();
});

test("only a too-old Node: the launcher says which one it found", { skip: systemNodeAtLeast(24) }, () => {
  const s = sandbox();
  s.fake(".local/share/mise/shims/node", 22);
  const r = s.run(DEV);
  assert.equal(r.chosen, null);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Found only .*mise\/shims\/node \(v22\.0\.0\)/);
  s.done();
});
