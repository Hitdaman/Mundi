// Skins: the second layer of the look. The style sets the HUD's shape, materials and words; a skin only changes
// colors, textures and mood (it never moves anything). Each style has its own skins; the player picks one per style
// (Settings → Interface), and a world can suggest one (world.skin).
import { UI } from '../core/store.js';
import { styleOf, type WorldDef } from '../core/world.js';

export const SKINS: Record<string, { id: string; name: string; desc: string }[]> = {
    modern: [
        { id: 'default', name: 'Clean', desc: 'Bright blue and clear panels.' },
    ],
    medieval: [
        { id: 'default', name: 'Classic', desc: 'Parchment, wood and gold.' },
    ],
};
const prefs = () => { const u = UI() as any; u.skins ??= {}; return u.skins as Record<string, string>; };
export function skinOf(w: WorldDef | null | undefined): string {
    const style = styleOf(w);
    const list = SKINS[style] ?? [];
    // the player's choice for this style wins; otherwise the world's own skin
    const id = prefs()[style] ?? (w as any)?.skin ?? 'default';
    return list.some(s => s.id === id) ? id : 'default';
}
export const setSkin = (style: string, id: string) => { prefs()[style] = id; };
