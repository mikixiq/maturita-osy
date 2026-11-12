# Maturita OSY a čeština – procvičování

Statická webová aplikace bez backendu a bez knihoven: `index.html`, `style.css`, `app.js`,
`data/questions.json` (OSY a PSI) a `data/literatura.json` (čeština, 20 děl).
Nahoře na stránce se přepíná sekce **OSY | Čeština**. Každá sekce má vlastní výběr, statistiky a „Ke zopakování“.

## Nahrání na GitHub Pages
1. Na GitHubu vytvoř nový repozitář (např. `maturita-osy`), klidně veřejný.
2. Nahraj do něj soubory `index.html`, `style.css`, `app.js`, `README.md` a složku `data`
   s `questions.json` a `literatura.json` (tlačítko **Add file → Upload files**, složku `data` přetáhni celou).
3. Otevři **Settings → Pages**, v části **Build and deployment** zvol **Source: Deploy from a branch**,
   větev `main` a složku `/ (root)`, ulož.
4. Po minutě až dvou bude web na adrese `https://<tvoje-jméno>.github.io/maturita-osy/`.

Netlify: stačí přetáhnout celou složku na https://app.netlify.com/drop.

## Spuštění na vlastním počítači
Z `file://` prohlížeč JSON nenačte. Ve složce aplikace spusť `python -m http.server` a otevři `http://localhost:8000`.
Když se jeden z JSON souborů nenačte, druhá sekce funguje dál.

## Data a statistiky
Všechna čtení a zápisy do localStorage jsou v try/catch – bez úložiště aplikace funguje, jen si nic nepamatuje.

OSY (klíče se nemění):
- `maturita-osy-stats-v2`, `maturita-osy-vyber-v2`, `maturita-osy-nastaveni-v2`, `maturita-osy-vyuka-v1`.
  Statistiky z první verze (`…-v1`) se převezmou automaticky.

Čeština:
- `maturita-cj-stats-v1` – zodpovězeno, správně, špatně, „Ke zopakování“, počítadla u děl (`dila`) a epoch (`epochy`), losování.
- `maturita-cj-vyber-v1` – vybraná díla (výchozí: všech 20), `maturita-cj-nastaveni-v1` – režim a nastavení.
- `maturita-cj-seznam-v1` – verze seznamu děl. Když se zvýší `verze_seznamu` v `literatura.json`, výběr děl,
  počítadla u děl a losování (uložené podle čísla díla) se jednou převedou podle pole `predchozi_cisla[<uložená verze>]`.
- `maturita-cj-procviceno-v1` – id děl, která si uživatel ve Výuce ručně označil jako „Procvičeno“
  (zaškrtávátko v seznamu nebo tlačítko na konci výuky). „Vynulovat statistiky“ je nemaže.

Společné:
- `maturita-sekce-v1` – naposledy otevřená sekce.
- Statistiky jsou navázané na `id` otázky – id se proto nikdy nemění.
- Otázka zmizí z „Ke zopakování“ po 2 správných odpovědích v řadě (v obou sekcích).
- Statistiky se nulují v Přehledu každé sekce zvlášť.

## Sekce Čeština
Otázky se negenerují ručně: `app.js` je vytvoří z `data/literatura.json` ve stejném formátu jako otázky OSY,
takže výběr odpovědi, pravda/nepravda, kartičky, otevřená odpověď, seřazení, test na čas a opakování
běží na stejném kódu. Navíc má čeština:
- **Přiřazování** – autor × dílo, postava × dílo, popis postavy × jméno, dílo × literární směr, dílo × druh, dílo × století
  (každý typ zvlášť, okamžitá zpětná vazba). V popisu postavy je její jméno skryté.
  Dílo × literární směr používá krátký směr z pole `styl` (např. Romeo a Julie – W. Shakespeare → renesance a humanismus);
  ze stejného pole jsou i otázky `<id díla>-styl` ve výběru odpovědi.
- **Filtr Motivy** na úvodní obrazovce – ukáže díla s vybraným motivem a umí je rovnou vybrat.
- **Srovnání dvou děl** – shody a rozdíly v epoše, druhu, žánru, směru, motivech a postavách, jen z dat.
- **Třídění** – rozdělení děl do období a seřazení epoch od nejstarší.
- **Výuka** – autor → epocha → dílo a druh → postavy (s charakteristikou) → shrnutí děje → motivy → obsah → zajímavost,
  na konci shrnutí a „Procvičit toto dílo“.
- **Losování k projevu** – 7 minut, pak osnova (autor → epocha → dílo → postavy → obsah → shrnutí děje → zajímavost) a „Zvládl/a jsem to?“.

- **Záložka Díla** – karta každého díla: název a autor, století vzniku, literární směr s krátkým popisem
  (pole `smery` a `smer_id` v `literatura.json`) a tři autoři ze stejného období – přednostně (až dva) autoři
  jiných děl ze seznamu, doplnění z pole `autori_obdobi` (mimo seznam, jen pro přehled, otázky se z nich netvoří);
  vždy nejbližší rokem vydání.
- **Simulace zkoušky** (i v sekci OSY) – náhodná otázka, odpověď nahlas nebo do pole, pak zaškrtnutí bodů odpovědi.
  Výsledek se ukládá do pole `zkouska` ve statistikách sekce a je vidět v Přehledu.
  V OSY jsou otázkou název maturitní otázky a body její osnova z `questions.json` (žádná nová data).

Id generovaných otázek mají tvar `<id díla>-<typ>`, např. `cj05-autor`, `cj05-postava-2`, `cj05-char-2`, `cj05-o-dej`,
a dále `cj-chrono-1` až `cj-chrono-5`, `cj-epochy-poradi`, `cj-epocha-19-1`.
Při úpravách `literatura.json` proto neměň pořadí postav ani `id` děl, jinak se statistiky přestanou párovat.
`id` díla se nemění ani při přečíslování seznamu; `cislo` je pořadí ve školním seznamu, takže se nemusí shodovat s číslem v `id`.

### Seznam děl (verze 3, podle školního „Seznamu literárních děl – maturitní zkouška z ČJL“, 2026/2027)
Sekce obsahuje jen těchto 20 děl – žádné další autory ani díla mimo seznam (u epoch je `dalsi_autori` prázdné,
epocha 21. století byla zrušena a 20. a 21. století tvoří jedno období jako ve školním seznamu).
Číslo v závorce je „č. s.“ ze školního seznamu (pole `cislo_skolni`), oddíly jsou v poli `skupina`.

- **Světová a česká literatura do konce 18. století:** 1. Romeo a Julie (2) · 2. Lakomec (23)
- **Světová a česká literatura 19. století:** 3. Kytice (3) · 4. Revizor (24) · 5. Jáma a kyvadlo (26)
- **Světová literatura 20. a 21. století:** 6. Proměna (11) · 7. Na západní frontě klid (12) · 8. Stařec a moře (13) · 9. Farma zvířat (18)
- **Česká literatura 20. a 21. století:** 10. Slezské písně (7) · 11. Krysař (8) · 12. R.U.R. (9) · 13. Spalovač mrtvol (14) · 14. Ostře sledované vlaky (19)
- **Další četba:** 15. O myších a lidech (27) · 16. Válka s mloky (29) · 17. Malý princ (37) · 18. Smrt krásných srnců (39) · 19. Zkrocení zlé ženy (45) · 20. Velký Gatsby (65)

Díla Slezské písně, Krysař, Spalovač mrtvol, Válka s mloky a Malý princ (id `cj21`–`cj25`) vycházejí z PDF
„Maturitní četba – Rozbor 20 děl“; co v PDF není (životní data autorů, zajímavosti), je uvedeno v `k_overeni`.
Id `cj04`, `cj06`, `cj15`, `cj18`, `cj20` (díla z dřívějšího seznamu) se už znovu nepoužijí.

### Struktura `data/literatura.json`
- `smery` – literární směry (`id`, `nazev`, `popis`, `zdroj`, `k_overeni`); dílo na směr odkazuje polem `smer_id`.
- `motivy` – jednotný slovník motivů (každý motiv se píše vždy stejně, aby šlo filtrovat); `poznamka_motivy`.
- `obdobi` – období podle školního seznamu: `18` = do konce 18. století, `19` = 19. století, `20` = 20. a 21. století.
- `skupiny` – oddíly školního seznamu (`id`, `nazev`); dílo odkazuje polem `skupina`.
- `dila[]` – `id`, `cislo`, `cislo_skolni`, `skupina`, `predchozi_cisla`, `dilo`, `rok`, `rok_text`, `autor` (`jmeno`, `zkratka`, `zivot`, `zeme`, `zdroj`),
  `druh` (lyrika / epika / drama), `zanr`, `literarni_smer`, `styl` (krátký směr pro přiřazování), `obdobi`, `stoleti_vzniku`, `postavy[]` (`jmeno`, `role`, `charakteristika`, `zdroj`), `motivy[]`,
  `obsah` (bez spoilerů), `shrnuti_deje` (včetně konce), `fun_fact` (`text`, `mimo_zdroje: true`, `zdroj`),
  `zkouska[]` (`id`, `otazka`, `body_odpovedi` 4–6, `citace_k_pouziti` – jen pár slov, `k_overeni`, `zdroj`),
  `zdroje[]` a `k_overeni[]` (co není ověřené nebo se liší od zadaného seznamu).
- `epochy[]` – `obdobi`, `nazev`, `rozsah`, `popis`, `hlavni_smery`, `dalsi_autori[]`, `zdroje`, `k_overeni`.

U zachovaných děl byly údaje ověřeny podle české (a u některých zajímavostí anglické) Wikipedie, u nových děl podle PDF. Položky v `k_overeni`
se zobrazují v aplikaci u příslušných otázek (štítek „k ověření“), ve výuce i v osnově losování.

## Přidání dalších prezentací OSY (nový zip)
1. Pošli nový zip a aktuální `data/questions.json`.
2. Z nového zipu vzniknou jen nové otázky. Stávající otázky a jejich `id` zůstávají.
3. Nová `id` mají tvar `<zkratka prezentace>-<pořadí>`, např. `osy21-01` nebo `psi24-03`.
   Když se číslo prezentace opakuje v jiné složce, přidá se rozlišení (např. `osy01disk-01`).
4. Opravená otázka si ponechá `id`. Smazané `id` se už znovu nepoužije.
5. U maturitních otázek se aktualizuje `pokryti`, `pokryti_casti` a `osnova`.
6. Ke každé aktualizaci patří souhrn, které maturitní otázky přibyly nebo se posunuly do stavu „ano“.
