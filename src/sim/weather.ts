// The weather: one kind of weather per day, the same every time you look (deterministic, no AI).
// The HUD shows it, and on rainy days people skip outdoor plans (parks, beaches) for somewhere with a roof.
import type { Save } from '../core/store.js';

const KINDS = [['☀️', 'Sunny'], ['🌤️', 'Fair'], ['⛅', 'Partly cloudy'], ['☁️', 'Cloudy'], ['🌧️', 'Rain']] as const;
export function weatherOn(world: string, day: number) {
    const h = Math.abs(Math.sin(day * 12.9898 + (world.length * 7.1)) * 43758.5453) % 1;
    const [icon, name] = KINDS[h < .3 ? 0 : h < .55 ? 1 : h < .75 ? 2 : h < .9 ? 3 : 4];
    return { icon, name, rain: name === 'Rain' };
}
export function weatherOf(g: Save) {
    const wx = weatherOn(g.world, g.day);
    const night = g.minutes < 330 || g.minutes >= 1170;
    return { ...wx, icon: night && !wx.rain ? '🌙' : wx.icon };
}
