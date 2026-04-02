import fs from 'node:fs';
import path from 'node:path';

import { getInvocationRoot } from '../util/cwd';

const rootArg = process.argv[2];
const ROOT = rootArg ? path.resolve(rootArg) : getInvocationRoot();

const nodeModules = path.join(ROOT, 'node_modules');
const tinifyRoot = path.join(nodeModules, 'tinify');
const certPath = path.join(tinifyRoot, 'lib/data/cacert.pem');
const clientPath = path.join(tinifyRoot, 'lib/tinify/Client.js');

if (!fs.existsSync(nodeModules)) {
	console.error('node_modules does not exist');
	process.exit(1);
}

if (!fs.existsSync(tinifyRoot)) {
	console.error('tinify does not exist');
	process.exit(1);
}

if (!fs.existsSync(certPath)) {
	console.error('cacert.pem does not exist');
	process.exit(1);
}

if (!fs.existsSync(clientPath)) {
	console.error('Client.js does not exist');
	process.exit(1);
}

const certData = fs.readFileSync(certPath, 'utf8');
const clientData = fs.readFileSync(clientPath, 'utf8');
const injectedData = clientData.replace(
	/const data = fs\.readFileSync\(`\$\{__dirname\}\/\.\.\/data\/cacert\.pem`\)\.toString\(\);/g,
	`const data = \`${certData}\`;`
);

fs.writeFileSync(clientPath, injectedData);
console.log('Tinify transformed successfully! cacert.pem injected into Client.js');
