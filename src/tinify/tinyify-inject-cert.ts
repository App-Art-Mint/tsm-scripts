import fs from 'fs';

// Check if node_modules exists
if (!fs.existsSync('node_modules')) {
    console.error('node_modules does not exist');
    process.exit(1);
}

// Check if tinify dependency exists
if (!fs.existsSync('node_modules/tinify')) {
    console.error('tinify does not exist');
    process.exit(1);
}

// Check if tinify/lib/data/cacert.pem exists
const certPath = 'node_modules/tinify/lib/data/cacert.pem';
if (!fs.existsSync(certPath)) {
    console.error('cacert.pem does not exist');
    process.exit(1);
}

// Check if tinify/lib/tinify/Client.js exists
const clientPath = 'node_modules/tinify/lib/tinify/Client.js';
if (!fs.existsSync(clientPath)) {
    console.error('Client.js does not exist');
    process.exit(1);
}

// Load cacert.pem into a string value
const certData = fs.readFileSync(certPath, 'utf8');

// Replace the line: const data = fs.readFileSync(`${__dirname}/../data/cacert.pem`).toString();
// with the cacert.pem string value
let clientData = fs.readFileSync(clientPath, 'utf8');
clientData = clientData.replace(/const data = fs\.readFileSync\(`\$\{__dirname\}\/\.\.\/data\/cacert\.pem`\)\.toString\(\);/g, `const data = \`${certData}\`;`);

// Save the file
fs.writeFileSync(clientPath, clientData);

// Log success
console.log('Tinify transformed successfully! cacert.pem injected into Client.js');
