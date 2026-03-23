import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const rootArg = process.argv[2];
const ROOT = rootArg ? path.resolve(rootArg) : process.cwd();

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

function walkTsFiles(dir: string, out: string[] = []): string[] {
	for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, name.name);
		if (name.isDirectory()) walkTsFiles(p, out);
		else if (name.isFile() && name.name.endsWith('.ts')) out.push(p);
	}
	return out;
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
	if (spec.includes('/environments/') || spec.includes('environments/environment') || spec.includes('.env')) return 'environment';
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

function fileUsesSemicolon(sourceText: string, importTexts: string[]): boolean {
	if (importTexts.some((t) => /;\s*$/.test(t))) return true;
	const sample = sourceText.slice(0, 2000);
	return /import[^;]+;\s*\n/.test(sample);
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

function sortKey(spec: string): string {
	if (spec.startsWith('@')) return spec.slice(1);
	return spec;
}

function compareSpec(a: string, b: string): number {
	return sortKey(a).localeCompare(sortKey(b), 'en');
}


function organizeImports(sourceText: string, filePath: string, tsconfigEntries: TsConfigAliasEntry[]): string {
	const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const localAliasPrefixes = resolveLocalAliasPrefixes(filePath, tsconfigEntries);

	let i = 0;
	const stmts = sf.statements;
	while (i < stmts.length && ts.isImportDeclaration(stmts[i])) i++;
	if (i === 0) return sourceText;

	const importNodes = stmts.slice(0, i);
	const replaceStart = importNodes[0].getFullStart();
	const replaceEnd = importNodes[importNodes.length - 1].end;

	const importTexts = importNodes.map((node) => sourceText.slice(node.getStart(sf), node.end).trim());

	const semicolon = fileUsesSemicolon(sourceText, importTexts);

	const parsed: ParsedImport[] = importTexts.map((trimmed) => {
		const spec = getModuleSpecifier(trimmed);
		const group = classify(spec, localAliasPrefixes);
		const wrapped = wrapImportIfNeeded(trimmed, 100, semicolon);
		return { spec, group, finalText: wrapped, multi: isMultiLineImport(wrapped) };
	});

	parsed.sort((a, b) => {
		const go = groupOrder(a.group) - groupOrder(b.group);
		if (go !== 0) return go;
		const cmp = compareSpec(a.spec, b.spec);
		if (cmp !== 0) return cmp;
		if (a.multi !== b.multi) return a.multi ? 1 : -1;
		return a.finalText.localeCompare(b.finalText);
	});

	const newBlock = parsed.map((p) => p.finalText).join('\n');
	const before = sourceText.slice(0, replaceStart);
	const after = sourceText.slice(replaceEnd);

	const result = before + newBlock + after;
	return result;
}

let changed = 0;
const files = walkTsFiles(ROOT);
const tsconfigEntries = loadTsConfigAliasEntries(ROOT);

for (const filePath of files) {
	let text = fs.readFileSync(filePath, 'utf8');
	const original = text;

	text = organizeImports(text, filePath, tsconfigEntries);
	text = text.replace(/\n{3,}(\/\*\*)/g, '\n\n$1');

	if (text !== original) {
		fs.writeFileSync(filePath, text, 'utf8');
		changed++;
	}
}

console.log('Updated ' + changed.toString() + ' / ' + files.length.toString() + ' files.');
