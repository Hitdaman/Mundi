const KINDS = [['☀️', 'Sunny'], ['🌤️', 'Fair'], ['⛅', 'Partly cloudy'], ['☁️', 'Cloudy'], ['🌧️', 'Rain']];
export function weatherOn(world, day) {
    const h = Math.abs(Math.sin(day * 12.9898 + (world.length * 7.1)) * 43758.5453) % 1;
    const [icon, name] = KINDS[h < .3 ? 0 : h < .55 ? 1 : h < .75 ? 2 : h < .9 ? 3 : 4];
    return { icon, name, rain: name === 'Rain' };
}
export function weatherOf(g) {
    const wx = weatherOn(g.world, g.day);
    const night = g.minutes < 330 || g.minutes >= 1170;
    return { ...wx, icon: night && !wx.rain ? '🌙' : wx.icon };
}
