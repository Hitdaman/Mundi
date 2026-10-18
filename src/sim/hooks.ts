// Places other systems hook into time (kept apart, with no imports, so no module waits on another).
import type { Save } from '../core/store.js';
import type { WorldDef } from '../core/world.js';
export const onHour: ((g: Save, w: WorldDef) => string[])[] = [];
export const onDay: ((g: Save, w: WorldDef) => string[])[] = [];
