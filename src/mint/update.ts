import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getInvocationRoot } from '../util/cwd';
import { logCard } from '../util/ui';

/** Cannot `npm install` this package while a script from it is running (folder lock on Windows, etc.). */
const PACKAGE_SELF = '@appartmint/tsm-scripts';

/** `dependencies`: these scopes → `npm i …@latest` */
const PREFIXES_PROD = ['@awesome.me/', '@app-art-mint/', '@appartmint/'];

/** `devDependencies` / `peerDependencies`: only these scopes */
const PREFIXES_DEV_PEER = ['@app-art-mint/', '@appartmint/'];

const FILTER_MODES = ['ngx', 'amp', 'mint', 'icons'] as const;
type FilterMode = (typeof FILTER_MODES)[number];

function isFilterMode(value: string | undefined): value is FilterMode {
	return value !== undefined && (FILTER_MODES as readonly string[]).includes(value);
}

/**
 * `argv[2]`: optional `ngx` | `amp` | `mint` | `icons`, or a path override for root.
 * When `argv[2]` is a filter mode, optional `argv[3]` is the root path.
 */
function parseRootAndMode(): { root: string; mode: FilterMode | 'all' } {
	const arg2 = process.argv[2];
	const arg3 = process.argv[3];
	if (isFilterMode(arg2)) {
		return {
			mode: arg2,
			root: arg3 ? path.resolve(arg3) : getInvocationRoot()
		};
	}
	return {
		mode: 'all',
		root: arg2 ? path.resolve(arg2) : getInvocationRoot()
	};
}

const { root: ROOT, mode: FILTER } = parseRootAndMode();

function matchesPrefix(name: string, prefixes: string[]): boolean {
	return prefixes.some((p) => name.startsWith(p));
}

function matchesModeFilter(name: string, mode: FilterMode): boolean {
	switch (mode) {
		case 'ngx':
			return name.startsWith('@app-art-mint/ngx-');
		case 'amp':
			return name.startsWith('@app-art-mint/amp-');
		case 'mint':
			return name.startsWith('@appartmint/');
		case 'icons':
			return name.startsWith('@awesome.me/');
	}
}

function pickPackages(
	section: Record<string, string> | undefined,
	sectionKind: 'prod' | 'devPeer'
): string[] {
	if (!section) return [];
	const keys = Object.keys(section).filter((n) => {
		if (FILTER === 'all') {
			const prefixes = sectionKind === 'prod' ? PREFIXES_PROD : PREFIXES_DEV_PEER;
			return matchesPrefix(n, prefixes);
		}
		return matchesModeFilter(n, FILTER);
	});
	return keys.sort((a, b) => a.localeCompare(b, 'en'));
}

function withoutSelf(packages: string[]): string[] {
	return packages.filter((p) => p !== PACKAGE_SELF);
}

interface PackageJson {
	name?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

function readPackageJson(root: string): PackageJson {
	const p = path.join(root, 'package.json');
	return JSON.parse(fs.readFileSync(p, 'utf8')) as PackageJson;
}

function readLockVersion(root: string, packageName: string): string | undefined {
	const lockPath = path.join(root, 'package-lock.json');
	if (!fs.existsSync(lockPath)) return undefined;
	const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as {
		packages?: Record<string, { version?: string }>;
	};
	return lock.packages?.[`node_modules/${packageName}`]?.version;
}

function snapshotVersions(root: string, names: string[]): Map<string, string | undefined> {
	const m = new Map<string, string | undefined>();
	for (const n of names) {
		m.set(n, readLockVersion(root, n));
	}
	return m;
}

function runNpmInstallLatest(
	root: string,
	packages: string[],
	extraArgs: string[]
): boolean {
	if (packages.length === 0) return true;
	const command = ['npm', 'i', ...extraArgs, ...packages.map((p) => `${p}@latest`)].join(' ');
	const result = spawnSync(command, { cwd: root, shell: true, stdio: 'inherit' });
	return (result.status ?? 1) === 0;
}

/** True when `mint:update` is run with the invocation root at this repo (not a consumer app). */
function isMintScriptsOwnProject(root: string): boolean {
	return readPackageJson(root).name === PACKAGE_SELF;
}

const SELF_UPDATE_COMMAND = `npm i -D ${PACKAGE_SELF}@latest`;

/**
 * When run from a consumer app, if a newer `@appartmint/tsm-scripts` exists on the registry, print a copy-paste
 * install line (cannot be applied from inside this running script). Skipped when the script is run from this package's repo.
 */
function printSelfUpdateHintIfNeeded(root: string): void {
	if (isMintScriptsOwnProject(root)) {
		return;
	}

	const result = spawnSync(`npm outdated ${PACKAGE_SELF} --json`, {
		cwd: root,
		encoding: 'utf8',
		shell: true
	});
	const rawOut = result.stdout;
	const stdout = typeof rawOut === 'string' ? rawOut.trim() : '';
	if (stdout === '' || stdout === '{}' || stdout === 'null') {
		return;
	}

	let parsed: Record<string, { latest?: string; current?: string }>;
	try {
		parsed = JSON.parse(stdout) as Record<string, { latest?: string; current?: string }>;
	} catch {
		return;
	}

	if (!(PACKAGE_SELF in parsed)) {
		return;
	}
	const row = parsed[PACKAGE_SELF];
	if (row.latest === undefined || row.current === undefined || row.latest === row.current) {
		return;
	}

	console.log('This package needs to be updated by itself:');
	console.log('');
	console.log(SELF_UPDATE_COMMAND);
	console.log('');
}

const pkg = readPackageJson(ROOT);
const prod = pickPackages(pkg.dependencies, 'prod');
const dev = pickPackages(pkg.devDependencies, 'devPeer');
const peer = pickPackages(pkg.peerDependencies, 'devPeer');

const prodRun = withoutSelf(prod);
const devRun = withoutSelf(dev);
const peerRun = withoutSelf(peer);

const allNames = [...new Set([...prodRun, ...devRun, ...peerRun])].sort((a, b) =>
	a.localeCompare(b, 'en')
);
const before = snapshotVersions(ROOT, allNames);

let ok = true;
if (prodRun.length > 0) {
	ok = runNpmInstallLatest(ROOT, prodRun, []) && ok;
}
if (devRun.length > 0) {
	ok = runNpmInstallLatest(ROOT, devRun, ['-D']) && ok;
}
if (peerRun.length > 0) {
	ok = runNpmInstallLatest(ROOT, peerRun, ['--save-peer']) && ok;
}

const after = snapshotVersions(ROOT, allNames);

const changed: { name: string; before: string | undefined; after: string | undefined }[] = [];
for (const name of allNames) {
	const b = before.get(name);
	const a = after.get(name);
	if (b !== a) {
		changed.push({ name, before: b, after: a });
	}
}

const syncedCount = allNames.length;
const changedCount = changed.length;

logCard({
	lines: [
		'Root: ' + ROOT,
		'Filter: ' + (FILTER === 'all' ? 'all' : FILTER),
		'Dependencies Synced:  ' + syncedCount.toString(),
		'Dependencies Changed: ' + changedCount.toString(),
		...changed.map(c => `    ${c.name}: ${c.before ?? '(none)'} → ${c.after ?? '(none)'}`),
	],
});

printSelfUpdateHintIfNeeded(ROOT);

process.exit(ok ? 0 : 1);
