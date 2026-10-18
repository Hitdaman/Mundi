// The tour, with Stella. Three parts (the menu, a scene, the world) that can be seen together or one by one
// (Settings → Game). No AI and nothing written to SillyTavern: the scene and the world are a practice world kept in
// memory, with Stella's lines written in advance. The step's element is lit, the rest is dimmed; some steps ask you
// to do the thing (send a line, drink something, travel), and the tour goes on when you do.
import { state, notify, settings, saveSettings, TUT, game, toast, nowAbs, esc, uiZoom, onPhone } from '../core/store.js';
import { getWorld } from '../core/world.js';
import { personaName, personaThumb } from '../st/bridge.js';
import { resident } from '../sim/game.js';
import { social } from '../sim/social.js';
import { advance } from '../sim/time.js';
import { travelMinutes, playerHomeId } from '../sim/places.js';
import { actionsHere, applyAction } from '../sim/needs.js';
import { ACT } from './reg.js';
import { icon } from './icons.js';
const STELLA = '__tut:stella';
const pic = (f) => new URL(`../../assets/tutorial/${f}`, import.meta.url).href;
// on a phone you tap, you don't click
const touch = (t) => (onPhone() ? t.replace(/\bClick\b/g, 'Tap').replace(/\bclick\b/g, 'tap').replace(', Ctrl-tap to grab a bunch', '') : t);
/* ---------- the practice world ---------- */
const W = () => getWorld('modern');
function practiceSave(w) {
    const home = { zone: w.homes.zones[0].id, x: w.homes.zones[0].spots[0][0], y: w.homes.zones[0].spots[0][1], n: 1, kind: w.homes.zones[0].kind };
    const g = {
        v: 1, world: w.id, lang: 'en', day: 1, minutes: 10 * 60, speed: 0,
        player: { loc: 'cafe', home, stats: Object.fromEntries(w.statuses.map(s => [s.id, s.id === 'thirst' ? 45 : s.start])), money: 2000, traits: {}, origin: 'newcomer', job: null, rentPaidDay: 1 },
        cast: {}, tick: {}, log: [],
    };
    const r = resident(w, STELLA, new Set());
    g.cast[STELLA] = { ...r, name: 'Stella', occupation: 'barista', met: true };
    social(g).bond[STELLA] = 35;
    social(g).with.push({ avatar: STELLA, until: 99999 }); // she stays with you for the whole tour
    return g;
}
const line = (mes, user = false) => (user
    ? { name: personaName(), is_user: true, is_system: false, mes, force_avatar: personaThumb(), extra: {} }
    : { name: 'Stella', is_user: false, is_system: false, mes, original_avatar: STELLA, extra: {} });
const lines = () => (globalThis.__mundiTutChat ??= []);
function enterWorld() {
    if (TUT.save)
        return;
    TUT.save = practiceSave(W());
    globalThis.__mundiTutPersona = { name: 'Seraphina', pic: pic('seraphina-face.png') };
    globalThis.__mundiTutChat = [line('*leans on the café counter and gives you a lazy two-finger wave.* Yo. You must be the new one. I\'m Stella. Relax, this is just practice: nothing here counts.')];
    state.view = 'scene';
}
function leaveWorld() {
    TUT.save = null;
    delete globalThis.__mundiTutChat;
    delete globalThis.__mundiTutPersona;
    state.view = 'menu';
}
/* ---------- the steps ---------- */
const flags = { sent: 0, drank: false, traveled: false };
const STEPS = [
    // the menu
    { part: 'menu', setup: () => { leaveWorld(); state.view = 'menu'; state.menuTab = 'main'; }, text: 'Yo! I\'m Stella. I\'ll show you the ropes around here. Won\'t take long, promise.', wide: true },
    { part: 'menu', target: '[data-act="menu-continue"]', text: 'Continue drops you right back into whatever you played last. Easy.' },
    { part: 'menu', target: '[data-act="menu-new"]', text: 'New game starts a whole life in a world. Modern city, medieval kingdom… same game, different outfit.' },
    { part: 'menu', target: '[data-act="menu-view"][data-v="load"]', text: 'Load has all your saves. Star the good ones, Ctrl-click to grab a bunch.' },
    { part: 'menu', target: '[data-act="menu-library"]', text: 'Library: your SillyTavern characters, personas and lorebooks, all in one spot.' },
    { part: 'menu', target: '[data-act="menu-gallery"]', text: 'Gallery. Every picture of everyone. Yeah, mine too.' },
    { part: 'menu', target: '[data-act="menu-settings"]', text: 'Settings: colors, fonts, sounds… and this tour, if you ever get lost. No shame in it.' },
    // a scene
    { part: 'scene', setup: () => enterWorld(), text: 'Okay, this is a scene. You talk, the AI writes the story. Today it\'s just me, so no AI needed.', wide: true },
    { part: 'scene', target: '.mu-log', text: 'Whatever we say lands here.' },
    { part: 'scene', target: '.mh-modes', text: 'Say is talking. Do is doing stuff. Story pushes the plot where you want. See is for looking around.' },
    { part: 'scene', target: '.mu-composer', task: 'Type something to me and hit Send.', text: 'Your turn. Say something. Anything. I don\'t bite.', done: () => flags.sent > 0 },
    { part: 'scene', target: '.mu-composer-tools', text: 'These guys: keep my line going, get me to say something else, or let the AI write yours when you\'re out of ideas.' },
    { part: 'scene', target: '.mu-composer textarea', text: 'Pro tip: type @ and pick a name. Then only that person answers. No more randoms butting in.' },
    { part: 'scene', target: '[data-act="hud-menu"]', text: 'The menu up here has Chat look: layouts, colors, presets. Make it look how you like.' },
    // the world
    { part: 'world', setup: () => enterWorld(), target: '.mh-persona', text: 'That\'s you. Energy, hunger, thirst, mood, hygiene, and your cash. Keep \'em up or you\'ll feel it.' },
    { part: 'world', target: '.mh-clock', text: 'The clock only moves when you do something. Talking\'s free, so chat all you want.' },
    { part: 'world', target: '.mh-acts', task: 'Drink something in "Things to do".', phoneTask: 'Tap "Things to do" to open it, then pick a drink.', text: 'You look thirsty. Grab a drink from Things to do. Watch the clock.', done: () => flags.drank },
    { part: 'world', target: '.mh-here', task: 'Click my face.', text: '"Here" shows who\'s around. Click my face.', done: () => !!document.querySelector('#mundi-root .mu-pcard') },
    { part: 'world', target: '.mu-pcard', text: 'My card. Friendship and romance bars fill up as we hang out. Plans, invites, all that, it\'s here.', wide: true },
    { part: 'world', setup: () => { document.querySelector('#mundi-root [data-act="pc-close"]')?.click(); }, target: '[data-act="phone"]', task: 'Open your phone.', text: 'Your phone. Open it.', done: () => !!document.querySelector('#mundi-root .mu-phone') },
    { part: 'world', target: '.mu-phone', text: 'Messages, People, Jobs, Calendar, your Profile, Homes for the bills… and Help, if you forget stuff.' },
    { part: 'world', setup: () => { document.querySelector('#mundi-root [data-act="ph-close"]')?.click(); }, target: '[data-act="to-map"]', task: 'Open the map.', text: 'Now the map. Go on.', done: () => state.view === 'map' },
    { part: 'world', target: '.mu-map', task: 'Click a place to go there.', text: 'Pick a place and go. Travel eats time, so plan ahead. I\'ll tag along.', done: () => flags.traveled },
    { part: 'world', target: '.mh-face', text: 'Click your photo anytime to play as someone else in your world. Wild, right?' },
    { part: 'world', target: '[data-act="hud-menu"]', text: 'And "This world" in this menu: people, homes, families, difficulty. Change anything you want.' },
    { part: 'world', text: 'That\'s it, rookie. Go make your own story. I\'ll be around.', wide: true },
];
/* ---------- running it ---------- */
const T = { on: false, i: 0, from: 0, to: STEPS.length - 1 };
const patched = {};
export const tutorialOn = () => T.on;
// The step being shown (the menu draws a pretend "Continue" when there is nothing to continue yet).
export const tutorialTarget = () => (T.on ? STEPS[T.i].target ?? '' : '');
export function startTutorial(part = 'all') {
    const idx = STEPS.map((s, i) => [s, i]).filter(([s]) => part === 'all' || s.part === part).map(([, i]) => i);
    T.on = true;
    T.from = idx[0];
    T.to = idx[idx.length - 1];
    T.i = T.from;
    Object.assign(flags, { sent: 0, drank: false, traveled: false });
    if (part !== 'menu' && part !== 'all')
        enterWorld();
    patch();
    STEPS[T.i].setup?.();
    notify();
}
function endTutorial() {
    T.on = false;
    unpatch();
    leaveWorld();
    settings().tourSeen = true;
    saveSettings();
    notify();
}
function go(d) {
    const n = T.i + d;
    if (n > T.to) {
        endTutorial();
        toast('Tour done. Have fun!', 'success');
        return;
    }
    if (n < T.from)
        return;
    T.i = n;
    STEPS[T.i].setup?.();
    notify();
}
// Steps that wait for you move on by themselves once you did it.
export function tutorialTick() {
    if (!T.on)
        return;
    const s = STEPS[T.i];
    if (s.done?.())
        setTimeout(() => { if (T.on && STEPS[T.i] === s)
            go(1); }, 700);
}
// What the practice world does instead of calling the AI or SillyTavern.
function patch() {
    const mine = {
        send: () => {
            const text = state.composer.trim();
            if (!text)
                return;
            lines().push(line(text, true));
            state.composer = '';
            flags.sent++;
            notify();
            setTimeout(() => { lines().push(line(flags.sent > 1 ? '*grins* Ha. You\'re getting the hang of it.' : '*snorts* See? That\'s all there is to it. In a real game the AI answers here, and you can swipe for a different reply if you don\'t like it.')); notify(); tutorialTick(); }, 700);
        },
        do: (el) => {
            const g = game();
            const w = g && getWorld(g.world);
            if (!g || !w)
                return;
            const a = actionsHere(g, w).find(x => x.id === el.dataset.id);
            if (!a)
                return;
            applyAction(g, w, a);
            advance(g, w, a.minutes);
            toast(`${a.name}: done. ${a.minutes} minutes went by.`, 'success');
            if (Object.keys(a.effects ?? {}).includes('thirst'))
                flags.drank = true;
            notify();
        },
        pin: (el) => travel(el.dataset.loc), go: (el) => travel(el.dataset.loc), travel: (el) => travel(el.dataset.loc),
        'ph-send': () => toast('In the tour, Stella is busy. Texting works in a real game.', 'info'),
        continue: () => toast('In a real game, this makes them keep talking.', 'info'),
        regenerate: () => toast('In a real game, this gives you a different reply.', 'info'),
        impersonate: () => toast('In a real game, the AI writes your line here.', 'info'),
        'to-menu': () => endTutorial(), exit: () => endTutorial(),
    };
    for (const [k, f] of Object.entries(mine)) {
        patched[k] = ACT[k];
        ACT[k] = f;
    }
}
function unpatch() { for (const [k, f] of Object.entries(patched)) {
    if (f)
        ACT[k] = f;
    else
        delete ACT[k];
    delete patched[k];
} }
function travel(loc) {
    const g = game();
    const w = g && getWorld(g.world);
    if (!g || !w || !loc)
        return;
    if (loc === g.player.loc) {
        state.view = 'scene';
        notify();
        return;
    }
    const mins = travelMinutes(g, w, g.player.loc, loc);
    advance(g, w, mins);
    g.player.loc = loc;
    lines().push(line(loc === playerHomeId ? '*looks around your place* Not bad. Could use a plant or two.' : `*catches up, hands in her pockets* ${mins} minutes. Told you travel eats time.`));
    flags.traveled = true;
    state.view = 'scene';
    void nowAbs;
    notify();
}
/* ---------- on screen ---------- */
// The welcome window, the first time Mundi opens.
export function welcomeHtml() {
    if (T.on || settings().tourSeen || state.view !== 'menu')
        return '';
    return `<div class="mu-recap-veil mu-tut-veil"><section class="mu-recap mh-glass mu-tut-welcome" role="dialog">
        <img class="mu-tut-welcome-pic" src="${pic('stella.png')}" alt="">
        <div><small>Welcome to Mundi</small><h3>New around here?</h3>
            <p>I'm Stella. Want the quick tour? About five minutes, and no AI connection needed.</p>
            <div class="mu-row"><button class="mu-primary" data-act="tut-start" data-v="all">${icon('forward')}<span>Take the tour</span></button><button class="mu-ghost" data-act="tut-skip">Skip</button></div>
            <small class="mu-muted">You can take it later in Settings → Game.</small></div></section></div>`;
}
export function tutorialHtml() {
    if (!T.on)
        return welcomeHtml();
    const s = STEPS[T.i];
    const n = T.i - T.from + 1, of = T.to - T.from + 1;
    return `<div class="mu-tut ${s.target ? 'has-target' : ''} ${s.task ? 'is-task' : ''}" data-tut-target="${esc(s.target ?? '')}">
        <i class="mu-tut-shade is-t"></i><i class="mu-tut-shade is-l"></i><i class="mu-tut-shade is-r"></i><i class="mu-tut-shade is-b"></i>
        ${s.target ? `<i class="mu-tut-ring"></i>${s.task ? '' : '<i class="mu-tut-block"></i>'}` : '<i class="mu-tut-shade is-all"></i>'}
        <aside class="mu-tut-box mh-glass ${s.wide ? 'is-wide' : ''}">
            <img src="${pic('stella.png')}" alt="Stella">
            <div class="mu-tut-talk"><b>Stella</b><p>${touch(s.text)}</p>${s.task ? `<p class="mu-tut-task">${icon('pin')} ${touch(onPhone() && s.phoneTask || s.task)}</p>` : ''}
                <div class="mu-tut-btns"><small>${n} / ${of}</small>
                    <button class="mu-ghost" data-act="tut-skip">Skip tour</button>
                    ${T.i > T.from ? `<button data-act="tut-back">${icon('back')}</button>` : ''}
                    ${s.task ? '' : `<button class="mu-primary" data-act="tut-next">${T.i === T.to ? 'Finish' : 'Next'}</button>`}</div></div>
        </aside></div>`;
}
// After drawing: the lit hole goes around the step's element.
export function placeTutorial(main) {
    const el = main.querySelector('.mu-tut');
    if (!el)
        return;
    const sel = el.dataset.tutTarget;
    const t = sel ? document.querySelector(`#mundi-root ${sel}`) : null;
    const r = t?.getBoundingClientRect();
    const pad = 6;
    if (!r || !r.width) {
        el.classList.remove('has-target');
        el.style.removeProperty('--x');
        return;
    }
    el.classList.add('has-target');
    const z = uiZoom(), m = document.getElementById('mundi-main').getBoundingClientRect();
    el.style.setProperty('--x', `${Math.max(0, (r.left - m.left) / z - pad)}px`);
    el.style.setProperty('--y', `${Math.max(0, (r.top - m.top) / z - pad)}px`);
    el.style.setProperty('--w', `${r.width / z + pad * 2}px`);
    el.style.setProperty('--h', `${r.height / z + pad * 2}px`);
    // Stella stays away from what she shows
    el.classList.toggle('box-top', r.top + r.height / 2 > window.innerHeight * 0.55);
    el.classList.toggle('box-left', r.left + r.width / 2 > window.innerWidth * 0.5);
}
Object.assign(ACT, {
    'tut-start': (el) => startTutorial(el.dataset.v || 'all'),
    'tut-next': () => go(1),
    'tut-back': () => go(-1),
    'tut-skip': () => { if (T.on)
        endTutorial();
    else {
        settings().tourSeen = true;
        saveSettings();
        notify();
    } },
});
// Settings → Game: the tour again, whole or one part.
export function tutorialSettingsHtml() {
    return `<section class="mu-tut-settings"><h3>Tutorial</h3><p class="mu-muted">Stella's tour, again. No AI needed and nothing is saved.</p>
        <div class="mu-row"><button class="mu-primary" data-act="tut-start" data-v="all">${icon('forward')}<span>The whole tour</span></button>
            <button data-act="tut-start" data-v="menu">Menu</button><button data-act="tut-start" data-v="scene">Scene</button><button data-act="tut-start" data-v="world">World</button></div></section>`;
}
