// Skins: the second layer of the look. The style sets the HUD's shape, materials and words; a skin only changes
// colors, textures and mood (it never moves anything). Each style has its own skins; the player picks one per style
// (Settings → Interface), and a world can suggest one (world.skin).
import { UI } from '../core/store.js';
import { styleOf } from '../core/world.js';
export const SKINS = {
    modern: [
        { id: 'default', name: 'Clean', desc: 'Bright blue and clear panels.' },
    ],
    medieval: [
        { id: 'default', name: 'Classic', desc: 'Parchment, wood and gold.' },
    ],
};
const prefs = () => { const u = UI(); u.skins ??= {}; return u.skins; };
export function skinOf(w) {
    const style = styleOf(w);
    const list = SKINS[style] ?? [];
    // the player's choice for this style wins; otherwise the world's own skin
    const id = prefs()[style] ?? w?.skin ?? 'default';
    return list.some(s => s.id === id) ? id : 'default';
}
export const setSkin = (style, id) => { prefs()[style] = id; };
