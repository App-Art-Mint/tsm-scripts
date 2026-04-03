import { spawn } from 'node:child_process';
import fs from 'node:fs';

import { getInvocationRoot } from '../../util/cwd';
import { envFiles } from '../../util/env';

const ssoProfiles = envFiles
	.map((file) => {
		const data = fs.readFileSync(file, 'utf8');
		const match = /AWS_SSO_PROFILE=(.*)/.exec(data);
		return match?.[1] ?? null;
	})
	.filter(Boolean);

const isSSO = ssoProfiles.length > 0;

const envArgs = envFiles.map((file) => `-f ${file} `).join('');
const envCommand = (isSSO ? `npx dotenvx run ${envArgs}-- ` : '') + 'cross-replace ';
const profileArgs = isSSO ? ' --profile $AWS_SSO_PROFILE' : '';

/**
 * Spawn a long-lived shell command and exit this process on `'spawn'` so tsx / Node releases
 * `node_modules` (e.g. you can `npm i` while `ampx sandbox` runs). Logs stay on this terminal via
 * `stdio: 'inherit'`.
 *
 * On Windows, `detached: true` can open a **new console**; we only set it on non-Windows so the
 * sandbox streams in the same window. `unref()` still lets this process exit right after spawn.
 */
function spawnDetachedAndExit(fullCommand: string, cwd: string): void {
	const child = spawn(fullCommand, {
		cwd,
		detached: process.platform !== 'win32',
		shell: true,
		stdio: 'inherit'
	});

	child.on('error', (err) => {
		console.error(err.message);
		process.exit(1);
	});

	child.on('spawn', () => {
		child.unref();
		process.exit(0);
	});
}

export function ssoCommand(command: string): void {
	const fullCommand = `${envCommand}${command}${profileArgs}`;
	spawnDetachedAndExit(fullCommand, getInvocationRoot());
}
