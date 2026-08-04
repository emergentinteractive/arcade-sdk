import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = new URL("../", import.meta.url);
const metadata = JSON.parse(
    await readFile(new URL("package.json", packageRoot), "utf8"),
);
const built = await import(
    new URL(`dist/index.js?verify=${Date.now()}`, packageRoot)
);

function stringTargets(value, targets = []) {
    if (typeof value === "string") targets.push(value);
    else if (value && typeof value === "object")
        for (const nested of Object.values(value))
            stringTargets(nested, targets);

    return targets;
}

assert.equal(
    built.SDK_VERSION,
    metadata.version,
    "SDK_VERSION must match package.json before publishing.",
);

const entrypoints = [
    metadata.main,
    metadata.types,
    ...stringTargets(metadata.exports),
];
for (const path of new Set(entrypoints)) {
    assert.equal(typeof path, "string", "Package entrypoints must be strings.");
    await access(new URL(path, packageRoot));
}

assert.ok(
    metadata.files.includes("src"),
    "Published source maps require src to be included in the package.",
);

if (process.env.CI_COMMIT_TAG?.startsWith("arcade-sdk-v")) {
    assert.equal(
        process.env.CI_COMMIT_TAG,
        `arcade-sdk-v${metadata.version}`,
        "The release tag must match the SDK package version.",
    );
}

const isGitHubTag =
    process.env.GITHUB_REF_TYPE === "tag" ||
    process.env.GITHUB_REF?.startsWith("refs/tags/");
if (isGitHubTag) {
    const tag =
        process.env.GITHUB_REF_NAME ??
        process.env.GITHUB_REF?.slice("refs/tags/".length);
    assert.equal(
        tag,
        `v${metadata.version}`,
        "The GitHub release tag must match the SDK package version.",
    );
}

const cache = await mkdtemp(resolve(tmpdir(), "arcade-sdk-pack-"));
try {
    const packed = spawnSync(
        process.platform === "win32" ? "npm.cmd" : "npm",
        ["pack", "--dry-run", "--ignore-scripts", "--json", "--cache", cache],
        {
            cwd: fileURLToPath(packageRoot),
            encoding: "utf8",
        },
    );
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);
    const report = JSON.parse(packed.stdout)[0];
    const files = new Set(report.files.map(({ path }) => path));

    for (const path of new Set(entrypoints)) {
        assert.ok(
            files.has(path.replace(/^\.\//, "")),
            `${path} is missing from the npm package.`,
        );
    }

    for (const path of [`${metadata.main}.map`, `${metadata.types}.map`]) {
        assert.ok(
            files.has(path.replace(/^\.\//, "")),
            `${path} is missing from the npm package.`,
        );
    }

    const allowedRoots = new Set([
        "CHANGELOG.md",
        "LICENSE",
        "README.md",
        "dist",
        "package.json",
        "src",
    ]);
    for (const path of files) {
        assert.ok(
            allowedRoots.has(path.split("/")[0]),
            `Unexpected published path: ${path}`,
        );
    }

    const rootPath = fileURLToPath(packageRoot);
    for (const path of files) {
        if (!path.endsWith(".map")) continue;
        const mapPath = resolve(rootPath, path);
        const map = JSON.parse(await readFile(mapPath, "utf8"));
        for (const source of map.sources ?? []) {
            const sourcePath = relative(
                rootPath,
                resolve(dirname(mapPath), map.sourceRoot ?? "", source),
            )
                .split(sep)
                .join("/");
            assert.ok(
                files.has(sourcePath),
                `${path} references unpublished source ${sourcePath}.`,
            );
        }
    }
} finally {
    await rm(cache, { recursive: true, force: true });
}
