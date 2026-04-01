import fs from 'fs';

if (!fs.existsSync('node_modules')) {
    console.error('node_modules does not exist');
    process.exit(1);
}

if (!fs.existsSync('node_modules/tinify')) {
    console.error('tinify does not exist');
    process.exit(1);
}

const certPath = 'node_modules/tinify/lib/data/cacert.pem';
if (!fs.existsSync(certPath)) {
    console.error('cacert.pem does not exist');
    process.exit(1);
}

const clientPath = 'node_modules/tinify/lib/tinify/Client.js';
if (!fs.existsSync(clientPath)) {
    console.error('Client.js does not exist');
    process.exit(1);
}

const certData = fs.readFileSync(certPath, 'utf8');
const clientData = fs.readFileSync(clientPath, 'utf8');
const injectedData = clientData.replace(/const data = fs\.readFileSync\(`\$\{__dirname\}\/\.\.\/data\/cacert\.pem`\)\.toString\(\);/g, `const data = \`${certData}\`;`);

fs.writeFileSync(clientPath, injectedData);
console.log('Tinify transformed successfully! cacert.pem injected into Client.js');
