import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

const rootArg = process.argv[2];
const ROOT = rootArg ? path.resolve(rootArg) : process.cwd();
const SRC = path.join(ROOT, 'src');

type ImportGroup = 'external' | 'workspace' | 'local' | 'environment';

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

const FROM_RE = /from\s+(['"])([^'"]+)\1/;

function getModuleSpecifier(text: string): string {
	const m = FROM_RE.exec(text);
	return m ? m[2] : '';
}

function classify(spec: string): ImportGroup {
	if (!spec) return 'external';
	if (spec.includes('/environments/') || spec.includes('environments/environment')) return 'environment';
	if (spec.startsWith('@app-art-mint/') || spec.startsWith('@appartmint/')) return 'workspace';
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

function stripKnownSectionComments(text: string): string {
	let s = text;
	s = s.replace(/\n\s*\/\*\*\s*\n\s*\*\s*Routes\s*\n\s*\*\/\s*\n/g, '\n');
	s = s.replace(/\n\s*\/\*\*\s*\n\s*\*\s*Module\s*\n\s*\*\/\s*\n/g, '\n');
	return s;
}

function removeLeadingSectionJSDocOnStatements(text: string): string {
	const sf = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const toRemove: [number, number][] = [];

	for (const stmt of sf.statements) {
		const ranges = ts.getLeadingCommentRanges(text, stmt.getFullStart());
		if (!ranges?.length) continue;
		for (const r of ranges) {
			const ctext = text.slice(r.pos, r.end);
			if (!/^\s*\/\*\*/.test(ctext)) continue;
			const inner = ctext
				.replace(/^\s*\/\*\*\s*/, '')
				.replace(/\s*\*\/\s*$/, '')
				.replace(/^\s*\*\s?/gm, '')
				.trim();
			const lines = inner.split(/\n/).map((l) => l.trim()).filter(Boolean);
			if (lines.length === 1 && /^(Routes|Module|Imports)$/.test(lines[0])) {
				toRemove.push([r.pos, r.end]);
			}
		}
	}

	toRemove.sort((a, b) => b[0] - a[0]);
	let out = text;
	for (const [pos, end] of toRemove) {
		out = out.slice(0, pos) + out.slice(end);
	}
	return out;
}

function organizeImports(sourceText: string, filePath: string): string {
	const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

	let i = 0;
	const stmts = sf.statements;
	while (i < stmts.length && ts.isImportDeclaration(stmts[i])) i++;

	if (i === 0) {
		return stripKnownSectionComments(sourceText);
	}

	const importNodes = stmts.slice(0, i);
	const replaceStart = importNodes[0].getFullStart();
	const replaceEnd = importNodes[importNodes.length - 1].end;

	const importTexts = importNodes.map((node) => sourceText.slice(node.getStart(sf), node.end).trim());

	const semicolon = fileUsesSemicolon(sourceText, importTexts);

	const parsed: ParsedImport[] = importTexts.map((trimmed) => {
		const spec = getModuleSpecifier(trimmed);
		const group = classify(spec);
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

	let result = before + newBlock + after;
	result = stripKnownSectionComments(result);
	return result;
}

let changed = 0;
const files = walkTsFiles(SRC);

for (const filePath of files) {
	let text = fs.readFileSync(filePath, 'utf8');
	const original = text;

	text = organizeImports(text, filePath);
	text = removeLeadingSectionJSDocOnStatements(text);
	text = text.replace(/\n{3,}(\/\*\*)/g, '\n\n$1');

	if (text !== original) {
		fs.writeFileSync(filePath, text, 'utf8');
		changed++;
	}
}

console.log('Updated ' + changed.toString() + ' / ' + files.length.toString() + ' files.');
