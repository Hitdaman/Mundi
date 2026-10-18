// Registry of interface actions. Each screen registers its handlers here:
// data-act="name" (click) → ACT.name(el, event); data-input="name" (input/change) → INPUT.name(el, event).
export const ACT: Record<string, (el: HTMLElement, e: Event) => unknown> = {};
export const INPUT: Record<string, (el: HTMLInputElement, e: Event) => unknown> = {};
