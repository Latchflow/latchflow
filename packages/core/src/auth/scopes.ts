export function hasAll(required: string[], given: string[]): boolean {
  for (const s of required) if (!given.includes(s)) return false;
  return true;
}

export function hasAny(required: string[], given: string[]): boolean {
  for (const s of required) if (given.includes(s)) return true;
  return false;
}
