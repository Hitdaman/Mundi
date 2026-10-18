// Life-Sim systems: needs in words, aspirations, feelings that fade, the lifestyle shop (vehicles, furniture,
// gear for working at home), quick gigs, the gym, college, things at home that break, scene lock, NPCs who
// invite you, and who lets you into their home. All decided by the engine; the AI only narrates.
import { nowAbs, type Save, type Resident } from '../core/store.js';
import { courseOf, learning, canStudyHere, studiedToday, studySession, countUp, countOf, gainTrait } from './skills.js';
import { priceOf } from './bills.js';
import { styleOf, type WorldDef, type ActionDef, type StatusDef } from '../core/world.js';
import { onDay, onHour } from './hooks.js';
import { addStatus, money } from './needs.js';
import { book } from './ledger.js';
import { social, bondOf, isPartner, type PlanKind } from './social.js';
import { note } from './facts.js';
import { placeOf, playerHomeId } from './places.js';
import { whereNow, residents } from './people.js';

const med = (w: WorldDef) => styleOf(w) === 'medieval';
const rnd = (g: Save, salt: string) => { let h = 2166136261; const s = `${g.world}|${g.day}|${g.minutes}|${salt}`; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const life = (g: Save) => {
    const p = g.player as any;
    p.items ??= []; p.broken ??= []; p.fitness ??= 0; p.study ??= { enrolled: false, classes: 0, passed: 0, degree: false };
    return p as { items: string[]; broken: string[]; fitness: number; study: { enrolled: boolean; classes: number; passed: number; degree: boolean }; aspiration?: string; aspDone?: string[] };
};
export const lifeOf = life;

/* ---------- needs in words (46) ---------- */

const WORDS: Record<string, [string, string, string, string]> = {
    energy: ['Exhausted', 'Tired', 'Rested', 'Full of energy'],
    hunger: ['Starving', 'Hungry', 'Satisfied', 'Full'],
    thirst: ['Parched', 'Thirsty', 'Fine', 'Hydrated'],
    mood: ['Miserable', 'Down', 'Good', 'Great'],
    hygiene: ['Filthy', 'Grubby', 'Clean', 'Fresh'],
    life: ['Badly hurt', 'Hurt', 'Healthy', 'In great shape'],
    health: ['Badly hurt', 'Hurt', 'Healthy', 'In great shape'],
};
export function needWord(s: StatusDef, v: number) {
    const w = WORDS[s.id] ?? ['Very low', 'Low', 'Good', 'Very good'];
    const pct = (v / (s.max || 100)) * 100;
    return pct <= 15 ? w[0] : pct <= 45 ? w[1] : pct <= 80 ? w[2] : w[3];
}

/* ---------- feelings that fade ---------- */

export interface Feeling { avatar: string; tag: string; until: number }
export const feelingsOf = (g: Save) => (((social(g) as any).feel ??= []) as Feeling[]);
export function feel(g: Save, avatar: string, tag: string, days: number) {
    const list = feelingsOf(g).filter(f => !(f.avatar === avatar && f.tag === tag));
    list.push({ avatar, tag, until: nowAbs(g) + days * 1440 });
    (social(g) as any).feel = list.slice(-80);
}
export const activeFeelings = (g: Save, avatar: string) => feelingsOf(g).filter(f => f.avatar === avatar && f.until > nowAbs(g));
export function feelingLine(g: Save, present: Resident[]) {
    const parts = present.map(r => { const f = activeFeelings(g, r.avatar); return f.length ? `${r.name}: ${f.map(x => `${x.tag} (for ${Math.max(1, Math.ceil((x.until - nowAbs(g)) / 1440))} more day${Math.ceil((x.until - nowAbs(g)) / 1440) > 1 ? 's' : ''})`).join(', ')}` : ''; }).filter(Boolean);
    return parts.length ? `Current feelings toward {{user}} — ${parts.join('; ')}. Let them color the tone, whatever the overall bond.` : '';
}

/* ---------- aspirations ---------- */

export interface Aspiration { id: string; name: string; desc: string; reward?: string; check: (g: Save, w: WorldDef) => [number, number] }
export const ASPIRATIONS: Aspiration[] = [
    { id: 'rich', name: 'Get rich', desc: 'Save up a fortune.', reward: 'Good with numbers', check: (g, w) => [g.player.money, med(w) ? 5000 : 50000] },
    { id: 'romance', name: 'Find love', desc: 'Be in a relationship.', reward: 'Romantic', check: g => [social(g).partner.length ? 1 : 0, 1] },
    { id: 'career', name: 'Top of the career', desc: 'Reach the highest rank of a job.', reward: 'Ambitious', check: (g, w) => { const j = g.player.job; const o = j && w.occupations.find(x => x.id === j.id); return [o ? j!.rank + 1 : 0, o ? o.ranks.length : 1]; } },
    { id: 'worker', name: 'Hard worker', desc: 'Work 20 shifts.', reward: 'Serious', check: g => [countOf(g, 'shifts'), 20] },
    { id: 'social', name: 'Social butterfly', desc: 'Have five good friends.', reward: 'Charming', check: g => [Object.values(social(g).bond).filter(b => b >= 60).length, 5] },
    { id: 'host', name: 'Party host', desc: 'Throw three parties.', reward: 'Outgoing', check: g => [countOf(g, 'parties'), 3] },
    { id: 'home', name: 'A home of your own', desc: 'Live in a house (not an apartment or a cottage).', reward: 'Calm', check: g => [['house', 'manor'].includes(g.player.home.kind) ? 1 : 0, 1] },
    { id: 'scholar', name: 'Lifelong learner', desc: 'Finish three courses.', reward: 'Smart', check: g => [learning(g).done.length, 3] },
    { id: 'chef', name: 'Home chef', desc: 'Cook 15 meals at home.', reward: 'Good cook', check: g => [countOf(g, 'meals'), 15] },
    { id: 'athlete', name: 'Athlete', desc: 'Have 15 good workouts.', reward: 'Athletic', check: g => [countOf(g, 'workouts'), 15] },
    { id: 'fit', name: 'In top shape', desc: 'Get really fit.', reward: 'Strong', check: g => [life(g).fitness, 80] },
    { id: 'artist', name: 'Artist', desc: 'Sell five paintings.', reward: 'Creative', check: g => [countOf(g, 'paintings'), 5] },
];
export const aspirationOf = (g: Save) => ASPIRATIONS.find(a => a.id === life(g).aspiration) ?? null;
export function setAspiration(g: Save, id: string) { life(g).aspiration = id; note(g, '{u} set a life goal: {0}.', [ASPIRATIONS.find(a => a.id === id)?.name ?? id], [], g.player.loc, 'goal'); }
function checkAspiration(g: Save, w: WorldDef): string[] {
    const a = aspirationOf(g); const l = life(g);
    if (!a || (l.aspDone ??= []).includes(a.id)) return [];
    const [have, need] = a.check(g, w);
    if (have < need) return [];
    l.aspDone.push(a.id);
    addStatus(g, w, 'mood', 30);
    note(g, '{u} reached a life goal: {0}!', [a.name], [], g.player.loc, 'goal');
    const got = a.reward && gainTrait(g, a.reward, 'goal');
    return [`Life goal reached: ${a.name}!${got ? ` You are now ${a.reward}.` : ''}`];
}

/* ---------- the lifestyle shop ---------- */

export interface Item { id: string; name: string; desc: string; icon: string; price: number }
export function shopItems(w: WorldDef): Item[] {
    if (med(w)) return [
        { id: 'bed', name: 'Feather bed', desc: 'Sleep better: you wake up in a better mood.', icon: '🛏️', price: 60 },
        { id: 'horse', name: 'Horse', desc: 'Travel takes half the time.', icon: '🐎', price: 400 },
        { id: 'mule', name: 'Mule', desc: 'Travel takes a quarter less time.', icon: '🫏', price: 150 },
        { id: 'loom', name: 'Loom', desc: 'Weave cloth at home and sell it.', icon: '🧶', price: 120 },
        { id: 'easel', name: 'Easel and paints', desc: 'Paint at home; a good painting sells.', icon: '🎨', price: 80 },
    ];
    return [
        { id: 'bed', name: 'King size bed', desc: 'Sleep better: you wake up in a better mood.', icon: '🛏️', price: 900 },
        { id: 'coffee', name: 'Coffee machine', desc: 'Make coffee at home (energy).', icon: '☕', price: 250 },
        { id: 'car', name: 'Sports car', desc: 'Travel takes half the time.', icon: '🚗', price: 18000 },
        { id: 'bike', name: 'Bicycle', desc: 'Travel takes a quarter less time.', icon: '🚲', price: 450 },
        { id: 'pc', name: 'Gaming PC', desc: 'Freelance or stream from home.', icon: '🖥️', price: 2200 },
        { id: 'easel', name: 'Easel and paints', desc: 'Paint at home; a good painting sells.', icon: '🎨', price: 300 },
        { id: 'treadmill', name: 'Treadmill', desc: 'Work out at home.', icon: '🏃', price: 1200 },
    ];
}
export const hasItem = (g: Save, id: string) => life(g).items.includes(id);
export function buy(g: Save, w: WorldDef, id: string): string {
    const it = shopItems(w).find(x => x.id === id);
    if (!it) return '';
    if (hasItem(g, id)) return 'You already have it.';
    const price = priceOf(g, it.price);
    if (g.player.money < price) return 'Not enough money.';
    g.player.money -= price; book(g, it.name, -price);
    life(g).items.push(id);
    note(g, '{u} bought: {0}.', [it.name], [], g.player.loc, 'shop');
    return '';
}
// Vehicles shorten every trip.
export const travelFactor = (g: Save) => (hasItem(g, 'car') || hasItem(g, 'horse') ? 0.5 : hasItem(g, 'bike') || hasItem(g, 'mule') ? 0.75 : 1);

/* ---------- things at home that break ---------- */

const BREAKABLE: Record<string, { name: string; blocks: string[] }> = {
    shower: { name: 'the shower', blocks: ['shower', 'basin'] },
    stove: { name: 'the stove', blocks: ['cook'] },
    sink: { name: 'the kitchen sink', blocks: ['water'] },
};
export const brokenThings = (g: Save) => life(g).broken.map(id => BREAKABLE[id]?.name ?? id);
const blocked = (g: Save) => new Set(life(g).broken.flatMap(id => BREAKABLE[id]?.blocks ?? []));

/* ---------- actions the engine adds ---------- */

const x = (a: Partial<ActionDef> & { id: string; label: string }): ActionDef => ({ name: a.label, cost: 0, minutes: 60, effects: {}, ...a } as ActionDef);
export function extraActions(g: Save, w: WorldDef): ActionDef[] {
    const out: ActionDef[] = [];
    const here = placeOf(g, w, g.player.loc);
    const tags = here?.tags ?? [];
    const atHome = g.player.loc === playerHomeId;
    const l = life(g);
    const m = med(w);
    if (atHome) {
        out.push(x({ id: 'x-tv', label: m ? 'Sit by the fire' : 'Watch TV', icon: m ? '🔥' : '📺', minutes: 60, effects: { mood: m ? 5 : 6, energy: -2 } }));   // an old TV: every home has one
        if (hasItem(g, 'coffee')) out.push(x({ id: 'x-coffee', label: 'Make coffee', icon: '☕', minutes: 10, effects: { energy: 20, thirst: 5 } }));
        if (hasItem(g, 'pc')) out.push(x({ id: 'x-freelance', label: 'Freelance on the computer', icon: '🖥️', minutes: 180, cost: -70, effects: { energy: -15, mood: -4, hygiene: -5 } }));
        if (hasItem(g, 'loom')) out.push(x({ id: 'x-weave', label: 'Weave cloth to sell', icon: '🧶', minutes: 180, cost: -8, effects: { energy: -15, mood: -3 } }));
        if (hasItem(g, 'easel')) out.push(x({ id: 'x-paint', label: 'Paint something to sell', icon: '🎨', minutes: 120, effects: { energy: -10, mood: 6 },
            roll: { dc: 13, traits: ['Creative', 'Skilled with hands'], success: { text: 'Your painting sold quickly.', money: m ? 12 : 110 }, fail: { text: 'Nobody wanted this one.', effects: { mood: -6 } } } }));
        if (hasItem(g, 'treadmill')) out.push(x({ id: 'x-treadmill', label: 'Run on the treadmill', icon: '🏃', minutes: 45, effects: { energy: -20, hygiene: -25, mood: 3 },
            roll: { dc: 9, traits: ['Athletic', 'Strong', 'Sports'], success: { text: 'A good run.', effects: { mood: 5 } }, fail: { text: 'You gave up halfway.', effects: { mood: -2 } } } }));
        for (const b of l.broken) out.push(x({ id: `x-repair-${b}`, label: `Pay someone to fix ${BREAKABLE[b]?.name ?? b}`, icon: '🧰', minutes: 60, cost: m ? 8 : 90, effects: {} }));
    }
    if (!atHome && tags.includes('work')) out.push(x({ id: 'x-gig', label: m ? 'Carry loads for a few coins (2 h)' : 'Do a quick gig: deliveries (2 h)', icon: m ? '📦' : '🛵', minutes: 120, cost: m ? -3 : -25, effects: { energy: -15, hunger: -10, hygiene: -10 } }));
    if (tags.includes('sport')) out.push(x({ id: 'x-workout', label: m ? 'Train in the yard' : 'Work out at the gym', icon: '🏋️', minutes: 90, cost: m ? 0 : 15, effects: { energy: -25, hygiene: -30, mood: 4, thirst: -10 },
        roll: { dc: 9, traits: ['Athletic', 'Strong', 'Sports'], success: { text: 'A great workout.', effects: { mood: 6 } }, fail: { text: 'A sloppy workout; your heart was not in it.', effects: { mood: -2 } } } }));
    if (!atHome && tags.includes('leisure') && !tags.includes('sport')) out.push(x({ id: 'x-run', label: 'Go for a run', icon: '👟', minutes: 40, effects: { energy: -15, hygiene: -20, mood: 6, thirst: -10 } }));
    // a course you are taking: one study session a day, at home (online) or at the university
    const cur = courseOf(w, learning(g).current);
    if (cur && canStudyHere(g, w) && !studiedToday(g, cur.id)) out.push(x({ id: 'x-study', label: `Study: ${cur.name}`, icon: cur.icon || '📚', minutes: 120, effects: { energy: -12, mood: -2, hunger: -6 } }));
    return out;
}
// Which world actions are blocked by something broken at home.
export const isBlocked = (g: Save, a: ActionDef) => !!a.home && blocked(g).has(a.id);

// After an action (the engine's own and the world's): its special results.
export function afterAction(g: Save, w: WorldDef, a: ActionDef, success: boolean | null): string[] {
    const l = life(g); const out: string[] = [];
    if (a.id === 'x-workout' || a.id === 'x-treadmill' || a.id === 'x-run') l.fitness = Math.min(100, l.fitness + (a.id === 'x-run' ? 3 : 5));
    if (a.id.startsWith('x-repair-')) { const b = a.id.slice(9); l.broken = l.broken.filter(x => x !== b); out.push(`${BREAKABLE[b]?.name ?? b} works again.`); }
    if (a.id === 'fix' && success && l.broken.length) { const b = l.broken.shift()!; out.push(`You fixed ${BREAKABLE[b]?.name ?? b}.`); }
    if (a.id === 'x-study') out.push(...studySession(g, w));
    if (a.id === 'cook') countUp(g, 'meals');
    if ((a.id === 'x-workout' || a.id === 'x-treadmill') && success) countUp(g, 'workouts');
    if (a.id === 'x-paint' && success) countUp(g, 'paintings');
    if (a.id === 'x-enroll') { l.study.enrolled = true; note(g, '{u} enrolled in classes.', [], [], g.player.loc, 'study'); }
    if (a.id === 'x-class') l.study.classes++;
    if (a.id === 'x-exam') {
        l.study.classes = 0;
        if (success) {
            l.study.passed++;
            if (l.study.passed >= 3 && !l.study.degree) {
                l.study.degree = true; l.study.enrolled = false;
                (g.player.traits.education ??= []).push('Degree');
                note(g, '{u} graduated!', [], [], g.player.loc, 'study'); out.push('You graduated!');
            }
        }
    }
    return out;
}

/* ---------- who lets you in ---------- */

export function doorAnswer(g: Save, w: WorldDef, loc: string): { ok: boolean; text: string } {
    if (!loc.startsWith('home:') || loc === playerHomeId) return { ok: true, text: '' };
    const r = g.cast[loc.slice(5)];
    if (!r) return { ok: true, text: '' };
    const home = whereNow(g, w, r) === loc;
    if (isPartner(g, r.avatar) || bondOf(g, r.avatar) >= 50) return { ok: true, text: home ? '' : `${r.name} is out, but you know where the key is.` };
    if (!home) return { ok: false, text: `You ring ${r.name}'s doorbell. Nobody answers.` };
    if (bondOf(g, r.avatar) >= 15) return { ok: true, text: `You ring the doorbell. ${r.name} opens the door and lets you in.` };
    return { ok: false, text: `You ring the doorbell. ${r.name} talks to you through the door, but does not let you in.` };
}

/* ---------- scene lock: people do not walk out in the middle of a conversation ---------- */

export function lockScene(g: Save, w: WorldDef) {
    const here = residents(g).filter(r => whereNow(g, w, r) === g.player.loc).map(r => r.avatar);
    (social(g) as any).lock = { loc: g.player.loc, who: here, until: nowAbs(g) + 60 };
}
export function lockedHere(g: Save, avatar: string): string | null {
    const l = (social(g) as any).lock as { loc: string; who: string[]; until: number } | undefined;
    if (!l || l.loc !== g.player.loc || nowAbs(g) >= l.until || !l.who.includes(avatar)) return null;
    return l.loc;
}

/* ---------- people who invite you ---------- */

export interface Invite { avatar: string; place: string; from: number; kind: PlanKind }
export const pendingInvite = (g: Save): Invite | null => ((social(g) as any).invite ?? null);
export const clearInvite = (g: Save) => { (social(g) as any).invite = null; };
function maybeInvite(g: Save, w: WorldDef): string[] {
    const h = Math.floor(g.minutes / 60);
    if (pendingInvite(g) || h < 9 || h > 20 || rnd(g, 'invite') > 0.05) return [];
    const pool = residents(g).filter(r => r.met && (bondOf(g, r.avatar) >= 25 || isPartner(g, r.avatar)) && r.leisure.length);
    if (!pool.length) return [];
    const r = pool[Math.floor(rnd(g, 'who') * pool.length)];
    const from = nowAbs(g) + 120 - (nowAbs(g) % 30);
    const place = r.leisure[Math.floor(rnd(g, 'where') * r.leisure.length)];
    const inv: Invite = { avatar: r.avatar, place, from, kind: isPartner(g, r.avatar) ? 'date' : 'hangout' };
    (social(g) as any).invite = inv;
    const s = social(g);
    const text = `Hey! Want to meet at ${placeOf(g, w, place)?.name ?? 'the usual place'} around ${String(Math.floor((from % 1440) / 60)).padStart(2, '0')}:${String(from % 60).padStart(2, '0')}?`;
    (s.threads[r.avatar] ??= []).push({ me: false, text, at: nowAbs(g) });
    s.unread[r.avatar] = (s.unread[r.avatar] ?? 0) + 1;
    return [];
}

/* ---------- the daily and hourly rules ---------- */

onDay.push((g, w) => {
    const out: string[] = [];
    const l = life(g);
    // something at home may break (not everything at once)
    const free = Object.keys(BREAKABLE).filter(b => !l.broken.includes(b));
    if (free.length && rnd(g, 'break') < 0.05) {   // a small chance each day
        const b = free[Math.floor(rnd(g, 'which') * free.length)];
        l.broken.push(b);
        note(g, '{0} broke at home.', [BREAKABLE[b].name], [], playerHomeId, 'home');
        out.push(`Oh no: ${BREAKABLE[b].name} broke at home. Fix it yourself, or pay someone.`);
    }
    // fitness fades a little if you never train
    l.fitness = Math.max(0, l.fitness - 1);
    out.push(...checkAspiration(g, w));
    // feelings that ran out are forgotten
    (social(g) as any).feel = feelingsOf(g).filter(f => f.until > nowAbs(g));
    return out;
});
onHour.push((g, w) => [...maybeInvite(g, w), ...checkAspiration(g, w)]);

// How the player looks, for the AI.
export const physiqueLine = (g: Save) => { const f = life(g).fitness; return f >= 70 ? '{{user}} is visibly fit and athletic.' : f >= 40 ? '{{user}} is in good shape.' : ''; };
export const moneyText = money;
