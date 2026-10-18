// Image cropper in SillyTavern's avatar format (2:3, saved at 512×768), with a preview of the three avatar
// styles SillyTavern offers (round, square, rectangle). Lives in its own layer, outside the redrawn screen.
import { ROOT_ID } from '../core/store.js';

export const AVATAR_W = 512, AVATAR_H = 768;

export function cropImage(file: Blob): Promise<Blob | null> {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.onload = () => open(img, url, resolve);
        img.src = url;
    });
}

function open(img: HTMLImageElement, url: string, resolve: (b: Blob | null) => void) {
    const root = document.getElementById(ROOT_ID)!;
    const FW = 280, FH = 420;   // the frame on screen (2:3)
    const base = Math.max(FW / img.naturalWidth, FH / img.naturalHeight);   // smallest zoom that fills the frame
    let zoom = 1, x = 0, y = 0;   // image offset (px on screen) of its top-left corner inside the frame

    const veil = document.createElement('div');
    veil.className = 'mu-crop-veil';
    veil.innerHTML = `<div class="mu-crop mu-panel" role="dialog">
        <h3>Adjust the image</h3>
        <div class="mu-crop-body">
            <div class="mu-crop-stage" style="width:${FW}px;height:${FH}px"><img alt="" draggable="false" src="${url}"><i class="mu-crop-grid"></i></div>
            <div class="mu-crop-side">
                <h4>How it looks in SillyTavern</h4>
                <div class="mu-crop-previews">
                    <figure><canvas class="is-round" width="96" height="96"></canvas><figcaption>Round</figcaption></figure>
                    <figure><canvas class="is-square" width="96" height="96"></canvas><figcaption>Square</figcaption></figure>
                    <figure><canvas class="is-rect" width="96" height="144"></canvas><figcaption>Rectangle</figcaption></figure>
                </div>
                <label class="mu-field"><span>Zoom</span><input type="range" min="1" max="4" step="0.01" value="1" class="mu-crop-zoom"></label>
                <p class="mu-muted">Drag the image to move it. The scroll wheel zooms.</p>
            </div>
        </div>
        <div class="mu-row mu-dlg-btns"><button data-c="reset">Fit</button><button data-c="cancel">Cancel</button><button class="mu-primary" data-c="ok">Use this image</button></div>
    </div>`;
    root.appendChild(veil);
    const stage = veil.querySelector<HTMLElement>('.mu-crop-stage')!;
    const im = stage.querySelector('img')!;
    const zoomIn = veil.querySelector<HTMLInputElement>('.mu-crop-zoom')!;
    const previews = [...veil.querySelectorAll('canvas')] as HTMLCanvasElement[];

    const scale = () => base * zoom;
    const clamp = () => {
        const w = img.naturalWidth * scale(), h = img.naturalHeight * scale();
        x = Math.min(0, Math.max(FW - w, x)); y = Math.min(0, Math.max(FH - h, y));
    };
    const center = () => { zoom = 1; zoomIn.value = '1'; x = (FW - img.naturalWidth * scale()) / 2; y = (FH - img.naturalHeight * scale()) / 2; };
    // the source rectangle of the image that lands inside the frame
    const src = () => ({ sx: -x / scale(), sy: -y / scale(), sw: FW / scale(), sh: FH / scale() });
    let raf = 0;
    const draw = () => {
        clamp();
        im.style.width = `${img.naturalWidth * scale()}px`;
        im.style.transform = `translate(${x}px, ${y}px)`;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
            const s = src();
            for (const c of previews) {
                const g = c.getContext('2d')!;
                g.clearRect(0, 0, c.width, c.height);
                if (c.classList.contains('is-rect')) g.drawImage(img, s.sx, s.sy, s.sw, s.sh, 0, 0, c.width, c.height);
                else g.drawImage(img, s.sx, s.sy + (s.sh - s.sw) / 2, s.sw, s.sw, 0, 0, c.width, c.height);   // SillyTavern centers the square
            }
        });
    };
    const zoomTo = (z: number, cx = FW / 2, cy = FH / 2) => {
        const before = scale();
        zoom = Math.min(4, Math.max(1, z));
        const k = scale() / before;
        x = cx - (cx - x) * k; y = cy - (cy - y) * k;
        zoomIn.value = String(zoom);
        draw();
    };

    let drag: { px: number; py: number; x: number; y: number } | null = null;
    stage.addEventListener('pointerdown', (e) => { drag = { px: e.clientX, py: e.clientY, x, y }; stage.setPointerCapture(e.pointerId); });
    stage.addEventListener('pointermove', (e) => { if (!drag) return; x = drag.x + e.clientX - drag.px; y = drag.y + e.clientY - drag.py; draw(); });
    stage.addEventListener('pointerup', () => { drag = null; });
    stage.addEventListener('wheel', (e) => { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    zoomIn.addEventListener('input', () => zoomTo(Number(zoomIn.value)));

    const done = (ok: boolean) => {
        if (!ok) { finish(null); return; }
        const s = src();
        const c = document.createElement('canvas');
        c.width = AVATAR_W; c.height = AVATAR_H;
        const g = c.getContext('2d')!;
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, s.sx, s.sy, s.sw, s.sh, 0, 0, AVATAR_W, AVATAR_H);
        c.toBlob(b => finish(b), 'image/png');
    };
    const finish = (b: Blob | null) => { veil.remove(); URL.revokeObjectURL(url); document.removeEventListener('keydown', key, true); resolve(b); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } if (e.key === 'Enter') { e.preventDefault(); done(true); } };
    document.addEventListener('keydown', key, true);
    veil.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-c]');
        if (!b) return;
        if (b.dataset.c === 'reset') { center(); draw(); } else done(b.dataset.c === 'ok');
    });
    center(); draw();
}

// Opens the system file picker and returns the chosen image, cropped.
export function pickAndCrop(): Promise<Blob | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
        input.onchange = async () => { const f = input.files?.[0]; resolve(f ? await cropImage(f) : null); };
        input.click();
    });
}
export function pickFile(accept = 'image/*'): Promise<File | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = accept;
        input.onchange = () => resolve(input.files?.[0] ?? null);
        input.click();
    });
}
