import { DateKey } from "../task";

export function dateToKey(d: Date): DateKey {
    const y   = d.getFullYear();
    const m   = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function keyToDate(key: string): Date {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(d: Date, n: number): Date {
    const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    copy.setDate(copy.getDate() + n);
    return copy;
}

export function startOfWeek(d: Date): Date {
    const x    = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow  = x.getDay();
    const diff = dow === 0 ? -6 : 1 - dow; // maybe make it customizable
    x.setDate(x.getDate() + diff);
    return x;
}

export function getWeekDateKeys(weekStart: Date): DateKey[] {
    return Array.from({ length: 7 }, (_, i) => dateToKey(addDays(weekStart, i)));
}

export function formatWeekRange(weekStart: Date): string {
    const end = addDays(weekStart, 6);
    const fmt = new Intl.DateTimeFormat(undefined, {
        month: "short",
        day:   "numeric",
        year:  "numeric",
    });
    return `${fmt.format(weekStart)} — ${fmt.format(end)}`;
}

export function formatLongDate(key: string): string {
    return new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        year:    "numeric",
        month:   "short",
        day:     "numeric",
    }).format(keyToDate(key));
}

export function formatMonthDay(key: string): string {
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day:   "numeric",
    }).format(keyToDate(key));
}
