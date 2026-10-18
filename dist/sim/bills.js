// Difficulty and the bills of your home.
// Difficulty changes the economy: how much work pays, what things cost and the money you start with.
// Bills (rent, water, power) are due every week and paid by you, in the Homes app. A bill left unpaid for a week is
// cut off: no water (no shower, no tap, no cooking), no power (no stove, TV, computer, coffee machine…), or, for the
// rent, you are locked out of your home until you pay.
import { cfg } from '../core/store.js';
import { book } from './ledger.js';
import { money } from './needs.js';
export const DIFFICULTIES = [
    { id: 'easy', name: 'Easy', desc: 'Work pays more, things cost less, and you start with more money.', pay: 1.25, price: 0.8, start: 1.5 },
    { id: 'normal', name: 'Normal', desc: 'The balance the world was made with.', pay: 1, price: 1, start: 1 },
    { id: 'hard', name: 'Hard', desc: 'Work pays less, everything costs more, and you start with little. Every bill counts.', pay: 0.8, price: 1.25, start: 0.6 },
];
export const difficultyOf = (g) => DIFFICULTIES.find(d => d.id === (cfg(g).difficulty ?? 'normal')) ?? DIFFICULTIES[1];
// A price (what you pay) and an income (what you get), after the difficulty.
export const priceOf = (g, v) => (v > 0 ? Math.round(v * difficultyOf(g).price) : v < 0 ? Math.round(v * difficultyOf(g).pay) : 0);
export const payOf = (g, v) => Math.round(v * difficultyOf(g).pay);
export const BILLS = [
    { id: 'rent', name: 'Rent', icon: 'home' },
    { id: 'water', name: 'Water', icon: 'drop' },
    { id: 'power', name: 'Power', icon: 'bolt' },
];
const EVERY = 7;
export function bills(g) {
    const x = g;
    if (!x.bills) {
        // older saves: the first bills are due a week after the last rent
        const first = (g.player.rentPaidDay ?? g.day) + EVERY;
        x.bills = { rent: { due: first }, water: { due: first }, power: { due: first } };
    }
    return x.bills;
}
const zoneOf = (g, w) => w.homes.zones.find(z => z.id === g.player.home.zone);
export function billAmount(g, w, id) {
    const zone = zoneOf(g, w);
    const kind = g.player.home.kind ?? zone?.kind ?? '';
    const base = id === 'rent' ? zone?.rent ?? 0 : Number(w.homes.kinds[kind]?.bills?.[id] ?? 0);
    return priceOf(g, base);
}
// How many weeks are owed (0 = paid up), whether it is due, and whether it was cut off (a week overdue).
export const owed = (g, id) => { const b = bills(g)[id]; return g.day >= b.due ? Math.floor((g.day - b.due) / EVERY) + 1 : 0; };
export const isDue = (g, id) => owed(g, id) > 0;
export const isCut = (g, id) => g.day >= bills(g)[id].due + EVERY;
export const daysLeft = (g, id) => bills(g)[id].due - g.day;
export function payBill(g, w, id) {
    const n = owed(g, id);
    if (!n)
        return '';
    const amount = billAmount(g, w, id) * n;
    if (g.player.money < amount)
        return `Not enough money (${money(w, amount)}).`;
    const wasCut = isCut(g, id);
    g.player.money -= amount;
    book(g, `${BILLS.find(b => b.id === id).name}${n > 1 ? ` (${n} weeks)` : ''}`, -amount);
    bills(g)[id].due += EVERY * n;
    return wasCut ? (id === 'rent' ? 'Rent paid: you can go back into your home.' : `${id === 'water' ? 'Water' : 'Power'} is back on.`) : '';
}
// Moving in: the first week is paid with the deposit, so everything starts fresh.
export function resetBills(g) { g.bills = { rent: { due: g.day + EVERY }, water: { due: g.day + EVERY }, power: { due: g.day + EVERY } }; }
// Once a day (from the timed rules): the bill that became due, and the one that was cut off.
export function billNews(g, w) {
    const out = [];
    for (const def of BILLS) {
        const b = bills(g)[def.id];
        if (!billAmount(g, w, def.id) || (def.id === 'rent' && !w.rent)) {
            while (b.due <= g.day)
                b.due += EVERY;
            continue;
        } // nothing to pay: always paid up
        if (isCut(g, def.id) && b.cutTold !== b.due) {
            b.cutTold = b.due;
            out.push(def.id === 'rent' ? 'You did not pay the rent for a week: you are locked out of your home until you pay it (Homes app).'
                : def.id === 'water' ? 'Your water was cut off: no shower, tap or cooking at home until you pay the bill (Homes app).'
                    : 'Your power was cut off: no stove, TV, computer or machines at home until you pay the bill (Homes app).');
        }
        else if (isDue(g, def.id) && b.told !== b.due) {
            b.told = b.due;
            out.push(`${def.name} is due: ${money(w, billAmount(g, w, def.id))}. Pay it in the Homes app within a week.`);
        }
    }
    return out;
}
// What a cut-off service stops at home.
const NEEDS_WATER = ['shower', 'water', 'cook', 'x-coffee'];
const NEEDS_POWER = ['cook', 'x-coffee', 'x-freelance', 'x-treadmill', 'x-tv'];
export function cutReason(g, id) {
    if (isCut(g, 'rent'))
        return 'You are locked out until you pay the rent.';
    if (NEEDS_WATER.includes(id) && isCut(g, 'water'))
        return 'The water is cut off.';
    if (NEEDS_POWER.includes(id) && isCut(g, 'power'))
        return 'The power is cut off.';
    return '';
}
export const lockedOut = (g) => isCut(g, 'rent');
