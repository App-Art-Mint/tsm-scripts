import { pathToFileURL } from 'node:url';
import { wrapSgr } from './ansi';

/**
 * Border glyphs for terminal cards. Most presets use only `h` and `v` for runs;
 * optional fields override specific edges or the title separator row.
 */
export interface BoxChars {
	readonly tl: string;
	readonly tr: string;
	readonly bl: string;
	readonly br: string;
	readonly h: string;
	readonly v: string;
	/** Horizontal run directly under the title row (default: `h`). */
	readonly hTitleSep?: string;
	/** Bottom border and footer horizontal run (default: `h`). */
	readonly hBottom?: string;
	/** Right edge of body rows (default: `v`). */
	readonly vRight?: string;
}

/**
 * Preset borders for terminal cards. Unicode box-drawing and ASCII fallbacks.
 * Ref: https://www.unicode.org/charts/PDF/U2500.pdf (Box Drawing)
 */
export const BOX_STYLES = {
	/** ┌ ┐ └ ┘ │ ─ */
	light: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
	/** ┏ ┓ ┗ ┛ ┃ ━ */
	heavy: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' },
	/** ╔ ╗ ╚ ╝ ║ ═; title separator uses light ─ */
	double: {
		tl: '╔',
		tr: '╗',
		bl: '╚',
		br: '╝',
		h: '═',
		v: '║',
		hTitleSep: '─',
	},
	/** ╭ ╮ ╰ ╯ │ ─ (rounded corners) */
	rounded: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
	/** ╓ ╖ ╙ ╜ ║ ─ (double vertical only) */
	doubleVertical: { tl: '╓', tr: '╖', bl: '╙', br: '╜', h: '─', v: '║' },
	/** + - | (ASCII; works everywhere) */
	ascii: { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' },
	/**
	 * Quadrant corners; top/bottom halves and left/right halves differ (glyph alignment).
	 * Top horizontals: ▀ · Bottom: ▄ · Left: ▌ · Right: ▐
	 */
	block: {
		tl: '▛',
		tr: '▜',
		bl: '▙',
		br: '▟',
		h: '▀',
		hBottom: '▄',
		v: '▌',
		vRight: '▐',
	},
} as const satisfies Record<string, BoxChars>;

/** Composite style: heavy top + title band, light body + bottom. */
export type CompositeBoxStyleName = 'heavyTitle';

export type BoxStyleName = keyof typeof BOX_STYLES | CompositeBoxStyleName;

export interface LogCardProps {
	title?: string;
	lines: string[];
	/** Named preset, composite name, or custom glyphs. Default: `light`. */
	style?: BoxStyleName | BoxChars;
}

const defaultBox: BoxChars = BOX_STYLES.light;

function resolveBox(style: LogCardProps['style']): BoxChars {
	if (style == null) return defaultBox;
	if (typeof style !== 'string') return style;
	if (style === 'heavyTitle') return defaultBox;
	return BOX_STYLES[style];
}

function horizontalRun(b: BoxChars, innerWidth: number, which: 'top' | 'titleSep' | 'bottom'): string {
	const char =
		which === 'bottom'
			? (b.hBottom ?? b.h)
			: which === 'titleSep'
				? (b.hTitleSep ?? b.h)
				: b.h;
	return char.repeat(innerWidth);
}

function verticalPair(b: BoxChars): { left: string; right: string } {
	return { left: b.v, right: b.vRight ?? b.v };
}

export function logCard({ title, lines, style }: LogCardProps) {
	if (style === 'heavyTitle') {
		logCardHeavyTitle({ title, lines });
		return;
	}

	const b = resolveBox(style);
	const maxLineLength = Math.max(...lines.map(line => line.length));
	const borderLength = maxLineLength + 4;
	const innerWidth = borderLength - 2;
	const { left: vl, right: vr } = verticalPair(b);

	const borderTop = horizontalRun(b, innerWidth, 'top');
	const headerLine = `\n${b.tl}${borderTop}${b.tr}`;
	const sep = horizontalRun(b, innerWidth, 'titleSep');
	const underLine = `${vl}${sep}${vr}`;
	const titleLine = title
		? `${vl} ${wrapSgr(title.padEnd(maxLineLength), 1)} ${vr}\n${underLine}`
		: '';
	const contentLines = lines.map(line => `${vl} ${line.padEnd(maxLineLength)} ${vr}`);
	const borderBottom = horizontalRun(b, innerWidth, 'bottom');
	const footerLine = `${b.bl}${borderBottom}${b.br}\n`;
	console.log(headerLine);
	console.log(titleLine);
	console.log(contentLines.join('\n'));
	console.log(footerLine);
}

function logCardHeavyTitle({ title, lines }: Pick<LogCardProps, 'title' | 'lines'>) {
	const H = BOX_STYLES.heavy;
	const L = BOX_STYLES.light;
	const maxLineLength = Math.max(...lines.map(line => line.length));
	const borderLength = maxLineLength + 4;
	const innerWidth = borderLength - 2;

	const borderTop = H.h.repeat(innerWidth);
	const headerLine = `\n${H.tl}${borderTop}${H.tr}`;
	const underLine = `${H.v}${H.h.repeat(innerWidth)}${H.v}`;
	const titleLine = title
		? `${H.v} ${wrapSgr(title.padEnd(maxLineLength), 1)} ${H.v}\n${underLine}`
		: '';
	const contentLines = lines.map(line => `${L.v} ${line.padEnd(maxLineLength)} ${L.v}`);
	const borderBottom = L.h.repeat(innerWidth);
	const footerLine = `${L.bl}${borderBottom}${L.br}\n`;
	console.log(headerLine);
	console.log(titleLine);
	console.log(contentLines.join('\n'));
	console.log(footerLine);
}

function formatPresetRefLine(p: BoxChars): string {
	const right = p.vRight ?? p.v;
	const bottomH = p.hBottom ?? p.h;
	const sep = p.hTitleSep;
	if (p.hBottom !== undefined || p.vRight !== undefined) {
		return `${p.tl}${p.h}${p.tr} ${p.v}${right} ${p.bl}${bottomH}${p.br}`;
	}
	if (sep !== undefined) {
		return `${p.tl}${p.h}${p.tr} · title sep: ${sep}`;
	}
	return `${p.tl}${p.h}${p.tr} ${p.v} ${p.bl}${p.h}${p.br}`;
}

/** Prints a small reference line (raw characters) then a sample card for each preset. */
export function logBoxStyleSamples(): void {
	const sampleLines = ['Line one', 'Line two'];
	const names: BoxStyleName[] = [
		...(Object.keys(BOX_STYLES) as (keyof typeof BOX_STYLES)[]),
		'heavyTitle',
	];
	console.log('');
	for (const name of names) {
		if (name === 'heavyTitle') {
			console.log('── heavyTitle ──  ┏━┓ header/title · ┌─┐ body/footer');
			logCard({ title: 'Sample', lines: sampleLines, style: 'heavyTitle' });
			continue;
		}
		const preset: BoxChars = BOX_STYLES[name];
		console.log(`── ${name} ──  ${formatPresetRefLine(preset)}`);
		logCard({ title: 'Sample', lines: sampleLines, style: name });
	}
}

const isMain =
	typeof process !== 'undefined' && import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMain) {
	logBoxStyleSamples();
}
