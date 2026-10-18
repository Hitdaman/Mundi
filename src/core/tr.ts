// Mundi is English only for now: no interface translation. These keep the same names so the screens stay simple.
type Dict = Record<string, string>;
export function setWorldDicts(_id: string, _dicts: Record<string, Dict>) { /* English only */ }
export const tr = (text: string): string => text;
export function translateTree(_root: Node | null) { /* English only */ }
export function installTranslator(_root: HTMLElement) { /* English only */ }
export const known = (_text: string, _l: string): string | null => null;
