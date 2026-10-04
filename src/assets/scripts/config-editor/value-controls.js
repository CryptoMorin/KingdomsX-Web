export const DURATION_UNITS = [
  { value: "years", label: "Years", milliseconds: 31_536_000_000, aliases: ["year", "years"] },
  { value: "months", label: "Months", milliseconds: 2_592_000_000, aliases: ["month", "months"] },
  { value: "weeks", label: "Weeks", milliseconds: 604_800_000, aliases: ["week", "weeks"] },
  { value: "days", label: "Days", milliseconds: 86_400_000, aliases: ["d", "day", "days"] },
  { value: "hours", label: "Hours", milliseconds: 3_600_000, aliases: ["h", "hr", "hrs", "hour", "hours"] },
  { value: "minutes", label: "Minutes", milliseconds: 60_000, aliases: ["m", "min", "mins", "minute", "minutes"] },
  { value: "seconds", label: "Seconds", milliseconds: 1_000, aliases: ["s", "sec", "secs", "second", "seconds"] },
  { value: "milliseconds", label: "Milliseconds", milliseconds: 1, aliases: ["ms", "millisec", "millisecs", "millisecond", "milliseconds"] }
];

const aliasToUnit = new Map(DURATION_UNITS.flatMap((unit) => unit.aliases.map((alias) => [alias, unit.value])));

export function parseDurationLiteral(source) {
  const match = /^\s*(\d+)\s*([a-z]+)?\s*$/i.exec(source);

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const suffix = match[2]?.toLocaleLowerCase("en-US") ?? "";

  if (!suffix) {
    return amount === 0 ? { amount, unit: "milliseconds", suffix: "" } : null;
  }

  const unit = aliasToUnit.get(suffix);

  return unit ? { amount, unit, suffix } : null;
}

export function formatDuration(amount, unit) {
  if (!Number.isInteger(amount) || amount < 0 || !DURATION_UNITS.some((candidate) => candidate.value === unit)) {
    throw new Error("Durations require a non-negative whole number and a valid time unit.");
  }

  return `${amount}${unit}`;
}
