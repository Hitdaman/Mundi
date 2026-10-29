export const OUT_SHARE = 0.1;
export function bandOf(hp, max) {
    const s = hp / Math.max(1, max);
    return hp <= 0 ? 'dead' : s < OUT_SHARE ? 'out' : s < 0.3 ? 'critical' : s < 0.5 ? 'wounded' : s < 0.75 ? 'hurt' : 'fine';
}
export const BAND_PENALTY = { fine: 0, hurt: 1, wounded: 3, critical: 5, out: 10, dead: 10 };
export const BAND_WORD = { fine: 'unhurt', hurt: 'hurt', wounded: 'badly hurt', critical: 'barely standing', out: 'unconscious', dead: 'dead' };
export const penaltyOf = (hp, max) => BAND_PENALTY[bandOf(hp, max)];
/** Down: unconscious or dead (out of a fight). */
export const isDown = (hp, max) => hp <= 0 || hp / Math.max(1, max) < OUT_SHARE;
/** The fewest hit points that keep someone on their feet (just above the unconscious line). */
export const awakeHp = (max) => Math.min(max, Math.floor(max * OUT_SHARE) + 1);
