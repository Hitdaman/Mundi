// Jobs: getting hired, working shifts at the job's place, pay per hour, promotions after enough shifts.
// Moving home and the bank's ledger live here too (the money side of the world).
import { bump } from './social.js';
import { missingCourses, triedToday, interview, countUp } from './skills.js';
import { payOf, priceOf, resetBills } from './bills.js';
import { note } from './facts.js';
import { advance, hour } from './time.js';
import { addStatus, money } from './needs.js';
import { book } from './ledger.js';
export { ledger, book } from './ledger.js';
export const jobDef = (w, id) => w.occupations.find(o => o.id === id) ?? null;
export const traitsOf = (g) => Object.values(g.player.traits ?? {}).flat();
export const fits = (g, o) => !o.needs?.length || o.needs.some(t => traitsOf(g).includes(t));
export const likes = (g, o) => (o.likes ?? []).filter(t => traitsOf(g).includes(t));
export const isOpen = (g, o) => { const [a, b] = o.hours ?? [0, 24]; const h = hour(g); return a <= b ? h >= a && h < b : h >= a || h < b; };
// Shifts still needed for the next rank (liked traits make it shorter).
export function shiftsToPromote(g, o, rank) {
    const need = o.promote?.[rank];
    if (need === undefined || rank >= o.ranks.length - 1)
        return null;
    return Math.max(2, need - likes(g, o).length);
}
/* ---------- jobs ---------- */
// Applying is a job interview: a d20 where the traits the job looks for are your bonus. Some jobs need a course first.
export function hire(g, w, id) {
    const o = jobDef(w, id);
    if (!o)
        return { ok: false, text: '' };
    const miss = missingCourses(g, w, o);
    if (miss.length)
        return { ok: false, text: `You need the course "${miss.join('", "')}" first (at home or at the University).` };
    if (triedToday(g, id))
        return { ok: false, text: 'You already had an interview there today. Try again tomorrow.' };
    const r = interview(g, o, traitsOf(g));
    if (!r.ok) {
        note(g, '{u} had a job interview for {0}, but did not get it.', [o.name], [], o.place, 'work');
        return { ok: false, text: r.text };
    }
    g.player.job = { id, rank: 0, shifts: r.crit ? Math.floor((o.promote?.[0] ?? 4) / 2) : 0 };
    note(g, '{u} got hired: {0} at {1}.', [o.ranks[0].name, o.name], [], o.place, 'work');
    return { ok: true, text: `You got the job! ${r.text}` };
}
export function quitJob(g, w) { const o = w && jobDef(w, g.player.job?.id); if (o)
    note(g, '{u} quit the job ({0}).', [o.name], [], g.player.loc, 'work'); g.player.job = null; }
export const WORK_MODES = [
    { id: 'normal', name: 'Do the job', desc: 'A normal shift.', icon: '💼' },
    { id: 'hard', name: 'Work hard', desc: 'Faster promotion and a chance of a bonus. More tiring, a bit stressful.', icon: '🔥' },
    { id: 'social', name: 'Chat with coworkers', desc: 'Better mood, closer to the people who work there. Slower promotion.', icon: '💬' },
    { id: 'easy', name: 'Take it easy', desc: 'Less tiring. Promotion barely moves, and the boss may notice.', icon: '😌' },
];
// `hours`: a shorter shift (leaving early for a date): pay, tiredness and progress are for the hours worked.
export function workShift(g, w, mode = 'normal', hours) {
    const j = g.player.job;
    const o = jobDef(w, j?.id);
    if (!j || !o)
        return [];
    const h = Math.max(1, Math.min(o.shift, Math.round(hours ?? o.shift)));
    const part = h / o.shift;
    const out = advance(g, w, h * 60);
    const k = mode === 'hard' ? 1.35 : mode === 'easy' ? 0.6 : 1;
    for (const [id, v] of Object.entries(o.cost ?? {}))
        addStatus(g, w, id, -v * part * (id === 'energy' ? k : 1));
    if (mode === 'hard')
        addStatus(g, w, 'mood', -5 * part);
    if (mode === 'social')
        addStatus(g, w, 'mood', 8 * part);
    let pay = payOf(g, o.ranks[j.rank].pay * h);
    countUp(g, 'shifts', h / o.shift);
    const bonus = mode === 'hard' && Math.random() < 0.3 ? Math.round(pay * 0.25) : 0;
    pay += bonus;
    g.player.money += pay;
    book(g, `${o.ranks[j.rank].name}: ${h} h${bonus ? ' (+ bonus)' : ''}`, pay);
    // progress to the next rank, like experience: a part of a shift counts for its part
    j.shifts = Math.round((j.shifts + part * (mode === 'hard' ? 1.5 : mode === 'social' ? 0.75 : mode === 'easy' ? 0.4 : 1)) * 100) / 100;
    out.push(`You worked ${h} hour${h === 1 ? '' : 's'} and earned ${money(w, pay)}${bonus ? ` (a bonus of ${money(w, bonus)} for the hard work)` : ''}.`);
    if (mode === 'social') {
        const mates = Object.values(g.cast).filter(r => r.occupation && jobDef(w, r.occupation)?.place === o.place);
        for (const r of mates)
            bump(g, r.avatar, 3);
        if (mates.length)
            out.push(`You got closer to ${mates.map(r => r.name).join(', ')}.`);
    }
    if (mode === 'easy' && Math.random() < 0.25)
        out.push('Your boss noticed you were slacking.');
    const need = shiftsToPromote(g, o, j.rank);
    if (need !== null && j.shifts >= need) {
        j.rank++;
        j.shifts = Math.round((j.shifts - need) * 100) / 100; // what was left over counts toward the next rank
        out.push(`Promotion! You are now ${o.ranks[j.rank].name}.`);
        note(g, '{u} got promoted to {0}.', [o.ranks[j.rank].name], [], o.place, 'work');
    }
    return out;
}
/* ---------- moving ---------- */
export function freeSpots(g, w, zoneId) {
    const zone = w.homes.zones.find(z => z.id === zoneId);
    if (!zone)
        return [];
    const taken = new Set([g.player.home, ...Object.values(g.cast).map(r => r.home)].map(h => `${h.x},${h.y}`));
    return zone.spots.filter(s => !taken.has(`${s[0]},${s[1]}`));
}
// Moving costs one week of the new rent; rent then counts from today.
export function moveTo(g, w, zoneId) {
    const zone = w.homes.zones.find(z => z.id === zoneId);
    const spot = freeSpots(g, w, zoneId)[0];
    if (!zone || !spot)
        return 'There is no free home there.';
    const deposit = priceOf(g, zone.rent);
    if (g.player.money < deposit)
        return 'Not enough money.';
    g.player.money -= deposit;
    book(g, `${zone.name}: deposit`, -deposit);
    g.player.home = { zone: zone.id, kind: zone.kind, x: spot[0], y: spot[1], n: zone.spots.findIndex(s => s[0] === spot[0] && s[1] === spot[1]) + 1 };
    g.player.rentPaidDay = g.day;
    resetBills(g);
    note(g, '{u} moved to a new home: {0}.', [zone.name], [], g.player.loc, 'home');
    return '';
}
