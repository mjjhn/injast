const zone = "Asia/Tehran";
export function serverToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function dateBounds(today = serverToday()) {
  const start = new Date(`${today}T12:00:00Z`);
  const min = new Date(start);
  min.setUTCDate(min.getUTCDate() + 30);
  const max = new Date(start);
  max.setUTCDate(1);
  max.setUTCMonth(max.getUTCMonth() + 24);
  const end = new Date(
    Date.UTC(max.getUTCFullYear(), max.getUTCMonth() + 1, 0),
  ).getUTCDate();
  max.setUTCDate(Math.min(start.getUTCDate(), end));
  return {
    min: min.toISOString().slice(0, 10),
    max: max.toISOString().slice(0, 10),
  };
}
export function fromISO(value: string): Date {
  return new Date(`${value}T12:00:00`);
}
export function toISO(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
export const formatDate = (value: string) =>
  new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(fromISO(value));
