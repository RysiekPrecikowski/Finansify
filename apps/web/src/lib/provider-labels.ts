import { type ProviderName } from '@finansify/core';

/**
 * Brand names, not translated content — "GPW" and "Bankier.pl" read the same
 * in Polish and English, so this lives outside the dictionaries rather than
 * duplicated into both.
 */
export const PROVIDER_LABELS: Record<ProviderName, string> = {
  yahoo: 'Yahoo Finance',
  gpw: 'GPW',
  bankier: 'Bankier.pl',
  nbp: 'NBP',
  gus: 'GUS',
  mf: 'Ministerstwo Finansów',
  pekao: 'Pekao',
};
