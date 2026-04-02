import fs from 'node:fs';
import path from 'node:path';

import { getInvocationRoot } from '../util/cwd';

const rootArg = process.argv[2];
const ROOT = rootArg ? path.resolve(rootArg) : getInvocationRoot();

interface PackageJson {
	name: string;
	version?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

function readPackageJsonFile(filePath: string): PackageJson {
	return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PackageJson;
}

function normalizeJsonText(s: string): string {
	return s.replace(/\r\n/g, '\n').trimEnd();
}

const projectPkgPath = path.join(ROOT, 'package.json');
const projectPkg = readPackageJsonFile(projectPkgPath);
const version = process.env.npm_package_version ?? projectPkg.version;
if (version === undefined || version === '') {
	throw new Error(`Set version in ${projectPkgPath}, or run via npm so npm_package_version is set`);
}

function resolveRootDependency(name: string): string | undefined {
	return projectPkg.dependencies?.[name] ?? projectPkg.devDependencies?.[name];
}

const srcDir = path.join(ROOT, 'src');
const libraries = fs
	.readdirSync(srcDir)
	.filter((dir) => {
		if (!dir.toLowerCase().startsWith('ngx-')) return false;
		const pkgPath = path.join(srcDir, dir, 'package.json');
		try {
			return fs.statSync(pkgPath).isFile();
		} catch {
			return false;
		}
	})
	.map((dir) => readPackageJsonFile(path.join(srcDir, dir, 'package.json')));

const scannedCount = libraries.length;

console.log('Root: ' + ROOT);
console.log('Version: ' + version);
console.log('Libraries Scanned: ' + scannedCount.toString());
console.log('');

let changed = 0;
const changedRelativeToRoot: string[] = [];

for (const pkg of libraries) {
	const outPath = path.join(ROOT, 'src', pkg.name.replace('@app-art-mint/', ''), 'package.json');
	const beforeText = fs.readFileSync(outPath, 'utf8');

	pkg.version = version;

	const peers = pkg.peerDependencies;
	if (!peers) {
		continue;
	}

	for (const dep of Object.keys(peers)) {
		if (dep.startsWith('@angular/')) {
			const coreRange = resolveRootDependency('@angular/core');
			if (!coreRange) {
				throw new Error(`Project package.json missing @angular/core; cannot sync peer ${dep} in ${pkg.name}`);
			}
			const angularMatch = /^[~^]?(\d+)\.(\d+)\.(\d+)/.exec(coreRange);
			const angularMajor = angularMatch?.[1];
			if (angularMajor === undefined) {
				throw new Error(`Could not parse @angular/core version from project: ${coreRange}`);
			}
			peers[dep] = `^${angularMajor}.0.0`;
			continue;
		}
		if (dep.startsWith('@app-art-mint/ngx-')) {
			peers[dep] = `^${version}`;
			continue;
		}
		const resolved = resolveRootDependency(dep);
		if (resolved === undefined) {
			throw new Error(`Project package.json has no dependency "${dep}" (needed for peer sync in ${pkg.name})`);
		}
		peers[dep] = resolved;
	}

	const afterText = JSON.stringify(pkg, null, 2);
	fs.writeFileSync(outPath, afterText);
	if (normalizeJsonText(afterText) !== normalizeJsonText(beforeText)) {
		changed++;
		changedRelativeToRoot.push(path.relative(ROOT, outPath));
	}
}

console.log('Libraries Changed: ' + changed.toString());
console.log('');
for (const rel of changedRelativeToRoot) {
	console.log(`\t${rel}`);
}
console.log('');
