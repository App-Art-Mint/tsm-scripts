import { globby } from 'globby';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const rootArg = process.argv[2];

/** Directory where `npm` was run (set by npm before `--prefix` moves the script cwd into a package). */
function defaultRootFromInvocation(): string {
	const initCwd = process.env.INIT_CWD;
	if (initCwd) {
		return path.resolve(initCwd);
	}
	return process.cwd();
}

const ROOT = rootArg ? path.resolve(rootArg) : defaultRootFromInvocation();

type ImportGroup = 'external' | 'workspace' | 'local' | 'environment';

interface TsConfigAliasEntry {
	fileNames: Set<string>;
	aliasPrefixes: string[];
}

interface ParsedImport {
	spec: string;
	group: ImportGroup;
	finalText: string;
	multi: boolean;
}

async function listTsFilesUnderRoot(root: string): Promise<string[]> {
	return globby(['**/*.ts', '**/*.tsx', '**/*.tsm'], {
		cwd: root,
		absolute: true,
		gitignore: true,
		caseSensitiveMatch: false,
		ignore: ['**/.git/**']
	});
}

/** First path segment under `root` for each file (`.` = file directly under root). */
function topLevelFoldersForFiles(root: string, files: string[]): string[] {
	const set = new Set<string>();
	for (const f of files) {
		const rel = path.relative(root, f);
		const parts = rel.split(/[/\\]/).filter(Boolean);
		set.add(parts.length <= 1 ? '.' : parts[0]);
	}
	return [...set].sort((a, b) => a.localeCompare(b, 'en'));
}

function getModuleSpecifier(text: string): string {
	const m = /from\s+(['"])([^'"]+)\1/.exec(text);
	return m ? m[2] : '';
}

function normalizePathForCompare(p: string): string {
	return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

function normalizeAliasPrefix(key: string): string {
	if (key === '*' || !key) return '';
	if (key.endsWith('/*')) return key.slice(0, -1);
	return key;
}

function discoverRootTsconfigs(rootDir: string): string[] {
	return fs
		.readdirSync(rootDir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && /^tsconfig.*\.json$/i.test(entry.name))
		.map((entry) => path.join(rootDir, entry.name));
}

function loadTsConfigAliasEntries(rootDir: string): TsConfigAliasEntry[] {
	const entries: TsConfigAliasEntry[] = [];
	for (const configPath of discoverRootTsconfigs(rootDir)) {
		const read = ts.readConfigFile(configPath, (fileName) => ts.sys.readFile(fileName));
		if (read.error) continue;

		const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath), undefined, configPath);
		const paths = parsed.options.paths ?? {};
		const aliasPrefixes = Object.keys(paths)
			.map((key) => normalizeAliasPrefix(key))
			.filter((key) => key.length > 0);
		if (aliasPrefixes.length === 0) continue;

		entries.push({
			fileNames: new Set(parsed.fileNames.map((name) => normalizePathForCompare(name))),
			aliasPrefixes
		});
	}
	return entries;
}

function resolveLocalAliasPrefixes(filePath: string, tsconfigEntries: TsConfigAliasEntry[]): string[] {
	const normalizedFilePath = normalizePathForCompare(filePath);
	const prefixes = new Set<string>();
	for (const entry of tsconfigEntries) {
		if (!entry.fileNames.has(normalizedFilePath)) continue;
		for (const prefix of entry.aliasPrefixes) {
			prefixes.add(prefix);
		}
	}
	return [...prefixes];
}

function classify(spec: string, localAliasPrefixes: string[]): ImportGroup {
	if (!spec) return 'external';
	if (
		spec.startsWith('$amplify/env') ||
		spec.includes('/environments/') ||
		spec.includes('environments/environment') ||
		spec.includes('.env')
	)
		return 'environment';
	if (spec.startsWith('@app-art-mint/') || spec.startsWith('@appartmint/')) return 'workspace';
	if (localAliasPrefixes.some((prefix) => spec === prefix || spec.startsWith(prefix))) return 'local';
	if (spec.startsWith('.') || spec.startsWith('..')) return 'local';
	return 'external';
}

function groupOrder(g: ImportGroup): number {
	const order: Record<ImportGroup, number> = { external: 0, workspace: 1, local: 2, environment: 3 };
	return order[g];
}

function isMultiLineImport(text: string): boolean {
	return text.includes('\n');
}

function normalizeImportLine(text: string): string {
	let s = text.replace(/\s+/g, ' ').replace(/;+\s*$/, '').trim();
	s = s.replace(/,\s*\}(?=\s+from\s+)/g, ' }');
	s = s.replace(/([\w$])}(?=\s+from\s+)/g, '$1 }');
	return s;
}

function ensureSemicolon(text: string, semicolon: boolean): string {
	const t = text.replace(/;+\s*$/, '').trimEnd();
	return semicolon ? `${t};` : t;
}

function wrapImportIfNeeded(text: string, maxLen: number, semicolon: boolean): string {
	const normalized = normalizeImportLine(text);
	if (normalized.length <= maxLen) return ensureSemicolon(normalized, semicolon);

	const fromMatch = /^(.+?)\s+from\s+(['"][^'"]+['"])$/.exec(normalized);
	if (!fromMatch) return ensureSemicolon(normalized, semicolon);

	const head = fromMatch[1].trim();
	const fromPart = fromMatch[2];
	const m = /^(import\s+(?:type\s+)?)(\{)(.*)(\})\s*$/.exec(head);
	if (!m) return ensureSemicolon(normalized, semicolon);

	const prefix = m[1];
	const inner = m[3];
	const names = inner
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	if (names.length <= 1) return ensureSemicolon(normalized, semicolon);

	const innerIndent = '\t';
	const lines = names.map((n) => `${innerIndent}${n},`);
	const body = `${prefix}{\n${lines.join('\n')}\n} from ${fromPart}`;
	return ensureSemicolon(body, semicolon);
}

/** First npm-style path segment; for `@scope/pkg/...` uses `scope` so it groups with unscoped `scope/...`. */
function externalFamilyKey(spec: string): string {
	if (spec.startsWith('@')) {
		const rest = spec.slice(1);
		const slash = rest.indexOf('/');
		const head = slash === -1 ? rest : rest.slice(0, slash);
		return head.toLowerCase();
	}
	const slash = spec.indexOf('/');
	const head = slash === -1 ? spec : spec.slice(0, slash);
	return head.toLowerCase();
}

/** Within the same family: scoped (`@`) imports first, then unscoped (`pkg`, `pkg/sub`). */
function compareExternal(a: string, b: string): number {
	const fa = externalFamilyKey(a);
	const fb = externalFamilyKey(b);
	const byFamily = fa.localeCompare(fb, 'en');
	if (byFamily !== 0) return byFamily;

	const scopedRank = (s: string) => (s.startsWith('@') ? 0 : 1);
	const sr = scopedRank(a) - scopedRank(b);
	if (sr !== 0) return sr;

	return a.localeCompare(b, 'en');
}

function workspaceScopeOrder(spec: string): number {
	if (spec.startsWith('@appartmint/')) return 0;
	if (spec.startsWith('@app-art-mint/')) return 1;
	return 2;
}

function compareWorkspace(a: string, b: string): number {
	const oa = workspaceScopeOrder(a);
	const ob = workspaceScopeOrder(b);
	if (oa !== ob) return oa - ob;
	return a.localeCompare(b, 'en');
}

function isRelativeLocalSpecifier(spec: string): boolean {
	return spec.startsWith('.') || spec.startsWith('..');
}

/** Tsconfig path aliases before `./` / `../` imports. */
function compareLocal(a: string, b: string): number {
	const ra = isRelativeLocalSpecifier(a);
	const rb = isRelativeLocalSpecifier(b);
	if (ra !== rb) return ra ? 1 : -1;
	return a.localeCompare(b, 'en');
}

function scriptKindForPath(filePath: string): ts.ScriptKind {
	return filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function organizeImports(sourceText: string, filePath: string, tsconfigEntries: TsConfigAliasEntry[]): string {
	const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKindForPath(filePath));
	const localAliasPrefixes = resolveLocalAliasPrefixes(filePath, tsconfigEntries);

	let i = 0;
	const stmts = sf.statements;
	while (i < stmts.length && ts.isImportDeclaration(stmts[i])) i++;
	if (i === 0) return sourceText;

	const importNodes = stmts.slice(0, i);
	const replaceStart = importNodes[0].getFullStart();
	const replaceEnd = importNodes[importNodes.length - 1].end;

	const importTexts = importNodes.map((node) => sourceText.slice(node.getStart(sf), node.end).trim());

	const parsed: ParsedImport[] = importTexts.map((trimmed) => {
		const spec = getModuleSpecifier(trimmed);
		const group = classify(spec, localAliasPrefixes);
		const wrapped = wrapImportIfNeeded(trimmed, 100, true);
		return { spec, group, finalText: wrapped, multi: isMultiLineImport(wrapped) };
	});

	parsed.sort((a, b) => {
		// All single-line imports (every group, in group order) before any multi-line import.
		if (a.multi !== b.multi) return a.multi ? 1 : -1;

		const go = groupOrder(a.group) - groupOrder(b.group);
		if (go !== 0) return go;

		let cmp = 0;
		switch (a.group) {
			case 'external':
				cmp = compareExternal(a.spec, b.spec);
				break;
			case 'workspace':
				cmp = compareWorkspace(a.spec, b.spec);
				break;
			case 'local':
				cmp = compareLocal(a.spec, b.spec);
				break;
			case 'environment':
				cmp = a.spec.localeCompare(b.spec, 'en');
				break;
		}
		if (cmp !== 0) return cmp;

		return a.finalText.localeCompare(b.finalText);
	});

	const newBlock = parsed.map((p) => p.finalText).join('\n');
	const before = sourceText.slice(0, replaceStart);
	const after = sourceText.slice(replaceEnd);

	const result = before + newBlock + after;
	return result;
}

const tsconfigEntries = loadTsConfigAliasEntries(ROOT);
const files = await listTsFilesUnderRoot(ROOT);

let changed = 0;
const changedRelativeToRoot: string[] = [];

console.log('Root: ' + ROOT);
console.log('Folders Scanned: ' + topLevelFoldersForFiles(ROOT, files).join(' '));
console.log('Files Scanned: ' + files.length.toString());

for (const filePath of files) {
	let text = fs.readFileSync(filePath, 'utf8');
	const original = text;

	text = organizeImports(text, filePath, tsconfigEntries);

	if (text !== original) {
		fs.writeFileSync(filePath, text, 'utf8');
		changed++;
		changedRelativeToRoot.push(path.relative(ROOT, filePath));
	}
}

console.log('Files Changed: ' + changed.toString());
for (const rel of changedRelativeToRoot) {
	console.log(`      ${rel}`);
}
console.log('');