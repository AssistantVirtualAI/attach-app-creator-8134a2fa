// Dependency-free assertions for Deno tests (no node:, jsr: or npm: import, so they run offline and in CI alike).
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
export function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }
export function assertEquals(actual: unknown, expected: unknown, message?: string) {
  if (!deepEqual(actual, expected)) throw new Error(`${message ?? "values differ"}\nactual:   ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(expected)}`);
}
export function assertMatch(actual: string, re: RegExp, message?: string) { if (!re.test(actual)) throw new Error(message ?? `${JSON.stringify(actual)} does not match ${re}`); }
export function assertStringIncludes(actual: string, expected: string, message?: string) { if (!actual.includes(expected)) throw new Error(message ?? `expected text to include ${JSON.stringify(expected)}`); }
