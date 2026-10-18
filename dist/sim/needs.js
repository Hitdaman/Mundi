// Statuses (life, energy, hunger…) and the actions that change them. Everything comes from the world's data:
// which statuses exist, how fast they drop, what happens at zero and what each action costs and gives.
import { nowAbs, cfg } from '../core/store.js';
import { billNews, cutReason, priceOf } from './bills.js';
import { activeStatuses } from '../core/world.js';
import { placeOf, playerHomeId } from './places.js';
import { book } from './ledger.js';
import { extraActions, isBlocked, brokenThings } from './life.js';
const clamp = (v, max) => Math.max(0, Math.min(max, Math.round(v)));
export const statusDef = (w, id) => w.statuses.find(s => s.id === id);
export function money(w, v) {
    const tiers = w.currency.tiers;
    if (!tiers?.length)
        return `${w.currency.symbol}${Math.round(v).toLocaleString('en-US')}`;
    // coins of several metals: 2g 5s 3c
    let left = Math.round(Math.abs(v));
    const parts = [];
    for (const t of [...tiers].sort((a, b) => b.value - a.value)) {
        const n = Math.floor(left / t.value);
        left -= n * t.value;
        if (n)
            parts.push(`${n}${t.symbol}`);
    }
    return `${v < 0 ? '−' : ''}${parts.join(' ') || `0${tiers.at(-1).symbol}`}`;
}
export function addStatus(g, w, id, delta) {
    const d = statusDef(w, id);
    if (!d)
        return;
    g.player.stats[id] = clamp((g.player.stats[id] ?? d.start) + delta, d.max);
}
// How many whole periods of `every` minutes passed since the rule last ran (and moves its mark forward).
function periods(g, key, every) {
    const now = nowAbs(g);
    const last = g.tick[key] ?? now;
    if (g.tick[key] === undefined) {
        g.tick[key] = now;
        return 0;
    }
    const n = Math.floor((now - last) / every);
    if (n > 0)
        g.tick[key] = last + n * every;
    return n;
}
// Runs after every slice of time: decay, damage at zero, passing out, rent.
export function applyTimedRules(g, w) {
    const out = [];
    for (const s of activeStatuses(w)) {
        if (s.decay) {
            const n = periods(g, `decay:${s.id}`, s.decay.everyMinutes);
            if (n > 0 && !(s.decay.awakeOnly && g.asleep))
                addStatus(g, w, s.id, -s.decay.amount * n * (cfg(g).decay ?? 1));
        }
        const v = g.player.stats[s.id] ?? s.start;
        if (v > 0 || !s.zero) {
            delete g.tick[`zero:${s.id}`];
            continue;
        }
        if (s.zero.drain) {
            const n = periods(g, `drain:${s.id}`, s.zero.drain.everyMinutes);
            if (n > 0)
                addStatus(g, w, s.zero.drain.status, -s.zero.drain.amount * n);
        }
        if ((s.zero.place || s.zero.text) && g.tick[`zero:${s.id}`] === undefined) {
            g.tick[`zero:${s.id}`] = nowAbs(g);
            const cost = s.zero.cost ?? 0;
            if (cost)
                g.player.money = Math.max(0, g.player.money - cost);
            if (s.zero.place)
                g.player.loc = s.zero.place === 'home' ? playerHomeId : s.zero.place;
            if (s.zero.restore)
                addStatus(g, w, s.id, s.zero.restore);
            if (s.zero.text)
                out.push(s.zero.text.replace('{cost}', money(w, cost)));
        }
    }
    // the bills of your home (rent, water, power): due each week, paid in the Homes app, cut off after a week
    out.push(...billNews(g, w));
    return out;
}
// Actions available where the player is (a café sells coffee; at home you can cook).
export function actionsHere(g, w) {
    const atHome = g.player.loc === playerHomeId;
    const tags = placeOf(g, w, g.player.loc)?.tags ?? [];
    const on = new Set(activeStatuses(w).map(s => s.id));
    // an action only about needs that are not in play (seeing a doctor in Life-Sim) is left out
    const useful = (a) => { const ids = Object.keys(a.effects ?? {}); return !ids.length || ids.some(id => on.has(id)); };
    const broken = brokenThings(g).length > 0;
    const base = w.actions.filter(useful).filter(a => !isBlocked(g, a)).filter(a => a.id !== 'fix' || broken).filter(a => (a.home && atHome)
        || (a.place && a.place === g.player.loc)
        || (!a.home && !a.place && (a.anywhere || (a.tags ?? []).some(t => tags.includes(t)))));
    // prices after the difficulty; at home, what a cut-off service stops is left out
    return [...base, ...extraActions(g, w)].filter(a => !atHome || !cutReason(g, a.id)).map(a => (a.cost ? { ...a, cost: priceOf(g, a.cost) } : a));
}
// Water, power… of a kind of home, paid with the rent.
export const billsOf = (w, kind) => Object.values(w.homes.kinds[kind]?.bills ?? {}).reduce((a, b) => a + b, 0);
export function canAfford(g, a) { return g.player.money >= a.cost; }
export function applyAction(g, w, a) {
    g.player.money -= a.cost;
    if (a.cost)
        book(g, a.name, -a.cost);
    for (const [id, v] of Object.entries(a.effects))
        addStatus(g, w, id, v);
}
// A short line for the AI about how the player feels (only what stands out).
export function feelings(g, w) {
    const low = activeStatuses(w).filter(s => (g.player.stats[s.id] ?? s.start) <= 25).map(s => `${s.name.toLowerCase()} is low (${g.player.stats[s.id]}/${s.max})`);
    return low.length ? `How {{user}} feels: ${low.join(', ')}.` : '';
}
// Is there enough energy for this? `drain` is how much each need goes down (positive numbers). Returns the reason
// it cannot be done, or '' when it can. Only energy stops you; the other needs simply drop.
export function tooTired(g, w, drain, what) {
    const s = activeStatuses(w).find(x => x.id === 'energy');
    const need = s ? drain[s.id] ?? 0 : 0;
    if (!s || need <= 0)
        return '';
    const have = Math.round(g.player.stats[s.id] ?? s.start);
    return have < need ? `Not enough ${s.name.toLowerCase()} to ${what} (it takes ${Math.round(need)}, you have ${have}). Sleep or rest first.` : '';
}
