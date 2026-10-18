// A short "doing it" moment for quick actions (eat, drink, run…): the action's icon, a bar filling up and the time
// it takes, so you feel the clock move before the result shows. Purely visual.
import { esc, notify } from '../core/store.js';
const D = { label: '', icon: '', mins: 0, ms: 0, on: false };
export const isDoing = () => D.on;
export async function doing(label, iconHtml, mins) {
    const ms = Math.round(900 + Math.min(mins, 120) * 6);
    Object.assign(D, { label, icon: iconHtml, mins, ms, on: true });
    notify();
    await new Promise(r => setTimeout(r, ms));
    D.on = false;
    notify();
}
export function doingHtml() {
    if (!D.on)
        return '';
    return `<div class="mh-doing mh-glass" role="status" style="--ms:${D.ms}ms"><i>${D.icon}</i><b>${esc(D.label)}…</b>
        <span class="mh-doing-bar"><em></em></span><small>+${D.mins} min</small></div>`;
}
