import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { getInvocationRoot } from '../util/cwd';

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
	const args = ['i', ...extraArgs, ...packages.map((p) => `${p}@latest`)];
	const result = spawnSync('npm', args, { cwd: root, shell: true, stdio: 'inherit' });
	return (result.status ?? 1) === 0;
}

const pkg = readPackageJson(ROOT);
const prod = pickPackages(pkg.dependencies, 'prod');
const dev = pickPackages(pkg.devDependencies, 'devPeer');
const peer = pickPackages(pkg.peerDependencies, 'devPeer');

const skippedSelf =
	prod.includes(PACKAGE_SELF) || dev.includes(PACKAGE_SELF) || peer.includes(PACKAGE_SELF);

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

console.log('Root: ' + ROOT);
console.log('Filter: ' + (FILTER === 'all' ? 'all' : FILTER));
if (skippedSelf) {
	console.log(
		'Skipped: ' + PACKAGE_SELF +
		' (cannot replace this package while a script from it is running)'
	);
}
console.log('Dependencies Synced: ' + syncedCount.toString());
console.log('Dependencies Changed: ' + changedCount.toString());
console.log('');
for (const c of changed) {
	console.log(`\t${c.name}: ${c.before ?? '(none)'} → ${c.after ?? '(none)'}`);
}
console.log('');

process.exit(ok ? 0 : 1);
