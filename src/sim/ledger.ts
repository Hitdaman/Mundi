// The bank statement: every money movement, newest first.
import { nowAbs, type Save } from '../core/store.js';


export interface Entry { at: number; text: string; amount: number }
export function ledger(g: Save): Entry[] { return ((g as any).ledger ??= []) as Entry[]; }
export function book(g: Save, text: string, amount: number) {
    const l = ledger(g);
    l.unshift({ at: nowAbs(g), text, amount });
    if (l.length > 40) l.length = 40;
}

