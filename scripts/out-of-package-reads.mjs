/**
 * Finds every file that a package's tests read outside the package, and checks that the reading
 * task declares it in its Turborepo `inputs` (WP-6 D2, ADR-048). An undeclared read is invisible
 * twice: a pull request that changes only that file selects no task (`--affected` maps changed
 * files to the tasks whose inputs match them), and the task's input hash does not change, so the
 * cache replays the old green result. Declaring it (`$TURBO_ROOT$/infra/compose/**`) fixes both.
 *
 * What counts as a read, in the `src/` and `test/` files of every workspace package, with string
 * literal arguments only:
 * - `new URL("<relative>", import.meta.url)`, resolved against the file;
 * - `join(import.meta.dirname, ...)` or `resolve(...)` with `import.meta.dirname` or `__dirname`;
 * - `join("<top folder>", ...)` or `resolve(...)` whose first segment is a top-level folder of the
 *   repo that holds no package (`infra`, `docs`): a path from the repo root, resolved at run time.
 *
 * Which task must declare it: a read in `*.int.*` test code belongs to that package's `test:int`;
 * any other test file to its `test`. A read in `src/` runs in the package's own unit tests and in
 * the integration suites of every package that depends on it (`@jadero/testing` runs the Postgres
 * provisioning script for every service's suites), so it belongs to the package's `test` and to the
 * `test:int` of each direct dependent that has one.
 *
 * Run by `scripts/out-of-package-reads.test.mjs` through `pnpm test:scripts`, so `pnpm verify`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Folders inside a package that never hold source. */
const SKIPPED = new Set(["node_modules", "dist", ".next", ".turbo", "coverage", "test-results"]);

/** Folders at the repo root that hold workspace packages (`pnpm-workspace.yaml`). */
const WORKSPACE_FOLDERS = ["apps", "packages", "templates"];

/** Source files the scan reads. */
const SOURCE_FILE = /\.(?:[cm]?[jt]s|tsx)$/;

/** A string literal without interpolation: "x", 'x' or `x`. */
const LITERAL = String.raw`(?:"[^"\n]*"|'[^'\n]*'|\`[^\`$\n]*\`)`;

/** A list of string literals separated by commas. */
const LITERALS = String.raw`${LITERAL}(?:\s*,\s*${LITERAL})*`;

/**
 * Turns a path into the slash form Turborepo globs use.
 * @param {string} path
 * @returns {string}
 */
function toPosix(path) {
  return path.split(sep).join("/");
}

/**
 * Removes the quotes of a string literal.
 * @param {string} literal
 * @returns {string}
 */
function unquote(literal) {
  return literal.slice(1, -1);
}

/**
 * Splits a list of string literals into their values.
 * @param {string} list
 * @returns {string[]}
 */
function literalValues(list) {
  return [...list.matchAll(new RegExp(LITERAL, "g"))].map((match) => unquote(match[0]));
}

/**
 * Lists the paths a source file reads outside its package. Pure: the caller reads the file.
 * @param {object} file
 * @param {string} file.source the file's text.
 * @param {string} file.path the file's path relative to the repo root (`packages/testing/test/a.ts`).
 * @param {string} file.packageDir the package folder relative to the repo root (`packages/testing`).
 * @param {Set<string>} rootFolders top-level folders of the repo that hold no package (`infra`).
 * @returns {string[]} repo-relative paths outside the package, sorted, without duplicates.
 */
export function outOfPackageReads({ source, path, packageDir }, rootFolders) {
  const folder = posix.dirname(path);
  const found = new Set();
  const fileRelative = new RegExp(
    String.raw`new\s+URL\(\s*(${LITERAL})\s*,\s*import\.meta\.url`,
    "g",
  );
  for (const match of source.matchAll(fileRelative)) {
    found.add(posix.join(folder, unquote(match[1])));
  }
  const dirnameRelative = new RegExp(
    String.raw`\b(?:join|resolve)\(\s*(?:import\.meta\.dirname|__dirname)\s*,\s*(${LITERALS})\s*\)`,
    "g",
  );
  for (const match of source.matchAll(dirnameRelative)) {
    found.add(posix.join(folder, ...literalValues(match[1])));
  }
  const rootRelative = new RegExp(String.raw`\b(?:join|resolve)\(\s*(${LITERALS})\s*\)`, "g");
  for (const match of source.matchAll(rootRelative)) {
    const segments = literalValues(match[1]);
    const first = posix.normalize(segments[0]).split("/")[0];
    if (rootFolders.has(first)) found.add(posix.join(...segments));
  }
  return [...found]
    .map((read) => posix.normalize(read).replace(/\/$/, ""))
    .filter((read) => read !== packageDir && !read.startsWith(`${packageDir}/`))
    .sort();
}

/**
 * The `inputs` a task runs with in one package: the package's own `turbo.json`, else the root's
 * `<package>#<task>` entry, else the root's `<task>` entry. `null` means Turborepo's default (the
 * package's tracked files only). Pure.
 * @param {object} configs
 * @param {object} configs.root the root `turbo.json`.
 * @param {object | undefined} configs.packageConfig the package's `turbo.json`, when it has one.
 * @param {string} packageName the package's name (`@jadero/testing`).
 * @param {string} task the task name (`test`).
 * @returns {string[] | null}
 */
export function effectiveInputs({ root, packageConfig }, packageName, task) {
  return (
    packageConfig?.tasks?.[task]?.inputs ??
    root.tasks?.[`${packageName}#${task}`]?.inputs ??
    root.tasks?.[task]?.inputs ??
    null
  );
}

/**
 * Whether a task's `inputs` cover a repo-relative path: a positive glob matches it and no negated
 * one does. `$TURBO_ROOT$/` globs are relative to the repo root, the others to the package;
 * `$TURBO_DEFAULT$` covers only the package's own files, so never a read outside it. Pure.
 * @param {string[] | null} inputs the task's inputs, `null` for the default.
 * @param {string} packageDir the package folder relative to the repo root.
 * @param {string} path the repo-relative path read; a folder read is matched as any file in it.
 * @param {boolean} [isFolder] whether the path is a folder.
 * @returns {boolean}
 */
export function declares(inputs, packageDir, path, isFolder = false) {
  if (!inputs) return false;
  const candidates = isFolder ? [path, `${path}/any-file`] : [path];
  const toGlob = (input) =>
    input.startsWith("$TURBO_ROOT$/")
      ? input.slice("$TURBO_ROOT$/".length)
      : posix.normalize(posix.join(packageDir, input));
  const matches = (glob) => candidates.some((candidate) => posix.matchesGlob(candidate, glob));
  const positive = inputs.filter((input) => !input.startsWith("!") && input !== "$TURBO_DEFAULT$");
  const negative = inputs.filter((input) => input.startsWith("!")).map((input) => input.slice(1));
  return (
    positive.some((input) => matches(toGlob(input))) &&
    !negative.some((input) => matches(toGlob(input)))
  );
}

/**
 * Lists every source file under a folder, skipping build output and dependencies.
 * @param {string} folder an absolute path.
 * @returns {string[]} absolute paths.
 */
function sourceFiles(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED.has(entry.name)) return [];
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE_FILE.test(entry.name) ? [path] : [];
  });
}

/**
 * Reads a JSON file, or returns undefined when it does not exist.
 * @param {string} path
 * @returns {any}
 */
function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}

/**
 * Describes the workspace packages of a repo.
 * @param {string} repoRoot an absolute path.
 * @returns {{ dir: string, name: string, manifest: any, turbo: any }[]} `dir` relative to the root.
 */
function workspacePackages(repoRoot) {
  return WORKSPACE_FOLDERS.flatMap((folder) => {
    const parent = join(repoRoot, folder);
    if (!existsSync(parent)) return [];
    return readdirSync(parent, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && existsSync(join(parent, entry.name, "package.json")),
      )
      .map((entry) => {
        const dir = `${folder}/${entry.name}`;
        const manifest = readJson(join(repoRoot, dir, "package.json"));
        return {
          dir,
          name: manifest.name,
          manifest,
          turbo: readJson(join(repoRoot, dir, "turbo.json")),
        };
      });
  });
}

/**
 * Finds every out-of-package read in a repo and the tasks that must declare it.
 * @param {string} repoRoot an absolute path.
 * @returns {{ file: string, read: string, packageDir: string, packageName: string, task: string, declared: boolean }[]}
 *   one row per read and task, `packageName` being the package whose task must declare it.
 */
export function scanRepository(repoRoot) {
  const root = readJson(join(repoRoot, "turbo.json"));
  const packages = workspacePackages(repoRoot);
  const rootFolders = new Set(
    readdirSync(repoRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !WORKSPACE_FOLDERS.includes(entry.name))
      .filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules")
      .map((entry) => entry.name),
  );
  const dependentsWithIntegration = (name) =>
    packages.filter(
      (other) =>
        other.manifest.scripts?.["test:int"] &&
        (other.manifest.dependencies?.[name] || other.manifest.devDependencies?.[name]),
    );
  const rows = [];
  for (const pkg of packages) {
    for (const absolute of ["src", "test"].flatMap((folder) =>
      sourceFiles(join(repoRoot, pkg.dir, folder)),
    )) {
      const file = toPosix(relative(repoRoot, absolute));
      const source = readFileSync(absolute, "utf8");
      for (const read of outOfPackageReads(
        { source, path: file, packageDir: pkg.dir },
        rootFolders,
      )) {
        const target = join(repoRoot, read);
        const isFolder = existsSync(target) && statSync(target).isDirectory();
        const readers = file.startsWith(`${pkg.dir}/src/`)
          ? [
              { reader: pkg, task: "test" },
              ...dependentsWithIntegration(pkg.name).map((reader) => ({
                reader,
                task: "test:int",
              })),
            ]
          : [{ reader: pkg, task: /\.int\./.test(file) ? "test:int" : "test" }];
        for (const { reader, task } of readers) {
          const inputs = effectiveInputs({ root, packageConfig: reader.turbo }, reader.name, task);
          rows.push({
            file,
            read,
            packageDir: reader.dir,
            packageName: reader.name,
            task,
            declared: declares(inputs, reader.dir, read, isFolder),
          });
        }
      }
    }
  }
  return rows;
}

/** The repo root, the folder above `scripts/`. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
