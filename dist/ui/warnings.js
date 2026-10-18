// Setup problems that hurt long games, shown as a red banner at the top of Settings and This world:
// SillyTavern's context size left unlocked, the Summarize extension running beside Mundi's own memory, and the
// TTS "no voice" notices turned back on.
import { esc } from '../core/store.js';
import { ctx } from '../st/bridge.js';
import { ttsQuiet } from './addons.js';
import { icon } from './icons.js';
export function setupWarnings() {
    const c = ctx();
    const out = [];
    const max = Number(c.chatCompletionSettings?.openai_max_context ?? 0);
    if (c.mainApi === 'openai' && max > 262144)
        out.push(`SillyTavern's Context Size is unlocked (${max.toLocaleString('en-US')} tokens): the whole chat is sent and long scenes stop fitting your model. Set it to your model's real context in AI Response Configuration.`);
    const ext = c.extensionSettings ?? {};
    const mem = ext.memory ?? {};
    const off = ext.disabledExtensions ?? [];
    if (!off.includes('memory') && !mem.memoryFrozen && mem.source !== 'extras' && (Number(mem.promptInterval) > 0 || Number(mem.promptForceWords) > 0))
        out.push('SillyTavern\'s Summarize extension is on: it sends the whole prompt again every few messages (about a third of all AI calls). Mundi already keeps memory with facts and the diary: pause it in Extensions → Summarize.');
    if (ext.tts && !ttsQuiet())
        out.push('TTS notices about characters without a voice are on: loading a game with many characters shows one for each of them. Turn them off in Add-ons → Text to speech.');
    return out;
}
export function warningsBanner() {
    const list = setupWarnings();
    if (!list.length)
        return '';
    return `<div class="mu-warnbar" role="alert">${icon('bolt')}<div><b>${list.length === 1 ? 'Something to fix for long games' : `${list.length} things to fix for long games`}</b>
        <ul>${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div>`;
}
