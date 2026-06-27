/**
 * ANSI / VT-style control sequences (CSI and related).
 * Reference: https://gist.github.com/fnky/458719343aabd01cfb17a3a4f7296797
 */

/** Escape (ESC, 0x1b) */
export const ESC = '\x1b';

/** Control Sequence Introducer: ESC [ */
export const CSI = `${ESC}[`;

/** RGB triple, 0–255 per channel (truecolor / 24-bit SGR). */
export type Rgb = readonly [r: number, g: number, b: number];

/** 1-based line and column for CUP (`CSI row;col H`), per common terminal behavior. */
export interface CursorPosition {
	readonly line: number;
	readonly column: number;
}

/** Named SGR graphic attributes (numeric codes after CSI, before `m`). */
export type SgrGraphicCode =
	| 0
	| 1
	| 2
	| 3
	| 4
	| 5
	| 7
	| 8
	| 9
	| 22
	| 23
	| 24
	| 25
	| 27
	| 28
	| 29
	| 30
	| 31
	| 32
	| 33
	| 34
	| 35
	| 36
	| 37
	| 39
	| 40
	| 41
	| 42
	| 43
	| 44
	| 45
	| 46
	| 47
	| 49
	| 90
	| 91
	| 92
	| 93
	| 94
	| 95
	| 96
	| 97
	| 100
	| 101
	| 102
	| 103
	| 104
	| 105
	| 106
	| 107;

/** 256-color palette index (0–255). */
export type Color256Index = number;

function csiParam(n: number): string {
	return String(n);
}

// --- Cursor controls + common private modes ---

export const cursor = {
	home: `${CSI}H`,
	/** Move to 1-based line and column (CUP / H). */
	position: (line: number, column: number): string => `${CSI}${csiParam(line)};${csiParam(column)}H`,
	/** Same as `position` (CUP alternate form). */
	positionAlt: (line: number, column: number): string => `${CSI}${csiParam(line)};${csiParam(column)}f`,

	up: (lines = 1): string => `${CSI}${csiParam(lines)}A`,
	down: (lines = 1): string => `${CSI}${csiParam(lines)}B`,
	right: (columns = 1): string => `${CSI}${csiParam(columns)}C`,
	left: (columns = 1): string => `${CSI}${csiParam(columns)}D`,

	/** Cursor to beginning of line `lines` rows down (CNL). */
	nextLine: (lines = 1): string => `${CSI}${csiParam(lines)}E`,
	/** Cursor to beginning of line `lines` rows up (CPL). */
	previousLine: (lines = 1): string => `${CSI}${csiParam(lines)}F`,

	/** Move to 1-based column on current row (CHA). */
	column: (column: number): string => `${CSI}${csiParam(column)}G`,

	/** Request cursor position (reports as CSI # ; # R — requires terminal read). */
	requestPosition: `${CSI}6n`,

	/** Index: move cursor down, scroll if needed. */
	index: `${ESC}D`,
	/** Reverse index: move cursor up, scroll if needed. */
	reverseIndex: `${ESC}M`,

	/** DEC: save cursor. */
	saveDec: `${ESC}7`,
	/** DEC: restore cursor. */
	restoreDec: `${ESC}8`,
	/** SCO: save cursor (widely supported, not standardized). */
	saveSco: `${CSI}s`,
	/** SCO: restore cursor. */
	restoreSco: `${CSI}u`,

	/** DEC private: hide cursor (`?25l`). */
	hide: `${CSI}?25l`,
	/** DEC private: show cursor (`?25h`). */
	show: `${CSI}?25h`,

	/** DEC private: save screen (`?47h`). */
	saveScreen: `${CSI}?47h`,
	/** DEC private: restore screen (`?47l`). */
	restoreScreen: `${CSI}?47l`,

	/** Alternate screen buffer on (`?1049h`). Pair with `alternateBufferOff` when done. */
	alternateBufferOn: `${CSI}?1049h`,
	/** Return to main buffer (`?1049l`). */
	alternateBufferOff: `${CSI}?1049l`,
} as const;

/** Move cursor using a `{ line, column }` object (1-based). */
export function cursorMoveTo(where: CursorPosition): string {
	return cursor.position(where.line, where.column);
}

// --- Erase functions ---

export const erase = {
	/** Erase from cursor to end of screen (default J). */
	fromCursorToEndOfScreen: `${CSI}0J`,
	/** Erase from cursor to end of screen (explicit). */
	toEndOfScreen: `${CSI}0J`,
	/** Erase from start of screen to cursor. */
	fromStartOfScreenToCursor: `${CSI}1J`,
	/** Erase entire screen (cursor position may be undefined across terminals). */
	entireScreen: `${CSI}2J`,
	/** Erase scrollback / saved lines where supported (`3J`). */
	savedLines: `${CSI}3J`,

	/** Erase from cursor to end of line (default K). */
	fromCursorToEndOfLine: `${CSI}0K`,
	toEndOfLine: `${CSI}0K`,
	/** Erase from start of line to cursor. */
	fromStartOfLineToCursor: `${CSI}1K`,
	/** Erase entire current line. */
	entireLine: `${CSI}2K`,

	/**
	 * RIS-style full reset of display state (ESC c). Clears screen; behavior varies by terminal.
	 */
	resetDevice: `${ESC}c`,
} as const;

// --- Colors / SGR (Select Graphic Rendition) ---

export const sgr = {
	reset: `${CSI}0m`,
	bold: `${CSI}1m`,
	resetBoldOrDim: `${CSI}22m`,
	dim: `${CSI}2m`,
	italic: `${CSI}3m`,
	resetItalic: `${CSI}23m`,
	underline: `${CSI}4m`,
	resetUnderline: `${CSI}24m`,
	blink: `${CSI}5m`,
	resetBlink: `${CSI}25m`,
	inverse: `${CSI}7m`,
	resetInverse: `${CSI}27m`,
	hidden: `${CSI}8m`,
	resetHidden: `${CSI}28m`,
	strikethrough: `${CSI}9m`,
	resetStrikethrough: `${CSI}29m`,

	fgBlack: `${CSI}30m`,
	fgRed: `${CSI}31m`,
	fgGreen: `${CSI}32m`,
	fgYellow: `${CSI}33m`,
	fgBlue: `${CSI}34m`,
	fgMagenta: `${CSI}35m`,
	fgCyan: `${CSI}36m`,
	fgWhite: `${CSI}37m`,
	fgDefault: `${CSI}39m`,

	bgBlack: `${CSI}40m`,
	bgRed: `${CSI}41m`,
	bgGreen: `${CSI}42m`,
	bgYellow: `${CSI}43m`,
	bgBlue: `${CSI}44m`,
	bgMagenta: `${CSI}45m`,
	bgCyan: `${CSI}46m`,
	bgWhite: `${CSI}47m`,
	bgDefault: `${CSI}49m`,

	fgBrightBlack: `${CSI}90m`,
	fgBrightRed: `${CSI}91m`,
	fgBrightGreen: `${CSI}92m`,
	fgBrightYellow: `${CSI}93m`,
	fgBrightBlue: `${CSI}94m`,
	fgBrightMagenta: `${CSI}95m`,
	fgBrightCyan: `${CSI}96m`,
	fgBrightWhite: `${CSI}97m`,

	bgBrightBlack: `${CSI}100m`,
	bgBrightRed: `${CSI}101m`,
	bgBrightGreen: `${CSI}102m`,
	bgBrightYellow: `${CSI}103m`,
	bgBrightBlue: `${CSI}104m`,
	bgBrightMagenta: `${CSI}105m`,
	bgBrightCyan: `${CSI}106m`,
	bgBrightWhite: `${CSI}107m`,
} as const;

/** Build `CSI … m` from one or more SGR numbers (e.g. bold + red: `1`, `31`). */
export function sgrSequence(...codes: number[]): string {
	if (codes.length === 0) {
		return `${CSI}0m`;
	}
	return `${CSI}${codes.map(csiParam).join(';')}m`;
}

/** Foreground 256-color (`38;5;n`). */
export function sgrForeground256(index: Color256Index): string {
	return `${CSI}38;5;${csiParam(index)}m`;
}

/** Background 256-color (`48;5;n`). */
export function sgrBackground256(index: Color256Index): string {
	return `${CSI}48;5;${csiParam(index)}m`;
}

/** Foreground truecolor (`38;2;r;g;b`). */
export function sgrForegroundRgb(rgb: Rgb): string {
	const [r, g, b] = rgb;
	return `${CSI}38;2;${csiParam(r)};${csiParam(g)};${csiParam(b)}m`;
}

/** Background truecolor (`48;2;r;g;b`). */
export function sgrBackgroundRgb(rgb: Rgb): string {
	const [r, g, b] = rgb;
	return `${CSI}48;2;${csiParam(r)};${csiParam(g)};${csiParam(b)}m`;
}

/**
 * Wrap text with SGR open and reset, e.g. bold red "hi":
 * `wrapSgr("hi", 1, 31)`.
 */
export function wrapSgr(text: string, ...codes: number[]): string {
	return `${sgrSequence(...codes)}${text}${sgr.reset}`;
}
