import { type Locale } from '../locales';
import { en } from './en';
import { pl, type Dictionary } from './pl';

export { type Dictionary };

const dictionaries: Record<Locale, Dictionary> = { pl, en };

export function dictionaryFor(locale: Locale): Dictionary {
  return dictionaries[locale];
}

/**
 * Fills `{name}` placeholders. Deliberately not a full ICU implementation —
 * when plural rules start mattering, reach for `Intl.PluralRules` here rather
 * than growing this.
 */
export function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
