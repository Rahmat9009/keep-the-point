/** 112 -> "1:52" */
export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${rest.toString().padStart(2, '0')}`;
}

/** "2:00" -> 120, "90" -> 90. Returns null for anything that isn't a valid time. */
export function parseTime(input: string): number | null {
  const text = input.trim();
  const mmss = /^(\d{1,3}):([0-5]\d)$/.exec(text);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  if (/^\d{1,5}$/.test(text)) return Number(text);
  return null;
}
