import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { getInvocationRoot } from '../util/cwd';

/** `dependencies`: these scopes → `npm i …@latest` */
const PREFIXES_PROD = ['@awesome.me/', '@app-art-mint/', '@appartmint/'];

/** `devDependencies` / `peerDependencies`: only these scopes */
const PREFIXES_DEV_PEER = ['@app-art-mint/', '@appartmint/'];

const rootArg = process.argv[2];
const ROOT = rootArg ? path.resolve(rootArg) : getInvocationRoot();

function matchesPrefix(name: string, prefixes: string[]): boolean {
	return prefixes.some((p) => name.startsWith(p));
}

function pickPackages(
	section: Record<string, string> | undefined,
	prefixes: string[]
): string[] {
	if (!section) return [];
	return Object.keys(section)
		.filter((n) => matchesPrefix(n, prefixes))
		.sort((a, b) => a.localeCompare(b, 'en'));
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
const prod = pickPackages(pkg.dependencies, PREFIXES_PROD);
const dev = pickPackages(pkg.devDependencies, PREFIXES_DEV_PEER);
const peer = pickPackages(pkg.peerDependencies, PREFIXES_DEV_PEER);

const allNames = [...new Set([...prod, ...dev, ...peer])].sort((a, b) => a.localeCompare(b, 'en'));
const before = snapshotVersions(ROOT, allNames);

let ok = true;
if (prod.length > 0) {
	ok = runNpmInstallLatest(ROOT, prod, []) && ok;
}
if (dev.length > 0) {
	ok = runNpmInstallLatest(ROOT, dev, ['-D']) && ok;
}
if (peer.length > 0) {
	ok = runNpmInstallLatest(ROOT, peer, ['--save-peer']) && ok;
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
console.log('Dependencies Synced: ' + syncedCount.toString());
console.log('Dependencies Changed: ' + changedCount.toString());
console.log('');
for (const c of changed) {
	console.log(`      ${c.name}: ${c.before ?? '(none)'} → ${c.after ?? '(none)'}`);
}
console.log('');

process.exit(ok ? 0 : 1);
