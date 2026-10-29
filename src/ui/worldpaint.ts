// Paint a world with ComfyUI: maps, place backgrounds and the cover, on the player's own ComfyUI.
// A map is laid out first and painted over: Mundi draws a plan where the pins already are (district zones, roads
// between places, a building at each pin, water if the world has a coast or a river), ComfyUI paints over it
// (img2img), so every pin sits on a street or a building and the names stay Mundi's own labels. Backgrounds and
// the cover are plain pictures from a prompt. Each finished picture is saved into the world straight away.
//
// The workflow is any SillyTavern ComfyUI workflow with the usual placeholders (%prompt%, %seed%, %width%…), the
// same Megumin Suite and Image Generation use: for a map Mundi turns it into img2img by itself (its empty latent
// becomes the uploaded plan, encoded). Model, sampler, steps and negative prompt come from Megumin Suite.
import { notify, esc, toast, settings, saveSettings } from '../core/store.js';
import { type WorldDef, type MapDef, type Place } from '../core/world.js';
import { ctx, quiet } from '../st/bridge.js';
import { saveWorld, uploadWorldPicture } from '../sim/creator.js';
import { comfyUrl, loadWorkflow, runJob, workflowList } from './spritegen.js';
import { CW } from './creator.js';
import { icon } from './icons.js';
import { ACT, INPUT } from './reg.js';

type Graph = Record<string, { class_type: string; inputs: Record<string, any>; _meta?: { title?: string } }>;
type Kind = 'map' | 'bg' | 'cover';
interface Item { kind: Kind; id: string; name: string; state: 'wait' | 'busy' | 'done' | 'failed'; why?: string }
interface Prefs { workflow: string; strength: number; loras: boolean; maps: boolean; bgs: boolean; cover: boolean; redo: boolean }

export const WP = { open: false, busy: false, stop: false, items: [] as Item[], flows: [] as string[], last: '' };
const prefs = (): Prefs => {
    const p = ((settings() as any).worldPaint ??= {}) as Prefs;
    p.workflow ??= meg().currentWorkflowName || 'Default_Comfy_Workflow.json';
    p.strength ??= 0.6; p.loras ??= false; p.maps ??= true; p.bgs ??= true; p.cover ??= true; p.redo ??= false;
    return p;
};
// Megumin Suite's image settings (its default profile), else nothing: the workflow's own values stay.
const meg = (): any => { const es = ctx().extensionSettings ?? {}; const pr = es['Megumin-Suite']?.profiles ?? {}; return pr.default?.imageGen ?? Object.values(pr).map((x: any) => x?.imageGen).find(Boolean) ?? {}; };

/* ---------- what there is to paint ---------- */

const isPainted = (f?: string) => !!f && !f.startsWith('data:');
function todo(w: WorldDef, p: Prefs): Item[] {
    const out: Item[] = [];
    if (p.cover && (p.redo || !isPainted(w.cover))) out.push({ kind: 'cover', id: '', name: 'Cover', state: 'wait' });
    if (p.maps) for (const m of w.maps) if (p.redo || !isPainted(m.image)) out.push({ kind: 'map', id: m.id, name: `Map: ${m.name}`, state: 'wait' });
    if (p.bgs) for (const pl of w.places) if (!pl.link && (p.redo || !pl.bg)) out.push({ kind: 'bg', id: pl.id, name: pl.name, state: 'wait' });
    return out;
}

/* ---------- the plan drawn under a map ---------- */

const W_PX = 1344, H_PX = 832;
const WATER = /\b(sea|ocean|coast|coastal|beach|harbou?r|port|bay|river|lake|canal|docks?|pier|shore|island)\b/i;
const RURAL = /\b(kingdom|realm|region|province|country|lands?|wilds?|valley|island|continent|empire)\b/i;
const GREEN = /\b(park|garden|forest|woods?|field|farm|meadow|grove|cemetery|camp)\b/i;
const indoor = (m: MapDef) => (m.trip ?? 99) <= 5;
function rng(seed: string) { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }

export async function drawPlan(w: WorldDef, m: MapDef): Promise<Blob> {
    const c = document.createElement('canvas'); c.width = W_PX; c.height = H_PX;
    const g = c.getContext('2d')!;
    const r = rng(m.id);
    const pins = w.places.filter(p => p.map === m.id);
    const px = (p: Place) => [(p.x / 100) * W_PX, (p.y / 100) * H_PX] as const;
    if (indoor(m)) {
        // a floor plan: a floor, walls round a room at each pin, corridors between them
        g.fillStyle = '#d9cbb2'; g.fillRect(0, 0, W_PX, H_PX);
        g.fillStyle = '#bfae90'; g.fillRect(40, 40, W_PX - 80, H_PX - 80);
        g.strokeStyle = '#efe6d4'; g.lineWidth = 46; g.lineCap = 'round';
        road(g, pins.map(px));
        for (const p of pins) { const [x, y] = px(p); const ww = 170 + r() * 60, hh = 120 + r() * 50; g.fillStyle = '#e8dcc4'; g.fillRect(x - ww / 2, y - hh / 2, ww, hh); g.strokeStyle = '#5a4a36'; g.lineWidth = 8; g.strokeRect(x - ww / 2, y - hh / 2, ww, hh); }
        return blob(c);
    }
    const lots = pins.filter(p => !p.link), links = pins.filter(p => p.link);
    const country = !m.parent && (RURAL.test(`${m.name} ${m.area ?? ''}`) || (!lots.length && links.length > 1 && w.style === 'medieval'));
    g.fillStyle = country ? '#b3c08f' : '#cbc4b4'; g.fillRect(0, 0, W_PX, H_PX);
    // water: a coast along one edge, or a river across
    const text = `${m.name} ${m.area ?? ''} ${pins.map(p => `${p.name} ${p.desc ?? ''}`).join(' ')} ${m.parent ? '' : w.setting}`;
    let water: ((x: number, y: number) => boolean) = () => false;
    if (WATER.test(text)) {
        g.fillStyle = '#6f9fbf'; g.strokeStyle = '#6f9fbf';
        if (/\b(river|canal)\b/i.test(text)) {
            const y0 = H_PX * (0.3 + r() * 0.4), y1 = H_PX * (0.3 + r() * 0.4);
            g.lineWidth = 70; g.beginPath(); g.moveTo(0, y0); g.bezierCurveTo(W_PX * 0.35, H_PX * r(), W_PX * 0.65, H_PX * r(), W_PX, y1); g.stroke();
            water = (x, y) => g.getImageData(x, y, 1, 1).data[2] > 180;
        } else {
            g.beginPath(); g.moveTo(0, H_PX); for (let x = 0; x <= W_PX; x += 64) g.lineTo(x, H_PX * 0.88 - Math.sin(x / 140) * 26); g.lineTo(W_PX, H_PX); g.fill();
            water = (_x, y) => y > H_PX * 0.84;
        }
    }
    const near = (x: number, y: number, d: number) => pins.some(p => { const [a, b] = px(p); return Math.hypot(a - x, b - y) < d; });
    if (country) {
        // countryside: fields and woods, a cluster of roofs for each town
        for (let k = 0; k < 40; k++) { const x = r() * W_PX, y = r() * H_PX; if (water(x, y) || near(x, y, 90)) continue; g.fillStyle = r() < 0.5 ? '#5f8a4a' : '#c9c27d'; g.beginPath(); g.ellipse(x, y, 30 + r() * 70, 20 + r() * 40, r() * 3, 0, Math.PI * 2); g.fill(); }
    } else {
        // a town: a street grid filled with blocks of houses, a few parks; each district its own roof colour
        const step = 64, hue = (x: number, y: number) => { let best = 0, d = 1e9; links.forEach((p, i) => { const [a, b] = px(p); const e = Math.hypot(a - x, b - y); if (e < d) { d = e; best = i + 1; } }); return best; };
        const roofs = ['#9a6b55', '#7d7268', '#62758a', '#8f7f62', '#7a5d6e', '#6e7f5c'];
        for (let y = 8; y < H_PX; y += step) for (let x = 8; x < W_PX; x += step) {
            if (water(x + 24, y + 24)) continue;
            if (r() < 0.07) { g.fillStyle = '#7fa262'; g.fillRect(x, y, step - 12, step - 12); continue; }
            g.fillStyle = '#a49c90'; g.fillRect(x, y, step - 12, step - 12);
            g.fillStyle = roofs[hue(x, y) % roofs.length];
            for (let k = 0; k < 4; k++) g.fillRect(x + 3 + (k % 2) * 26, y + 3 + Math.floor(k / 2) * 26, 20 + r() * 4, 18 + r() * 5);
        }
    }
    // main roads between the places, then a landmark at each place (a square and a big building, or a park)
    g.lineCap = 'round';
    g.strokeStyle = '#7d7a74'; g.lineWidth = country ? 16 : 30; road(g, pins.map(px));
    g.strokeStyle = country ? '#d8c79a' : '#ebe7de'; g.lineWidth = country ? 9 : 20; road(g, pins.map(px));
    for (const p of pins) {
        const [x, y] = px(p);
        if (p.link) { if (country) for (let k = 0; k < 14; k++) { g.fillStyle = ['#9a5b45', '#7d7268', '#8a7a62'][k % 3]; g.fillRect(x - 60 + r() * 120, y - 40 + r() * 80, 16 + r() * 12, 14 + r() * 10); } continue; }
        if (GREEN.test(`${p.id} ${p.name}`)) { g.fillStyle = '#5f8f48'; g.beginPath(); g.ellipse(x, y, 80, 60, 0, 0, Math.PI * 2); g.fill(); continue; }
        g.fillStyle = '#e4dccb'; g.fillRect(x - 70, y - 55, 140, 110);
        g.fillStyle = ['#a0523c', '#5c6f84', '#7a6a5a', '#6d5a7d'][Math.floor(r() * 4)]; g.fillRect(x - 46, y - 36, 92, 64);
        g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x - 46, y + 28, 92, 8);
    }
    return blob(c);
}
// Roads: every place joined to its nearest neighbours (a spanning tree), so the plan reads as one street net.
function road(g: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[]) {
    if (pts.length < 2) return;
    const inTree = [0], d = (a: number, b: number) => Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]);
    while (inTree.length < pts.length) {
        let best: [number, number] | null = null;
        for (const a of inTree) for (let b = 0; b < pts.length; b++) if (!inTree.includes(b) && (!best || d(a, b) < d(best[0], best[1]))) best = [a, b];
        const [a, b] = best!; inTree.push(b);
        g.beginPath(); g.moveTo(pts[a][0], pts[a][1]); g.lineTo(pts[a][0], pts[b][1]); g.lineTo(pts[b][0], pts[b][1]); g.stroke();
    }
}
const blob = (c: HTMLCanvasElement) => new Promise<Blob>((ok, bad) => c.toBlob(b => (b ? ok(b) : bad(new Error('Could not draw the plan.'))), 'image/png'));

/* ---------- ComfyUI ---------- */

// The workflow's placeholders, filled the way Megumin Suite and Image Generation fill them.
function fill(g: Graph, v: { prompt: string; width: number; height: number }): Graph {
    const s = meg(), p = prefs();
    const loras = (n: number) => (p.loras ? s[`selectedLora${n === 1 ? '' : n}`] : '') || 'None';
    const triggers = p.loras ? [1, 2, 3, 4].filter(n => loras(n) !== 'None').map(n => s[`loraTrigger${n}`]).filter(Boolean) : [];
    const vals: Record<string, any> = {
        '%prompt%': [...triggers, s.promptPrefix, v.prompt].map(x => String(x).trim().replace(/,$/, '')).filter(Boolean).join(', '), '%negative_prompt%': [s.customNegative, 'text, letters, watermark, signature, people, person'].filter(Boolean).join(', '),
        '%seed%': Math.floor(Math.random() * 1e9), '%sampler%': s.selectedSampler || 'euler', '%model%': s.selectedModel || undefined, '%steps%': Number(s.steps) || 25,
        '%scale%': Number(s.cfg) || 6, '%denoise%': 1, '%clip_skip%': -Math.abs(Number(s.clipSkip) || 2), '%width%': v.width, '%height%': v.height,
        '%lora1%': loras(1), '%lora2%': loras(2), '%lora3%': loras(3), '%lora4%': loras(4),
        '%lorawt1%': p.loras ? Number(s.selectedLoraWt) || 1 : 0, '%lorawt2%': p.loras ? Number(s.selectedLoraWt2) || 1 : 0, '%lorawt3%': p.loras ? Number(s.selectedLoraWt3) || 1 : 0, '%lorawt4%': p.loras ? Number(s.selectedLoraWt4) || 1 : 0,
    };
    for (const n of Object.values(g)) for (const [k, x] of Object.entries(n.inputs ?? {})) if (typeof x === 'string' && vals[x] !== undefined) n.inputs[k] = vals[x];
    const left = Object.values(g).flatMap(n => Object.values(n.inputs ?? {})).find(x => typeof x === 'string' && /^%\w+%$/.test(x));
    if (left) throw new Error(`The workflow needs ${left}, which Megumin Suite does not set (choose a model there, or another workflow).`);
    return g;
}
// txt2img → img2img: the empty latent becomes the uploaded picture, encoded with the workflow's own VAE, and the
// sampler starts part of the way in (strength 0.6: the last 60% of the steps).
function toImg2Img(g: Graph, image: string, strength: number): Graph {
    const lat = Object.keys(g).find(id => /^Empty.*LatentImage$/.test(g[id].class_type));
    const dec = Object.values(g).find(n => n.class_type === 'VAEDecode');
    if (!lat || !dec?.inputs?.vae) throw new Error('This workflow has no Empty Latent Image and VAE Decode, so Mundi cannot paint over a plan with it.');
    g.mundi_load = { class_type: 'LoadImage', inputs: { image } };
    g.mundi_enc = { class_type: 'VAEEncode', inputs: { pixels: ['mundi_load', 0], vae: dec.inputs.vae } };
    for (const n of Object.values(g)) for (const [k, x] of Object.entries(n.inputs ?? {})) if (Array.isArray(x) && x[0] === lat) n.inputs[k] = ['mundi_enc', 0];
    delete g[lat];
    for (const n of Object.values(g)) {
        if (n.class_type === 'KSampler' && 'denoise' in n.inputs) n.inputs.denoise = strength;
        if (n.class_type === 'KSamplerAdvanced') { const steps = Number(n.inputs.steps) || 25; n.inputs.start_at_step = Math.round(steps * (1 - strength)); n.inputs.end_at_step = 10000; }
    }
    return g;
}
async function upload(b: Blob, name: string): Promise<string> {
    const f = new FormData(); f.append('image', b, name); f.append('overwrite', 'true');
    const res = await fetch(`${comfyUrl()}/upload/image`, { method: 'POST', body: f });
    if (!res.ok) throw new Error(`ComfyUI did not take the plan (${res.status}).`);
    const d = await res.json();
    return d.subfolder ? `${d.subfolder}/${d.name}` : d.name;
}
async function paint(prompt: string, width: number, height: number, plan?: Blob): Promise<Blob> {
    let g = fill(structuredClone(await loadWorkflow(prefs().workflow)) as Graph, { prompt, width, height });
    if (plan) g = toImg2Img(g, await upload(plan, `mundi-plan-${Date.now().toString(36)}.png`), prefs().strength);
    const out = await runJob(g as any);
    const saved = Object.keys(out).find(id => g[id]?.class_type === 'SaveImage') ?? Object.keys(out)[0];
    if (!saved) throw new Error('ComfyUI gave back no picture.');
    return out[saved];
}

/* ---------- prompts (the AI turns the world into tags once) ---------- */

const MAP_TAGS = 'masterpiece, best quality, no humans, scenery, map, from above, aerial view, top-down, detailed illustration, painted map, roads, rooftops, trees, no text';
const PLAN_TAGS = 'masterpiece, best quality, no humans, indoors, floor plan, from above, top-down, rooms, corridors, furniture, detailed illustration, no text';
async function tagsFor(w: WorldDef, places: Place[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let i = 0; i < Math.max(places.length, 1); i += 30) {
        const part = places.slice(i, i + 30);
        const prompt = `Write Danbooru tags (for the Illustrious image model) for background pictures of a world.
World: ${w.name}. ${w.setting}

Answer with one line per item, "id: tags", and nothing else. Scenery only: no people, no character tags, no text. 10 to 20 tags each, the place's look, era, materials and light.
world: <tags for the look of the whole world, used for its maps and cover>
${part.map(p => `${p.id}: <${p.name}${p.desc ? `, ${p.desc}` : ''}>`).join('\n')}`;
        try {
            const raw = await quiet(prompt, 1500);
            for (const l of raw.split('\n')) { const m = l.match(/^\s*[-*]?\s*([\w-]+)\s*:\s*(.+)$/); if (m) out.set(m[1], m[2].replace(/["<>]/g, '').trim()); }
        } catch (e) { console.warn('[Mundi] paint tags', e); }
    }
    return out;
}

/* ---------- the queue ---------- */

async function run() {
    const w = CW.w; if (!w || WP.busy) return;
    WP.busy = true; WP.stop = false; notify();
    const tags = await tagsFor(w, w.places.filter(p => WP.items.some(i => i.kind === 'bg' && i.id === p.id)));
    const look = tags.get('world') ?? '';
    for (const it of WP.items) {
        if (WP.stop) break;
        if (it.state === 'done') continue;
        it.state = 'busy'; notify();
        try {
            let pic: Blob;
            if (it.kind === 'map') {
                const m = w.maps.find(x => x.id === it.id)!;
                pic = await paint(`${indoor(m) ? PLAN_TAGS : MAP_TAGS}, ${look}`, W_PX, H_PX, await drawPlan(w, m));
                m.image = await uploadWorldPicture(w, pic, `map-${m.id}`); m.ratio = +(W_PX / H_PX).toFixed(4); delete m.images;
                if (!isPainted(w.cover) && !WP.items.some(i => i.kind === 'cover' && i.state !== 'failed')) w.cover = m.image;
            } else if (it.kind === 'bg') {
                const p = w.places.find(x => x.id === it.id)!;
                pic = await paint(`masterpiece, best quality, no humans, scenery, ${tags.get(p.id) || `${p.name}, ${p.desc ?? ''}`}, ${look}`, 1216, 832);
                p.bg = await uploadWorldPicture(w, pic, `place-${p.id}`); delete p.bgs;
            } else {
                pic = await paint(`masterpiece, best quality, no humans, scenery, wide shot, landscape, ${look || w.setting}`, W_PX, 768);
                w.cover = await uploadWorldPicture(w, pic, 'cover');
            }
            WP.last = URL.createObjectURL(pic);
            it.state = 'done';
            await saveWorld(w); CW.dirty = false;
        } catch (e: any) { it.state = 'failed'; it.why = String(e?.message ?? e); console.warn('[Mundi] paint', it, e); }
        notify();
    }
    WP.busy = false;
    const done = WP.items.filter(i => i.state === 'done').length, bad = WP.items.filter(i => i.state === 'failed').length;
    toast(`${done} picture${done === 1 ? '' : 's'} painted${bad ? `, ${bad} failed` : ''}.`, bad ? 'warn' : 'success');
    notify();
}

/* ---------- the dialog ---------- */

export function paintHtml(): string {
    if (!WP.open || !CW.w) return '';
    const p = prefs(), w = CW.w;
    const list = WP.items.length ? WP.items : todo(w, p);
    const mark = (i: Item) => (i.state === 'done' ? icon('check') : i.state === 'busy' ? '…' : i.state === 'failed' ? icon('x') : '');
    const flows = [...new Set([p.workflow, ...WP.flows])];
    return `<div class="mu-dlg-veil" data-act="wp-close"><div class="mu-dlg mu-panel mu-paint" role="dialog" data-act="lib-stay">
        <h3>Paint with ComfyUI</h3>
        <p class="mu-muted">Maps are laid out by Mundi where the pins are, then painted over by ComfyUI, so every place sits on a street or a building. Your ComfyUI: <b data-notr>${esc(comfyUrl())}</b>.</p>
        ${WP.busy || WP.items.some(i => i.state !== 'wait') ? '' : `<div class="mu-paint-opts">
            <label class="mu-check"><input type="checkbox" data-act="wp-opt" data-k="maps" ${p.maps ? 'checked' : ''}><span>Maps (${w.maps.length})</span></label>
            <label class="mu-check"><input type="checkbox" data-act="wp-opt" data-k="bgs" ${p.bgs ? 'checked' : ''}><span>Place backgrounds (${w.places.filter(x => !x.link).length})</span></label>
            <label class="mu-check"><input type="checkbox" data-act="wp-opt" data-k="cover" ${p.cover ? 'checked' : ''}><span>Cover</span></label>
            <label class="mu-check"><input type="checkbox" data-act="wp-opt" data-k="redo" ${p.redo ? 'checked' : ''}><span>Paint again what already has a picture</span></label>
            <label class="mu-check"><input type="checkbox" data-act="wp-opt" data-k="loras" ${p.loras ? 'checked' : ''}><span>Use my Megumin Suite LoRAs<small>Off: character LoRAs would bleed into scenery.</small></span></label>
            <label class="mu-field"><span>Workflow</span><select data-input="wp-flow">${flows.map(f => `<option ${f === p.workflow ? 'selected' : ''} data-notr>${esc(f)}</option>`).join('')}</select></label>
            <label class="mu-field"><span>How much ComfyUI may change the plan: ${Math.round(p.strength * 100)}%</span><input type="range" min="0.3" max="0.9" step="0.05" value="${p.strength}" data-input="wp-strength"></label></div>`}
        ${WP.last ? `<img class="mu-paint-last" src="${esc(WP.last)}" alt="">` : ''}
        <ul class="mu-paint-list">${list.map(i => `<li class="is-${i.state}" title="${esc(i.why ?? '')}"><span data-notr>${esc(i.name)}</span><i>${mark(i)}</i></li>`).join('') || '<li class="mu-muted">Nothing to paint: everything has a picture.</li>'}</ul>
        <div class="mu-row mu-dlg-btns">${WP.busy ? `<button data-act="wp-stop">${icon('x')}<span>Stop after this one</span></button>`
            : `<button data-act="wp-close">Close</button>${WP.items.some(i => i.state === 'failed') ? `<button data-act="wp-retry">Try the failed ones again</button>` : ''}<button class="mu-primary" data-act="wp-go" ${list.some(i => i.state !== 'done') ? '' : 'aria-disabled="true"'}>${icon('image')}<span>Paint ${list.filter(i => i.state !== 'done').length}</span></button>`}</div></div></div>`;
}
export async function openPaint() {
    WP.open = true; WP.items = []; WP.last = ''; notify();
    WP.flows = await workflowList(); notify();
}

Object.assign(ACT, {
    'wp-open': () => void openPaint(),
    'wp-close': (el, e) => { if (e && el.classList.contains('mu-dlg-veil') && e.target !== el) return; if (WP.busy) return; WP.open = false; notify(); },
    'wp-opt': (el) => { const p = prefs() as any, k = el.dataset.k!; p[k] = !p[k]; saveSettings(); notify(); },
    'wp-go': () => { if (WP.busy || !CW.w) return; if (!WP.items.length) WP.items = todo(CW.w, prefs()); if (WP.items.length) void run(); },
    'wp-retry': () => { for (const i of WP.items) if (i.state === 'failed') i.state = 'wait'; void run(); },
    'wp-stop': () => { WP.stop = true; notify(); },
});
Object.assign(INPUT, {
    'wp-flow': (el) => { prefs().workflow = el.value; saveSettings(); },
    'wp-strength': (el) => { prefs().strength = Number(el.value) || 0.6; saveSettings(); notify(); },
});
