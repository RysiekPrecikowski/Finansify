// Polish is the source dictionary: `Dictionary` is derived from it, so every
// other locale is type-checked against these keys.

export const pl = {
  app: {
    name: 'Finansify',
    tagline: 'Portfel inwestycyjny',
    // Nadtytuł w pasku nagłówka, nad nazwą bieżącego ekranu. Jeden portfel na
    // użytkownika — kiedy pojawi się ich więcej, to miejsce pokaże wybrany.
    portfolioName: 'Portfel główny',
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
    nativeLines: 'Pozycje w walucie instrumentu',
    currencySource: 'Przeliczane po kursie średnim NBP, tabela A',
    sort: 'Sortowanie',
    account: 'Konto',
    signOut: 'Wyloguj się',
  },
  // Szuflada nawigacji na telefonie. Ma własne etykiety, bo pokazuje więcej
  // niż wspólne `nav-items.ts`: dwa ekrany jeszcze nieistniejące oraz
  // „Ustawienia”, które prowadzą do `/more` — ta strona obejmuje więcej niż
  // same ustawienia, więc na pasku dolnym pozostaje „Więcej”.
  drawer: {
    title: 'Menu',
    close: 'Zamknij menu',
    sectionScreens: 'Ekrany',
    settings: 'Ustawienia',
    // Znacznik przy pozycji, której ekran jeszcze nie powstał — wiersz nie
    // jest klikalny, więc nie prowadzi donikąd.
    comingSoon: 'wkrótce',
    screens: {
      dashboard: 'Pulpit',
      portfolio: 'Portfel',
      transactions: 'Transakcje',
      allocation: 'Skład i rebalans',
      cash: 'Gotówka i waluty',
    },
  },
  dashboard: {
    title: 'Pulpit',
    totalValue: 'Wartość całkowita',
    totalChange: 'Łącznie',
    invested: 'Zainwestowane',
    asOf: 'Dane z',
    stale: 'nieaktualne',
    filterByAssetClass: 'Filtruj według klasy aktywów',
    chartRange: 'Zakres wykresu',
    ranges: {
      '1D': '1D',
      '1W': '1T',
      '1M': '1M',
      YTD: 'YTD',
      '1Y': '1R',
      MAX: 'MAX',
    },
    chart: {
      title: 'Wartość portfela',
      ariaLabel: 'Wartość portfela w czasie',
      loadingHistory: 'Wczytywanie historii…',
      unsupportedRange: 'jeszcze niedostępne',
      legendPortfolio: 'Portfel',
    },
    benchmark: {
      label: 'Indeks',
      select: 'Wybierz indeks porównawczy',
      // Rule 7 w wersji dla serii: linia indeksu jest jawnie oznaczona jako
      // poglądowa, dopóki nie ma prawdziwego źródła notowań indeksów.
      demo: 'Linia indeksu jest poglądowa — brak jeszcze źródła notowań indeksów.',
      names: {
        wig20tr: 'WIG20TR',
        msciWorld: 'MSCI World',
        sp500: 'S&P 500',
      },
    },
    performance: {
      portfolio: 'Portfel (TWR)',
      difference: 'Różnica',
      // Wyliczane z serii wartości portfela, więc wpłaty i wypłaty w okresie
      // podbijają albo obniżają ten wynik. Prawdziwy TWR (z neutralizacją
      // przepływów) jest częścią Fazy 5.
      note: 'Zwrot z serii wartości portfela w wybranym zakresie — wpłaty i wypłaty nie są jeszcze neutralizowane.',
    },
    assetClasses: {
      all: 'Wszystko',
      equity: 'Akcje',
      etf: 'ETF-y',
      fund: 'Fundusze',
      bond: 'Obligacje',
      catalyst_bond: 'Obligacje Catalyst',
    },
    accounts: {
      title: 'Konta',
      // Polska liczba mnoga ma trzy formy — `plural()` wybiera je przez
      // `Intl.PluralRules`, nie przez ręczne `if`y na liczbie.
      count: {
        one: '{count} rachunek',
        few: '{count} rachunki',
        many: '{count} rachunków',
        other: '{count} rachunku',
      },
      limit: 'Limit {year}',
      // Do czasu, aż `wrapper_rules` będzie miało ewidencję wpłat w roku,
      // pasek pokazuje wartość konta, a nie sumę wpłat — mówimy o tym wprost.
      limitApproximate:
        'Przybliżenie: bieżąca wartość konta, nie zweryfikowana suma wpłat w {year} r.',
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
    marketSnapshot: {
      title: 'Kursy i wskaźniki',
      referenceRate: 'Stopa NBP',
      cpi: 'Inflacja r/r',
    },
    topMovers: {
      title: 'Ruch dnia',
    },
    sectors: {
      title: 'Podział sektorowy',
      labels: {
        technology: 'Technologia',
        financials: 'Finanse',
        healthcare: 'Ochrona zdrowia',
        industrials: 'Przemysł',
        consumer: 'Dobra konsumpcyjne',
        energy: 'Energia',
        diversified: 'Fundusze i ETF-y',
        bonds: 'Obligacje',
      },
    },
    news: {
      title: 'Na bieżąco',
      disclaimer:
        'Przykładowe nagłówki — połączenie z prawdziwym źródłem wiadomości jeszcze nie istnieje.',
      templates: {
        results: '{symbol}: wyniki kwartalne powyżej oczekiwań analityków',
        upgrade: '{symbol}: dom maklerski podniósł rekomendację',
        target: '{symbol}: nowa cena docelowa po ostatniej sesji',
        launch: '{symbol}: zapowiedź nowego produktu w tym kwartale',
        regulatory: '{symbol}: zmiana regulacyjna może wpłynąć na branżę',
      },
      times: {
        hoursAgo: '{hours} godz. temu',
        daysAgo: '{days} dni temu',
      },
    },
  },
  accounts: {
    title: 'Konta',
    add: 'Dodaj konto',
    empty: 'Nie masz jeszcze żadnego konta. Dodaj pierwsze, żeby zacząć wprowadzać transakcje.',
    name: 'Nazwa',
    broker: 'Broker',
    wrapper: 'Typ rachunku',
    currency: 'Waluta bazowa',
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
  transactions: {
    title: 'Transakcje',
    add: 'Dodaj transakcję',
    edit: 'Edytuj transakcję',
    delete: 'Usuń transakcję',
    confirmDelete:
      'Transakcja zostanie ukryta, ale zachowana w bazie — dzięki temu ponowny import jej nie zduplikuje.',
    empty: 'Brak transakcji. Dodaj pierwszą, żeby zobaczyć pozycje i saldo gotówki.',
    needsAccount: 'Najpierw dodaj konto — transakcja musi być do czegoś przypisana.',
    unknownAccount: 'Nieznane konto',
    account: 'Konto',
    instrument: 'Instrument',
    instrumentSearch: {
      label: 'Instrument',
      placeholder: 'Szukaj po tickerze lub nazwie…',
      searching: 'Szukam…',
      searchingMore: 'Nadal szukam w pozostałych źródłach…',
      noResults: 'Brak wyników',
    },
    type: 'Typ',
    amount: 'Kwota',
    quantity: 'Liczba',
    price: 'Cena za sztukę',
    grossAmount: 'Kwota brutto',
    grossAmountHint: 'Jeśli podasz, ma pierwszeństwo przed liczbą × ceną — to kwota z wyciągu.',
    fee: 'Prowizja',
    tax: 'Podatek',
    currency: 'Waluta',
    fxRate: 'Kurs wykonania',
    fxRateSource: 'Źródło kursu',
    fxRequired:
      'waluta transakcji różni się od waluty konta. Jeśli broker faktycznie przewalutował tę transakcję, podaj kurs faktycznie wykonany — nie odtwarzamy go później, broker przewalutowuje po własnym spreadzie. Jeśli konto po prostu trzyma tę walutę bezpośrednio, zostaw puste.',
    tradeDate: 'Data transakcji',
    settleDate: 'Data rozliczenia',
    note: 'Notatka',
    save: 'Zapisz',
    saving: 'Zapisywanie…',
    cancel: 'Anuluj',
    // All fifteen, so an imported row can be labelled even though the form does
    // not offer `split` (`buildPositions` refuses it by design).
    types: {
      buy: 'Kupno',
      sell: 'Sprzedaż',
      dividend: 'Dywidenda',
      interest: 'Odsetki',
      coupon: 'Kupon',
      fee: 'Prowizja',
      tax: 'Podatek',
      deposit: 'Wpłata',
      withdrawal: 'Wypłata',
      transfer_in: 'Przeniesienie do',
      transfer_out: 'Przeniesienie z',
      split: 'Split',
      bond_purchase: 'Zakup obligacji',
      bond_redemption: 'Wykup obligacji',
      bond_early_redemption: 'Przedterminowy wykup obligacji',
    },
    kinds: {
      equity: 'Akcje',
      etf: 'ETF',
      fund: 'Fundusz',
      bond: 'Obligacja',
    },
    fxRateSources: {
      broker: 'Broker',
      nbp: 'NBP',
      user: 'Własny',
    },
    errors: {
      invalid: 'Nie udało się zapisać transakcji — sprawdź wprowadzone dane.',
    },
  },
  settings: {
    fxTitle: 'Kursy walut',
    fxSubtitle: 'Skąd bierzemy kurs i czego ten wybór dotyczy.',
    fxSourceLabel: 'Źródło kursu',
    fxSourceNames: {
      nbp: 'NBP, tabela A',
      yahoo: 'Kurs rynkowy (Yahoo)',
    },
    fxSourceNotes: {
      nbp: 'Jeden kurs średni na dzień roboczy, publikowany około południa. Po tym kursie liczy się podatek.',
      yahoo:
        'Zmienia się w trakcie sesji, co kilka sekund. Odświeżamy co 15 minut. Źródło nieoficjalne, bez gwarancji dostępności.',
    },
    fxScopeLabel: 'Czego dotyczy',
    fxScopeNames: {
      charts: 'Tylko wykresy par walutowych',
      all: 'Cały portfel',
    },
    fxScopeNotes: {
      charts: 'Wycena portfela zostaje na kursie NBP niezależnie od wyboru powyżej.',
      all: 'Wartość portfela też jest przeliczana wybranym kursem.',
    },
    fxDivergesWarning:
      'Wartość portfela liczy się teraz z innej serii niż podatek. Polski podatek od zysków przelicza się po kursie NBP z dnia roboczego poprzedzającego transakcję, więc suma na ekranie i kwota w rozliczeniu będą się różnić o spread. Koszt nabycia i zrealizowany zysk się nie zmieniają — one biorą kurs zapisany na transakcji.',
  },
  wrappers: {
    brokerage: 'Rachunek maklerski',
    ike: 'IKE',
    ikze: 'IKZE',
    ppk: 'PPK',
  },
  portfolio: {
    title: 'Portfel',
    instrument: 'Instrument',
    quantity: 'Liczba',
    averageCost: 'Średni koszt',
    costBasis: 'Koszt nabycia',
    realized: 'Zrealizowany zysk/strata',
    accounts: 'Konta',
    // Pokazywane zamiast średniego kosztu, kiedy ta sama pozycja jest
    // rozłożona na konta w różnych walutach — nie ma jednego kursu, którym
    // można by je zsumować przed Fazą 2.
    multipleCurrencies: 'Kilka walut',
    marketValue: 'Wartość rynkowa',
    unrealized: 'Niezrealizowany zysk/strata',
    totalValue: 'Wartość portfela',
    totalValueNote:
      'Tylko otwarte pozycje, przeliczone na {currency} po ostatnim kursie NBP. Gotówka nie jest jeszcze wliczona.',
    totalValueMarket: 'Przeliczone kursem rynkowym, nie NBP — podatek liczy się po kursie NBP.',
    totalValueIncomplete:
      'Część pozycji nie ma jeszcze ceny lub kursu wymiany — ta suma jest niepełna.',
    unavailableNeverFetched: 'cena się ładuje…',
    unavailableUnmapped: 'jeszcze niezmapowane do dostawcy',
    openTitle: 'Otwarte pozycje',
    filterByWrapper: 'Filtruj według rachunku',
    allWrappers: 'Wszystkie',
    // Licznik obok nagłówka sekcji. Druga część pojawia się tylko wtedy, gdy
    // jakaś pozycja nie ma wyceny — ADR: niewyceniona pozycja musi być widoczna.
    positionCount: {
      one: '{count} pozycja',
      few: '{count} pozycje',
      many: '{count} pozycji',
      other: '{count} pozycji',
    },
    withoutPrice: '{count} bez ceny',
    balanceCount: {
      one: '{count} saldo',
      few: '{count} salda',
      many: '{count} sald',
      other: '{count} salda',
    },
    // Obligacje detaliczne nie mają notowania — nikt ich nie kwotuje (ADR 0011).
    // Wartość liczy silnik naliczania z opublikowanych tabel odsetkowych, więc
    // wiersz mówi to wprost zamiast pokazywać pustą albo zmyśloną cenę.
    accrualNote: 'Wycena z tabel odsetkowych',
    noResults: 'Brak pozycji dla tego filtra.',
    // ADR 0021: jedna pozycja nie może mieć lotów w dwóch walutach na tym
    // samym koncie — silnik odmawia zgadywania kursu. Do naprawy: usuń lub
    // popraw transakcję, która wprowadziła drugą walutę.
    mixedCurrencyError:
      'Ta pozycja ma transakcje w dwóch różnych walutach na jednym koncie, więc nie da się policzyć jej kosztu nabycia bez zgadywania kursu. Popraw lub usuń jedną z transakcji na liście Transakcje, żeby wszystkie były w tej samej walucie.',
    closed: {
      title: 'Zamknięte pozycje',
    },
    cash: {
      title: 'Gotówka',
      account: 'Konto',
      note: 'Salda pokazane osobno w walucie każdego konta — gotówka nie jest jeszcze wliczona do sumy powyżej.',
    },
    lots: {
      title: 'Loty',
      openedOn: 'Otwarto',
      originalQuantity: 'Pierwotna liczba',
      remainingQuantity: 'Pozostało',
      originalCost: 'Pierwotny koszt',
      remainingCost: 'Pozostały koszt',
      back: 'Wróć do portfela',
    },
  },
  export: {
    title: 'Eksport',
    description:
      'Pobierz całą swoją księgę transakcji — Twoja własna kopia, niezależna od Finansify.',
    downloadCsv: 'Pobierz CSV',
    downloadJson: 'Pobierz JSON',
  },
  imports: {
    title: 'Import wyciągów',
    account: 'Konto',
    file: 'Plik wyciągu',
    upload: 'Wgraj',
    uploading: 'Wgrywanie…',
    status: 'Status',
    broker: 'Broker',
    rowsStaged: 'Wierszy do przeglądu',
    resolveInstruments: 'Dopasuj instrumenty',
    resolve: {
      title: 'Wyciąg {broker} — dopasuj instrumenty',
      progress: '{resolved}/{total} tickerów dopasowanych',
      empty: 'Nic do dopasowania — ten wyciąg nie zawiera wierszy z instrumentem.',
      autoMatched: 'Dopasowane automatycznie',
      confirmSelected: 'Zatwierdź zaznaczone',
      needsInput: 'Wymaga Twojego wyboru',
      resolveAction: 'Dopasuj',
      resolved: 'Dopasowane',
      row: '1 wiersz',
      rows: '{count} wierszy',
      continueToReview: 'Przejdź do przeglądu',
      back: 'Wstecz',
    },
    review: {
      title: 'Wyciąg {broker} — przegląd',
      back: 'Wróć do importów',
      warnings: 'Ostrzeżenia uzgodnienia',
      unresolved: 'tickerów wciąż wymaga dopasowania',
      resolveLink: 'Dopasuj tickery',
      needsReview: 'wierszy wymaga przeglądu przed akceptacją',
      reviewLink: 'Przejrzyj',
      needsReviewStatus: 'Wymaga przeglądu',
      pending: 'Oczekujące',
      accepted: 'Zaakceptowane',
      rejected: 'Odrzucone',
      duplicate: 'Konflikty',
      previewUnchanged: 'Bez zmian',
      previewChanged: 'Zaktualizuje',
      previewConflict: 'Konflikt (edytowane ręcznie)',
      previewDeleted: 'Usunięte ręcznie',
      previewUnchangedCount: '{count} bez zmian — zostaną pominięte',
      previewChangedCount: '{count} zaktualizuje istniejącą transakcję',
      previewConflictCount: '{count} pominiętych — edytowane ręcznie od importu',
      previewDeletedCount: '{count} pominiętych — usunięte ręcznie od importu',
      empty: 'W tej partii nie ma żadnych wierszy.',
      date: 'Data',
      type: 'Typ',
      description: 'Opis',
      amount: 'Kwota',
      accept: 'Akceptuj',
      acceptAll: 'Zaakceptuj wszystkie oczekujące ({count})',
      acceptingAll: 'Akceptowanie…',
      reject: 'Odrzuć',
      edit: 'Edytuj',
      viewTransaction: 'Zobacz transakcję',
      reasonPlaceholder: 'Dlaczego pomijasz ten wiersz? (opcjonalnie)',
      row: {
        acceptAsIs: 'Akceptuj bez zmian',
        editAndAccept: 'Edytuj i akceptuj',
        rejectSection: 'Odrzuć ten wiersz',
        acceptError:
          'Nie udało się zaakceptować wiersza bez zmian — popraw wartości poniżej i zaakceptuj.',
        reviewed: 'Już przejrzane',
      },
    },
  },
  indicators: {
    title: 'Wskaźniki',
    subtitle: 'Stopa referencyjna i inflacja — dane, na których liczą się obligacje skarbowe.',
    referenceRate: 'Stopa referencyjna NBP',
    referenceRateBy: 'Rada Polityki Pieniężnej',
    referenceRateNote: 'Oprocentowanie obligacji ROR i DOR w kolejnych okresach odsetkowych.',
    cpi: 'Inflacja r/r',
    cpiBy: 'Prezes GUS',
    cpiNote: 'Indeksacja obligacji COI, ROS, EDO i ROD. Ujemny odczyt liczy się jako zero.',
    effectiveFrom: 'Obowiązuje od',
    announcedIn: 'Ogłoszono w',
    change: 'Zmiana',
    noChange: 'bez zmian',
    previous: 'Poprzednio',
    history: 'Historia',
    source: 'Źródło',
    unavailable: 'Brak danych — nic jeszcze nie pobrano.',
    refreshFailed: 'Nie udało się odświeżyć — pokazujemy ostatnią znaną wartość.',
    seeAll: 'Zobacz wskaźniki',
    fxBy: 'NBP, tabela A — kurs średni',
    fxByMarket: 'Kurs rynkowy — Yahoo Finance',
    fxNoteMarket:
      'Kurs rynkowy, zmienia się w trakcie sesji. Wycena portfela liczy się po kursie NBP, chyba że zmienisz to w Więcej → Kursy walut.',
    fxPair: 'Para walutowa',
    fxBase: 'Waluta bazowa',
    fxQuote: 'Waluta kwotowana',
    fxSwap: 'Zamień strony',
    fxRange: 'Zakres',
    fixedOn: 'Kurs z dnia',
    fxNote:
      'Ten sam kurs, po którym przeliczana jest wartość portfela. Tylko dni robocze — w święta i weekendy nie ma notowania.',
  },
  instruments: {
    bondName: 'Obligacja skarbowa',
  },
  providers: {
    title: 'Dostawcy notowań',
    subtitle:
      'Które źródło notowań obsługuje dany instrument i w jakiej kolejności jest próbowane.',
    columns: {
      instrument: 'Instrument',
      kind: 'Rodzaj',
      chain: 'Łańcuch dostawców',
    },
    unmapped: 'Brak mapowania',
    empty: 'Brak instrumentów.',
    back: 'Wróć do listy',
    chainTitle: 'Łańcuch dostawców',
    chainSubtitle:
      'Pierwszy wpis jest próbowany jako pierwszy — kolejność da się zmienić strzałkami.',
    providerLabel: 'Dostawca',
    symbolLabel: 'Symbol u dostawcy',
    addButton: 'Dodaj',
    saveButton: 'Zapisz',
    saving: 'Zapisywanie…',
    removeButton: 'Usuń wpis',
    moveUp: 'Przenieś wyżej',
    moveDown: 'Przenieś niżej',
    fallbackCount: 'Odwołania do zapasowego',
    lastFallbackAt: 'Ostatnie odwołanie',
    verifiedAt: 'Zweryfikowano',
    never: 'nigdy',
    saved: 'Zapisano.',
    noProvidersLeft: 'Wszyscy obsługiwani dostawcy są już przypisani.',
    genericError: 'Nie udało się zapisać. Spróbuj ponownie.',
  },
  placeholder: {
    more: 'Ustawienia i import wyciągów.',
  },
};

export type Dictionary = typeof pl;
