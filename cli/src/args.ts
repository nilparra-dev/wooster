import { ResolveError } from "./resolver.js";

/**
 * Value readers shared by every command's argument loop. Each command keeps its
 * own option table, because the options differ, but the validation of a value
 * is the same rule everywhere: the same accepted forms, message and error code.
 * All of them read `args[index + 1]`; the caller advances `index` afterwards.
 */

/** A free-form value. A following option is not a value, so `-q -o x` fails. */
export function optionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new ResolveError(`${option} requires a value.`, "INVALID_ARGUMENT");
  return value;
}

/**
 * A canonical decimal integer in `[minimum, maximum]`. Forms such as `08`,
 * `+5` and `1e3` are rejected so the option text and its meaning cannot differ.
 * `expected` completes the "requires ..." message for ranges that read better
 * as a phrase than as bounds.
 */
export function integerValue(
  args: readonly string[],
  index: number,
  option: string,
  minimum: number,
  maximum: number,
  expected = `an integer between ${minimum} and ${maximum}`,
): number {
  const value = args[index + 1];
  const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum || String(parsed) !== value) {
    throw new ResolveError(`${option} requires ${expected}.`, "INVALID_ARGUMENT");
  }
  return parsed;
}

/** One of a closed set of words. */
export function choiceValue<T extends string>(
  args: readonly string[],
  index: number,
  option: string,
  choices: readonly T[],
): T {
  const value = args[index + 1];
  const choice = choices.find((candidate) => candidate === value);
  if (choice === undefined) {
    const list = choices.length > 1 ? `${choices.slice(0, -1).join(", ")} or ${choices.at(-1)}` : (choices[0] ?? "");
    throw new ResolveError(`${option} must be ${list}.`, "INVALID_ARGUMENT");
  }
  return choice;
}
