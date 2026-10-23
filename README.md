# Maturita OSY a PSI – procvičování

Statická webová aplikace bez backendu a bez knihoven: `index.html`, `style.css`, `app.js`, `data/questions.json`.

## Nahrání na GitHub Pages
1. Na GitHubu vytvoř nový repozitář (např. `maturita-osy`), klidně veřejný.
2. Nahraj do něj soubory `index.html`, `style.css`, `app.js`, `README.md` a složku `data` s `questions.json`
   (tlačítko **Add file → Upload files**, soubory přetáhni; složku `data` přetáhni celou).
3. Otevři **Settings → Pages**, v části **Build and deployment** zvol **Source: Deploy from a branch**,
   větev `main` a složku `/ (root)`, ulož.
4. Po minutě až dvou bude web na adrese `https://<tvoje-jméno>.github.io/maturita-osy/`.

Netlify: stačí přetáhnout celou složku na https://app.netlify.com/drop.

## Spuštění na vlastním počítači
Z `file://` prohlížeč JSON nenačte. Ve složce aplikace spusť `python -m http.server` a otevři `http://localhost:8000`.

## Data a statistiky
- Statistiky, výběr maturitních otázek a losování jsou v localStorage pod klíči `maturita-osy-stats-v2`,
  `maturita-osy-vyber-v2` a `maturita-osy-nastaveni-v2`. Statistiky z první verze (`…-v1`) se převezmou automaticky.
- Statistiky jsou navázané na `id` otázky – id se proto nikdy nemění.
- Otázka zmizí z „Ke zopakování“ po 2 správných odpovědích v řadě.

## Přidání dalších prezentací (nový zip)
1. Pošli nový zip a aktuální `data/questions.json`.
2. Z nového zipu vzniknou jen nové otázky. Stávající otázky a jejich `id` zůstávají.
3. Nová `id` mají tvar `<zkratka prezentace>-<pořadí>`, např. `osy21-01` nebo `psi24-03`.
   Když se číslo prezentace opakuje v jiné složce, přidá se rozlišení (např. `osy01disk-01`).
4. Opravená otázka si ponechá `id`. Smazané `id` se už znovu nepoužije.
5. U maturitních otázek se aktualizuje `pokryti`, `pokryti_casti` a `osnova`.
6. Ke každé aktualizaci patří souhrn, které maturitní otázky přibyly nebo se posunuly do stavu „ano“.
