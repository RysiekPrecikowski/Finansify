// Polish is the source dictionary: `Dictionary` is derived from it, so every
// other locale is type-checked against these keys.

export const pl = {
  app: {
    name: 'Finansify',
    tagline: 'Portfel inwestycyjny',
  },
  nav: {
    dashboard: 'Pulpit',
    portfolio: 'Portfel',
    transactions: 'Transakcje',
    more: 'Więcej',
  },
  actions: {
    toggleTheme: 'Przełącz motyw',
    changeLanguage: 'Zmień język',
    changeCurrency: 'Zmień walutę prezentacji',
    sort: 'Sortowanie',
  },
  dashboard: {
    title: 'Pulpit',
    totalValue: 'Wartość całkowita',
    todayChange: 'Dziś',
    totalChange: 'Łącznie',
    asOf: 'Dane z',
    stale: 'nieaktualne',
    filterByAssetClass: 'Filtruj według klasy aktywów',
    chartRange: 'Zakres wykresu',
    currencyLocked: 'Przewalutowanie pojawi się w Fazie 2, razem z kursami NBP.',
    ranges: {
      '1D': '1D',
      '1W': '1T',
      '1M': '1M',
      YTD: 'YTD',
      '1Y': '1R',
      MAX: 'MAX',
    },
    assetClasses: {
      all: 'Wszystko',
      equity: 'Akcje',
      etf: 'ETF-y',
      fund: 'Fundusze',
      bond: 'Obligacje',
      cash: 'Gotówka',
    },
    accounts: {
      title: 'Konta',
      limit: 'limit {year}',
      limitUsed: '{used} z {limit}',
    },
    holdings: {
      title: 'Pozycje',
      empty: 'Brak pozycji. Dodaj transakcję, żeby zobaczyć tu portfel.',
      instrument: 'Instrument',
      quantity: 'Liczba',
      averageCost: 'Średni koszt',
      price: 'Cena',
      value: 'Wartość',
      pnl: 'Zysk / strata',
      weight: 'Udział',
      unvaluable: 'Brak wyceny',
      unvaluableNote: '{count} pozycji bez aktualnej ceny — nie wchodzi do wartości całkowitej.',
    },
    sort: {
      valueDesc: 'Wartość (od największej)',
      gainAbsoluteDesc: 'Zysk w kwocie (od największego)',
      gainPercentDesc: 'Zysk w procentach (od największego)',
      nameAsc: 'Nazwa (A–Z)',
    },
  },
  accounts: {
    title: 'Konta',
    add: 'Dodaj konto',
    empty: 'Nie masz jeszcze żadnego konta. Dodaj pierwsze, żeby zacząć wprowadzać transakcje.',
    name: 'Nazwa',
    broker: 'Broker',
    wrapper: 'Typ rachunku',
    currency: 'Waluta',
    openedAt: 'Data otwarcia',
    save: 'Zapisz',
    saving: 'Zapisywanie…',
    cancel: 'Anuluj',
    // Field-level validation messages come from `accountInputSchema` and are
    // English; translating zod is its own change. Only what the UI phrases
    // itself lives here.
    errors: {
      invalid: 'Nie udało się zapisać konta — sprawdź wprowadzone dane.',
    },
  },
  wrappers: {
    brokerage: 'Rachunek maklerski',
    ike: 'IKE',
    ikze: 'IKZE',
    ppk: 'PPK',
  },
  placeholder: {
    portfolio: 'Pozycje, konta i loty pojawią się w Fazie 1, razem z księgą transakcji.',
    transactions: 'Ręczne wprowadzanie transakcji pojawi się w Fazie 1.',
    more: 'Ustawienia, import wyciągów i raporty.',
  },
  mock: {
    banner: 'Dane demonstracyjne — księga transakcji pojawi się w Fazie 1.',
  },
};

export type Dictionary = typeof pl;
