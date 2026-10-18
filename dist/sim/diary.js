// The diary: when you go to sleep, the day becomes one diary entry (first person) written by the AI from the day's
// atomic facts (certain, written by the engine) and the day's conversation. The conversation itself is already
// hidden from the AI scene by scene (visits.ts); from then on the story remembers the day through these entries.
import { settings, saveGame, notify } from '../core/store.js';
import { chat, quiet, personaName, ctx, translateTo } from '../st/bridge.js';
import { facts, factText, placeName } from './facts.js';
import { fmtClock as hm } from '../core/fmt.js';
import { applyVerdict } from './romance.js';
export const diaryOn = () => settings().diaryOnSleep !== false;
export const diaryEntries = (g) => (g.journalProse ??= {});
const clean = (t) => String(t ?? '').replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
// Where the day's conversation starts in the chat (moved forward each night).
export const dayStart = (g) => { const d = g.dayStart ?? 0; return d <= chat().length ? d : 0; };
export const markDayStart = (g) => { g.dayStart = chat().length; };
export async function writeDiary(g, w, day, verdict = true) {
    const me = personaName();
    const dayFacts = facts(g).filter(f => Math.floor(f.at / 1440) === day);
    const msgs = chat().slice(dayStart(g)).filter((m) => clean(m.mes) && !m.extra?.mundi_diary);
    const talk = msgs.map((m) => `${m.is_user ? me : m.extra?.mundi_narrator ? 'Narrator' : m.name}: ${clean(m.mes).slice(0, 320)}`);
    let convo = talk.slice(-60).join('\n');
    if (convo.length > 9000)
        convo = convo.slice(-9000);
    if (!dayFacts.length && !convo)
        return { ok: false, changes: [] };
    // the people of the day: who appears in the facts or spoke
    const spoke = new Set(msgs.filter((m) => !m.is_user).map((m) => String(m.name ?? '')));
    const people = Object.values(g.cast).filter(r => r.met && (spoke.has(r.name) || dayFacts.some(f => f.who.includes(r.avatar)))).map(r => ({ avatar: r.avatar, name: r.name }));
    const factList = dayFacts.map(f => `- ${hm(f.at % 1440)}, ${placeName(g, w, f.place)}: ${factText(f, me)}`).join('\n');
    const verdictAsk = verdict && people.length ? `\n\nThen write a line with only "---", and below it one line for each of these people: ${people.map(p => p.name).join(', ')}. ` +
        `Each line exactly like this: Name | friendship +1 | romance 0 | a short reason (what happened between them and ${me} today). ` +
        `Friendship and romance go from -3 to +3; 0 when nothing changed. Romance only moves with flirting, dates or love; insults, fights or broken promises are negative. Be honest, not generous.` : '';
    const out = await quiet(`This is one day (day ${day}) in ${me}'s life in ${w.name}.\n\nWhat surely happened:\n${factList || '(nothing noted)'}\n\n` +
        `${convo ? `What was said that day:\n${convo}\n\n` : ''}Write ${me}'s diary entry for that day, in the first person, in one or two short paragraphs (at most 150 words). ` +
        `Keep the people's names, what ${me} felt, promises and plans made, the important things that were said, and every relationship moment (asking someone out, a proposal, a breakup, and the answer). Each of the facts above must be in the entry. Use only what is above: invent nothing.${verdictAsk}`, 2000, // room for models that think first
    'You write short, faithful diary entries from notes and conversations. You never invent events.');
    const raw = String(out ?? '').replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '');
    let [entryPart, verdictPart = ''] = raw.split(/\n\s*-{3,}\s*\n/);
    // the model forgot the "---": the verdict lines ("Name | friendship +1 | romance 0 | …") are taken out of the entry
    const VERDICT = /^\s*[-*]?\s*[^|\n]+\|\s*friendship\s*[+-]?\d\s*\|\s*romance\s*[+-]?\d\s*\|.*$/gim;
    if (!verdictPart && VERDICT.test(entryPart)) {
        verdictPart = (entryPart.match(VERDICT) ?? []).join('\n');
        entryPart = entryPart.replace(VERDICT, '');
    }
    const text = clean(entryPart);
    if (!text)
        return { ok: false, changes: [] };
    diaryEntries(g)[day] = text;
    const changes = verdict && verdictPart ? applyVerdict(g, people, verdictPart) : [];
    saveGame();
    return { ok: true, changes };
}
/* ---------- translation: SillyTavern's Chat Translation, when it translates the replies ---------- */
// The entry is kept as written (the AI reads it); the player sees the translated copy, in the language of the chat.
const autoTranslate = () => { const t = ctx().extensionSettings?.translate; return t && (t.auto_mode === 'responses' || t.auto_mode === 'both') ? String(t.target_language ?? '') : ''; };
const trStore = (g) => (g.journalProseTr ??= {});
const trBusy = new Set();
const translateText = (text, lang) => translateTo(text, lang);
// The diary entry of a day as the player should read it (translated when Chat Translation is on).
export function diaryShown(g, day) {
    const src = diaryEntries(g)[day] ?? '';
    const lang = src && autoTranslate();
    if (!lang)
        return src;
    const t = trStore(g)[day];
    if (t && t.src === src && t.lang === lang)
        return t.text;
    const key = `${day}|${lang}`;
    if (!trBusy.has(key)) {
        trBusy.add(key);
        translateText(src, lang).then(out => { if (out.trim()) {
            trStore(g)[day] = { src, lang, text: out.trim() };
            saveGame();
            notify();
        } })
            .catch(e => console.warn('[Mundi] diary translation', e)).finally(() => setTimeout(() => trBusy.delete(key), 30000));
    }
    return src;
}
// For the AI: the last entries (the story remembers the past days through them).
export function diaryLines(g) {
    const e = diaryEntries(g);
    const days = Object.keys(e).map(Number).filter(d => d < g.day).sort((a, b) => a - b).slice(-2);
    if (!days.length)
        return [];
    const ago = (d) => (g.day - d === 1 ? 'yesterday' : `${g.day - d} days ago`);
    return [`Earlier days, from {{user}}'s diary. These days are over: today is day ${g.day}. Whatever an entry calls "today", "tonight" or "later" already happened on that day (for continuity; the other characters only know what they saw or were told): ${days.map(d => `(day ${d}, ${ago(d)}) ${e[d]}`).join(' ')}`];
}
