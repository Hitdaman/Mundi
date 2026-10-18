// How a scene goes changes the bond: insults or violence in your line, and the character's reaction (the emotion the
// Expressions extension reads in their reply), make it go down; warm reactions make it go up a little.
import type { Save } from '../core/store.js';
import type { WorldDef } from '../core/world.js';
import { addBond, loseBond } from './social.js';
import { approve } from './living.js';
import { note } from './facts.js';

// insults and violence, in English and Portuguese
const INSULT = /\b(idiot|stupid|shut up|hate you|fuck (you|off)|bitch|loser|ugly|dumb|moron|asshole|whore|slut|pathetic|worthless)\b|\b(idiota|burr[oa]|cala (a )?boca|te odeio|vai se f\w*|vadia|imbecil|ot[aá]ri[oa]|nojent[oa]|babaca|desgra[cç]ad[oa]|filh[oa] da puta|vagabund[oa]|in[uú]til|pat[eé]tic[oa]|puta|cuz[aã]o)\b/i;
const VIOLENCE = /\b(punch(es|ed)?|slap(s|ped)?|hit(s|ting)?|kick(s|ed)?|shove[sd]?|push(es|ed)? (her|him)|spit(s)? on)\b|\b(soc[oa]|d[aá] um soco|tap[ae]i?a?|chut[ae]i?|empurr\w*|bat[eo]u? n[ae]l[ae]|cusp\w*)\b/i;

// what your line does to the people who hear it
export function judgeLine(g: Save, w: WorldDef, text: string, hearers: { avatar: string; name: string; met: boolean }[]): string[] {
    void w;
    const out: string[] = [];
    const hit = VIOLENCE.test(text) ? 12 : INSULT.test(text) ? 7 : 0;
    if (!hit) return out;
    for (const r of hearers) {
        if (!r.met) continue;
        const lost = loseBond(g, r.avatar, hit);
        approve(g, r.avatar, -Math.round(hit * 0.8));
        if (lost) out.push(`${r.name} did not like that (bond −${lost}).`);
        note(g, hit > 10 ? '{u} got violent with {0}.' : '{u} insulted {0}.', [r.name], [r.avatar], g.player.loc, 'fight');
    }
    return out;
}

// the character's reaction, from the emotion of their reply (labels of SillyTavern's Expressions classifier)
const BAD: Record<string, number> = { anger: 5, annoyance: 3, disgust: 5, disapproval: 3, disappointment: 3, grief: 2, remorse: 1 };
const GOOD: Record<string, number> = { love: 3, admiration: 2, gratitude: 2, joy: 1, amusement: 1, caring: 2, excitement: 1 };
export function judgeReaction(g: Save, avatar: string, label: string | null): number {
    const l = String(label ?? '').toLowerCase();
    if (BAD[l]) { loseBond(g, avatar, BAD[l]); approve(g, avatar, -BAD[l]); return -BAD[l]; }
    if (GOOD[l]) return addBond(g, avatar, GOOD[l]);
    return 0;
}
