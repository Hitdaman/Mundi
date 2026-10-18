// The living world: approval (what people think of how you behave), lore that switches on with the state of
// the world, people's own lives moving on over the weeks, and rumors that travel between people.
import { personaName } from '../st/bridge.js';
import { nowAbs, type Save, type Resident } from '../core/store.js';
import type { WorldDef, LoreEntry } from '../core/world.js';
import { onDay } from './hooks.js';
import { residents, whereNow } from './people.js';
import { weatherOn } from './weather.js';
import { period, isWeekend } from './time.js';
import { note, facts, factText } from './facts.js';
import { homeSpot } from './game.js';

const rnd = (g: Save, salt: string) => { let h = 2166136261; const s = `${g.world}|${g.day}|${salt}`; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const L = (g: Save) => { const x = ((g as any).living ??= {}); x.approval ??= {}; x.rumors ??= []; x.pairs ??= []; return x as { approval: Record<string, number>; rumors: Rumor[]; pairs: [string, string][] }; };

/* ---------- approval (55): what people think of the way you act, -100..100 ---------- */

export const approvalOf = (g: Save, avatar: string) => L(g).approval[avatar] ?? 0;
export function approve(g: Save, avatar: string, delta: number) { const a = L(g).approval; a[avatar] = Math.max(-100, Math.min(100, (a[avatar] ?? 0) + delta)); }
// Everyone who hears about it reacts a little (kind acts raise it, broken promises lower it).
export function approveAll(g: Save, delta: number, except: string[] = []) { for (const r of residents(g)) if (r.met && !except.includes(r.avatar)) approve(g, r.avatar, delta); }
export const approvalWord = (v: number) => (v >= 50 ? 'Admires you' : v >= 15 ? 'Approves of you' : v > -15 ? 'Neutral' : v > -50 ? 'Disapproves' : 'Despises your ways');
export function approvalLine(g: Save, present: Resident[]) {
    const p = present.filter(r => Math.abs(approvalOf(g, r.avatar)) >= 15);
    return p.length ? `What they think of how {{user}} behaves: ${p.map(r => `${r.name} — ${approvalWord(approvalOf(g, r.avatar)).toLowerCase()}`).join('; ')}.` : '';
}

/* ---------- lore that switches on with the world (75) ---------- */

// A world's lore entry can have `when`: { weather: 'Rain', period: 'Night', place: 'cafe', weekend: true }.
export interface LoreWhen { weather?: string; period?: string; place?: string; weekend?: boolean }
export function activeWorldLore(g: Save, w: WorldDef): string[] {
    const wx = weatherOn(g.world, g.day).name.toLowerCase();
    const per = period(w, g.minutes).name.toLowerCase();
    return (w.lore as (LoreEntry & { when?: LoreWhen })[]).filter(e => {
        const c = e.when; if (!c || !e.content) return false;
        if (c.weather && !wx.includes(c.weather.toLowerCase())) return false;
        if (c.period && c.period.toLowerCase() !== per) return false;
        if (c.place && c.place !== g.player.loc) return false;
        if (c.weekend !== undefined && c.weekend !== isWeekend(g.day)) return false;
        return true;
    }).map(e => e.content);
}

/* ---------- people's own lives (76) ---------- */

export const couples = (g: Save) => L(g).pairs.filter(([a, b]) => g.cast[a] && g.cast[b]);
function lifeGoesOn(g: Save, w: WorldDef): string[] {
    const out: string[] = [];
    const people = residents(g);
    if (!people.length) return out;
    // about once a week someone's life changes: a new job, a new home, or a new relationship
    if (rnd(g, 'life') > 0.15) return out;
    const r = people[Math.floor(rnd(g, 'who') * people.length)];
    const kind = rnd(g, 'kind');
    if (kind < 0.35 && w.occupations.length) {
        const o = w.occupations[Math.floor(rnd(g, 'job') * w.occupations.length)];
        if (o.id !== r.occupation) { r.occupation = o.id; note(g, '{0} started a new job: {1}.', [r.name, o.name], [r.avatar], o.place, 'life'); }
    } else if (kind < 0.6) {
        const z = w.homes.zones[Math.floor(rnd(g, 'zone') * w.homes.zones.length)];
        const taken = new Set([g.player.home, ...people.map(x => x.home)].map(h => `${h.x},${h.y}`));
        r.home = homeSpot(w, z.id, taken);
        note(g, '{0} moved to {1}.', [r.name, z.name], [r.avatar], `home:${r.avatar}`, 'life');
    } else {
        const single = people.filter(x => x !== r && !L(g).pairs.some(p => p.includes(x.avatar)) && !L(g).pairs.some(p => p.includes(r.avatar)) && !(g as any).social?.partner?.includes(x.avatar));
        if (single.length && !(g as any).social?.partner?.includes(r.avatar)) {
            const o = single[Math.floor(rnd(g, 'pair') * single.length)];
            L(g).pairs.push([r.avatar, o.avatar]);
            note(g, '{0} and {1} started dating.', [r.name, o.name], [r.avatar, o.avatar], r.leisure[0] ?? g.player.loc, 'life');
        }
    }
    return out;
}
export function couplesLine(g: Save, present: Resident[]) {
    const here = new Set(present.map(r => r.avatar));
    const c = couples(g).filter(([a, b]) => here.has(a) || here.has(b));
    return c.length ? `Relationships between people: ${c.map(([a, b]) => `${g.cast[a].name} and ${g.cast[b].name} are dating`).join('; ')}.` : '';
}

/* ---------- rumors (77) ---------- */

export interface Rumor { id: string; text: string; at: number; knownBy: string[] }
const GOSSIP = ['love', 'party', 'plan', 'life', 'goal', 'work'];
// Juicy facts become rumors, then spread to people who spend time at the same places.
function spreadRumors(g: Save, w: WorldDef): string[] {
    const st = L(g);
    const yesterday = nowAbs(g) - 1440;
    for (const f of facts(g).filter(f => f.at >= yesterday && GOSSIP.includes(f.kind ?? '') && !st.rumors.some(r => r.id === f.id))) {
        st.rumors.push({ id: f.id, text: factText(f, personaName()), at: f.at, knownBy: [...f.who] });
    }
    const people = residents(g);
    const spots = (r: Resident) => new Set([...r.leisure, w.occupations.find(o => o.id === r.occupation)?.place ?? '', whereNow(g, w, r)].filter(Boolean));
    for (const rumor of st.rumors) {
        for (const knower of people.filter(p => rumor.knownBy.includes(p.avatar))) {
            const ks = spots(knower);
            for (const other of people) {
                if (rumor.knownBy.includes(other.avatar)) continue;
                if ([...spots(other)].some(s => ks.has(s)) && rnd(g, `${rumor.id}|${other.avatar}`) < 0.4) rumor.knownBy.push(other.avatar);
            }
        }
    }
    st.rumors = st.rumors.filter(r => nowAbs(g) - r.at < 14 * 1440).slice(-40);
    return [];
}
export function rumorLines(g: Save, present: Resident[]) {
    const out: string[] = [];
    for (const r of present) {
        const heard = L(g).rumors.filter(x => x.knownBy.includes(r.avatar) && !facts(g).find(f => f.id === x.id)?.who.includes(r.avatar)).slice(-2);
        if (heard.length) out.push(`${r.name} has heard around town: ${heard.map(h => h.text).join(' ')}`);
    }
    return out;
}

onDay.push((g, w) => [...lifeGoesOn(g, w), ...spreadRumors(g, w)]);

/* ---------- families and ties between people (like The Sims: who is whose mother, and how they get along) ---------- */

export type TieType = 'parent' | 'child' | 'sibling' | 'spouse' | 'partner' | 'cousin' | 'roommate' | 'friend' | 'rival' | 'ex';
export type TieTone = 'close' | 'good' | 'neutral' | 'tense' | 'hostile';
export interface Tie { a: string; b: string; type: TieType; tone: TieTone }   // `a` is the <type> of `b`; '__you' is the player
export const TIE_TYPES: [TieType, string][] = [['parent', 'parent of'], ['child', 'child of'], ['sibling', 'sibling of'], ['spouse', 'married to'], ['partner', 'partner of'], ['cousin', 'cousin of'], ['roommate', 'roommate of'], ['friend', 'friend of'], ['rival', 'rival of'], ['ex', 'ex of']];
export const TIE_TONES: [TieTone, string][] = [['close', 'Close'], ['good', 'Good'], ['neutral', 'Neutral'], ['tense', 'Tense'], ['hostile', 'Hostile']];
export const ties = (g: Save): Tie[] => ((L(g) as any).ties ??= []);
export const tiesOf = (g: Save, avatar: string) => ties(g).filter(t => t.a === avatar || t.b === avatar);
export function setTie(g: Save, t: Tie) {
    const list = ties(g); const i = list.findIndex(x => (x.a === t.a && x.b === t.b) || (x.a === t.b && x.b === t.a));
    if (i >= 0) list.splice(i, 1, t); else list.push(t);
}
export function removeTie(g: Save, a: string, b: string) { const list = ties(g); const i = list.findIndex(x => (x.a === a && x.b === b) || (x.a === b && x.b === a)); if (i >= 0) list.splice(i, 1); }
// Living together: the second person moves into the first one's home (the player's home for '__you').
export function liveTogether(g: Save, host: string, guest: string) {
    const r = g.cast[guest]; if (!r) return;
    r.home = host === '__you' ? { ...g.player.home } : { ...g.cast[host].home };
    (r as any).homeWith = host;
    normalizeHomes(g);
}
// Households: everyone at the same address shares one home. With the player there, it is the player's home;
// otherwise the first person who lived there is the "head" whose home the others share (`homeWith`).
export const homeKey = (h: { zone: string; x: number; y: number }) => `${h.zone}:${h.x},${h.y}`;
export function normalizeHomes(g: Save) {
    const groups = new Map<string, string[]>();
    for (const r of Object.values(g.cast)) { const k = homeKey(r.home); groups.set(k, [...(groups.get(k) ?? []), r.avatar]); }
    const mine = homeKey(g.player.home);
    for (const [k, list] of groups) {
        if (k === mine) { for (const a of list) (g.cast[a] as any).homeWith = '__you'; continue; }
        // keep the current head when there is one
        const head = list.find(a => !(g.cast[a] as any).homeWith || !list.includes((g.cast[a] as any).homeWith)) ?? list[0];
        for (const a of list) { if (a === head) delete (g.cast[a] as any).homeWith; else (g.cast[a] as any).homeWith = head; }
    }
}
const nameOfId = (g: Save, id: string) => (id === '__you' ? '{{user}}' : g.cast[id]?.name ?? id);
const INVERSE: Partial<Record<TieType, string>> = { parent: 'child of', child: 'parent of' };
// For the AI: the ties of the people in this scene (only those, like the memories).
export function tiesLine(g: Save, present: Resident[]) {
    const here = new Set(present.map(r => r.avatar));
    const list = ties(g).filter(t => here.has(t.a) || here.has(t.b));
    if (!list.length) return '';
    return `Family and ties: ${list.map(t => `${nameOfId(g, t.a)} is ${TIE_TYPES.find(x => x[0] === t.type)?.[1] ?? t.type} ${nameOfId(g, t.b)}${t.tone !== 'neutral' ? ` (${t.tone} relationship)` : ''}`).join('; ')}.`;
}
void INVERSE;
