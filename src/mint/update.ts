import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	padVisibleEnd,
	palette,
	type Rgb,
	visibleLength,
	wrapForegroundRgb,
	wrapUnderline,
} from '../util/ansi';
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
type FilterSelection = FilterMode | 'all';

const LIB_PREFIX_COLORS: readonly { prefix: string; color: Rgb }[] = [
	{ prefix: 'ngx-', color: palette.angularRed },
	{ prefix: 'tsm-', color: palette.typescriptBlue },
	{ prefix: 'jsm-', color: palette.javascriptYellow },
	{ prefix: 'css-', color: palette.sassPink },
	{ prefix: 'tsx-', color: palette.reactBlue },
	{ prefix: 'nex-', color: palette.reactBlueDark },
	{ prefix: 'vue-', color: palette.vueGreen },
	{ prefix: 'nux-', color: palette.nuxtGreen },
	{ prefix: 'amp-', color: palette.amplifyViolet },
	{ prefix: 'web-', color: palette.webOrange },
];

function isFilterMode(value: string | undefined): value is FilterMode {
	return value !== undefined && (FILTER_MODES as readonly string[]).includes(value);
}

/**
 * `argv[2]`: optional `ngx` | `amp` | `mint` | `icons`, or a path override for root.
 * When `argv[2]` is a filter mode, optional `argv[3]` is the root path.
 */
function parseRootAndMode(): { root: string; mode: FilterSelection } {
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
		default: {
			const _exhaustive: never = mode;
			return _exhaustive;
		}
	}
}

function filterColor(mode: FilterSelection): Rgb {
	switch (mode) {
		case 'all':
			return palette.stoplightGreen;
		case 'ngx':
			return palette.angularRed;
		case 'amp':
			return palette.amplifyViolet;
		case 'mint':
			return palette.mintGreen;
		case 'icons':
			return palette.fontAwesomeBlue;
		default: {
			const _exhaustive: never = mode;
			return _exhaustive;
		}
	}
}

function scopeColor(scope: string): Rgb | undefined {
	switch (scope) {
		case '@appartmint':
			return palette.mintGreen;
		case '@app-art-mint':
			return palette.stoplightGreen;
		case '@awesome.me':
			return palette.fontAwesomeBlue;
		default:
			return undefined;
	}
}

function formatRootPath(root: string): string {
	const home = os.homedir();
	let display = root;
	if (root === home || root.startsWith(home + path.sep)) {
		display = '~' + root.slice(home.length);
	}
	const sep = display.includes('\\') && !display.includes('/') ? '\\' : '/';
	const parts = display.split(/[/\\]/);
	const lastIndex = parts.length - 1;
	const last = parts[lastIndex] ?? '';
	if (last === '' && lastIndex > 0) {
		const prior = parts[lastIndex - 1] ?? '';
		if (prior !== '') {
			parts[lastIndex - 1] = wrapUnderline(prior);
		}
		return parts.join(sep);
	}
	parts[lastIndex] = wrapUnderline(last);
	return parts.join(sep);
}

function formatPackageName(name: string): string {
	const slash = name.indexOf('/');
	if (slash < 0) {
		return wrapUnderline(name);
	}
	const scope = name.slice(0, slash);
	const id = name.slice(slash + 1);
	const scopeRgb = scopeColor(scope);
	const coloredScope = scopeRgb != null ? wrapForegroundRgb(scope, scopeRgb) : scope;

	const lib = LIB_PREFIX_COLORS.find((entry) => id.startsWith(entry.prefix));
	if (lib == null) {
		return `${coloredScope}/${wrapUnderline(id)}`;
	}
	const rest = id.slice(lib.prefix.length);
	return `${coloredScope}/${wrapForegroundRgb(lib.prefix, lib.color)}${wrapUnderline(rest)}`;
}

function formatSyncedValue(count: number, mode: FilterSelection): string {
	if (count === 0) {
		const modeText = mode === 'all' ? ' ' : ` ${mode} `;
		return wrapForegroundRgb(`0 - No${modeText}dependencies found`, palette.angularRed);
	}
	return count.toString();
}

function formatChangedValue(changedCount: number, syncedCount: number): string {
	const digits = String(changedCount).padStart(String(syncedCount).length, ' ');
	if (changedCount === 0) {
		return wrapForegroundRgb(`${digits} ✓`, palette.stoplightGreen);
	}
	return wrapForegroundRgb(`${digits} ↑`, palette.fontAwesomeBlue);
}

function formatChangedRow(
	entry: { name: string; before: string | undefined; after: string | undefined },
	nameWidth: number,
	beforeWidth: number
): string {
	const coloredName = formatPackageName(entry.name);
	const beforeText = entry.before ?? '(none)';
	const afterText = entry.after ?? '(none)';
	return `    ${padVisibleEnd(coloredName, nameWidth)}: ${padVisibleEnd(beforeText, beforeWidth)} → ${afterText}`;
}

function buildSummaryLines(
	root: string,
	mode: FilterSelection,
	syncedCount: number,
	changed: { name: string; before: string | undefined; after: string | undefined }[]
): string[] {
	const lines: string[] = [
		'Root: ' + formatRootPath(root),
		'Filter: ' + wrapForegroundRgb(mode, filterColor(mode)),
		'Dependencies Synced:  ' + formatSyncedValue(syncedCount, mode),
	];

	if (syncedCount === 0) {
		return lines;
	}

	const changedCount = changed.length;
	lines.push('Dependencies Changed: ' + formatChangedValue(changedCount, syncedCount));

	if (changedCount === 0) {
		return lines;
	}

	const coloredNames = changed.map((c) => formatPackageName(c.name));
	const nameWidth = Math.max(...coloredNames.map(visibleLength));
	const beforeWidth = Math.max(...changed.map((c) => (c.before ?? '(none)').length));

	for (const entry of changed) {
		lines.push(formatChangedRow(entry, nameWidth, beforeWidth));
	}
	return lines;
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

logCard({
	title: 'Synced Mint Dependencies',
	lines: buildSummaryLines(ROOT, FILTER, syncedCount, changed),
});

printSelfUpdateHintIfNeeded(ROOT);

process.exit(ok ? 0 : 1);
