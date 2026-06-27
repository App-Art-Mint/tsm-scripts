import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getInvocationRoot } from '../util/cwd';

const rootArg = process.argv[2];
const ROOT = rootArg ? path.resolve(rootArg) : getInvocationRoot();

interface PackageJson {
	name: string;
	peerDependencies?: Record<string, string>;
}

function readLibraryPackage(filePath: string): PackageJson {
	return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PackageJson;
}

/**
 * Libraries in dependency order: prerequisites before dependents.
 */
function topologicalSort(libraries: Record<string, string[]>): string[] {
	const inDegree = new Map<string, number>();
	const graph = new Map<string, Set<string>>();

	for (const lib of Object.keys(libraries)) {
		inDegree.set(lib, 0);
		graph.set(lib, new Set());
	}

	for (const lib of Object.keys(libraries)) {
		for (const dep of libraries[lib] ?? []) {
			if (!graph.has(dep)) {
				graph.set(dep, new Set());
			}
			graph.get(dep)?.add(lib);
			inDegree.set(lib, (inDegree.get(lib) ?? 0) + 1);
		}
	}

	const queue = new Set<string>();
	for (const [lib, degree] of inDegree.entries()) {
		if (degree === 0) {
			queue.add(lib);
		}
	}

	const sortedOrder: string[] = [];
	while (queue.size > 0) {
		const next = queue.values().next();
		if (next.done) break;
		const lib = next.value;
		queue.delete(lib);
		sortedOrder.push(lib);

		for (const neighbor of graph.get(lib) ?? []) {
			inDegree.set(neighbor, (inDegree.get(neighbor) ?? 0) - 1);
			if (inDegree.get(neighbor) === 0) {
				queue.add(neighbor);
			}
		}
	}

	if (sortedOrder.length !== Object.keys(libraries).length) {
		throw new Error('Cycle detected in the dependency graph');
	}

	return sortedOrder;
}

const srcDir = path.join(ROOT, 'src');

const libEntries: { name: string; ngxPeersAll: string[] }[] = [];
for (const dir of fs.readdirSync(srcDir)) {
	if (!dir.toLowerCase().startsWith('ngx-')) continue;
	const pkgPath = path.join(srcDir, dir, 'package.json');
	try {
		if (!fs.statSync(pkgPath).isFile()) continue;
	} catch {
		continue;
	}
	const pkg = readLibraryPackage(pkgPath);
	const ngxPeersAll = Object.keys(pkg.peerDependencies ?? {}).filter((dep) =>
		dep.startsWith('@app-art-mint/ngx-')
	);
	libEntries.push({ name: pkg.name, ngxPeersAll });
}

/** Only edges between libraries in this repo; peers satisfied from npm are ignored for ordering. */
const localNames = new Set(libEntries.map((e) => e.name));
const dependencies: Record<string, string[]> = {};
for (const e of libEntries) {
	dependencies[e.name] = e.ngxPeersAll.filter((dep) => localNames.has(dep));
}

const libraries = topologicalSort(dependencies);

console.log('Root: ' + ROOT);
console.log('Libraries Queued: ' + libraries.length.toString());
console.log('Build Order:');
for (const lib of libraries) {
	console.log(`\t${lib}`);
}
console.log('');

for (const lib of libraries) {
	const project = lib.replace('@app-art-mint/', '');
	const result = spawnSync(`npx ng build ${project}`, {
		cwd: ROOT,
		shell: true,
		stdio: 'inherit'
	});
	if (result.error) {
		throw result.error;
	}
	const code = result.status;
	if (code !== 0 && code !== null) {
		process.exit(code);
	}
}

console.log(`${libraries.length.toString()} Libraries Built\n\n`);
