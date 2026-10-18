// Small pictures for grids: each picture is loaded once, shrunk (≈360 px) and drawn on a <canvas>, so a grid of large
// pictures does not keep dozens of full-size images on screen. The full picture opens when clicked.
const CACHE = new Map();
const PENDING = new Map();
let running = 0;
const queue = [];
const slot = () => new Promise(ok => { if (running < 4) {
    running++;
    ok();
}
else
    queue.push(() => { running++; ok(); }); });
const done = () => { running--; queue.shift()?.(); };
function load(url) {
    if (CACHE.has(url))
        return Promise.resolve(CACHE.get(url));
    if (PENDING.has(url))
        return PENDING.get(url);
    const p = (async () => {
        await slot();
        try {
            const img = new Image();
            img.decoding = 'async';
            img.referrerPolicy = 'no-referrer';
            img.src = url;
            await img.decode();
            const w = img.naturalWidth, h = img.naturalHeight, side = 360;
            const k = Math.min(1, side / Math.min(w, h));
            const bmp = await createImageBitmap(img, { resizeWidth: Math.max(1, Math.round(w * k)), resizeHeight: Math.max(1, Math.round(h * k)), resizeQuality: 'medium' });
            if (CACHE.size > 400) {
                const [first] = CACHE.keys();
                CACHE.get(first)?.close();
                CACHE.delete(first);
            }
            CACHE.set(url, bmp);
            return bmp;
        }
        catch {
            CACHE.set(url, null);
            return null;
        }
        finally {
            done();
            PENDING.delete(url);
        }
    })();
    PENDING.set(url, p);
    return p;
}
function paint(c, bmp) {
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    c.width = W;
    c.height = H;
    // like object-fit: cover, from the top (faces are usually at the top)
    const s = Math.max(W / bmp.width, H / bmp.height);
    const dw = bmp.width * s, dh = bmp.height * s;
    c.getContext('2d').drawImage(bmp, (W - dw) / 2, 0, dw, dh);
    c.classList.add('is-ready');
}
const html = (url, cls = '') => `<canvas class="mu-thumb ${cls}" data-thumb="${url.replace(/"/g, '&quot;')}"></canvas>`;
export const thumbCanvas = html;
// Draws every thumbnail on screen that is not drawn yet (called after each redraw).
export function drawThumbs(root) {
    root.querySelectorAll('canvas[data-thumb]').forEach(c => {
        const url = c.dataset.thumb;
        if (c.dataset.drawn === url)
            return;
        c.dataset.drawn = url;
        load(url).then(b => { if (c.dataset.thumb === url && b)
            paint(c, b);
        else if (!b)
            c.classList.add('is-broken'); });
    });
}
