// Places: the world's public places plus homes (the player's and each resident's). Distances and travel time.
import { travelFactor } from './life.js';
import { cfg, type Save } from '../core/store.js';
import type { WorldDef, Place } from '../core/world.js';

export const playerHomeId = 'home:player';
export const isHome = (id: string) => id.startsWith('home:');
// "North Suburbs, House 4": every home spot of the map has a fixed number.
export function homeAddress(w: WorldDef, h: { zone: string; x: number; y: number; n?: number }) {
    const zone = w.homes.zones.find(z => z.id === h.zone);
    if (!zone) return '';
    const n = h.n ?? (zone.spots.findIndex(s => s[0] === h.x && s[1] === h.y) + 1);
    return `${zone.name}, ${zone.kind === 'house' ? 'House' : 'Apartment'} ${n || 1}`;
}

export function placeOf(g: Save, w: WorldDef, id: string): (Place & { home?: boolean; owner?: string }) | null {
    if (id === playerHomeId) {
        const h = g.player.home, kind = w.homes.kinds[h.kind];
        const zone = w.homes.zones.find(z => z.id === h.zone);
        return { id, name: 'My home', map: zone?.map ?? w.maps[0].id, x: h.x, y: h.y, tags: ['home'], desc: `${homeAddress(w, h)}: ${kind?.desc ?? ''}`, home: true };
    }
    if (isHome(id)) {
        const r = g.cast[id.slice(5)];
        if (!r) return null;
        // someone who lives with another person is at that person's home (or yours)
        const w2 = (r as any).homeWith as string | undefined;
        if (w2 === '__you') return placeOf(g, w, playerHomeId);
        if (w2 && w2 !== r.avatar && g.cast[w2]) return placeOf(g, w, `home:${w2}`);
        const zone = w.homes.zones.find(z => z.id === r.home.zone);
        const mates = Object.values(g.cast).filter(x => x.home.zone === r.home.zone && x.home.x === r.home.x && x.home.y === r.home.y && (x.met || x === r)).map(x => x.name);
        const label = mates.length <= 1 ? r.name : mates.length === 2 ? `${mates[0]} & ${mates[1]}` : `${r.name} & family`;
        return { id, name: `${label}'s home`, map: zone?.map ?? w.maps[0].id, x: r.home.x, y: r.home.y, tags: ['home'], desc: `${homeAddress(w, r.home)}: ${zone?.desc ?? ''}`, home: true, owner: r.avatar };
    }
    return w.places.find(p => p.id === id) ?? null;
}

// Every point on the map: public places, your home, and the homes of people you know.
export function pins(g: Save, w: WorldDef) {
    const out: (Place & { home?: boolean; owner?: string })[] = [...w.places];
    const mine = placeOf(g, w, playerHomeId);
    if (mine) out.push(mine);
    for (const r of Object.values(g.cast)) if (r.met) { const p = placeOf(g, w, `home:${r.avatar}`); if (p && !out.some(x => x.id === p.id)) out.push(p); }
    return out;
}

// Travel time, rounded to the world's steps (15, 20, 30…), so the clock stays readable. Between maps (two cities
// on a region map), the trip goes through the link pins on the bigger map.
// Travel takes a fixed time: 30 minutes inside a town (a local map), 2 hours between towns or across a region map
// (a map that other maps hang from). The world's "travel" rule (advanced settings) scales both.
export const LOCAL_TRIP = 30, GLOBAL_TRIP = 120;
export function travelMinutes(g: Save, w: WorldDef, from: string, to: string): number {
    if (from === to) return 0;
    const a = placeOf(g, w, from), b = placeOf(g, w, to);
    const isRegion = (mapId?: string) => !!mapId && w.maps.some(m => m.parent === mapId);
    const local = !!a && !!b && a.map === b.map && !isRegion(a.map);
    return Math.max(5, Math.round((local ? LOCAL_TRIP : GLOBAL_TRIP) * (cfg(g).travel ?? 1) * travelFactor(g) / 5) * 5);
}
