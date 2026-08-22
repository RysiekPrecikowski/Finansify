import { intlLocale, type Locale } from '../locales';
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

/**
 * The four cardinal plural categories the dictionaries carry. Polish uses
 * `one` / `few` / `many` and puts fractions in `other`; English collapses to
 * `one` / `other` and repeats the plural in the rest. Written out rather than
 * derived so a missing form fails typecheck in `en.ts`, the same way every
 * other key already does.
 */
export interface PluralForms {
  readonly one: string;
  readonly few: string;
  readonly many: string;
  readonly other: string;
}

/**
 * Picks the plural form for `count` and fills its `{count}` placeholder.
 *
 * `Intl.PluralRules` is what the note on `interpolate` above pointed at: "5
 * rachunków" versus "3 rachunki" versus "1 rachunek" is a rule of the language,
 * not a threshold anyone should be hand-coding at a call site. Categories this
 * app's two locales never produce (`zero`, `two`) fall back to `other`.
 */
export function plural(forms: PluralForms, count: number, locale: Locale): string {
  const category = new Intl.PluralRules(intlLocale[locale]).select(count);
  const form = category in forms ? forms[category as keyof PluralForms] : forms.other;
  return interpolate(form, { count: String(count) });
}
