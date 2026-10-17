/** Языки интерфейса: название и страна пишутся на самом языке, так их узнают при любом выбранном языке */
export const LANGS = [
  { code: 'ru', name: 'Русский', short: 'Рус', country: '', numberLocale: 'ru-RU' },
  { code: 'kk', name: 'Қазақша', short: 'Қаз', country: 'Қазақстан', numberLocale: 'ru-RU' },
  { code: 'en', name: 'English', short: 'Eng', country: '', numberLocale: 'en-US' },
  { code: 'ky', name: 'Кыргызча', short: 'Кыр', country: 'Кыргызстан', numberLocale: 'ru-RU' },
  { code: 'uz', name: 'Oʻzbekcha', short: 'Oʻzb', country: 'Oʻzbekiston', numberLocale: 'ru-RU' },
  { code: 'tg', name: 'Тоҷикӣ', short: 'Тоҷ', country: 'Тоҷикистон', numberLocale: 'ru-RU' },
  { code: 'mn', name: 'Монгол', short: 'Мон', country: 'Монгол Улс', numberLocale: 'ru-RU' },
] as const

export type Lang = (typeof LANGS)[number]['code']
