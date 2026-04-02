import fs from 'node:fs';
import path from 'node:path';

/**
 * True when `absoluteDir` is under a `node_modules` segment (dependency install, not the consuming project).
 */
function isInsideNodeModules(absoluteDir: string): boolean {
	const normalized = path.resolve(absoluteDir);
	return normalized.split(path.sep).includes('node_modules');
}

/**
 * Walk upward from `startDir` to the nearest directory with a `package.json` that is not inside `node_modules`.
 * Matches how npm resolves the project when you run a script from a subfolder of the repo.
 */
function findNearestPackageRoot(startDir: string): string {
	let dir = path.resolve(startDir);

	const hasUsablePackageJson = (d: string): boolean => {
		const pkgPath = path.join(d, 'package.json');
		return fs.existsSync(pkgPath) && !isInsideNodeModules(d);
	};

	if (hasUsablePackageJson(dir)) {
		return dir;
	}

	let parent = path.dirname(dir);
	while (parent !== dir) {
		dir = parent;
		if (hasUsablePackageJson(dir)) {
			return dir;
		}
		parent = path.dirname(dir);
	}

	return path.resolve(startDir);
}

/**
 * Root of the project that owns the nearest `package.json` (walking up from where the command was started).
 * Uses `INIT_CWD` when npm set it (including `--prefix`), else `process.cwd()`.
 * Ignores `package.json` files under `node_modules` so a script run from inside a dependency still resolves the app root.
 */
export function getInvocationRoot(): string {
	const start = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : process.cwd();
	return findNearestPackageRoot(start);
}
