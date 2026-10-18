// Dates and times the way you chose in Settings (date format, 24 h or 12 h clock).
import { UI } from './store.js';

export const DATE_FORMATS: [string, string][] = [
    ['DD/MM/YYYY', '31/12/2026'], ['MM/DD/YYYY', '12/31/2026 (US)'], ['YYYY-MM-DD', '2026-12-31 (ISO)'], ['DD.MM.YYYY', '31.12.2026'],
    ['DD-MM-YYYY', '31-12-2026'], ['YYYY/MM/DD', '2026/12/31'], ['D MMM YYYY', '31 Dec 2026'], ['MMM D, YYYY', 'Dec 31, 2026 (US)'], ['DD MMMM YYYY', '31 December 2026'], ['MMMM D, YYYY', 'December 31, 2026'],
];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const p2 = (n: number) => String(n).padStart(2, '0');
const u = () => UI() as any;
export const is12h = () => u().timeFormat === '12';

export function fmtDate(t: number | Date): string {
    const d = t instanceof Date ? t : new Date(t);
    if (isNaN(d.getTime())) return '';
    const f = String(u().dateFormat || 'DD/MM/YYYY');
    const map: Record<string, string> = { YYYY: String(d.getFullYear()), MMMM: MON[d.getMonth()], MMM: MON[d.getMonth()].slice(0, 3), MM: p2(d.getMonth() + 1), DD: p2(d.getDate()), D: String(d.getDate()) };
    return f.replace(/YYYY|MMMM|MMM|MM|DD|D/g, k => map[k]);
}
// A clock time from minutes of the day.
export function fmtClock(min: number, withSuffix = true): string {
    const h = Math.floor(min / 60) % 24, m = p2(Math.floor(min % 60));
    if (!is12h()) return `${p2(h)}:${m}`;
    return `${(h % 12) || 12}:${m}${withSuffix ? (h < 12 ? ' AM' : ' PM') : ''}`;
}
export const fmtTime = (t: number | Date) => { const d = t instanceof Date ? t : new Date(t); return fmtClock(d.getHours() * 60 + d.getMinutes()); };
export const fmtDateTime = (t: number) => (t ? `${fmtDate(t)} ${fmtTime(t)}` : '—');
