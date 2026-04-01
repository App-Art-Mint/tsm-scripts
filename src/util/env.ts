import fs from 'node:fs';
import path from 'node:path';

import { getInvocationRoot } from './cwd';

const root = getInvocationRoot();

export const envFiles = [path.join(root, '.env.local'), path.join(root, '.env')].filter(fs.existsSync);
