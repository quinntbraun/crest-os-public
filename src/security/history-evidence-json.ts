// Internal lossless reader for opaque PostgreSQL JSONB receipt/delta/payload
// text. Numeric values never pass through JavaScript Number. No I/O.
class ExactNumber {
  readonly value: string;
  constructor(token: string) {
    const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token)!;
    if ((m[4]?.replace(/^[+-]/, '').length ?? 0) > 6) throw new Error('HISTORY_JSON_REVIEW_REQUIRED');
    let digits = (m[2]! + (m[3] ?? '')).replace(/^0+/, '');
    let exponent = BigInt(m[4] ?? '0') - BigInt(m[3]?.length ?? 0);
    const trailing = /0+$/.exec(digits)?.[0].length ?? 0;
    if (trailing) { digits = digits.slice(0, -trailing); exponent += BigInt(trailing); }
    this.value = digits ? m[1] + digits + 'e' + exponent : '0';
    Object.freeze(this);
  }
}
function require(value: unknown): asserts value {
  if (!value) throw new Error('HISTORY_JSON_REVIEW_REQUIRED');
}
export function historyJsonNumber(value: unknown, expected: number): boolean {
  return value instanceof ExactNumber && value.value === new ExactNumber(String(expected)).value;
}
export function historyJsonInteger(value: unknown): number | undefined {
  if (!(value instanceof ExactNumber)) return undefined;
  if (value.value === '0') return 0;
  const m = /^(-?)([1-9][0-9]*)e(-?[0-9]+)$/.exec(value.value)!;
  const exponent = Number(m[3]);
  if (exponent < 0 || exponent > 15 || m[2]!.length + exponent > 16) return undefined;
  const n = Number(m[1]! + m[2]!) * 10 ** exponent;
  return Number.isSafeInteger(n) ? n : undefined;
}
// Convert only proven exact signed64 integers, never rounded Number values.
export function historyJsonBigint(value: unknown): bigint | undefined {
  if (!(value instanceof ExactNumber)) return undefined;
  if (value.value === '0') return 0n;
  const m = /^(-?)([1-9][0-9]*)e(-?[0-9]+)$/.exec(value.value)!;
  const exponent = Number(m[3]);
  if (exponent < 0 || exponent > 18 || m[2]!.length + exponent > 19) return undefined;
  const n = BigInt(m[1]! + m[2]!) * 10n ** BigInt(exponent);
  return n >= -9223372036854775808n && n <= 9223372036854775807n ? n : undefined;
}
export function historyJsonEqual(a: unknown, b: unknown): boolean {
  if (a instanceof ExactNumber || b instanceof ExactNumber) return a instanceof ExactNumber && b instanceof ExactNumber && a.value === b.value;
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(k => Object.hasOwn(right, k) && historyJsonEqual(left[k], right[k]));
}
export function parseHistoryJson(source: string): unknown {
  // Each caller first enforces its source-column byte cap. These structural
  // limits are processing limits, not additional PostgreSQL source constraints.
  let at = 0, nodes = 0;
  const space = () => { while (at < source.length && ' \t\r\n'.includes(source[at]!)) at++; };
  function string(): string {
    require(source[at++] === '"'); const start = at - 1;
    while (at < source.length) {
      const c = source.charCodeAt(at++);
      if (c === 34) {
        const decoded: unknown = JSON.parse(source.slice(start, at));
        require(typeof decoded === 'string' && !decoded.includes('\0') && Buffer.from(decoded, 'utf8').toString('utf8') === decoded);
        return decoded;
      }
      require(c >= 32);
      if (c === 92) {
        const escape = source[at++]; require(escape !== undefined && '"\\/bfnrtu'.includes(escape));
        if (escape === 'u') { require(/^[a-fA-F0-9]{4}$/.test(source.slice(at, at + 4))); at += 4; }
      }
    }
    throw new Error('HISTORY_JSON_REVIEW_REQUIRED');
  }
  function value(depth: number): unknown {
    space(); require(++nodes <= 100000 && depth <= 32); const c = source[at];
    if (c === '"') return string();
    if (c === '{') {
      at++; space(); const result: Record<string, unknown> = Object.create(null);
      if (source[at] === '}') { at++; return result; }
      let keys = 0;
      for (;;) {
        space(); const name = string(); require(++keys <= 10000 && !Object.hasOwn(result, name));
        space(); require(source[at++] === ':'); result[name] = value(depth + 1); space();
        const next = source[at++]; if (next === '}') return result; require(next === ',');
      }
    }
    if (c === '[') {
      at++; space(); const result: unknown[] = [];
      if (source[at] === ']') { at++; return result; }
      for (;;) {
        require(result.length < 10000); result.push(value(depth + 1)); space();
        const next = source[at++]; if (next === ']') return result; require(next === ',');
      }
    }
    for (const [token, decoded] of [['null', null], ['true', true], ['false', false]] as const) {
      if (source.startsWith(token, at)) { at += token.length; return decoded; }
    }
    const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
    number.lastIndex = at; const match = number.exec(source); require(match); at = number.lastIndex;
    return new ExactNumber(match[0]);
  }
  const result = value(0); space(); require(at === source.length); return result;
}
