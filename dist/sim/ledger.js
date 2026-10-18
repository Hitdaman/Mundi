// The bank statement: every money movement, newest first.
import { nowAbs } from '../core/store.js';
export function ledger(g) { return (g.ledger ??= []); }
export function book(g, text, amount) {
    const l = ledger(g);
    l.unshift({ at: nowAbs(g), text, amount });
    if (l.length > 40)
        l.length = 40;
}
