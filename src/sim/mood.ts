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

// Said playfully or with affection: a slap on the arm between lovers, "idiot" with a grin.
const PLAYFUL = /\b(playful(ly)?|teas(e|es|ing|ingly)|jokingly|joking|gently|lightly|softly|affectionate(ly)?|lovingly|fondly|grin(s|ning)?|smirk(s|ing)?|giggl\w*|laugh(s|ing)?|wink(s|ing)?|smil(e|es|ing)|kiss\w*|cuddl\w*|tickl\w*)\b|\b(brincadeira|brincando|de brincadeira|de leve|levinho|carinh\w*|tapinha|provoc\w*|sorri\w*|ri(ndo|u)|piscando|piscou|beij\w*|abra[cç]\w*|c[oó]cegas)\b/i;
/** A line with insults or violence: how hard it hits, or 0. Said playfully, it is nothing. */
export function harshness(text: string): number {
    const hit = VIOLENCE.test(text) ? 12 : INSULT.test(text) ? 7 : 0;
    return hit && !PLAYFUL.test(text) ? hit : 0;
}
interface Pending { hit: number; who: string[]; at: number }
const P = (g: Save) => ((g as any).social ??= {});

// What your line does to the people who hear it. Words alone can't tell a slap from a playful one, so the bond only
// drops if they take it badly: their reply's emotion decides (see settleLine). Returns whether the line was harsh.
export function judgeLine(g: Save, w: WorldDef, text: string, hearers: { avatar: string; name: string; met: boolean }[]): { hurt: string[]; harsh: boolean } {
    void w;
    const hurt = settlePending(g, null);   // a line before it that nobody reacted to (no Expressions)
    const hit = harshness(text);
    if (!hit) return { hurt, harsh: false };
    const who = hearers.filter(r => r.met).map(r => r.avatar);
    if (who.length) P(g).pendingHurt = { hit, who, at: g.day * 1440 + g.minutes } as Pending;
    return { hurt, harsh: true };
}
// Their reply came: angry, disgusted, hurt… the line counts in full; amused, loving… it was fine; no emotion known
// (the Expressions extension is off): half of it.
const TOOK_BADLY = new Set(['anger', 'annoyance', 'disgust', 'disapproval', 'disappointment', 'fear', 'sadness', 'grief', 'nervousness', 'embarrassment']);
export function settleLine(g: Save, avatar: string, label: string | null, reply = ''): string[] {
    const p = P(g).pendingHurt as Pending | undefined;
    if (!p || !p.who.includes(avatar)) return [];
    return settlePending(g, label ?? readReply(reply));
}
// Without the Expressions extension: how they took it, read from the words of their reply (English and Portuguese).
const HURT_REPLY = /\b(glar\w*|scowl\w*|angr\w*|furious|how dare|ouch|that hurt|flinch\w*|winc\w*|tears?|cr(y|ies|ied|ying)|sob\w*|shov\w* (you|him|her) away|pull\w* away|step\w* back|don'?t touch|stop it|what the hell|offended|hurt)\b|\b(irritad\w*|furios\w*|brav[oa]|com raiva|como (voc[eê]|tu) ousa|ai+!|doeu|machucou|recua\w*|se afasta\w*|l[aá]grimas?|chor\w*|n[aã]o me toca|para com isso|ofendid\w*|magoad\w*)\b/i;
const FINE_REPLY = /\b(laugh\w*|giggl\w*|grin\w*|smil\w*|smirk\w*|chuckl\w*|blush\w*|playful\w*|teas\w*|wink\w*|kiss\w*|hug\w*)\b|\b(ri(ndo|u|sada)|risad\w*|sorri\w*|gargalh\w*|cor[ao]\w*|brincalh\w*|provoc\w*|piscando|beij\w*|abra[cç]\w*)\b/i;
const readReply = (t: string): string | null => (!t ? null : HURT_REPLY.test(t) ? 'anger' : FINE_REPLY.test(t) ? 'amusement' : null);
function settlePending(g: Save, label: string | null): string[] {
    const p = P(g).pendingHurt as Pending | undefined;
    if (!p) return [];
    delete P(g).pendingHurt;
    const l = String(label ?? '').toLowerCase();
    const hit = !l ? Math.round(p.hit / 2) : TOOK_BADLY.has(l) ? p.hit : 0;
    if (!hit) return [];
    const out: string[] = [];
    for (const a of p.who) {
        const r = g.cast[a]; if (!r) continue;
        const lost = loseBond(g, a, hit);
        approve(g, a, -Math.round(hit * 0.8));
        if (lost) out.push(`${r.name} did not like that (bond −${lost}).`);
        note(g, p.hit > 10 ? '{u} got violent with {0}.' : '{u} insulted {0}.', [r.name], [a], g.player.loc, 'fight');
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
