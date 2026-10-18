// Mundi is English only for now (interface and its own AI instructions). The chat's language is left to SillyTavern
// and to the user's preset.
export const LANGS = [{ id: 'en', flag: '🇺🇸', name: 'English', ai: 'English' }];
export const lang = () => 'en';
export const uiLang = () => 'en';
export const aiLang = () => '';
export const aiLangName = (_id) => 'the same language as the story so far';
export const aiLangNote = () => '';
