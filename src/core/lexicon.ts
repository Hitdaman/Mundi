// The Lexicon: the same feature, named for each style. A phone message in Modern is a letter in Medieval; the
// mechanics are the same, only the words change. A world can rename any term (world.lexicon); a style without
// its own word falls back to Modern. Texts are in English and translated like the rest of the interface.
import { styleOf, type WorldDef } from './world.js';

export const LEXICON: Record<string, Record<string, string>> = {
    matchTitle: { modern: 'It\'s a match!', medieval: 'The matchmaker has news!' },
    profileAbout: { modern: 'About you', medieval: 'Tell the matchmaker about yourself' },
    jobApply: { modern: 'Apply', medieval: 'Ask for work' },
    balance: { modern: 'Balance', medieval: 'In your purse' },
    nextSuitor: { modern: 'Keep swiping', medieval: 'Hear of someone else' },
    like: { modern: 'Like', medieval: 'I would like to meet them' },
    matches: { modern: 'Matches', medieval: 'Introductions' },
    writeMessage: { modern: 'Message', medieval: 'Write a letter' },
    messagePlaceholder: { modern: 'Message', medieval: 'Write a letter…' },
    noMatches: { modern: 'No matches yet.', medieval: 'No introductions yet.' },
    noMovements: { modern: 'No movements yet.', medieval: 'Nothing in the ledger yet.' },
    noCandidates: { modern: 'No one new around. Come back another day.', medieval: 'The matchmaker knows no one else for now. Come back another day.' },
    openings: { modern: 'Openings', medieval: 'Work to be had' },
    pass: { modern: 'Pass', medieval: 'Not for me' },
    emptyThread: { modern: 'Say hi.', medieval: 'No letters yet. Write the first one.' },
    sendMessage: { modern: 'Send a message', medieval: 'Write a letter' },
    send: { modern: 'Send', medieval: 'Send the letter' },
    profileStart: { modern: 'Start', medieval: 'Hand it to the matchmaker' },
    statement: { modern: 'Statement', medieval: 'Ledger' },
    noContacts: { modern: 'You have no contacts yet. Meet people around the city.', medieval: 'No one to write to yet. Meet people around the kingdom.' },
    noJob: { modern: 'You have no job. Pick one below; you work at its place, on the map.', medieval: 'You have no trade. Pick one below; you work at its place, on the map.' },
    yourJob: { modern: 'Your job', medieval: 'Your trade' },
    yourProfile: { modern: 'Your profile', medieval: 'Your entry' },
    typing: { modern: 'typing…', medieval: 'writing back…' },
    newMessage: { modern: 'New message from {0}.', medieval: 'The courier brought you a letter from {0}.' },
    device: { modern: 'Phone', medieval: 'Journal' },
    journal: { modern: 'Journal', medieval: 'Chronicle' },
    journalEmpty: { modern: 'Nothing written yet. What you live is noted here by itself.', medieval: 'Nothing written yet. What you live is noted here by itself.' },
    readAsProse: { modern: 'Read it as a diary', medieval: 'Read it as a chronicle' },
};
export type LexKey = keyof typeof LEXICON;
export function lex(w: WorldDef | null | undefined, key: string, ...args: string[]): string {
    const own = (w as any)?.lexicon?.[key];
    const row = LEXICON[key];
    const s = String(own ?? row?.[styleOf(w)] ?? row?.modern ?? key);
    return s.replace(/\{(\d)\}/g, (_, n) => args[Number(n)] ?? '');
}
