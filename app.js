'use strict';

/*
 * Maturita OSY a PSI – procvičování k ústní maturitě.
 * Čistý JavaScript bez knihoven a bez síťových volání mimo vlastní data/questions.json.
 *
 * Statistiky jsou navázané na pole "id" otázky. Když se id nezmění,
 * zůstanou statistiky zachované i po aktualizaci questions.json.
 * Všechny přístupy do localStorage jsou v try/catch – bez něj stránka funguje, jen si nic nepamatuje.
 */

const STATS_KEY = 'maturita-osy-stats-v2';
const STATS_KEY_V1 = 'maturita-osy-stats-v1';   // starší verze aplikace – při prvním spuštění se převezme
const SELECTION_KEY = 'maturita-osy-vyber-v2';
const SETTINGS_KEY = 'maturita-osy-nastaveni-v2';
const LEARN_KEY = 'maturita-osy-vyuka-v1';      // NOVÉ: stav bodů výuky (rozumím / zopakovat)

// NOVÉ: „Moje otázky“ – výchozí výběr a jediné otázky, pro které je výuka.
const MY_MO = [1, 2, 3, 17, 18];

const REVIEW_STREAK = 2;        // počet správných odpovědí v řadě, po kterém otázka zmizí z „Ke zopakování“
const SPEECH_SECONDS = 7 * 60;  // délka projevu při losování
const NO_BASIS = 'chybí podklad';

const MODES = [
  { id: 'vyber', title: 'Výběr odpovědi', sub: 'a, b, c, d' },
  { id: 'pravda_nepravda', title: 'Pravda / nepravda', sub: 'včetně chytáků' },
  { id: 'karticka', title: 'Kartičky', sub: 'otázka / odpověď' },
  { id: 'otevrena', title: 'Otevřená odpověď', sub: 'se sebehodnocením' },
  { id: 'serazeni', title: 'Seřazení kroků', sub: 'správné pořadí' },
  { id: 'test', title: 'Test na čas', sub: '10 / 20 / 30 otázek' },
  { id: 'opakovani', title: 'Jen ke zopakování', sub: 'chybně zodpovězené' },
  { id: 'losovani', title: 'Losování k projevu', sub: '7 minut + osnova' }
];

// Typy, které lze vyhodnotit automaticky – z nich se skládá „Test na čas“.
const TEST_TYPES = ['vyber', 'pravda_nepravda', 'serazeni'];

const TYPE_LABELS = {
  vyber: 'Výběr odpovědi',
  pravda_nepravda: 'Pravda / nepravda',
  karticka: 'Kartička',
  otevrena: 'Otevřená odpověď',
  serazeni: 'Seřazení'
};

let DATA = null;          // obsah questions.json
let QUESTIONS = [];       // pole otázek
let BY_ID = new Map();    // id -> otázka
let MO = [];              // maturitní otázky
let MO_BY_NUM = new Map();
let stats = loadStats();
let selection = loadSelection();
let session = null;       // probíhající test
let timer = null;         // časovač otázky
let speech = null;        // probíhající losování
let moGroup = 'mine';     // NOVÉ: aktivní záložka na úvodní obrazovce
let learn = null;         // NOVÉ: probíhající výuka
let learnMarks = storageGet(LEARN_KEY) || {};   // NOVÉ: id bodu -> 'rozumim' | 'zopakovat'
let prevSelection = null; // NOVÉ: výběr před „Přejít na procvičení“, aby šel obnovit

const $ = (sel) => document.querySelector(sel);

/* ---------- Pomocné funkce ---------- */

// Vytvoří element; text se vkládá přes textContent, takže obsah JSON nemůže vložit HTML.
function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function percent(part, whole) {
  return whole ? Math.round((part / whole) * 100) : 0;
}

// Česká čísla: 1 otázka, 2–4 otázky, 5+ otázek
function plural(n, one, few, many) {
  if (n === 1) return `${n} ${one}`;
  if (n >= 2 && n <= 4) return `${n} ${few}`;
  return `${n} ${many}`;
}

function formatClock(sec) {
  const s = Math.max(0, sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ---------- localStorage (vše v try/catch) ---------- */

function storageGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}

function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* soukromý režim nebo plné úložiště */ }
}

function emptyStats() {
  return { verze: 2, answered: 0, correct: 0, wrong: 0, q: {}, review: [], los: {} };
}

function loadStats() {
  const saved = storageGet(STATS_KEY);
  if (saved) return Object.assign(emptyStats(), saved);
  // Převzetí statistik z první verze aplikace (stejná id otázek).
  const v1 = storageGet(STATS_KEY_V1);
  if (v1) {
    const migrated = Object.assign(emptyStats(), {
      answered: v1.answered || 0, correct: v1.correct || 0, wrong: v1.wrong || 0,
      q: v1.q || {}, review: v1.review || []
    });
    for (const id of migrated.review) if (migrated.q[id]) migrated.q[id].streak = 0;
    storageSet(STATS_KEY, migrated);
    return migrated;
  }
  return emptyStats();
}

function saveStats() {
  storageSet(STATS_KEY, stats);
}

// ZMĚNA: když výběr v localStorage není (první spuštění), předvyberou se „Moje otázky“.
function loadSelection() {
  const saved = storageGet(SELECTION_KEY);
  return new Set(Array.isArray(saved) ? saved : MY_MO);
}

function saveSelection() {
  storageSet(SELECTION_KEY, [...selection].sort((a, b) => a - b));
}

// Otázka zmizí z „Ke zopakování“ až po REVIEW_STREAK správných odpovědích v řadě.
function recordAnswer(q, correct) {
  const s = stats.q[q.id] || (stats.q[q.id] = { ok: 0, bad: 0, last: null, streak: 0 });
  if (correct) { s.ok++; s.streak = (s.streak || 0) + 1; } else { s.bad++; s.streak = 0; }
  s.last = correct;
  stats.answered++;
  if (correct) stats.correct++; else stats.wrong++;

  const idx = stats.review.indexOf(q.id);
  if (!correct && idx === -1) stats.review.push(q.id);
  if (correct && idx !== -1 && s.streak >= REVIEW_STREAK) stats.review.splice(idx, 1);
  saveStats();
}

function inReview(id) {
  return stats.review.includes(id);
}

// Zvládnuto = poslední odpověď správná a otázka není ke zopakování.
function isMastered(id) {
  const s = stats.q[id];
  return !!(s && s.last === true && !inReview(id));
}

/* ---------- Výběr maturitních otázek ---------- */

function isSelectable(n) {
  const m = MO_BY_NUM.get(n);
  return !!m && m.pokryti !== NO_BASIS;
}

function inSelection(q) {
  return q.maturitni_otazky.some((n) => selection.has(n));
}

function selectedQuestions() {
  return QUESTIONS.filter(inSelection);
}

function reviewIds() {
  return stats.review.filter((id) => BY_ID.has(id));
}

function questionsForMo(n) {
  return QUESTIONS.filter((q) => q.maturitni_otazky.includes(n));
}

/* ---------- Načtení dat ---------- */

async function init() {
  bindNav();
  try {
    const res = await fetch('data/questions.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
  } catch (err) {
    showLoadError(err);
    return;
  }
  QUESTIONS = Array.isArray(DATA.otazky) ? DATA.otazky : [];
  MO = Array.isArray(DATA.maturitni_otazky) ? DATA.maturitni_otazky : [];
  MO.forEach((m) => MO_BY_NUM.set(m.cislo, m));
  const dupes = [];
  for (const q of QUESTIONS) {
    if (BY_ID.has(q.id)) dupes.push(q.id);
    BY_ID.set(q.id, q);
  }
  if (dupes.length) console.warn('Duplicitní id v questions.json:', dupes);

  // Z uloženého výběru vyhodíme otázky, které mezitím přestaly být dostupné.
  for (const n of [...selection]) if (!isSelectable(n)) selection.delete(n);

  $('#loading').hidden = true;
  buildHome();
  showView('home');
}

function showLoadError(err) {
  const box = $('#loading');
  box.className = 'card error';
  box.replaceChildren(
    el('h2', { text: 'Otázky se nepodařilo načíst' }),
    el('p', null, 'Soubor ', el('code', { text: 'data/questions.json' }), ' nejde načíst (' + err.message + ').'),
    el('p', null, 'Pokud otevíráš index.html přímo ze složky (adresa začíná file://), prohlížeč načítání zablokuje. ' +
      'Spusť ve složce s aplikací jednoduchý server, např. ', el('code', { text: 'python -m http.server' }),
      ', a otevři ', el('code', { text: 'http://localhost:8000' }), '. Na GitHub Pages nebo Netlify funguje aplikace bez úprav.')
  );
}

/* ---------- Navigace ---------- */

function bindNav() {
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!DATA) return;
      if (session && !confirm('Opravdu ukončit rozpracovaný test? Dosavadní odpovědi zůstanou uložené.')) return;
      if (speech && !speech.done && !confirm('Opravdu přerušit losování? Výsledek se neuloží.')) return;
      endSession();
      endSpeech();
      showView(btn.dataset.nav);
    });
  });
}

function showView(name) {
  for (const v of ['home', 'quiz', 'result', 'speech', 'learn', 'overview']) {  // ZMĚNA: + learn
    $('#view-' + v).hidden = v !== name;
  }
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.nav === name);
    if (t.dataset.nav === name) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  if (name === 'home') renderHome();
  if (name === 'learn') { learn = null; renderLearnList(); }  // NOVÉ
  if (name === 'overview') renderOverview();
  window.scrollTo(0, 0);
}

/* ---------- Úvodní obrazovka ---------- */

function buildHome() {
  const saved = storageGet(SETTINGS_KEY) || {};

  $('#mode-grid').replaceChildren(...MODES.map((m) =>
    el('label', { class: 'mode', 'data-mode': m.id },
      el('input', { type: 'radio', name: 'mode', value: m.id, checked: m.id === (saved.mode || 'vyber') }),
      el('span', { class: 'mode-title', text: m.title }),
      el('span', { class: 'mode-sub', text: m.sub })
    )
  ));
  if (!document.querySelector('input[name="mode"]:checked')) document.querySelector('input[name="mode"]').checked = true;
  if (saved.cas) $('#sel-cas').value = saved.cas;
  updateLengthOptions(saved.delka);

  // ZMĚNA: „Vybrat vše“ a „Zrušit výběr“ pracují s právě otevřenou záložkou.
  $('#btn-all').addEventListener('click', () => {
    groupMo(moGroup).forEach((m) => { if (isSelectable(m.cislo)) selection.add(m.cislo); });
    saveSelection();
    renderHome();
  });
  $('#btn-none').addEventListener('click', () => {
    groupMo(moGroup).forEach((m) => selection.delete(m.cislo));
    saveSelection();
    renderHome();
  });
  // NOVÉ: přepínání záložek „Moje otázky“ / „Další otázky“
  document.querySelectorAll('.subtab').forEach((t) => t.addEventListener('click', () => {
    moGroup = t.dataset.group;
    renderHome();
  }));
  $('#mo-list').addEventListener('change', (e) => {
    const n = Number(e.target.value);
    if (e.target.checked) selection.add(n); else selection.delete(n);
    saveSelection();
    renderHome();
  });
  $('#setup-form').addEventListener('change', (e) => {
    if (e.target.name === 'mode') updateLengthOptions($('#sel-delka').value);
    updatePoolInfo();
  });
  $('#setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const s = readSettings();
    storageSet(SETTINGS_KEY, s);
    if (s.mode === 'losovani') startSpeech();
    else startSession(s);
  });
}

function currentMode() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked ? checked.value : 'vyber';
}

// Test na čas má pevně 10 / 20 / 30 otázek, ostatní režimy navíc „Všechny“.
function updateLengthOptions(preferred) {
  const sel = $('#sel-delka');
  const isTest = currentMode() === 'test';
  const opts = [['10', '10'], ['20', '20'], ['30', '30']];
  if (!isTest) opts.push(['all', 'Všechny']);
  sel.replaceChildren(...opts.map(([v, t]) => el('option', { value: v }, t)));
  sel.value = opts.some(([v]) => v === preferred) ? preferred : (isTest ? '10' : '20');
  $('#settings').hidden = currentMode() === 'losovani';
}

function readSettings() {
  return { mode: currentMode(), cas: $('#sel-cas').value, delka: $('#sel-delka').value };
}

function buildPool(settings) {
  let pool;
  if (settings.mode === 'opakovani') pool = reviewIds().map((id) => BY_ID.get(id));
  else if (settings.mode === 'test') pool = QUESTIONS.filter((q) => TEST_TYPES.includes(q.typ));
  else pool = QUESTIONS.filter((q) => q.typ === settings.mode);
  return pool.filter(inSelection);
}

function updatePoolInfo() {
  const s = readSettings();
  const btn = $('#btn-start');
  if (!selection.size) {
    $('#pool-info').textContent = 'Nejdřív nahoře vyber aspoň jednu maturitní otázku.';
    btn.disabled = true;
    btn.textContent = 'Spustit';
    return;
  }
  if (s.mode === 'losovani') {
    $('#pool-info').textContent = `Vylosuje se jedna z ${plural(selection.size, 'vybrané maturitní otázky', 'vybraných maturitních otázek', 'vybraných maturitních otázek')} a spustí se odpočet 7 minut.`;
    btn.disabled = false;
    btn.textContent = 'Losovat';
    return;
  }
  btn.textContent = 'Spustit';
  const n = buildPool(s).length;
  const len = s.delka === 'all' ? n : Math.min(n, Number(s.delka));
  let text;
  if (n === 0) {
    text = s.mode === 'opakovani'
      ? 'Ve vybraných maturitních otázkách teď nic ke zopakování není.'
      : 'Pro tento výběr nejsou žádné otázky tohoto typu.';
  } else {
    text = `K dispozici: ${plural(n, 'otázka', 'otázky', 'otázek')}. Spustí se ${plural(len, 'otázka', 'otázky', 'otázek')}.`;
    if (s.mode === 'test' && n < Number(s.delka)) text += ' (Méně než zvolená délka – použijí se všechny dostupné.)';
  }
  $('#pool-info').textContent = text;
  btn.disabled = n === 0;
}

function renderHome() {
  $('#home-stats').replaceChildren(...statTiles());

  // ZMĚNA: počet vybraných nad oběma záložkami, seznam jen pro aktivní záložku
  $('#mo-count').textContent = `Vybráno: ${plural(selection.size, 'maturitní otázka', 'maturitní otázky', 'maturitních otázek')} · ${plural(selectedQuestions().length, 'otázka', 'otázky', 'otázek')} k procvičování`;
  document.querySelectorAll('.subtab').forEach((t) => {
    const group = groupMo(t.dataset.group);
    const sel = group.filter((m) => selection.has(m.cislo)).length;
    t.setAttribute('aria-selected', String(t.dataset.group === moGroup));
    t.replaceChildren(t.dataset.group === 'mine' ? 'Moje otázky ' : 'Další otázky ', el('span', { class: 'count', text: `(${sel}/${group.length})` }));
  });
  $('#mo-list').setAttribute('aria-labelledby', moGroup === 'mine' ? 'tab-mine' : 'tab-more');
  const notice = $('#mo-notice');
  if (!selection.size) {
    notice.className = 'notice warn';
    notice.textContent = 'Zatím není vybraná žádná maturitní otázka. Zaškrtni ty, které chceš procvičovat.';
  } else if (moGroup === 'more') {
    notice.className = 'notice';
    notice.textContent = 'Zaškrtnuté otázky z této záložky se přidají k procvičování spolu s „Mými otázkami“.';
  } else {
    notice.className = 'notice';
    notice.textContent = 'Pro tyto otázky je k dispozici i sekce Výuka.';
  }
  // NOVÉ: po „Přejít na procvičení“ z Výuky lze vrátit původní výběr
  if (prevSelection) {
    notice.className = 'notice warn';
    notice.replaceChildren(
      'Výběr je nastavený jen na otázku z výuky. ',
      el('button', { type: 'button', class: 'btn btn-small', onclick: () => {
        selection = new Set(prevSelection);
        prevSelection = null;
        saveSelection();
        renderHome();
      } }, 'Obnovit předchozí výběr')
    );
  }
  $('#mo-list').replaceChildren(...groupMo(moGroup).map((m) => {
    const ok = isSelectable(m.cislo);
    const qs = questionsForMo(m.cislo);
    const mastered = qs.filter((q) => isMastered(q.id)).length;
    const checked = ok && selection.has(m.cislo);
    return el('li', { class: 'mo-item' + (checked ? ' checked' : '') + (ok ? '' : ' disabled') },
      el('label', null,
        el('input', { type: 'checkbox', value: String(m.cislo), checked, disabled: !ok, 'aria-describedby': `mo-meta-${m.cislo}` }),
        el('span', { class: 'mo-num', text: m.cislo + '.' }),
        el('span', { class: 'mo-name', text: m.nazev }),
        el('span', { class: 'mo-meta', id: `mo-meta-${m.cislo}` },
          coveragePill(m.pokryti),
          ok ? `${plural(qs.length, 'otázka', 'otázky', 'otázek')} · zvládnuto ${mastered}` : 'nelze vybrat'
        )
      )
    );
  }));

  // Kolonka „Ke zopakování“
  const review = reviewIds();
  const reviewSel = review.filter((id) => inSelection(BY_ID.get(id)));
  $('#review-card').replaceChildren(
    el('div', null,
      el('strong', { text: 'Ke zopakování: ' + review.length }),
      el('p', { class: 'hint', text: `Z toho ve vybraných maturitních otázkách: ${reviewSel.length}. Otázka zmizí až po ${REVIEW_STREAK} správných odpovědích v řadě.` })
    ),
    el('button', {
      type: 'button', class: 'btn btn-primary', disabled: reviewSel.length === 0,
      onclick: () => startSession({ mode: 'opakovani', cas: $('#sel-cas').value, delka: 'all' })
    }, 'Opakovat chybné')
  );
  updateLengthOptions($('#sel-delka').value);
  updatePoolInfo();
}

// NOVÉ: maturitní otázky podle záložky
function groupMo(group) {
  return MO.filter((m) => (group === 'mine') === MY_MO.includes(m.cislo));
}

function coveragePill(pokryti) {
  const cls = pokryti === 'ano' ? 'ano' : pokryti === NO_BASIS ? 'ne' : 'castecne';
  return el('span', { class: 'pill ' + cls, text: pokryti });
}

function statTiles() {
  return [
    statTile(stats.answered, 'zodpovězeno'),
    statTile(stats.correct, 'správně', 'ok'),
    statTile(stats.wrong, 'špatně', 'bad'),
    statTile(percent(stats.correct, stats.answered) + ' %', 'úspěšnost')
  ];
}

function statTile(value, label, cls) {
  return el('div', { class: 'stat' + (cls ? ' ' + cls : '') },
    el('div', { class: 'stat-value', text: String(value) }),
    el('div', { class: 'stat-label', text: label })
  );
}

/* ---------- Průběh testu ---------- */

function startSession(settings) {
  const pool = buildPool(settings);
  if (!pool.length) return;
  const len = settings.delka === 'all' ? pool.length : Math.min(pool.length, Number(settings.delka));
  session = { settings, items: shuffle(pool).slice(0, len), index: 0, results: [], answered: false, reveal: null };
  showView('quiz');
  renderQuestion();
}

function endSession() {
  stopTimer();
  session = null;
}

// Štítek „OSY 01 · str. 3“ – zkratka prezentace a čísla stránek ze zdroje.
function sourceLabel(q) {
  const m = q.zdroj.match(/str\. .+$/);
  return m ? `${q.prezentace} · ${m[0]}` : q.prezentace;
}

function renderQuestion() {
  const q = session.items[session.index];
  session.answered = false;
  session.reveal = null;
  const n = session.items.length;
  $('#quiz-progress').textContent = `Otázka ${session.index + 1} / ${n}`;
  $('#progress-bar').style.width = percent(session.index, n) + '%';

  $('#question').replaceChildren(
    el('div', { class: 'q-meta' },
      el('span', { class: 'badge source', title: q.zdroj, text: sourceLabel(q) }),
      el('span', { class: 'badge mo', text: 'Mat. ot. ' + q.maturitni_otazky.join(', ') }),
      el('span', { class: 'badge', text: TYPE_LABELS[q.typ] || q.typ }),
      el('span', { class: 'badge', text: q.tema }),
      q.poznamka ? el('span', { class: 'badge warn', text: 'k ověření' }) : null
    ),
    el('p', { class: 'q-text', text: q.zneni }),
    el('div', { id: 'answer-area' }),
    el('div', { id: 'feedback-area' })
  );

  const renderers = {
    vyber: renderChoice,
    pravda_nepravda: renderTrueFalse,
    karticka: renderFlashcard,
    otevrena: renderOpen,
    serazeni: renderOrder
  };
  (renderers[q.typ] || renderUnknown)(q, $('#answer-area'));
  startTimer(Number(session.settings.cas));
}

function renderUnknown(q, area) {
  area.append(el('p', { text: 'Neznámý typ otázky: ' + q.typ }));
  showNextButton();
}

// Výběr odpovědi – možnosti se zamíchají, správnost se kontroluje podle původního indexu.
function renderChoice(q, area) {
  const list = el('div', { class: 'options' });
  for (const i of shuffle(q.moznosti.map((_, idx) => idx))) {
    list.append(el('button', {
      type: 'button', class: 'option', 'data-key': String(i),
      onclick: () => {
        if (session.answered) return;
        markOptions(list, String(q.spravna_odpoved), String(i));
        finish(q, i === q.spravna_odpoved);
      }
    }, q.moznosti[i]));
  }
  area.append(list);
}

function renderTrueFalse(q, area) {
  const list = el('div', { class: 'options tf' });
  for (const [value, label] of [[true, 'Pravda'], [false, 'Nepravda']]) {
    list.append(el('button', {
      type: 'button', class: 'option', 'data-key': String(value),
      onclick: () => {
        if (session.answered) return;
        markOptions(list, String(q.spravna_odpoved), String(value));
        finish(q, value === q.spravna_odpoved);
      }
    }, label));
  }
  area.append(list);
}

function markOptions(list, correctKey, chosenKey) {
  list.querySelectorAll('.option').forEach((b) => {
    b.disabled = true;
    if (b.dataset.key === correctKey) b.classList.add('correct');
    else if (b.dataset.key === chosenKey) b.classList.add('wrong');
  });
}

// Kartička: nejdřív otočit, pak sebehodnocení.
function renderFlashcard(q, area) {
  const reveal = () => {
    stopTimer();
    area.replaceChildren(
      el('div', { class: 'flashcard', text: q.spravna_odpoved }),
      selfAssess(q, [['Věděl(a) jsem', true], ['Nevěděl(a) jsem', false]])
    );
  };
  area.append(el('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: reveal }, 'Otočit kartičku'));
  session.reveal = reveal;
}

// Otevřená odpověď: vlastní odpověď → vzorová odpověď → sebehodnocení.
// „Částečně“ se počítá jako nezvládnuté, aby otázka zůstala ke zopakování.
function renderOpen(q, area) {
  const ta = el('textarea', { placeholder: 'Napiš svou odpověď (nepovinné – slouží jen pro porovnání)…', 'aria-label': 'Tvoje odpověď' });
  const reveal = () => {
    stopTimer();
    ta.readOnly = true;
    area.replaceChildren(
      ta.value.trim() ? el('div', null, el('h3', { text: 'Tvoje odpověď' }), el('div', { class: 'flashcard', text: ta.value })) : null,
      el('h3', { text: 'Vzorová odpověď' }),
      el('div', { class: 'flashcard model-answer', text: q.spravna_odpoved }),
      selfAssess(q, [['Správně', true], ['Částečně', false], ['Špatně', false]])
    );
  };
  area.append(ta, el('div', { class: 'btn-row' },
    el('button', { type: 'button', class: 'btn btn-primary', onclick: reveal }, 'Zobrazit vzorovou odpověď')));
  session.reveal = reveal;
}

function selfAssess(q, buttons) {
  return el('div', null,
    el('p', { class: 'hint', text: 'Ohodnoť se:' }),
    el('div', { class: 'btn-row' }, ...buttons.map(([label, correct]) =>
      el('button', {
        type: 'button', class: 'btn' + (correct ? ' btn-primary' : ''),
        onclick: (e) => {
          if (session.answered) return;
          e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => { b.disabled = true; });
          finish(q, correct, { selfAssessed: true, label });
        }
      }, label)
    ))
  );
}

// Seřazení: položky se posouvají šipkami (funguje i na mobilu bez přetahování).
function renderOrder(q, area) {
  const correctOrder = q.spravna_odpoved;
  let order = shuffle(correctOrder);
  for (let guard = 0; order.length > 1 && order.every((v, i) => v === correctOrder[i]) && guard < 10; guard++) {
    order = shuffle(correctOrder);
  }
  const list = el('ol', { class: 'order-list' });

  const draw = () => {
    list.replaceChildren(...order.map((itemIdx, pos) =>
      el('li', { class: 'order-item' },
        el('span', { class: 'order-num', text: (pos + 1) + '.' }),
        el('span', { class: 'order-text', text: q.moznosti[itemIdx] }),
        el('span', { class: 'order-btns' },
          el('button', { type: 'button', 'aria-label': 'Posunout nahoru', disabled: pos === 0 || session.answered, onclick: () => move(pos, -1) }, '↑'),
          el('button', { type: 'button', 'aria-label': 'Posunout dolů', disabled: pos === order.length - 1 || session.answered, onclick: () => move(pos, 1) }, '↓')
        )
      )
    ));
  };
  const move = (pos, dir) => {
    const target = pos + dir;
    [order[pos], order[target]] = [order[target], order[pos]];
    draw();
  };
  const check = () => {
    if (session.answered) return;
    const correct = order.every((v, i) => v === correctOrder[i]);
    session.answered = true;   // zamkne šipky ještě před překreslením
    draw();
    list.querySelectorAll('.order-item').forEach((li, i) => {
      li.classList.add(order[i] === correctOrder[i] ? 'correct' : 'wrong');
    });
    checkBtn.disabled = true;
    session.answered = false;
    finish(q, correct);
  };
  const checkBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: check }, 'Zkontrolovat pořadí');
  session.lockOrder = () => { session.answered = true; draw(); };

  draw();
  area.append(list, el('div', { class: 'btn-row' }, checkBtn));
}

function finish(q, correct, opts = {}) {
  if (session.answered) return;
  session.answered = true;
  stopTimer();
  recordAnswer(q, correct);
  session.results.push({ q, correct });

  const fb = el('div', { class: 'feedback ' + (correct ? 'ok' : 'bad') });
  let title;
  if (opts.timeout) title = 'Čas vypršel';
  else if (opts.selfAssessed) title = 'Hodnocení: ' + opts.label;
  else title = correct ? 'Správně!' : 'Špatně';
  fb.append(el('p', { class: 'feedback-title', text: title }));

  if (!correct && !opts.selfAssessed) {
    fb.append(el('p', null, el('strong', { text: 'Správná odpověď: ' }), correctAnswerText(q)));
  }
  if (q.vysvetleni) fb.append(el('p', { text: q.vysvetleni }));
  fb.append(el('p', { class: 'source', text: 'Zdroj: ' + q.zdroj }));
  if (q.poznamka) fb.append(el('p', { class: 'note', text: 'Poznámka: ' + q.poznamka }));

  const s = stats.q[q.id];
  if (!correct) fb.append(el('p', { class: 'source', text: 'Otázka je v kolonce „Ke zopakování“.' }));
  else if (inReview(q.id)) {
    const left = REVIEW_STREAK - (s.streak || 0);
    fb.append(el('p', { class: 'source', text: `Ještě ${plural(left, 'správná odpověď', 'správné odpovědi', 'správných odpovědí')} v řadě a otázka zmizí z „Ke zopakování“.` }));
  }

  if (q.nad_ramec && q.nad_ramec.text) {
    fb.append(el('details', { class: 'extra' },
      el('summary', { text: 'Něco navíc' }),
      el('p', { text: q.nad_ramec.text }),
      q.nad_ramec.mimo_prezentace ? el('p', { class: 'extra-note', text: 'Informace nad rámec prezentací – před použitím u maturity si ji ověř.' }) : null
    ));
  }

  $('#feedback-area').append(fb);
  showNextButton();
}

function showNextButton() {
  const last = session.index >= session.items.length - 1;
  const btn = el('button', { type: 'button', class: 'btn btn-primary btn-block', id: 'btn-next', onclick: next },
    last ? 'Zobrazit výsledek' : 'Další otázka');
  $('#feedback-area').append(el('div', { class: 'btn-row' }, btn));
  btn.focus({ preventScroll: true });
  btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function next() {
  if (session.index >= session.items.length - 1) {
    renderResult();
    return;
  }
  session.index++;
  renderQuestion();
  window.scrollTo(0, 0);
}

function correctAnswerText(q) {
  switch (q.typ) {
    case 'vyber': return q.moznosti[q.spravna_odpoved];
    case 'pravda_nepravda': return q.spravna_odpoved ? 'Pravda' : 'Nepravda';
    case 'serazeni': return q.spravna_odpoved.map((i, n) => `${n + 1}. ${q.moznosti[i]}`).join('  ');
    default: return String(q.spravna_odpoved);
  }
}

/* ---------- Časovač otázky ---------- */

// Čas se počítá od pevného konce, takže sedí i po přepnutí do jiné karty prohlížeče.
function startTimer(seconds) {
  stopTimer();
  const box = $('#timer');
  if (!seconds) { box.hidden = true; return; }
  box.hidden = false;
  timer = { end: Date.now() + seconds * 1000, total: seconds, id: null };
  const tick = () => {
    const left = Math.ceil((timer.end - Date.now()) / 1000);
    $('#timer-text').textContent = Math.max(0, left) + ' s';
    $('#timer-bar').style.width = percent(Math.max(0, left), timer.total) + '%';
    box.classList.toggle('low', left <= 5);
    if (left <= 0) {
      stopTimer();
      onTimeout();
    }
  };
  tick();
  timer.id = setInterval(tick, 250);
}

function stopTimer() {
  if (timer && timer.id) clearInterval(timer.id);
  timer = null;
}

// Po vypršení času: u automaticky hodnocených otázek = špatná odpověď,
// u kartiček a otevřených otázek se jen odkryje odpověď a hodnotíš se sám/sama.
function onTimeout() {
  if (!session || session.answered) return;
  const q = session.items[session.index];
  if ((q.typ === 'karticka' || q.typ === 'otevrena') && session.reveal) {
    session.reveal();
    return;
  }
  const list = document.querySelector('#answer-area .options');
  if (list) markOptions(list, String(q.spravna_odpoved), null);
  if (q.typ === 'serazeni' && session.lockOrder) session.lockOrder();
  document.querySelectorAll('#answer-area button').forEach((b) => { b.disabled = true; });
  session.answered = false;
  finish(q, false, { timeout: true });
}

/* ---------- Výsledek ---------- */

function renderResult() {
  stopTimer();
  const { results, settings } = session;
  const ok = results.filter((r) => r.correct).length;
  const wrong = results.filter((r) => !r.correct);

  $('#view-result').replaceChildren(
    el('div', { class: 'card' },
      el('h2', { text: 'Výsledek' }),
      el('p', { class: 'big-score', text: `${ok} / ${results.length}` }),
      el('p', { class: 'hint', text: `Úspěšnost ${percent(ok, results.length)} %` }),
      el('div', { class: 'btn-row' },
        el('button', { type: 'button', class: 'btn btn-primary', onclick: () => startSession(settings) }, 'Znovu se stejným nastavením'),
        wrong.length ? el('button', { type: 'button', class: 'btn', onclick: () => startSession({ ...settings, mode: 'opakovani', delka: 'all' }) }, 'Opakovat chybné') : null,
        el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => showView('home') }, 'Zpět')
      )
    ),
    wrong.length ? el('div', { class: 'card' },
      el('h2', { text: 'Chybné odpovědi' }),
      el('ul', { class: 'wrong-list' }, ...wrong.map(({ q }) =>
        el('li', null,
          el('div', { text: q.zneni }),
          q.typ === 'karticka' || q.typ === 'otevrena' ? null : el('div', null, el('strong', { text: 'Správně: ' }), correctAnswerText(q)),
          el('div', { class: 'muted', text: sourceLabel(q) + ' · ' + q.zdroj.split(',')[0] })
        )
      ))
    ) : null
  );
  session = null;
  showView('result');
}

/* ---------- Losování k projevu ---------- */

// ZMĚNA: opts.pool = z čeho losovat, opts.prep = režim „Vylosovat a připravit“ z Výuky (během odpočtu je vidět osnova a výklad).
function startSpeech(opts = {}) {
  const pool = opts.pool || [...selection].filter(isSelectable);
  if (!pool.length) return;
  const n = pool[Math.floor(Math.random() * pool.length)];
  speech = { n, opts, end: Date.now() + SPEECH_SECONDS * 1000, paused: null, id: null, done: false };
  showView('speech');
  renderSpeechRunning();
  speech.id = setInterval(tickSpeech, 250);
}

function endSpeech() {
  if (speech && speech.id) clearInterval(speech.id);
  speech = null;
}

function speechLeft() {
  const ref = speech.paused !== null ? speech.paused : Date.now();
  return Math.ceil((speech.end - ref) / 1000);
}

function tickSpeech() {
  if (!speech || speech.done) return;
  const left = speechLeft();
  const clock = $('#speech-clock');
  if (clock) {
    clock.textContent = formatClock(left);
    clock.classList.toggle('low', left <= 60);
  }
  if (left <= 0) finishSpeech();
}

function renderSpeechRunning() {
  const m = MO_BY_NUM.get(speech.n);
  const pauseBtn = el('button', { type: 'button', class: 'btn', onclick: () => {
    if (speech.paused === null) { speech.paused = Date.now(); pauseBtn.textContent = 'Pokračovat'; }
    else { speech.end += Date.now() - speech.paused; speech.paused = null; pauseBtn.textContent = 'Pauza'; }
    tickSpeech();
  } }, 'Pauza');

  $('#view-speech').replaceChildren(
    el('div', { class: 'card' },
      el('p', { class: 'speech-num', text: `Vylosovaná maturitní otázka č. ${m.cislo}` }),
      el('h2', { class: 'speech-title', text: m.nazev }),
      el('p', { class: 'hint', text: speech.opts.prep
        ? 'Příprava: projdi si osnovu a výklad, pak mluv nahlas jako u maturity.'
        : 'Mluv nahlas, jako u maturity. Osnova se ukáže po skončení času.' }),
      el('div', { class: 'speech-clock', id: 'speech-clock', role: 'timer', 'aria-live': 'off', text: formatClock(SPEECH_SECONDS) }),
      speech.opts.prep ? prepMaterials(m) : null,  // NOVÉ: osnova a výklad během přípravy
      el('div', { class: 'btn-row' },
        pauseBtn,
        el('button', { type: 'button', class: 'btn btn-primary', onclick: finishSpeech }, 'Mám hotovo – ukázat osnovu'),
        el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => {
          if (!confirm('Zrušit losování? Výsledek se neuloží.')) return;
          endSpeech();
          showView('home');
        } }, 'Zrušit')
      )
    )
  );
  tickSpeech();
}

function finishSpeech() {
  if (!speech || speech.done) return;
  speech.done = true;
  if (speech.id) clearInterval(speech.id);
  const m = MO_BY_NUM.get(speech.n);
  const answer = (value, label) => el('button', {
    type: 'button', class: 'btn' + (value === 'ano' ? ' btn-primary' : ''),
    onclick: (e) => {
      e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      recordSpeech(m.cislo, value);
      $('#speech-after').replaceChildren(
        el('p', { class: 'feedback-title', text: `Uloženo: ${label}. Losování této otázky celkem: ${stats.los[m.cislo].count}×.` }),
        el('div', { class: 'btn-row' },
          el('button', { type: 'button', class: 'btn btn-primary', onclick: () => { const o = speech.opts; endSpeech(); startSpeech(o); } }, 'Losovat znovu'),
          el('button', { type: 'button', class: 'btn', onclick: () => {
            endSpeech();
            selectionOnly(m.cislo);
          } }, 'Procvičit otázky k tématu'),
          el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { endSpeech(); showView('home'); } }, 'Zpět')
        )
      );
    }
  }, label);

  $('#view-speech').replaceChildren(
    el('div', { class: 'card' },
      el('p', { class: 'speech-num', text: `Maturitní otázka č. ${m.cislo} · pokrytí: ${m.pokryti}` }),
      el('h2', { class: 'speech-title', text: m.nazev }),
      el('h3', { text: 'Osnova z prezentací' }),
      el('ol', { class: 'osnova' }, ...m.osnova.map((b) => el('li', { text: b }))),
      m.poznamka ? el('p', { class: 'note hint', text: m.poznamka }) : null,
      el('h3', { text: 'Zvládl/a jsem to?' }),
      el('div', { id: 'speech-after' },
        el('div', { class: 'btn-row' }, answer('ano', 'Ano'), answer('castecne', 'Částečně'), answer('ne', 'Ne'))
      )
    )
  );
}

function recordSpeech(n, value) {
  const s = stats.los[n] || (stats.los[n] = { count: 0, ano: 0, castecne: 0, ne: 0, posledni: null });
  s.count++;
  s[value]++;
  s.posledni = value;
  saveStats();
}

// Po losování: test (výběr odpovědi) jen z vylosované otázky; uložený výběr se nemění.
function selectionOnly(n) {
  const pool = QUESTIONS.filter((q) => q.typ === 'vyber' && q.maturitni_otazky.includes(n));
  if (!pool.length) { showView('home'); return; }
  session = { settings: { mode: 'vyber', cas: '0', delka: '10' }, items: shuffle(pool).slice(0, 10), index: 0, results: [], answered: false, reveal: null };
  showView('quiz');
  renderQuestion();
}

/* ---------- NOVÉ: Výuka ---------- */
// Výuka vychází jen z pole vyuka v questions.json (body, výklad a pojmy z prezentací); nad_ramec se nepoužívá.

// Výuka je jen pro „Moje otázky“, které jsou vybrané a mají výukový obsah.
function learnAvailable() {
  return MY_MO.filter((n) => selection.has(n) && MO_BY_NUM.get(n) && MO_BY_NUM.get(n).vyuka);
}

function srcLabel(x) {
  const m = x.zdroj.match(/str\. .+$/);
  return m ? `${x.prezentace} · ${m[0]}` : x.prezentace;
}

function srcLine(x) {
  return el('p', { class: 'src' }, 'Zdroj: ', el('strong', { text: srcLabel(x) }), ` (${x.zdroj.split(', str.')[0]})`);
}

function saveLearnMarks() {
  storageSet(LEARN_KEY, learnMarks);
}

function repeatBodies(m) {
  return m.vyuka.body.filter((b) => learnMarks[b.id] === 'zopakovat');
}

function renderLearnList() {
  const avail = learnAvailable();
  const view = $('#view-learn');
  if (!avail.length) {
    view.replaceChildren(el('div', { class: 'card' },
      el('h2', { text: 'Výuka' }),
      el('p', { text: 'Výuka je připravená jen pro maturitní otázky 1, 2, 3, 17 a 18 a zobrazí se, když je máš zaškrtnuté v záložce „Moje otázky“.' }),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => { moGroup = 'mine'; showView('home'); } }, 'Vybrat otázky')
    ));
    return;
  }
  view.replaceChildren(
    el('div', { class: 'card' },
      el('h2', { text: 'Výuka' }),
      el('p', { class: 'hint', text: 'Krokovaný výklad k vybraným otázkám ze záložky „Moje otázky“. Vše vychází z prezentací – u každého bodu je zdroj.' }),
      el('ul', { class: 'learn-list' }, ...avail.map((n) => {
        const m = MO_BY_NUM.get(n);
        const total = m.vyuka.body.length;
        const ok = m.vyuka.body.filter((b) => learnMarks[b.id] === 'rozumim').length;
        const rep = repeatBodies(m).length;
        return el('li', { class: 'learn-item' },
          el('div', { class: 'learn-name' },
            el('strong', { text: `${m.cislo}. ` }), m.nazev,
            el('span', { class: 'learn-meta', text: `${plural(total, 'bod', 'body', 'bodů')} · rozumím ${ok} · zopakovat ${rep}` })
          ),
          el('button', { type: 'button', class: 'btn btn-primary', 'aria-label': `Začít výuku: otázka ${m.cislo}`, onclick: () => startLearn(n) }, 'Začít výuku')
        );
      }))
    ),
    el('div', { class: 'card' },
      el('h2', { text: 'Losování k projevu' }),
      el('p', { class: 'hint', text: 'Vylosuje jednu z otázek výše, ukáže osnovu a výklad a spustí odpočet 7 minut.' }),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => startSpeech({ pool: avail, prep: true }) }, 'Vylosovat a připravit')
    )
  );
}

function startLearn(n) {
  const m = MO_BY_NUM.get(n);
  // Body označené „Potřebuju zopakovat“ se ukážou v úvodu výuky (krok -1).
  learn = { n, step: repeatBodies(m).length ? -1 : 0 };
  renderLearnStep();
}

function renderLearnStep() {
  const m = MO_BY_NUM.get(learn.n);
  const body = m.vyuka.body;
  const total = body.length;
  const view = $('#view-learn');
  const title = el('p', { class: 'speech-num', text: `Výuka · maturitní otázka č. ${m.cislo}: ${m.nazev}` });
  const backToList = el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { learn = null; renderLearnList(); } }, 'Zpět na seznam');

  if (learn.step === -1) {
    view.replaceChildren(el('div', { class: 'card' },
      title,
      el('h2', { text: 'Nejdřív zopakuj' }),
      el('p', { class: 'hint', text: 'Tyto body sis minule označil(a) jako „Potřebuju zopakovat“.' }),
      el('ol', { class: 'repeat-list' }, ...repeatBodies(m).map((b) =>
        el('li', null, el('strong', { text: b.text }), el('p', { class: 'step-expl', text: b.vysvetleni }), srcLine(b))
      )),
      el('div', { class: 'nav-row' },
        backToList,
        el('button', { type: 'button', class: 'btn btn-primary', onclick: () => { learn.step = 0; renderLearnStep(); } }, 'Začít výuku')
      )
    ));
    return;
  }

  if (learn.step >= total) {
    const v = m.vyuka;
    view.replaceChildren(el('div', { class: 'card' },
      title,
      el('h2', { text: 'Celý výklad' }),
      el('p', { class: 'vyklad', text: v.vyklad }),
      el('p', { class: 'src', text: 'Výklad je sestaven z bodů výuky – jejich zdroje jsou uvedené u jednotlivých kroků.' }),
      el('h3', { text: 'Doporučené pořadí výkladu' }),
      el('ol', { class: 'osnova' }, ...v.poradi_vykladu.map((t) => el('li', { text: t }))),
      el('h3', { text: 'Klíčové pojmy' }),
      el('dl', { class: 'pojmy' }, ...v.klicove_pojmy.flatMap((k) => [
        el('dt', { text: k.pojem }),
        el('dd', null, k.definice, ' ', el('span', { class: 'src', text: `(${srcLabel(k)})` }))
      ])),
      v.poznamka ? el('p', { class: 'note hint', text: 'Poznámka: ' + v.poznamka }) : null,
      el('div', { class: 'nav-row' },
        el('button', { type: 'button', class: 'btn', onclick: () => { learn.step = total - 1; renderLearnStep(); } }, 'Zpět'),
        el('button', { type: 'button', class: 'btn', onclick: () => startLearn(m.cislo) }, 'Projít znovu'),
        el('button', { type: 'button', class: 'btn btn-primary', onclick: () => goPractice(m.cislo) }, 'Přejít na procvičení')
      ),
      el('div', { class: 'btn-row' }, backToList)
    ));
    return;
  }

  const b = body[learn.step];
  const mark = (value) => {
    learnMarks[b.id] = learnMarks[b.id] === value ? undefined : value;  // druhé kliknutí označení zruší
    if (!learnMarks[b.id]) delete learnMarks[b.id];
    saveLearnMarks();
    renderLearnStep();
  };
  const state = learnMarks[b.id];
  const go = (step) => { learn.step = step; renderLearnStep(); window.scrollTo(0, 0); };

  view.replaceChildren(el('div', { class: 'card' },
    title,
    el('p', { class: 'step-count', text: `Krok ${learn.step + 1} z ${total}` }),
    el('div', { class: 'progress', 'aria-hidden': 'true' }, el('div', { class: 'progress-bar', style: `width:${percent(learn.step + 1, total)}%` })),
    el('span', { class: 'badge source', text: srcLabel(b) }),
    el('h2', { class: 'step-text', text: b.text }),
    el('p', { class: 'step-expl', text: b.vysvetleni }),
    srcLine(b),
    el('div', { class: 'mark-row', role: 'group', 'aria-label': 'Jak tomuto bodu rozumíš' },
      el('button', { type: 'button', class: 'btn ok-mark', 'aria-pressed': String(state === 'rozumim'), onclick: () => mark('rozumim') }, 'Rozumím'),
      el('button', { type: 'button', class: 'btn bad-mark', 'aria-pressed': String(state === 'zopakovat'), onclick: () => mark('zopakovat') }, 'Potřebuju zopakovat')
    ),
    el('div', { class: 'nav-row' },
      el('button', { type: 'button', class: 'btn', disabled: learn.step === 0 && !repeatBodies(m).length, onclick: () => go(learn.step - 1) }, 'Zpět'),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => go(learn.step + 1) }, learn.step === total - 1 ? 'Dokončit' : 'Další'),
      el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => go(total) }, 'Přeskočit na konec')
    )
  ));
}

// „Přejít na procvičení“: výběr se nastaví jen na tuto otázku; původní výběr jde na úvodní obrazovce obnovit.
function goPractice(n) {
  if (!prevSelection) prevSelection = new Set(selection);
  selection = new Set([n]);
  saveSelection();
  moGroup = 'mine';
  learn = null;
  showView('home');
}

// Materiály pro přípravu při „Vylosovat a připravit“.
function prepMaterials(m) {
  return el('div', null,
    el('h3', { text: 'Osnova z prezentací' }),
    el('ol', { class: 'osnova' }, ...m.osnova.map((t) => el('li', { text: t }))),
    m.vyuka ? el('h3', { text: 'Výklad' }) : null,
    m.vyuka ? el('p', { class: 'vyklad', text: m.vyuka.vyklad }) : null
  );
}

/* ---------- Přehled ---------- */

const SPEECH_LABELS = { ano: 'ano', castecne: 'částečně', ne: 'ne' };

function renderOverview() {
  const review = reviewIds();

  $('#view-overview').replaceChildren(
    el('div', { class: 'stats-row' }, ...statTiles()),

    el('div', { class: 'card' },
      el('h2', { text: 'Maturitní otázky' }),
      el('p', { class: 'hint', text: `„Zvládnuto“ = poslední odpověď byla správná a otázka není ke zopakování. Z „Ke zopakování“ otázka zmizí po ${REVIEW_STREAK} správných odpovědích v řadě.` }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { class: 'num', text: '#' }), el('th', { text: 'Název' }), el('th', { text: 'Pokrytí' }),
            el('th', { class: 'num', text: 'Otázek' }), el('th', { class: 'num', text: 'Zvládnuto' }),
            el('th', { class: 'num', text: 'Opakovat' }), el('th', { class: 'num', text: 'Losováno' })
          )),
          el('tbody', null, ...MO.map((m) => {
            const qs = questionsForMo(m.cislo);
            const mastered = qs.filter((q) => isMastered(q.id)).length;
            const rev = qs.filter((q) => inReview(q.id)).length;
            const los = stats.los[m.cislo];
            const has = qs.length > 0;
            return el('tr', { class: has ? '' : 'uncovered' },
              el('td', { class: 'num', text: String(m.cislo) }),
              el('td', null, m.nazev, has ? meter(mastered, qs.length) : null),
              el('td', null, coveragePill(m.pokryti)),
              el('td', { class: 'num', text: has ? String(qs.length) : '–' }),
              el('td', { class: 'num', text: has ? `${mastered} (${percent(mastered, qs.length)} %)` : '–' }),
              el('td', { class: 'num', text: has ? String(rev) : '–' }),
              el('td', { class: 'num', text: los ? `${los.count}× (${SPEECH_LABELS[los.posledni]})` : '0' })
            );
          }))
        )
      )
    ),

    el('div', { class: 'card' },
      el('h2', { text: `Ke zopakování (${review.length})` }),
      review.length
        ? el('ul', { class: 'wrong-list' }, ...review.map((id) => {
            const q = BY_ID.get(id);
            const streak = (stats.q[id] && stats.q[id].streak) || 0;
            return el('li', null,
              el('div', { text: q.zneni }),
              el('div', { class: 'muted', text: `${sourceLabel(q)} · mat. ot. ${q.maturitni_otazky.join(', ')} · ${TYPE_LABELS[q.typ]} · správně v řadě ${streak}/${REVIEW_STREAK}` })
            );
          }))
        : el('p', { class: 'hint', text: 'Nic ke zopakování. Otázky sem přibudou po špatné odpovědi.' })
    ),

    el('div', { class: 'card' },
      el('h2', { text: 'Vynulování' }),
      el('p', { class: 'hint', text: 'Smaže statistiky, kolonku „Ke zopakování“ i výsledky losování v tomto prohlížeči. Výběr maturitních otázek zůstane. Nejde vrátit zpět.' }),
      el('button', { type: 'button', class: 'btn btn-danger', onclick: resetStats }, 'Vynulovat statistiky')
    )
  );
}

function meter(part, whole) {
  const bar = el('div', { class: 'meter', title: `${part} z ${whole}` }, el('div'));
  bar.firstChild.style.width = percent(part, whole) + '%';
  return bar;
}

function resetStats() {
  if (!confirm('Opravdu vynulovat všechny statistiky, kolonku „Ke zopakování“ a výsledky losování? Tuto akci nejde vrátit.')) return;
  stats = emptyStats();
  saveStats();
  renderOverview();
}

/* ---------- Klávesnice a tlačítko Ukončit ---------- */

document.addEventListener('keydown', (e) => {
  if (!session || $('#view-quiz').hidden) return;
  if (e.target.tagName === 'TEXTAREA') return;
  const nextBtn = $('#btn-next');
  if (e.key === 'Enter' && nextBtn && document.activeElement !== nextBtn) {
    e.preventDefault();
    nextBtn.click();
  }
});

$('#btn-quit').addEventListener('click', () => {
  if (!session) return;
  if (!session.results.length) {
    endSession();
    showView('home');
  } else if (confirm('Ukončit test a zobrazit dosavadní výsledek?')) {
    session.items = session.items.slice(0, session.results.length);
    renderResult();
  }
});

init();
