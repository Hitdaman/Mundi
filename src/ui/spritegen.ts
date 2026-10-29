// Sprites drawn on the player's ComfyUI for people who have none. When someone with no Expressions sprites is in
// the scene, Mundi (asking first, or by itself) has the AI write their look as Danbooru tags, fills a ComfyUI
// workflow with it and saves what comes back as their sprites: the first outfit in their Expressions folder, the
// others as outfit subfolders ("Bianca/swim"), which the outfit menu and the rooms' dress codes already use.
//
// The workflow is any API-format workflow saved in SillyTavern (user/workflows). Mundi finds its parts by their
// titles, so it can keep being edited in ComfyUI: "Appearance", "Outfit N (…)" (as "name: tags", gathered in a
// list node), the seed node ("… seed"), "Expression N: name" + "Save: name", "Output folder", and Any Switch
// nodes titled "… on/off" or "(on, else …)" (each an on/off option here: off takes the switch's first input away).
// Everything else (model, LoRAs, steps, detailers) stays in the workflow. Only the nodes the chosen sprites need
// are sent, so other parts of the workflow (a CG section, a base frame save) never run.
import { settings, saveSettings, notify, state, toast, esc, game } from '../core/store.js';
import { ctx, charOf, fetchSprites, uploadSprite, fullCharacter, setCharacterImage, quiet, expressionLabels } from '../st/bridge.js';
import { addOutfit, forgetOutfits } from './outfits.js';
import { icon } from './icons.js';
import { ACT, INPUT } from './reg.js';

type Mode = 'off' | 'ask' | 'auto';
interface Sheet { name: string; appearance: string; outfits: { name: string; tags: string }[]; seed: number; drawn?: number; avatarSet?: boolean }
interface Prefs { mode: Mode; workflow: string; url: string; outfits: string[] | null; expressions: string[] | null; off: string[]; avatar: boolean; sheets: Record<string, Sheet> }

export const sprPrefs = (): Prefs => {
    const s = settings() as any;
    const p = (s.sprites ??= {}) as Prefs;
    p.mode ??= 'ask'; p.workflow ??= 'Character.modular.workflow.json'; p.url ??= '';
    p.outfits ??= null; p.expressions ??= null; p.off ??= []; p.avatar ??= true; p.sheets ??= {};
    return p;
};

/* ---------- the ComfyUI server ---------- */

// The address set here, else Megumin Suite's (its default profile first), else SillyTavern's Image Generation.
export function comfyUrl(): string {
    const own = sprPrefs().url.trim();
    if (own) return own.replace(/\/+$/, '');
    const es = ctx().extensionSettings ?? {};
    const profiles = es['Megumin-Suite']?.profiles ?? {};
    const meg = profiles.default?.imageGen?.comfyUrl || Object.values(profiles).map((p: any) => p?.imageGen?.comfyUrl).find(Boolean);
    return String(meg || es.sd?.comfy_url || 'http://127.0.0.1:8188').replace(/\/+$/, '');
}
const stHeaders = () => ctx().getRequestHeaders();

/* ---------- the workflow ---------- */

type Graph = Record<string, { class_type: string; inputs: Record<string, any>; _meta?: { title?: string } }>;
const titleOf = (g: Graph, id: string) => String(g[id]?._meta?.title ?? '');
const isLink = (v: any) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string';

async function loadWorkflow(name = sprPrefs().workflow): Promise<Graph> {
    const res = await fetch('/api/sd/comfy/workflow', { method: 'POST', headers: stHeaders(), body: JSON.stringify({ file_name: name }) });
    if (!res.ok) throw new Error(`Could not load the workflow "${name}". Save it in SillyTavern's workflows (user/workflows).`);
    let w = await res.json();
    if (typeof w === 'string') w = JSON.parse(w);
    if (!w || typeof w !== 'object' || Array.isArray(w.nodes)) throw new Error(`"${name}" is not in ComfyUI's API format. In ComfyUI use Workflow → Export (API).`);
    return w as Graph;
}
export async function workflowList(): Promise<string[]> {
    try {
        const res = await fetch('/api/sd/comfy/workflows', { method: 'POST', headers: stHeaders(), body: JSON.stringify({ url: comfyUrl() }) });
        const l = res.ok ? await res.json() : [];
        return Array.isArray(l) ? l.map(String) : [];
    } catch { return []; }
}

// What a workflow offers, read from its titles.
interface Parts { appearance: string[]; outfits: { id: string; name: string; tags: string }[]; list: string | null; seed: string | null; expr: { name: string; save: string }[]; folder: string | null; switches: { id: string; name: string }[] }
const splitOutfit = (v: string) => { const m = String(v ?? '').match(/^\s*([^:\n]+?)\s*:\s*([\s\S]*)$/); return m ? { name: m[1], tags: m[2].trim() } : { name: '', tags: String(v ?? '').trim() }; };
function partsOf(g: Graph): Parts {
    const ids = Object.keys(g);
    const outfits = ids.filter(id => /^outfit\s*\d+/i.test(titleOf(g, id)) && typeof g[id].inputs?.value === 'string')
        .sort((a, b) => Number(titleOf(g, a).match(/\d+/)![0]) - Number(titleOf(g, b).match(/\d+/)![0]))
        .map(id => ({ id, ...splitOutfit(g[id].inputs.value) }))
        .map((o, k) => ({ ...o, name: o.name || (k ? `outfit${k + 1}` : 'default') }));
    const oset = new Set(outfits.map(o => o.id));
    const list = ids.find(id => Object.values(g[id].inputs ?? {}).some(v => isLink(v) && oset.has(v[0]))) ?? null;
    const saves = new Map(ids.filter(id => /^save:\s*/i.test(titleOf(g, id))).map(id => [titleOf(g, id).replace(/^save:\s*/i, '').trim().toLowerCase(), id]));
    const expr = ids.filter(id => /^expression\s*\d+\s*:/i.test(titleOf(g, id)))
        .sort((a, b) => Number(titleOf(g, a).match(/\d+/)![0]) - Number(titleOf(g, b).match(/\d+/)![0]))
        .map(id => titleOf(g, id).replace(/^expression\s*\d+\s*:\s*/i, '').trim())
        .filter(n => saves.has(n.toLowerCase())).map(n => ({ name: n, save: saves.get(n.toLowerCase())! }));
    return {
        appearance: ids.filter(id => /^appearance$/i.test(titleOf(g, id).trim()) && typeof g[id].inputs?.value === 'string'),
        outfits, list,
        seed: ids.find(id => /seed/i.test(titleOf(g, id)) && typeof g[id].inputs?.seed === 'number') ?? null,
        expr,
        folder: ids.find(id => /^output folder$/i.test(titleOf(g, id).trim())) ?? null,
        switches: ids.filter(id => /any switch/i.test(g[id].class_type) && /on\/off|\(on, else/i.test(titleOf(g, id)) && isLink(g[id].inputs?.any_01))
            .map(id => ({ id, name: titleOf(g, id).replace(/\s*\(.*$/, '').replace(/\s*on\/off.*$/i, '').trim() })),
    };
}
// SillyTavern's Expressions labels for the workflow's expression names.
const LABELS: Record<string, string> = { happy: 'joy', sad: 'sadness', angry: 'anger', surprised: 'surprise', embarrassed: 'embarrassment', aroused: 'desire', scared: 'fear', disgusted: 'disgust', confused: 'confusion', loving: 'love', proud: 'pride' };
const labelOf = (n: string) => { const k = n.toLowerCase(); return expressionLabels().includes(k) ? k : LABELS[k] ?? k; };

// Only what the chosen Save nodes need (following their inputs back), so nothing else in the workflow runs.
function prune(g: Graph, keep: string[]): Graph {
    const out: Graph = {}; const todo = [...keep];
    while (todo.length) {
        const id = todo.pop()!; if (out[id] || !g[id]) continue;
        out[id] = g[id];
        for (const v of Object.values(g[id].inputs ?? {})) if (isLink(v)) todo.push(v[0]);
    }
    return out;
}

// One ComfyUI job: one outfit, some expressions. Returns the graph and which Save node is which expression.
function job(base: Graph, p: Parts, sheet: Sheet, outfit: number, exprs: { name: string; save: string }[]) {
    const g = structuredClone(base);
    for (const id of p.appearance) g[id].inputs.value = sheet.appearance;
    if (p.seed) g[p.seed].inputs.seed = sheet.seed;
    const slot = p.outfits[0];
    const o = sheet.outfits[outfit];
    if (slot && o) {
        g[slot.id].inputs.value = `${o.name}: ${o.tags}`;
        if (p.list) { const l = g[p.list]; for (const k of Object.keys(l.inputs)) if (isLink(l.inputs[k])) delete l.inputs[k]; l.inputs.value1 = [slot.id, 0]; }
    }
    if (p.folder) { const f = g[p.folder].inputs; const key = Object.keys(f).find(k => typeof f[k] === 'string'); if (key) f[key] = `Mundi/${sheet.name.replace(/[^\p{L}\p{N}_-]+/gu, '_')}/`; }
    for (const s of p.switches) if (sprPrefs().off.includes(s.name)) delete g[s.id].inputs.any_01;
    return prune(g, exprs.map(e => e.save));
}

async function runJob(graph: Graph, onStep?: () => void): Promise<Record<string, Blob>> {
    const url = comfyUrl();
    const res = await fetch(`${url}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: `mundi-${Date.now()}` }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.prompt_id) {
        const why = Object.values(data.node_errors ?? {}).flatMap((n: any) => (n.errors ?? []).map((e: any) => `${n.class_type}: ${e.details || e.message}`))[0] || data.error?.message || res.statusText;
        throw new Error(`ComfyUI refused the workflow (${why}).`);
    }
    const until = Date.now() + 20 * 60_000;
    while (Date.now() < until) {
        await new Promise(r => setTimeout(r, 2000)); onStep?.();
        const h = await (await fetch(`${url}/history/${data.prompt_id}`)).json().catch(() => ({}));
        const run = h[data.prompt_id]; if (!run) continue;
        if (run.status?.status_str === 'error') throw new Error('ComfyUI stopped with an error (see its console).');
        const out: Record<string, Blob> = {};
        for (const [id, o] of Object.entries(run.outputs ?? {}) as [string, any][]) {
            const img = o.images?.[0]; if (!img) continue;
            const r = await fetch(`${url}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=${encodeURIComponent(img.type ?? 'output')}`);
            if (r.ok) out[id] = await r.blob();
        }
        return out;
    }
    throw new Error('ComfyUI took more than 20 minutes.');
}

/* ---------- the look, written by the AI ---------- */

async function writeSheet(avatar: string, p: Parts): Promise<Sheet> {
    const c = await fullCharacter(avatar);
    const name = String(c?.name ?? avatar);
    const card = [c?.description, c?.personality, c?.data?.extensions?.depth_prompt?.prompt].map(x => String(x ?? '').replace(/\{\{char\}\}/gi, name).trim()).filter(Boolean).join('\n\n').slice(0, 6000);
    const slots = p.outfits.length ? p.outfits : [{ name: 'default', tags: '' }];
    const prompt = `Write the look of ${name} as Danbooru tags for an image model (Illustrious).

<character>
${card || name}
</character>

Answer with exactly these lines and nothing else:
appearance: <the subject count tag first (1girl, 1boy…), then age, body, skin, face, eyes, hair: only what does not change with clothes>
${slots.map(o => `${o.name}: <what ${name} wears for "${o.name}"${o.tags ? `, in the spirit of: ${o.tags.split(',').slice(0, 8).join(',')}` : ''}>`).join('\n')}

Comma-separated tags only, no sentences. Take every detail the card gives; invent the rest so it fits the character.`;
    const raw = await quiet(prompt, 600);
    const lines = new Map(raw.split('\n').map(l => l.match(/^\s*[-*]?\s*([^:\n]+?)\s*:\s*(.+)$/)).filter(Boolean).map(m => [m![1].toLowerCase(), m![2].trim()]));
    const appearance = lines.get('appearance') ?? '';
    if (!appearance) throw new Error(`The AI did not describe ${name}.`);
    return { name, appearance, outfits: slots.map(o => ({ name: o.name, tags: lines.get(o.name.toLowerCase()) ?? o.tags })), seed: Math.floor(Math.random() * 2 ** 31) };
}

/* ---------- the queue ---------- */

// Session only: who is waiting, being drawn, done or skipped (a failure is not tried again until asked).
const S = { queue: [] as string[], busy: '', step: '', status: new Map<string, 'none' | 'has' | 'queued' | 'busy' | 'failed'>() };
export const spriteStatus = (avatar: string) => S.status.get(avatar);

async function hasSprites(avatar: string) {
    const known = S.status.get(avatar); if (known) return known !== 'none';
    S.status.set(avatar, 'has');   // while looking
    const has = (await fetchSprites(avatar, '')).length > 0;
    if (!S.status.has(avatar) || S.status.get(avatar) === 'has') S.status.set(avatar, has ? 'has' : 'none');
    return has;
}

// Called whenever the scene changes, with who is there.
export async function spritesFor(avatars: string[]) {
    const mode = sprPrefs().mode; if (mode === 'off') return;
    let fresh = false;
    for (const a of avatars) {
        if (a.startsWith('__tut:') || !charOf(a)) continue;
        const known = S.status.has(a);
        if (await hasSprites(a)) continue;
        if (mode === 'auto' && S.status.get(a) === 'none') enqueue(a);
        else if (!known) fresh = true;   // "Draw sprite" shows on them
    }
    if (fresh) notify();
}
export function enqueue(avatar: string, redo = false) {
    if (S.busy === avatar || S.queue.includes(avatar)) return;
    if (redo) delete sprPrefs().sheets[avatar]?.drawn;
    S.status.set(avatar, 'queued'); S.queue.push(avatar); notify();
    void pump();
}

async function pump() {
    if (S.busy) return;
    const avatar = S.queue.shift(); if (!avatar) return;
    S.busy = avatar; S.status.set(avatar, 'busy'); S.step = 'Writing the look'; notify();
    const name = String(charOf(avatar)?.name ?? '');
    try {
        await draw(avatar);
        S.status.set(avatar, 'has');
        toast(`${name}'s sprites are ready.`, 'success');
    } catch (e: any) {
        S.status.set(avatar, 'failed');
        toast(`Could not draw ${name}: ${String(e?.message ?? e)}`, 'error');
    } finally {
        S.busy = ''; S.step = ''; notify();
        void pump();
    }
}

async function draw(avatar: string) {
    const base = await loadWorkflow(); const p = partsOf(base);
    if (!p.expr.length) throw new Error('the workflow has no "Expression N: name" nodes with a matching "Save: name".');
    const prefs = sprPrefs();
    const sheet = prefs.sheets[avatar] ??= await writeSheet(avatar, p);
    saveSettings();
    const exprs = p.expr.filter(e => !prefs.expressions || prefs.expressions.includes(e.name));
    const outfits = sheet.outfits.map((o, i) => ({ o, i })).filter(({ o, i }) => i === 0 || !prefs.outfits || prefs.outfits.includes(o.name));
    const first = exprs.find(e => labelOf(e.name) === 'neutral') ?? exprs[0];
    // the first outfit's neutral sprite first, so they show up quickly; then the rest
    const jobs = [{ i: 0, ex: [first] }, { i: 0, ex: exprs.filter(e => e !== first) }, ...outfits.filter(x => x.i > 0).map(x => ({ i: x.i, ex: exprs }))].filter(j => j.ex.length);
    const total = jobs.reduce((n, j) => n + j.ex.length, 0); let done = 0;
    for (const j of jobs) {
        const o = sheet.outfits[j.i];
        const sub = j.i === 0 ? '' : o.name;
        S.step = `${done}/${total}${sub ? ` · ${sub}` : ''}`; notify();
        const imgs = await runJob(job(base, p, sheet, j.i, j.ex));
        for (const e of j.ex) {
            const b = imgs[e.save]; if (!b) continue;
            await uploadSprite(avatar, labelOf(e.name), b, labelOf(e.name), sub);
            done++;
        }
        if (sub) addOutfit(avatar, sub);
        delete (state.sprites as any)[avatar]; forgetOutfits(avatar);
        if (j.i === 0 && j === jobs[0]) await fixAvatar(avatar, imgs[first.save]);
        notify();
    }
    sheet.drawn = Date.now(); saveSettings();
}

// A person the world made (an example of the world, with an initials picture) gets a picture from the sprite.
async function fixAvatar(avatar: string, sprite?: Blob) {
    const c = charOf(avatar), sheet = sprPrefs().sheets[avatar];
    if (!sprite || !sheet || sheet.avatarSet || !sprPrefs().avatar || !c?.data?.extensions?.mundi?.example) return;
    const img = await createImageBitmap(sprite);
    const w = Math.round(img.width * 0.62), h = Math.min(img.height, Math.round(w * 1.5));
    const cv = document.createElement('canvas'); cv.width = 400; cv.height = 600;
    const g2 = cv.getContext('2d')!;
    g2.fillStyle = '#20232b'; g2.fillRect(0, 0, 400, 600);
    g2.drawImage(img, Math.round((img.width - w) / 2), 0, w, h, 0, 0, 400, 600);
    const png = await new Promise<Blob | null>(r => cv.toBlob(r, 'image/png'));
    if (!png) return;
    await setCharacterImage(avatar, png);
    sheet.avatarSet = true; saveSettings();
}

/* ---------- in the scene and the menu ---------- */

// On a person's figure in the scene, when they have no sprites: a button (ask first) or how far the drawing is.
export function spriteBadge(avatar: string): string {
    const st = S.status.get(avatar), mode = sprPrefs().mode;
    if (mode === 'off' || !st || st === 'has') return '';
    if (st === 'busy') return `<small class="mu-sprgen is-busy">${icon('image')}<span>Drawing… ${esc(S.step)}</span></small>`;
    if (st === 'queued') return `<small class="mu-sprgen is-busy">${icon('image')}<span>Waiting to be drawn</span></small>`;
    return `<button class="mu-sprgen" data-act="spr-draw" data-who="${esc(avatar)}" title="Draw their sprites on ComfyUI">${icon('image')}<span>${st === 'failed' ? 'Try drawing again' : 'Draw sprite'}</span></button>`;
}
// In the sprite's menu (left side, with the outfits).
export function spriteMenuButtons(avatar: string): string[] {
    if (sprPrefs().mode === 'off' || !charOf(avatar) || S.busy === avatar || S.queue.includes(avatar)) return [];
    return [`<button data-act="spr-redraw" data-who="${esc(avatar)}">🎨<span>Redraw sprites</span></button>`];
}

/* ---------- settings (Add-ons) ---------- */

const WF = { list: null as string[] | null, parts: null as Parts | null, for: '' };
function readWorkflow() {
    const name = sprPrefs().workflow;
    if (WF.for === name) return; WF.for = name; WF.parts = null;
    void loadWorkflow(name).then(g => { WF.parts = partsOf(g); }).catch(() => { WF.parts = null; }).finally(notify);
    if (!WF.list) void workflowList().then(l => { WF.list = l; notify(); });
}

export function spritesSettingsHtml(): string {
    const p = sprPrefs(); readWorkflow();
    const parts = WF.parts;
    const chk = (act: string, v: string, on: boolean, label: string) => `<label class="mu-check"><input type="checkbox" data-input="${act}" data-v="${esc(v)}" ${on ? 'checked' : ''}><span>${esc(label)}</span></label>`;
    const files = [...new Set([p.workflow, ...(WF.list ?? [])])];
    const sheets = Object.entries(p.sheets);
    return `<section><h3>Sprites</h3><p class="mu-muted">Draws Expressions sprites on your ComfyUI for people who have none, when they are in the scene. The model, LoRAs and quality settings are the workflow's own.</p>
        <label class="mu-field"><span>Draw sprites for people with none</span><select data-input="spr-mode">${([['off', 'Off'], ['ask', 'Ask first (a "Draw sprite" button on them)'], ['auto', 'Automatically']] as const).map(([v, l]) => `<option value="${v}" ${p.mode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="mu-field"><span>Workflow (API format, in SillyTavern's workflows)</span><select data-input="spr-wf">${files.map(f => `<option value="${esc(f)}" ${f === p.workflow ? 'selected' : ''} data-notr>${esc(f)}</option>`).join('')}</select></label>
        <label class="mu-field"><span>ComfyUI address · now ${esc(comfyUrl())}</span><input type="text" placeholder="Empty: Megumin Suite's, else Image Generation's" value="${esc(p.url)}" data-input="spr-url"></label>
        ${parts ? `<div class="mu-field"><span>Expressions</span>${parts.expr.map(e => chk('spr-expr', e.name, !p.expressions || p.expressions.includes(e.name), `${e.name} → ${labelOf(e.name)}`)).join('')}</div>
            ${parts.outfits.length > 1 ? `<div class="mu-field"><span>Outfits (the first is always drawn)</span>${parts.outfits.slice(1).map(o => chk('spr-outfits', o.name, !p.outfits || p.outfits.includes(o.name), o.name)).join('')}</div>` : ''}
            ${parts.switches.length ? `<div class="mu-field"><span>Workflow options</span>${parts.switches.map(s => chk('spr-switch', s.name, !p.off.includes(s.name), s.name)).join('')}</div>` : ''}`
            : `<p class="mu-muted">${WF.for ? 'Reading the workflow… (if this stays, the file is missing or not in API format)' : ''}</p>`}
        <label class="mu-check"><input type="checkbox" data-input="spr-avatar" ${p.avatar ? 'checked' : ''}><span>Give the world's people a card picture from their sprite<small>Only the people a world made (they start with an initials picture), once.</small></span></label>
        ${sheets.length ? `<h4>Looks written so far</h4>${sheets.map(([a, s]) => `<details class="mu-sprsheet"><summary data-notr>${esc(s.name)}${s.drawn ? '' : ' · not drawn yet'}</summary>
            <label class="mu-field"><span>Appearance</span><textarea rows="3" data-input="spr-sheet" data-who="${esc(a)}" data-k="appearance">${esc(s.appearance)}</textarea></label>
            ${s.outfits.map((o, i) => `<label class="mu-field"><span data-notr>${esc(o.name)}</span><textarea rows="2" data-input="spr-sheet" data-who="${esc(a)}" data-k="${i}">${esc(o.tags)}</textarea></label>`).join('')}
            <div class="mu-row"><button data-act="spr-redraw" data-who="${esc(a)}">Redraw (same face)</button><button class="mu-ghost" data-act="spr-newface" data-who="${esc(a)}">New face</button><button class="mu-ghost" data-act="spr-forget" data-who="${esc(a)}">Forget this look</button></div></details>`).join('')}` : ''}
    </section>`;
}

const toggle = (list: string[] | null, all: string[], v: string, on: boolean) => {
    const cur = new Set(list ?? all); if (on) cur.add(v); else cur.delete(v);
    return all.every(x => cur.has(x)) ? null : all.filter(x => cur.has(x));
};
Object.assign(ACT, {
    'spr-draw': (el) => { const a = el.dataset.who!; S.status.delete(a); enqueue(a); },
    'spr-redraw': (el) => enqueue(el.dataset.who!, true),
    'spr-newface': (el) => { const s = sprPrefs().sheets[el.dataset.who!]; if (s) { s.seed = Math.floor(Math.random() * 2 ** 31); saveSettings(); } enqueue(el.dataset.who!, true); },
    'spr-forget': (el) => { delete sprPrefs().sheets[el.dataset.who!]; saveSettings(); notify(); },
});
Object.assign(INPUT, {
    'spr-mode': (el) => { sprPrefs().mode = el.value as Mode; saveSettings(); notify(); const g = game(); if (g) void import('../sim/game.js').then(m => m.syncScene()); },
    'spr-wf': (el) => { sprPrefs().workflow = el.value; saveSettings(); notify(); },
    'spr-url': (el) => { sprPrefs().url = el.value.trim(); saveSettings(); },
    'spr-avatar': (el) => { sprPrefs().avatar = el.checked; saveSettings(); },
    'spr-expr': (el) => { const all = WF.parts?.expr.map(e => e.name) ?? []; sprPrefs().expressions = toggle(sprPrefs().expressions, all, el.dataset.v!, el.checked); saveSettings(); },
    'spr-outfits': (el) => { const all = WF.parts?.outfits.slice(1).map(o => o.name) ?? []; sprPrefs().outfits = toggle(sprPrefs().outfits, all, el.dataset.v!, el.checked); saveSettings(); },
    'spr-switch': (el) => { const p = sprPrefs(); p.off = el.checked ? p.off.filter(x => x !== el.dataset.v) : [...new Set([...p.off, el.dataset.v!])]; saveSettings(); },
    'spr-sheet': (el) => {
        const s = sprPrefs().sheets[el.dataset.who!]; if (!s) return;
        const k = el.dataset.k!;
        if (k === 'appearance') s.appearance = el.value.trim(); else if (s.outfits[Number(k)]) s.outfits[Number(k)].tags = el.value.trim();
        saveSettings();
    },
});
