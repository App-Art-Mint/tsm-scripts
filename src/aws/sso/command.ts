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

export function ssoCommand(command: string): void {
	const fullCommand = `${envCommand}${command}${profileArgs}`;
	const child = spawn(fullCommand, {
		cwd: getInvocationRoot(),
		shell: true,
		stdio: 'inherit'
	});

	child.on('error', (err) => {
		console.error(err.message);
		process.exit(1);
	});

	child.on('exit', (code) => {
		if (code !== 0) {
			process.exit(code ?? 1);
		}
	});
}
