export type WeightFormat = 'sd' | 'nai';

export interface ConversionWarning {
  code: 'unsupported' | 'unbalanced' | 'ambiguous' | 'invalid_weight';
  /** Half-open offsets in the original input, not the converted output. */
  start: number;
  end: number;
}

export interface WeightConversion {
  output: string;
  converted: number;
  warnings: ConversionWarning[];
}

interface Span {
  end: number;
  code?: ConversionWarning['code'];
}

interface Group extends Span {
  colons: number[];
  nested: boolean;
  control: boolean;
  pipe: boolean;
  doubleColon: boolean;
}

interface NumericOpener {
  weight: string;
  body: number;
  valid: boolean;
}

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const OPENERS = '([{';
const CLOSERS = ')]}';
const PAIRED_CONTROLS = new Set(['from', 'to', 'range', 'region']);
const TOKEN_BREAK = /[\s,;()[\]{}<>]/;

function escapedAt(input: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && input[cursor] === '\\'; cursor--) slashes++;
  return slashes % 2 === 1;
}

/** Protect complete Mooshie control blocks, including their prompt contents. */
function controlSpans(input: string): Map<number, Span> {
  const spans = new Map<number, Span>();
  const opens = new Map<string, Array<{ start: number; end: number }>>();
  const segments: number[] = [];
  for (let cursor = 0; cursor < input.length; cursor++) {
    if (input[cursor] === '\\') {
      cursor++;
      continue;
    }
    if (input[cursor] !== '<') continue;
    const header = /^<\/?([a-z][\w-]*)(?=[:>\s[\/])/i.exec(input.slice(cursor));
    if (!header) continue;
    let end = cursor + header[0].length;
    while (end < input.length && (input[end] !== '>' || escapedAt(input, end))) end++;
    if (end === input.length) {
      spans.set(cursor, { end, code: 'unbalanced' });
      break;
    }
    end++;
    const name = header[1].toLowerCase();
    const closing = input[cursor + 1] === '/';
    const stack = opens.get(name) ?? [];
    spans.set(cursor, { end, code: closing ? 'unbalanced' : 'unsupported' });
    if (closing) {
      const open = stack.pop();
      if (open) spans.set(open.start, { end, code: 'unsupported' });
    } else if (!input.slice(cursor, end).endsWith('/>')) {
      stack.push({ start: cursor, end });
      if (name === 'segment') segments.push(cursor);
    }
    opens.set(name, stack);
    cursor = end - 1;
  }
  for (const [name, stack] of opens) {
    for (const open of stack) {
      if (PAIRED_CONTROLS.has(name)) {
        spans.set(open.start, { end: input.length, code: 'unbalanced' });
      } else if (name === 'segment') {
        // Mooshie also supports a segment whose contents run to the next segment.
        const next = segments.find((start) => start > open.start);
        spans.set(open.start, { end: next ?? input.length, code: 'unsupported' });
      }
    }
  }
  return spans;
}

function readGroup(input: string, start: number, controls: Map<number, Span>): Group {
  const stack = [input[start]];
  const group: Group = {
    end: input.length, colons: [], nested: false, control: false, pipe: false, doubleColon: false,
  };
  for (let cursor = start + 1; cursor < input.length; cursor++) {
    const char = input[cursor];
    if (char === '\\') {
      cursor++;
      continue;
    }
    const control = controls.get(cursor);
    if (control) {
      group.control = true;
      cursor = control.end - 1;
      continue;
    }
    const open = OPENERS.indexOf(char);
    if (open !== -1) {
      stack.push(char);
      group.nested = true;
      continue;
    }
    const close = CLOSERS.indexOf(char);
    if (close !== -1) {
      if (stack[stack.length - 1] !== OPENERS[close]) return { ...group, code: 'unbalanced' };
      stack.pop();
      if (!stack.length) return { ...group, end: cursor + 1 };
      continue;
    }
    if (stack.length === 1) {
      if (char === ':') group.colons.push(cursor);
      if (char === '|') group.pipe = true;
    }
    if (char === ':' && input[cursor + 1] === ':') group.doubleColon = true;
  }
  return { ...group, code: 'unbalanced' };
}

function numericOpener(input: string, start: number): NumericOpener | null {
  let cursor = start;
  while (cursor < input.length && !TOKEN_BREAK.test(input[cursor]) && input[cursor] !== '\\') {
    if (input.startsWith('::', cursor)) {
      const weight = input.slice(start, cursor);
      if (!weight) return null;
      return { weight, body: cursor + 2, valid: DECIMAL.test(weight) && Number.isFinite(Number(weight)) };
    }
    cursor++;
  }
  return null;
}

function tokenBoundary(input: string, cursor: number): boolean {
  return cursor === 0 || /[\s,;]/.test(input[cursor - 1]);
}

function possibleNestedTail(input: string, start: number, controls: Map<number, Span>): boolean {
  for (let cursor = start; cursor < input.length; cursor++) {
    if (input[cursor] === '\\') {
      cursor++;
      continue;
    }
    const control = controls.get(cursor);
    if (control) {
      cursor = control.end - 1;
      continue;
    }
    if (!input.startsWith('::', cursor)) continue;
    // A number immediately before the closing delimiter can simply be part of
    // the phrase ("year 2026"). A following independent numeric span likewise
    // does not establish nesting. Consecutive closers do establish ambiguity.
    if (input.startsWith('::', cursor + 2)) return true;
    const between = input.slice(start, cursor).replace(/^[\s,;]+/, '');
    return !DECIMAL.test(between);
  }
  return false;
}

function readNumeric(input: string, opener: NumericOpener, controls: Map<number, Span>): Span {
  let depth = 1;
  let code: Span['code'];
  for (let cursor = opener.body; cursor < input.length;) {
    if (input[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    const control = controls.get(cursor);
    if (control) {
      code = control.code ?? 'unsupported';
      cursor = control.end;
      continue;
    }
    if (input.startsWith('::', cursor)) {
      depth--;
      cursor += 2;
      if (!depth) return { end: cursor, code: cursor - 2 === opener.body ? 'ambiguous' : code };
      continue;
    }
    if (cursor === opener.body || tokenBoundary(input, cursor) || input[cursor - 1] === '(') {
      const nested = numericOpener(input, cursor);
      if (nested && (nested.valid || /^[+-]?(?:NaN|Infinity)$/i.test(nested.weight))
        && possibleNestedTail(input, nested.body, controls)) {
        depth++;
        code = 'ambiguous';
        cursor = nested.body;
        continue;
      }
    }
    if (input[cursor] === '{' || input[cursor] === '[') {
      const group = readGroup(input, cursor, controls);
      code = group.code ?? (group.pipe || group.colons.length > 1 ? 'unsupported' : 'ambiguous');
      cursor = group.end;
      continue;
    }
    cursor++;
  }
  return { end: input.length, code: 'unbalanced' };
}

/** Exact decimal powers avoid rounding a legacy wrapper's effective weight. */
function legacyWeight(base: bigint, layers: number): string {
  const digits = (base ** BigInt(layers)).toString().padStart(layers * 2 + 1, '0');
  const point = digits.length - layers * 2;
  return (digits.slice(0, point) + '.' + digits.slice(point)).replace(/0+$/, '').replace(/\.$/, '');
}

function escapeLiteral(input: string, format: WeightFormat): string {
  let output = '';
  for (let cursor = 0; cursor < input.length; cursor++) {
    const char = input[cursor];
    if (char === '\\') {
      output += input.slice(cursor, cursor + 2);
      cursor++;
    } else if ((format === 'sd' ? '()[]' : '{}[]').includes(char)) {
      output += '\\' + char;
    } else if (format === 'nai' && input.startsWith('::', cursor)) {
      output += '\\:\\:';
      cursor++;
    } else {
      output += char;
    }
  }
  return output;
}

/** Render a finite JS number without exponent syntax or arbitrary rounding. */
function decimalNumber(weight: number): string {
  const value = String(weight);
  if (!/[eE]/.test(value)) return value;
  const [mantissa, exponent] = value.toLowerCase().split('e');
  const negative = mantissa.startsWith('-');
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const [integer, fraction = ''] = unsigned.split('.');
  const digits = integer + fraction;
  const point = integer.length + Number(exponent);
  const decimal = point <= 0
    ? '0.' + '0'.repeat(-point) + digits
    : point >= digits.length
      ? digits + '0'.repeat(point - digits.length)
      : digits.slice(0, point) + '.' + digits.slice(point);
  return (negative ? '-' : '') + decimal;
}

/** Mixer tags are literal text; do not turn a tag's parentheses into emphasis. */
export function formatWeightedTag(content: string, weight: number, format: WeightFormat): string {
  const literal = escapeLiteral(content, format);
  if (!Number.isFinite(weight) || weight === 1) return literal;
  const number = decimalNumber(weight);
  return format === 'sd' ? `(${literal}:${number})` : `${number}::${literal}::`;
}

/**
 * Convert complete weighted spans rather than comma-separated tag fragments.
 * Unsupported syntax stays byte-for-byte intact. NovelAI has no defined nested
 * numeric spans, so nested attention is deliberately reported, never guessed.
 */
export function convertWeights(input: string, from: WeightFormat, to: WeightFormat): WeightConversion {
  if (from === to) return { output: input, converted: 0, warnings: [] };
  const controls = controlSpans(input);
  const output: string[] = [];
  const warnings: ConversionWarning[] = [];
  let converted = 0;
  let constructEnd = -1;
  const preserve = (start: number, end: number, code: ConversionWarning['code']) => {
    output.push(input.slice(start, end));
    warnings.push({ code, start, end });
    constructEnd = end;
  };
  for (let cursor = 0; cursor < input.length;) {
    const char = input[cursor];
    if (char === '\\') {
      output.push(input.slice(cursor, cursor + 2));
      cursor += 2;
      continue;
    }
    const control = controls.get(cursor);
    if (control) {
      preserve(cursor, control.end, control.code ?? 'unsupported');
      cursor = control.end;
      continue;
    }
    if (OPENERS.includes(char)) {
      const group = readGroup(input, cursor, controls);
      const body = input.slice(cursor + 1, group.end - 1);
      const colon = group.colons[group.colons.length - 1];
      if (group.code) {
        preserve(cursor, group.end, group.code);
      } else if (group.control || group.pipe) {
        preserve(cursor, group.end, 'unsupported');
      } else if (from === 'sd' && char === '(' && colon !== undefined) {
        const weight = input.slice(colon + 1, group.end - 1).trim();
        if (!DECIMAL.test(weight) || !Number.isFinite(Number(weight))) {
          preserve(cursor, group.end, 'invalid_weight');
        } else if (group.nested || group.doubleColon || !input.slice(cursor + 1, colon).trim()) {
          preserve(cursor, group.end, 'ambiguous');
        } else {
          output.push(`${weight}::${input.slice(cursor + 1, colon)}::`);
          converted++;
        }
      } else if (from === 'nai' && (char === '{' || char === '[')) {
        const scheduled = char === '[' && (group.colons.length > 1
          || (colon !== undefined && DECIMAL.test(input.slice(colon + 1, group.end - 1).trim())));
        let layers = 1;
        let content = body;
        while (content.startsWith(char) && content.endsWith(char === '{' ? '}' : ']')) {
          const wrapped = readGroup(content, 0, new Map());
          if (wrapped.code || wrapped.end !== content.length) break;
          layers++;
          content = content.slice(1, -1);
        }
        const inner = readGroup(char + content + (char === '{' ? '}' : ']'), 0, new Map());
        const innerColon = inner.colons[inner.colons.length - 1];
        const innerScheduled = char === '[' && (inner.colons.length > 1
          || (innerColon !== undefined && DECIMAL.test(content.slice(innerColon).trim())));
        if (scheduled || innerScheduled || group.doubleColon || inner.pipe) {
          preserve(cursor, group.end, 'unsupported');
        } else if (inner.nested || inner.code || !content.trim() || layers > 128) {
          preserve(cursor, group.end, 'ambiguous');
        } else {
          // These multipliers match Mooshie's NovelAI metadata importer.
          output.push(`(${escapeLiteral(content, 'sd')}:${legacyWeight(char === '{' ? 105n : 95n, layers)})`);
          converted++;
        }
      } else {
        preserve(cursor, group.end, 'unsupported');
      }
      constructEnd = group.end;
      cursor = group.end;
      continue;
    }
    if (CLOSERS.includes(char) || input.startsWith('::', cursor)) {
      const end = cursor + (input.startsWith('::', cursor) ? 2 : 1);
      preserve(cursor, end, 'unbalanced');
      cursor = end;
      continue;
    }
    if (tokenBoundary(input, cursor) || cursor === constructEnd) {
      const opener = numericOpener(input, cursor);
      if (opener) {
        const span = readNumeric(input, opener, controls);
        if (!opener.valid) {
          preserve(cursor, span.end, 'invalid_weight');
        } else if (span.code || from !== 'nai') {
          preserve(cursor, span.end, span.code ?? 'unsupported');
        } else {
          output.push(`(${escapeLiteral(input.slice(opener.body, span.end - 2), 'sd')}:${opener.weight})`);
          converted++;
        }
        constructEnd = span.end;
        cursor = span.end;
        continue;
      }
    }
    output.push(char);
    cursor++;
  }
  return { output: output.join(''), converted, warnings };
}
