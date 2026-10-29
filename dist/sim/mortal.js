// Death is real (RPG mode). Hit points are life: the lower they go, the worse everyone does (sim/wounds.ts), under a
// tenth of them you are unconscious, and at 0 you are dead. Nobody wakes up at the hospital by magic:
//   - Unconscious from wounds, you bleed out (about 12% of your hit points an hour); starving or parched, the drain
//     goes on. Whoever is with you tries first aid (Medicine), or uses a potion or first aid kit from your bag. People
//     around (not in the wild, fewer at night) may find you: in a modern world they call an ambulance, in an older one
//     they carry you to a healer, and either has to get there in time. No healer and nobody who can stop the bleeding:
//     you die.
//   - Dead is dead, unless something real brings you back in that minute: a god's ward, a phoenix feather, someone
//     with a defibrillator or Revivify, or CPR (a modern world) from someone at your side or a passer-by.
//   - Lose a fight to beasts or monsters and they finish you; robbers take your coins and leave you to bleed.
//   - Companions and sellswords live by the same rules. One who dies is gone from the world (a grave in the journal).
//   - Where the world has magic or the dead walk, the dead sometimes do not rest: a ghost, or undead (killed by the
//     undead, or in a crypt). It is not a choice: the death screen offers it only when it happens. The risen do not
//     eat or drink, healers will not take them, and nothing brings them back a second time.
// When you die, the save is kept as it was a moment before (Settings → Game → This save), and the game shows how it
// ended. The world stands still for the dead.
import { nowAbs } from '../core/store.js';
import { placeIs, styleOf } from '../core/world.js';
import { rpgOf } from '../core/rpgdef.js';
import { backup } from '../core/saves.js';
import { sheetOf, hpMax, mortalOn, syncLife, skillBonus, skillOf, mod, attr, prof, tooHurt } from './rpg.js';
import { bandOf, BAND_WORD, BAND_PENALTY, awakeHp, isDown } from './wounds.js';
import { checkMods, onHurt, onDay } from './hooks.js';
import { presentAt } from './people.js';
import { placeOf, playerHomeId } from './places.js';
import { openNow } from './daynight.js';
import { advance } from './time.js';
import { note } from './facts.js';
import { book } from './ledger.js';
import { faithOf, patronOf } from './realm.js';
import { bagOf, addGood, goodDef } from './economy.js';
import { priceOf } from './bills.js';
import { partyOf, friends, memberKey, memberName, dismissMerc, leave, inParty } from './party.js';
import { normalizeHomes } from './homes.js';
export const mortalOf = (g) => (g.mortal ??= { graves: [] });
export const deathOf = (g) => (g?.mortal?.dead ?? null);
export const gravesOf = (g) => mortalOf(g).graves;
export const formOf = (g) => (g?.mortal?.form ?? null);
export const FORM_WORD = { ghost: 'a ghost', undead: 'undead' };
/** What happened to you while you were out (shown once, then cleared). */
export const toldOf = (g) => mortalOf(g).told?.[0] ?? null;
export function dismissTold(g) { const m = mortalOf(g); m.told = (m.told ?? []).slice(1); if (!m.told.length)
    delete m.told; }
const tell = (g, title, lines) => { if (lines.length)
    (mortalOf(g).told ??= []).push({ at: nowAbs(g), title, text: lines.join(' ') }); };
/** The dice (tests can swap them). */
export const DICE = { rnd: Math.random };
const rnd = () => DICE.rnd();
const d20 = () => 1 + Math.floor(rnd() * 20);
const between = (a, b) => Math.round(a + rnd() * (b - a));
/* ---------- how hurt you are ---------- */
export function bandNow(g, w) {
    const s = sheetOf(g);
    if (!s || !mortalOn(g, w))
        return null;
    return bandOf(s.hp, hpMax(w, s));
}
// Every check you roll: the worse you are hurt, the worse it goes.
checkMods.push((g, w) => { const b = bandNow(g, w); return b ? -BAND_PENALTY[b] : 0; });
export { tooHurt };
/* ---------- the world around you ---------- */
// A modern world calls an ambulance; an older one carries you to a healer.
export const modernish = (w) => styleOf(w) !== 'medieval' && !/medieval|ancient|wuxia|xianxia|cultivat|feudal/i.test(`${w.style ?? ''} ${w.kind ?? ''}`);
function healers(g, w) {
    const map = placeOf(g, w, g.player.loc)?.map;
    return w.places.filter(p => !p.link && !p.hidden && placeIs(p, 'healer')).sort((a, b) => Number(b.map === map) - Number(a.map === map));
}
const careWord = (w) => (modernish(w) ? 'the hospital' : 'the healer');
// What a stay costs: the world's own price for waking up there (its "life at zero" rule), or a usual one.
function careCost(g, w) {
    const z = w.statuses.find(s => /^(life|health)$/.test(s.id))?.zero?.cost;
    return priceOf(g, z ?? (modernish(w) ? 300 : 60));
}
// How likely someone comes across you: whoever is here, an open public place by day; a home or the night far less.
function crowd(g, w, where, remote) {
    if (remote)
        return 0.03;
    if (presentAt(g, w, where).length)
        return 0.95;
    const p = placeOf(g, w, where);
    const h = Math.floor(g.minutes / 60);
    const day = h >= 7 && h < 22;
    if (!p)
        return 0.1;
    if (p.home || where === playerHomeId)
        return 0.05;
    return openNow(g, w, where) ? (day ? 0.75 : 0.35) : (day ? 0.3 : 0.1);
}
const awake = (m, max) => m.hp === undefined || !isDown(m.hp, max ?? m.max ?? m.hp + 1);
// Who is with you and on their feet: companions and sellswords (a healer's training helps), and you if you are awake.
function helpersOf(g, w, skip, youAwake, fighters) {
    const s = sheetOf(g);
    const r = rpgOf(w);
    const out = [];
    if (youAwake && !skip.has('you')) {
        const bonus = skillOf(w, 'medicine') ? skillBonus(w, s, 'medicine') : mod(attr(s, 'wis'));
        out.push({ key: 'you', name: 'you', bonus, caster: false, you: true });
    }
    for (const m of partyOf(g).members) {
        const key = memberKey(m);
        if (skip.has(key))
            continue;
        if (m.avatar && !g.cast[m.avatar])
            continue;
        const f = fighters?.find(x => x.ref === key && x.side === 'us');
        if (f ? f.down : !awake(m))
            continue;
        const c = r?.classes.find(x => x.id === m.cls);
        const lvl = m.merc ? m.merc.level : s.level;
        const medic = !!c?.skills.includes('medicine') || c?.ability?.kind === 'heal';
        out.push({ key, name: memberName(g, m), bonus: medic ? prof(lvl) + 2 : m.merc ? 0 : 1, caster: !!c?.schools?.includes('restoration') && lvl >= 5 });
    }
    return out;
}
const best = (hs) => [...hs].sort((a, b) => b.bonus - a.bonus)[0];
const healItem = (g, w) => Object.keys(bagOf(g).items).find(id => (bagOf(g).items[id] ?? 0) > 0 && goodDef(w, id)?.kind === 'potion');
// How long until someone out cold dies: wounds bleed about 12% of the hit points an hour; hunger eats 2%, thirst 6%.
export function minutesLeft(hp, max, cause) {
    const perHour = cause === 'wounds' ? 0.12 : cause === 'thirst' ? 0.06 : 0.02;
    return Math.max(5, Math.round((hp / (max * perHour)) * 60));
}
const someone = (p) => (p.you ? 'you' : p.name);
function getThrough(g, w, p, sc) {
    const lines = [];
    const limit = minutesLeft(p.hp, p.max, sc.cause);
    const risen = p.you && !!formOf(g); // healers will not take the risen, and strangers run
    const heal = risen ? undefined : healers(g, w)[0];
    if (risen)
        sc = { ...sc, strangers: false };
    let t = 0;
    let stable = false;
    // the people with you
    const hs = sc.helpers.filter(h => h.key !== p.key);
    if (hs.length) {
        if (sc.cause !== 'wounds') {
            stable = true;
            t = 15;
            lines.push(`${best(hs).name === 'you' ? 'You get' : `${best(hs).name} gets`} food and water into ${p.you ? 'you' : p.name}.`);
        }
        else {
            const item = healItem(g, w);
            if (item) {
                addGood(g, item, -1);
                stable = true;
                t = 5;
                lines.push(`${best(hs).name === 'you' ? 'You use' : `${best(hs).name} uses`} ${goodDef(w, item).name.toLowerCase()} on ${p.you ? 'you' : p.name}.`);
            }
            else
                for (let i = 1; i <= 3 && !stable; i++) {
                    t = i * 5;
                    const h = best(hs);
                    const roll = d20() + h.bonus;
                    if (roll >= 12 && t <= limit) {
                        stable = true;
                        lines.push(`${h.you ? 'You stop' : `${h.name} stops`} the bleeding (Medicine ${roll}).`);
                    }
                    else if (i === 3)
                        lines.push(`${h.you ? 'You try' : `${h.name} tries`} to stop the bleeding, but it will not stop (Medicine ${roll}).`);
                }
        }
        if (stable && heal) {
            t += 40;
            lines.push(`${p.you ? 'You are' : `${p.name} is`} carried to ${heal.name}.`);
            return { saved: true, lines, minutes: t, treated: true, to: heal.id };
        }
        if (stable)
            return { saved: true, lines, minutes: t, treated: false };
    }
    // strangers
    if (sc.strangers && rnd() < crowd(g, w, sc.where, sc.remote)) {
        const found = Math.max(t, presentAt(g, w, sc.where).length ? 2 : between(5, 25));
        if (found > limit) {
            lines.push(`Someone finds ${someone(p)}, but too late.`);
            return { saved: false, lines, minutes: limit, treated: false };
        }
        if (sc.cause !== 'wounds' && !heal) {
            lines.push(`A stranger finds ${someone(p)} and gets food and water into ${p.you ? 'you' : 'them'}.`);
            return { saved: true, lines, minutes: found + 20, treated: false };
        }
        const aid = d20();
        const aided = sc.cause !== 'wounds' || aid >= 13;
        if (heal && modernish(w)) {
            const arrive = found + between(8, 20);
            lines.push(`A passer-by finds ${someone(p)} and calls an ambulance${aided && sc.cause === 'wounds' ? ', pressing on the wound until it comes' : ''}.`);
            if (aided || arrive <= limit) {
                lines.push(`The paramedics get ${p.you ? 'you' : p.name} to ${heal.name} in time.`);
                return { saved: true, lines, minutes: arrive + 20, treated: true, to: heal.id };
            }
            lines.push('The ambulance comes too late.');
            return { saved: false, lines, minutes: limit, treated: false };
        }
        if (heal) {
            const there = found + between(20, 45);
            lines.push(`A passer-by finds ${someone(p)} and carries ${p.you ? 'you' : 'them'} to ${heal.name}.`);
            if (aided || there <= limit)
                return { saved: true, lines, minutes: there, treated: true, to: heal.id };
            lines.push('It is too far: the bleeding wins on the way.');
            return { saved: false, lines, minutes: limit, treated: false };
        }
        if (aided) {
            lines.push(`A stranger finds ${someone(p)} and manages to stop the bleeding.`);
            return { saved: true, lines, minutes: found + 10, treated: false };
        }
        lines.push(`A stranger finds ${someone(p)} but cannot stop the bleeding, and there is no ${modernish(w) ? 'hospital' : 'healer'} to take ${p.you ? 'you' : 'them'} to.`);
        return { saved: false, lines, minutes: limit, treated: false };
    }
    if (!lines.length)
        lines.push(sc.remote ? 'Nobody comes out here.' : 'Nobody comes.');
    return { saved: false, lines, minutes: limit, treated: false };
}
// Only something real brings the dead back, in the minute after: a god's ward, a phoenix feather, a defibrillator or
// Revivify in someone's hands, CPR (a modern world). `slain`: finished off on purpose (no CPR helps then).
function revive(g, w, p, sc, slain) {
    const s = sheetOf(g);
    const m = mortalOf(g);
    const hs = sc.helpers.filter(h => h.key !== p.key);
    if (p.you && formOf(g))
        return { ok: false, lines: [], hp: 0 }; // the risen have no second time
    if (p.you && faithOf(g).ward) {
        faithOf(g).ward = false;
        const god = patronOf(g, w)?.name ?? 'Your god';
        return { ok: true, lines: [`${god}'s ward turns death aside: you wake with a gasp.`], hp: awakeHp(p.max) };
    }
    const own = (kind) => Object.keys(bagOf(g).items).find(id => (bagOf(g).items[id] ?? 0) > 0 && goodDef(w, id)?.revive === kind);
    if (p.you) {
        const f = own('self');
        if (f) {
            addGood(g, f, -1);
            return { ok: true, lines: [`The ${goodDef(w, f).name.toLowerCase()} you carry burns away, and you breathe again.`], hp: Math.ceil(p.max * 0.25) };
        }
    }
    // Revivify: you (for a companion), or a companion trained in restoration (once a day each)
    const spell = rpgOf(w)?.spells.find(x => x.effect.kind === 'revive');
    if (spell && !p.you && hs.some(h => h.you) && s.prepared.includes(spell.id) && s.focus >= spell.cost) {
        s.focus -= spell.cost;
        return { ok: true, lines: [`You cast ${spell.name} over ${p.name}, and ${p.name} breathes again.`], hp: awakeHp(p.max) };
    }
    const caster = hs.find(h => h.caster && (m.revived?.[h.key] ?? 0) !== g.day);
    if (caster) {
        (m.revived ??= {})[caster.key] = g.day;
        return { ok: true, lines: [`${caster.name} calls ${p.you ? 'you' : p.name} back from death${spell ? ` with ${spell.name}` : ''}.`], hp: awakeHp(p.max) };
    }
    const aed = own('helper');
    if (aed && hs.length) {
        const h = best(hs);
        const roll = d20() + h.bonus;
        if (roll >= 10) {
            addGood(g, aed, -1);
            return { ok: true, lines: [`${h.you ? 'You use' : `${h.name} uses`} the ${goodDef(w, aed).name.toLowerCase()}: a jolt, and a heartbeat (Medicine ${roll}).`], hp: 1 };
        }
    }
    if (modernish(w) && !slain) {
        if (hs.length) {
            const h = best(hs);
            const roll = d20() + h.bonus;
            if (roll >= 15)
                return { ok: true, lines: [`${h.you ? 'You start' : `${h.name} starts`} CPR and ${p.you ? 'your' : `${p.name}'s`} heart starts again (Medicine ${roll}).`], hp: 1 };
            return { ok: false, lines: [`${h.you ? 'You try' : `${h.name} tries`} CPR, but ${p.you ? 'your' : 'their'} heart does not start again (Medicine ${roll}).`], hp: 0 };
        }
        if (sc.strangers && rnd() < crowd(g, w, sc.where, sc.remote) * 0.5 && rnd() < 0.25)
            return { ok: true, lines: [`A stranger kneels and starts CPR; ${p.you ? 'your' : `${p.name}'s`} heart starts again.`], hp: 1 };
    }
    return { ok: false, lines: [], hp: 0 };
}
/* ---------- the end ---------- */
const CAUSE = { wounds: 'bled to death', hunger: 'starved to death', thirst: 'died of thirst' };
// A world where the dead might not rest: magic, or the walking dead, or a world that says so.
export function supernatural(w) {
    const r = rpgOf(w);
    const tags = (w.tags ?? []);
    if ((r?.bestiary ?? []).some(b => (b.tags ?? []).includes('undead')))
        return true;
    if (tags.includes('realistic'))
        return false; // (a modern world's "spells" are skills and gadgets)
    if ((r?.spells?.length ?? 0) > 0)
        return true;
    return /magic|fantasy|supernatural|horror|myth|occult|ghost|undead|cultivat|xianxia|wuxia/i.test(`${w.style ?? ''} ${w.kind ?? ''} ${(w.tags ?? []).join(' ')}`);
}
const CRYPT = /crypt|tomb|grave|cemeter|barrow|catacomb|haunt|necro|ossuar|mausole/i;
/** Whether the dead rise, and as what: rare, likelier when the undead killed you or you died among the dead. */
export function riseOf(g, w, where, byUndead) {
    if (formOf(g) || !supernatural(w))
        return null;
    const place = placeOf(g, w, where)?.name ?? '';
    const s = sheetOf(g);
    const undying = (s?.talents ?? []).some(id => /undying|deathless|revenant|lich|undead/i.test(`${id} ${rpgOf(w)?.talents?.find(t => t.id === id)?.name ?? ''}`));
    let chance = 0.08 + (byUndead ? 0.3 : 0) + (CRYPT.test(place) ? 0.2 : 0);
    if (undying)
        chance = 1;
    if (rnd() >= chance)
        return null;
    return byUndead || CRYPT.test(place) ? 'undead' : 'ghost';
}
function youDie(g, w, pre, cause, where, lines, byUndead = false) {
    const s = sheetOf(g);
    const m = mortalOf(g);
    if (pre) {
        try {
            backup(pre, 'right before you died');
        }
        catch { /* no chat to keep it in (tests) */ }
    }
    s.hp = 0;
    syncLife(g, w);
    const place = placeOf(g, w, where)?.name ?? 'somewhere';
    const was = formOf(g);
    const rise = riseOf(g, w, where, byUndead); // (never for the risen)
    if (was) {
        cause = was === 'ghost' ? 'faded away for good' : 'were destroyed for good';
        delete m.form;
    }
    const text = [...lines, `You ${cause} at ${place}.`].join(' ');
    m.dead = { day: g.day, minutes: g.minutes, where, cause, text };
    if (rise)
        m.dead.rise = rise;
    if (!was)
        m.graves.push({ name: 'You', day: g.day, minutes: g.minutes, where, cause, you: true });
    note(g, '{u} {0} at {1}.', [cause, place], [], where, 'event');
    return [`☠️ You ${cause}.`];
}
/** Rise from death as what the death screen offers (a ghost, or undead): half your hit points, and no second time. */
export function rise(g, w) {
    const m = mortalOf(g);
    const d = m.dead;
    const s = sheetOf(g);
    if (!d?.rise || !s)
        return '';
    const form = d.rise;
    m.form = form;
    delete m.dead;
    s.hp = Math.ceil(hpMax(w, s) * 0.5);
    delete s.carry;
    syncLife(g, w);
    for (const id of ['hunger', 'thirst']) {
        const st = w.statuses.find(x => x.id === id);
        if (st)
            g.player.stats[id] = st.max;
    }
    note(g, '{u} rose again as {0}.', [FORM_WORD[form]], [], d.where, 'event');
    return form === 'ghost' ? 'You open eyes you no longer have. You are still here, a ghost.' : 'Your heart does not beat, but you get up. You are undead.';
}
/** A companion or sellsword dies: gone from the party and from the world, remembered in the journal. */
export function companionDies(g, w, key, cause, where = g.player.loc) {
    const m = partyOf(g).members.find(x => memberKey(x) === key);
    if (!m)
        return '';
    const name = memberName(g, m);
    const place = placeOf(g, w, where)?.name ?? 'somewhere';
    mortalOf(g).graves.push({ ...(m.avatar ? { avatar: m.avatar } : {}), name: m.merc ? m.merc.name : name, day: g.day, minutes: g.minutes, where, cause });
    if (m.merc) {
        dismissMerc(g, key);
        note(g, '{0} {1} at {u}\'s side, at {2}.', [m.merc.name, cause, place], [], where, 'event');
        return `💀 ${m.merc.name} ${cause}.`;
    }
    const a = m.avatar;
    leave(g, a);
    note(g, '{0} {1} at {2}.', [name, cause, place], [a], where, 'event');
    forget(g, a);
    return `💀 ${name} ${cause}.`;
}
/** Someone of the world dies (in the story): a companion as above; anyone else gets a grave and is gone too. */
export function residentDies(g, w, avatar, cause, where = g.player.loc) {
    if (inParty(g, avatar))
        return companionDies(g, w, avatar, cause, where);
    const r = g.cast[avatar];
    if (!r)
        return '';
    const place = placeOf(g, w, where)?.name ?? 'somewhere';
    mortalOf(g).graves.push({ avatar, name: r.name, day: g.day, minutes: g.minutes, where, cause });
    note(g, '{0} {1} at {2}.', [r.name, cause, place], [avatar], where, 'event');
    forget(g, avatar);
    return `💀 ${r.name} ${cause}.`;
}
// Gone from the world: plans with them called off, nobody lives with them, their card out of the cast.
export function forget(g, a) {
    const soc = g.social;
    if (soc) {
        for (const x of soc.appts ?? [])
            if (x.avatar === a && (x.state === 'set' || x.state === 'met'))
                x.state = 'cancelled';
        if (soc.solo === a)
            soc.solo = '';
        soc.partner = (soc.partner ?? []).filter((x) => x !== a);
        soc.with = (soc.with ?? []).filter((x) => x.avatar !== a);
    }
    for (const x of Object.values(g.cast))
        if (x.homeWith === a)
            delete x.homeWith;
    delete g.cast[a];
    normalizeHomes(g);
}
/* ---------- a companion hurt outside a fight (in the story) ---------- */
/** Down under a tenth of their hit points, dead at 0, unless you or the others get them through. */
export function memberHurt(g, w, key, dmg, max) {
    const m = partyOf(g).members.find(x => memberKey(x) === key);
    if (!m)
        return [];
    const hp = Math.max(0, Math.min(max, (m.hp ?? max) - dmg));
    if (!isDown(hp, max)) {
        m.hp = hp;
        m.max = max;
        if (hp >= max) {
            delete m.hp;
            delete m.max;
        }
        return [];
    }
    const s = sheetOf(g);
    const name = memberName(g, m);
    const lines = [];
    const youUp = !isDown(s.hp, hpMax(w, s));
    const sc = { cause: 'wounds', where: g.player.loc, remote: false, helpers: helpersOf(g, w, new Set([key]), youUp), strangers: true };
    const p = { key, name, hp, max, you: false };
    if (hp <= 0) {
        const r = revive(g, w, p, sc, false);
        lines.push(...r.lines);
        if (!r.ok) {
            lines.push(companionDies(g, w, key, dmg >= max ? 'was killed' : 'died of their wounds'));
            return lines;
        }
        p.hp = r.hp;
    }
    if (isDown(p.hp, max)) {
        const o = getThrough(g, w, p, sc);
        lines.push(...o.lines);
        if (!o.saved) {
            lines.push(companionDies(g, w, key, 'died of their wounds'));
            return lines;
        }
        p.hp = Math.max(p.hp, o.treated ? Math.ceil(max * 0.4) : awakeHp(max));
    }
    m.hp = p.hp;
    m.max = max;
    return lines;
}
/* ---------- falling outside a fight (starving, poison, a blast in the face…) ---------- */
let busy = false;
onHurt.push((g, w) => {
    if (busy || !mortalOn(g, w) || deathOf(g))
        return;
    if (g.combat && !g.combat.over)
        return; // in a fight, the end of the fight decides
    const s = sheetOf(g);
    const max = hpMax(w, s);
    if (!isDown(s.hp, max))
        return;
    busy = true;
    try {
        collapse(g, w, g._hurtBy ?? 'wounds');
    }
    finally {
        busy = false;
    }
});
function collapse(g, w, cause) {
    const s = sheetOf(g);
    const max = hpMax(w, s);
    const where = g.player.loc;
    const pre = structuredClone(g);
    const sc = { cause, where, remote: false, helpers: helpersOf(g, w, new Set(['you']), false), strangers: true };
    const p = { key: 'you', name: 'You', hp: s.hp, max, you: true };
    const lines = [cause === 'wounds' ? 'You collapse.' : `You collapse from ${cause === 'thirst' ? 'thirst' : 'hunger'}.`];
    if (s.hp <= 0) {
        const r = revive(g, w, p, sc, false);
        lines.push(...r.lines);
        if (!r.ok) {
            youDie(g, w, pre, CAUSE[cause], where, lines);
            return;
        }
        p.hp = r.hp;
    }
    if (isDown(p.hp, max)) {
        if (!care(g, w, p, sc, pre, lines))
            return;
    }
    else {
        s.hp = p.hp;
        syncLife(g, w);
    }
    tell(g, 'You came to', lines);
}
// Out cold: someone gets you through, or you die. Moves time and you (to the healer) as it happens.
function care(g, w, p, sc, pre, lines) {
    const s = sheetOf(g);
    const o = getThrough(g, w, p, sc);
    lines.push(...o.lines);
    if (!o.saved) {
        advance(g, w, o.minutes);
        youDie(g, w, pre, CAUSE[sc.cause], sc.where, lines);
        return false;
    }
    for (const id of ['hunger', 'thirst'])
        if (w.statuses.some(x => x.id === id) && (g.player.stats[id] ?? 1) <= 0)
            g.player.stats[id] = 30;
    if (o.treated && o.to) {
        const cost = Math.min(g.player.money, careCost(g, w));
        g.player.loc = o.to;
        advance(g, w, o.minutes + 8 * 60);
        if (cost > 0) {
            g.player.money -= cost;
            book(g, `Treatment at ${placeOf(g, w, o.to)?.name ?? careWord(w)}`, -cost);
        }
        s.hp = Math.max(p.hp, Math.ceil(p.max * 0.4));
        lines.push(`You wake up at ${placeOf(g, w, o.to)?.name ?? careWord(w)} hours later${cost ? `; the bill is ${cost}` : ''}.`);
        note(g, '{u} was brought to {0}, badly hurt.', [placeOf(g, w, o.to)?.name ?? careWord(w)], [], o.to, 'event');
    }
    else {
        advance(g, w, o.minutes + 120);
        s.hp = Math.max(p.hp, awakeHp(p.max));
        lines.push('You come to a couple of hours later, barely able to stand.');
    }
    syncLife(g, w);
    return true;
}
/* ---------- after a fight ---------- */
// Beasts and monsters finish off the fallen; robbers, thugs and guards leave them (a foe can say which).
export function merciless(w, c) {
    if (c.tower || c.gate)
        return true;
    const foes = c.list.filter(f => f.side === 'them');
    const defs = foes.map(f => rpgOf(w)?.bestiary?.find(b => b.id === f.ref));
    if (defs.some(d => d?.kills === true))
        return true;
    if (defs.length && defs.every(d => d?.kills === false))
        return false;
    return foes.some(f => (f.tags ?? []).some(t => t === 'wild' || t === 'undead')) || foes.every(f => !(f.tags ?? []).some(t => t === 'town' || t === 'road'));
}
const remoteFight = (c) => !!(c.tower || c.gate) || (c.tags ?? []).some(t => t === 'road' || t === 'wild') && !(c.tags ?? []).includes('town');
/** The end of a fight when death is real: who is dead, who bleeds, who gets them through. `pre`: the save before. */
export function afterBattle(g, w, c, pre) {
    busy = true;
    try {
        return aftermath(g, w, c, pre);
    }
    finally {
        busy = false;
    }
}
function aftermath(g, w, c, pre) {
    const mo = mortalOf(g);
    mo.fights = (mo.fights ?? 0) + 1;
    const s = sheetOf(g);
    const me = c.list.find(f => f.id === 'you');
    const lines = [];
    const story = [];
    const killers = c.over === 'lost' && merciless(w, c);
    const allies = c.list.filter(f => f.side === 'us' && (f.who === 'friend' || f.who === 'merc'));
    const youUp = !me.down;
    const remote = remoteFight(c);
    const fighters = c.list;
    const mkScene = (cause, skip, youAwake) => ({ cause, where: c.where, remote, helpers: c.over === 'lost' ? [] : helpersOf(g, w, new Set(skip), youAwake, fighters), strangers: true });
    let youDied = false;
    // companions first (you, if awake, and the others tend to them where they fell)
    for (const f of allies) {
        if (!f.down)
            continue;
        const m = partyOf(g).members.find(x => memberKey(x) === f.ref);
        if (!m)
            continue;
        const p = { key: f.ref, name: f.name, hp: f.hp, max: f.max, you: false };
        const left = c.over === 'fled'; // you got away; they did not
        const sc = mkScene('wounds', [f.ref], youUp && !left);
        if (left)
            sc.helpers = [];
        if (f.hp <= 0 || killers || (left && merciless(w, c))) {
            const r = killers || (left && merciless(w, c)) ? { ok: false, lines: [], hp: 0 } : revive(g, w, p, sc, false);
            lines.push(...r.lines);
            if (!r.ok) {
                lines.push(companionDies(g, w, f.ref, killers || left ? 'was killed' : 'died of their wounds', c.where));
                continue;
            }
            p.hp = r.hp;
        }
        if (isDown(p.hp, p.max)) {
            const o = getThrough(g, w, p, sc);
            lines.push(...o.lines);
            if (!o.saved) {
                lines.push(companionDies(g, w, f.ref, 'died of their wounds', c.where));
                continue;
            }
            p.hp = Math.max(p.hp, o.treated ? Math.ceil(p.max * 0.4) : awakeHp(p.max));
        }
        m.hp = p.hp;
        m.max = p.max;
    }
    for (const f of allies)
        if (!f.down) {
            const m = partyOf(g).members.find(x => memberKey(x) === f.ref);
            if (m) {
                m.hp = f.hp;
                m.max = f.max;
            }
        }
    // you
    if (!me.down) {
        s.hp = Math.max(1, me.hp + Math.max(0, hpMax(w, s) - me.max));
        syncLife(g, w);
    } // (a level gained in the fight adds its hit points)
    else {
        const p = { key: 'you', name: 'You', hp: me.hp, max: me.max, you: true };
        const sc = mkScene('wounds', ['you'], false);
        if (killers)
            story.push(`The ${[...new Set(c.list.filter(f => f.side === 'them' && !f.down).map(f => f.name.replace(/ \d+$/, '')))].join(' and ').toLowerCase() || 'foes'} finish what they started.`);
        if (me.hp <= 0 || killers) {
            const r = revive(g, w, p, sc, killers);
            story.push(...r.lines);
            const byUndead = c.list.some(f => f.side === 'them' && (f.tags ?? []).includes('undead'));
            if (!r.ok) {
                lines.push(...youDie(g, w, pre, killers ? 'were killed' : 'died of your wounds', c.where, story, byUndead));
                youDied = true;
            }
            else
                p.hp = r.hp;
        }
        if (!youDied) {
            if (killers)
                story.push('When they are gone, you are still breathing.');
            if (isDown(p.hp, p.max)) {
                if (!care(g, w, p, sc, pre, story)) {
                    youDied = true;
                    lines.push('☠️ You bled to death.');
                }
            }
            else {
                s.hp = p.hp;
                syncLife(g, w);
            }
            if (!youDied)
                tell(g, 'You came to', story);
        }
    }
    const summary = youDied ? `{{user}} died in the fight (${deathOf(g)?.text ?? ''}).`
        : me.down ? '{{user}} went down in the fight and barely survived.' : '';
    return { lines, summary, youDied };
}
/* ---------- the days after ---------- */
// Companions heal like you do: a fifth of their hit points a night.
onDay.push((g, w) => {
    if (!mortalOn(g, w))
        return [];
    for (const m of partyOf(g).members) {
        const max = m.max;
        if (m.hp === undefined || !max) {
            delete m.hp;
            continue;
        }
        m.hp = Math.min(max, m.hp + Math.ceil(max * 0.2));
        if (m.hp >= max) {
            delete m.hp;
            delete m.max;
        }
    }
    return [];
});
/* ---------- for the AI ---------- */
export function mortalLine(g, w) {
    if (!mortalOn(g, w))
        return '';
    const d = deathOf(g);
    if (d)
        return `{{user}} is DEAD: ${d.text} The story of {{user}} is over. Write only what follows their death (who finds them, who mourns), never {{user}} acting or speaking again.`;
    const out = [];
    const form = formOf(g);
    if (form === 'ghost')
        out.push('{{user}} died and came back as a ghost: no body, unseen by most people; the few who see them are frightened. A ghost cannot eat, drink, or hold anything for long, and cannot be healed by any healer. If a ghost is destroyed, it is gone forever.');
    if (form === 'undead')
        out.push('{{user}} died and came back as undead: a walking corpse with no heartbeat, no hunger and no thirst. The living fear or attack the undead; healers and temples turn them away; holy places and sunlight are hostile to them. If destroyed, they are gone forever.');
    const b = bandNow(g, w);
    if (b && b !== 'fine')
        out.push(`{{user}} is ${BAND_WORD[b]}${b === 'critical' ? ': every move hurts, they can barely fight or work' : b === 'wounded' ? ', and it shows in everything they do' : ''}.`);
    const hurt = friends(g).filter(m => m.hp !== undefined && m.max).map(m => `${memberName(g, m)} is ${BAND_WORD[bandOf(m.hp, m.max)]}`);
    if (hurt.length)
        out.push(`${hurt.join('; ')}.`);
    const recent = gravesOf(g).filter(x => !x.you && g.day - x.day <= 7);
    if (recent.length)
        out.push(`Dead and gone (they never appear again): ${recent.map(x => `${x.name} (${x.cause}, day ${x.day})`).join(', ')}.`);
    out.push('In this world death is real: at 0 hit points a person is dead for good. Harm in the story costs real hit points: describe injuries honestly when they happen, and never undo or ignore them.');
    return out.join(' ');
}
