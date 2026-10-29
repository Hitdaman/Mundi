import { rpgOf } from '../core/rpgdef.js';
import { charOf, personaName } from '../st/bridge.js';
import { sheetOf, makeSheet, hpMax, focusMax, isCaster, xpFor, maxLevel, syncLife } from './rpg.js';
import { mortalOf, forget } from './mortal.js';
import { partyOf, friends, classFor, leave } from './party.js';
import { switchTo, markGone, playing, swapOf } from './playas.js';
import { bondOf } from './social.js';
import { ties } from './living.js';
import { ailOf } from './afflictions.js';
import { note } from './facts.js';
const isKid = (g, a) => (g.family?.kids ?? []).some((k) => k.avatar === a);
/** Who can carry on: your companions first, then the people you knew best (not children). */
export function heirsOf(g) {
    const dead = playing(g);
    const orig = swapOf(g)?.origCard;
    const out = [];
    for (const m of friends(g))
        if (m.avatar !== dead)
            out.push({ avatar: m.avatar, name: g.cast[m.avatar].name, why: 'Your companion' });
    const known = Object.values(g.cast)
        .filter(r => r.met && r.avatar !== dead && r.avatar !== orig && !out.some(h => h.avatar === r.avatar) && !isKid(g, r.avatar) && charOf(r.avatar))
        .sort((a, b) => bondOf(g, b.avatar) - bondOf(g, a.avatar)).slice(0, 8);
    for (const r of known)
        out.push({ avatar: r.avatar, name: r.name, why: bondOf(g, r.avatar) >= 50 ? 'Close to you' : 'Someone you knew' });
    return out;
}
// A sheet raised to a level (what each level would have given: attribute points, spells, skills to learn).
function grow(w, s, level) {
    const to = Math.min(level, maxLevel(w));
    if (to <= 1)
        return;
    const r = rpgOf(w);
    for (let l = 2; l <= to; l++) {
        s.points += r?.levelPoints ? r.levelPoints : l % 4 === 0 ? 2 : 0;
        if (isCaster(w, s))
            s.learn += 1;
        if (l % 2 === 1)
            s.skillPicks = (s.skillPicks ?? 0) + 1;
    }
    s.level = to;
    s.xp = xpFor(w, to - 1);
    s.hp = hpMax(w, s);
    s.focus = focusMax(w, s);
}
/** Carry on as `avatar` after you died. Returns their name. */
export async function carryOn(g, w, avatar) {
    const mo = mortalOf(g);
    const old = sheetOf(g);
    if (!mo.dead || !old)
        return '';
    if (!g.cast[avatar] || !charOf(avatar))
        throw new Error('That character is not in SillyTavern anymore.');
    const dead = playing(g);
    const deadName = personaName();
    const member = partyOf(g).members.find(m => m.avatar === avatar);
    const cls = member?.cls ?? classFor(w, avatar)?.id ?? rpgOf(w).classes[0].id;
    markGone(g, dead);
    if (member)
        leave(g, avatar);
    const name = await switchTo(g, w, avatar);
    if (dead)
        forget(g, dead); // you were playing someone of the world: they are gone from it now
    const list = ties(g);
    for (let i = list.length - 1; i >= 0; i--)
        if (!list[i].a || !list[i].b || list[i].a === dead || list[i].b === dead)
            list.splice(i, 1);
    // your grave becomes theirs (the one who carries on did not die)
    const grave = [...mo.graves].reverse().find(x => x.you);
    if (grave) {
        grave.name = deadName;
        delete grave.you;
        if (dead)
            grave.avatar = dead;
    }
    const s = makeSheet(w, { cls });
    grow(w, s, member ? old.level : 1);
    g.rpg = s;
    delete mo.dead;
    delete mo.form;
    delete mo.harm;
    const ail = ailOf(g);
    ail.debuffs = [];
    ail.injuries = [];
    ail.stress = 0;
    for (const id of ['hunger', 'thirst', 'energy']) {
        const st = w.statuses.find(x => x.id === id);
        if (st)
            g.player.stats[id] = Math.max(g.player.stats[id] ?? 0, Math.round(st.max * 0.7));
    }
    syncLife(g, w);
    note(g, '{u} carries on after {0} died.', [deadName], [], g.player.loc, 'event');
    return name;
}
