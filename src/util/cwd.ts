import path from 'node:path';

/**
 * Directory where the user ran `npm` (`INIT_CWD`), before `--prefix` moves the script cwd into a package.
 * Falls back to `process.cwd()` when unset (e.g. `tsx` / `node` without npm).
 */
export function getInvocationRoot(): string {
	const initCwd = process.env.INIT_CWD;
	if (initCwd) {
		return path.resolve(initCwd);
	}
	return process.cwd();
}
