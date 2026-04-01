import fs from 'fs';
import path from 'path';

export const envFiles = [
	path.join(process.cwd(), '.env.local'),
	path.join(process.cwd(), '.env'),
].filter(fs.existsSync);
