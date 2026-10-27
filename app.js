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

// Sekce Čeština má vlastní klíče – data OSY se nikdy nemíchají s daty češtiny.
const SECTION_KEY = 'maturita-sekce-v1';
const CJ_STATS_KEY = 'maturita-cj-stats-v1';
const CJ_SELECTION_KEY = 'maturita-cj-vyber-v1';
const CJ_SETTINGS_KEY = 'maturita-cj-nastaveni-v1';

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
  { id: 'losovani', title: 'Losování k projevu', sub: '7 minut + osnova' },
  { id: 'simulace', title: 'Simulace zkoušky', sub: 'otázka + body odpovědi' }
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

// Stav sekce Čeština
let section = storageGet(SECTION_KEY) === 'cj' ? 'cj' : 'osy';
let loadErrors = {};      // sekce -> { err, file }
let LIT = null;           // obsah literatura.json
let CJ_WORKS = [];        // 20 děl
let CJ_BY_NUM = new Map();
let CJ_EPOCHS = [];
let CJ_PERIODS = [];
let CJ_QUESTIONS = [];    // otázky vygenerované z děl – stejný formát jako v questions.json
let CJ_BY_ID = new Map();
let cjStats = loadCjStats();
let cjSelection = loadCjSelection();
let cjSettings = Object.assign({ mode: 'vyber', cas: '0', delka: '20', match: 'autor', motiv: '', cmpA: '1', cmpB: '9' }, storageGet(CJ_SETTINGS_KEY) || {});
let cjLearn = null;       // probíhající výuka díla
let play = null;          // probíhající přiřazování nebo třídění
let CJ_MOTIFS = [];       // jednotný slovník motivů
let exam = null;          // probíhající simulace zkoušky (obě sekce)

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
  return { verze: 2, answered: 0, correct: 0, wrong: 0, q: {}, review: [], los: {}, zkouska: {} };
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
// Stejné pravidlo platí pro obě sekce, každá ale zapisuje do svých statistik.
function applyAnswer(st, q, correct) {
  const s = st.q[q.id] || (st.q[q.id] = { ok: 0, bad: 0, last: null, streak: 0 });
  if (correct) { s.ok++; s.streak = (s.streak || 0) + 1; } else { s.bad++; s.streak = 0; }
  s.last = correct;
  st.answered++;
  if (correct) st.correct++; else st.wrong++;

  const idx = st.review.indexOf(q.id);
  if (!correct && idx === -1) st.review.push(q.id);
  if (correct && idx !== -1 && s.streak >= REVIEW_STREAK) st.review.splice(idx, 1);
}

function recordAnswer(q, correct) {
  if (q.sekce === 'cj') { recordCjAnswer(q, correct); return; }
  applyAnswer(stats, q, correct);
  saveStats();
}

function statsFor(q) {
  return q.sekce === 'cj' ? cjStats : stats;
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

async function loadJson(file) {
  const res = await fetch(file, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Obě sekce se načítají nezávisle – když jeden soubor chybí, druhá sekce funguje dál.
async function init() {
  bindNav();
  bindSections();
  applySectionUi();
  const [osy, cj] = await Promise.allSettled([loadJson('data/questions.json'), loadJson('data/literatura.json')]);
  if (cj.status === 'fulfilled') {
    try { setupCj(cj.value); } catch (err) { LIT = null; loadErrors.cj = { err, file: 'data/literatura.json' }; }
  } else {
    loadErrors.cj = { err: cj.reason, file: 'data/literatura.json' };
  }
  if (osy.status === 'fulfilled') {
    DATA = osy.value;
    setupOsy();
  } else {
    loadErrors.osy = { err: osy.reason, file: 'data/questions.json' };
  }
  setSection(section);
}

function setupOsy() {
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

  buildHome();
}

function showLoadError(err, file = 'data/questions.json') {
  const box = $('#loading');
  box.className = 'card error';
  box.replaceChildren(
    el('h2', { text: 'Otázky se nepodařilo načíst' }),
    el('p', null, 'Soubor ', el('code', { text: file }), ' nejde načíst (' + (err && err.message) + ').'),
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
      if (!sectionReady(section)) return;
      if (!confirmLeave()) return;
      endSession();
      endSpeech();
      showView(btn.dataset.nav === '@home' ? homeView() : btn.dataset.nav);
    });
  });
}

function confirmLeave() {
  if (session && !confirm('Opravdu ukončit rozpracovaný test? Dosavadní odpovědi zůstanou uložené.')) return false;
  if (speech && !speech.done && !confirm('Opravdu přerušit losování? Výsledek se neuloží.')) return false;
  return true;
}

/* ---------- Přepínač sekcí OSY | Čeština ---------- */

function homeView(sec = section) {
  return sec === 'cj' ? 'cj-home' : 'home';
}

function sectionReady(sec) {
  return sec === 'cj' ? !!LIT : !!DATA;
}

function bindSections() {
  document.querySelectorAll('.section-btn').forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.section === section) return;
    if (!confirmLeave()) return;
    endSession();
    endSpeech();
    play = null;
    setSection(btn.dataset.section);
  }));
}

// Záložky a patička patřící sekci mají data-section; přepínač sám je výjimka.
function applySectionUi() {
  document.querySelectorAll('.section-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.section === section)));
  document.querySelectorAll('[data-section]:not(.section-btn)').forEach((n) => { n.hidden = n.dataset.section !== section; });
}

function setSection(sec) {
  section = sec;
  storageSet(SECTION_KEY, sec);
  applySectionUi();
  const box = $('#loading');
  if (!sectionReady(sec)) {
    document.querySelectorAll('.view').forEach((v) => { v.hidden = true; });
    box.hidden = false;
    if (loadErrors[sec]) showLoadError(loadErrors[sec].err, loadErrors[sec].file);
    return;
  }
  box.hidden = true;
  showView(homeView(sec));
}

function showView(name) {
  for (const v of ['home', 'quiz', 'result', 'speech', 'learn', 'overview', 'cj-home', 'cj-learn', 'cj-play', 'cj-overview', 'exam']) {  // ZMĚNA: + learn, + čeština
    $('#view-' + v).hidden = v !== name;
  }
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.nav === name);
    if (t.dataset.nav === name) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  if (name === 'home') renderHome();
  if (name === 'learn') { learn = null; renderLearnList(); }  // NOVÉ
  if (name === 'overview') renderOverview();
  if (name === 'cj-home') renderCjHome();
  if (name === 'cj-learn') { cjLearn = null; renderCjLearnList(); }
  if (name === 'cj-overview') renderCjOverview();
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
    else if (s.mode === 'simulace') startExam('osy');
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
  $('#settings').hidden = currentMode() === 'losovani' || currentMode() === 'simulace';
}

function readSettings() {
  return { mode: currentMode(), cas: $('#sel-cas').value, delka: $('#sel-delka').value };
}

function buildPool(settings) {
  if (settings.sekce === 'cj') return cjBuildPool(settings);
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
  if (s.mode === 'simulace') {
    const n = osyExamItems().length;
    $('#pool-info').textContent = n
      ? `Vylosuje se otázka z ${plural(n, 'vybrané maturitní otázky', 'vybraných maturitních otázek', 'vybraných maturitních otázek')}. Po odpovědi si zaškrtneš body z osnovy, které jsi zmínil(a).`
      : 'Vybrané maturitní otázky nemají osnovu.';
    btn.disabled = n === 0;
    btn.textContent = 'Spustit';
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
      el('span', { class: 'badge mo', text: q.sekce === 'cj' ? cjBadge(q) : 'Mat. ot. ' + q.maturitni_otazky.join(', ') }),
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

  const st = statsFor(q);
  const s = st.q[q.id];
  if (!correct) fb.append(el('p', { class: 'source', text: 'Otázka je v kolonce „Ke zopakování“.' }));
  else if (st.review.includes(q.id)) {
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
        el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => showView(homeView(settings.sekce === 'cj' ? 'cj' : 'osy')) }, 'Zpět')
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
  if (left <= 0) (speech.onEnd || finishSpeech)();  // Čeština má vlastní konec losování
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

    examResultsCard(stats, (id) => {
      const m = MO_BY_NUM.get(Number(id.replace('mo-', '')));
      return m ? `${m.cislo}. ${m.nazev}` : id;
    }),

    el('div', { class: 'card' },
      el('h2', { text: 'Vynulování' }),
      el('p', { class: 'hint', text: 'Smaže statistiky, kolonku „Ke zopakování“, výsledky losování i simulace zkoušky v tomto prohlížeči. Výběr maturitních otázek zůstane. Nejde vrátit zpět.' }),
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

/* ==========================================================================
 * Sekce Čeština
 * Data jsou v data/literatura.json. Z děl se vygenerují otázky ve stejném formátu
 * jako v questions.json (pole sekce: 'cj'), takže výběr odpovědi, pravda/nepravda,
 * kartičky, otevřená odpověď, seřazení, test na čas i opakování běží na stejném kódu jako OSY.
 * Navíc má čeština přiřazování a třídění. Statistiky jsou pod vlastními klíči.
 * ========================================================================== */

const CJ_MODES = [
  { id: 'vyber', title: 'Výběr odpovědi', sub: 'a, b, c, d' },
  { id: 'pravda_nepravda', title: 'Pravda / nepravda', sub: 'autor, druh, období' },
  { id: 'karticka', title: 'Kartičky', sub: 'otázka / odpověď' },
  { id: 'otevrena', title: 'Otevřená odpověď', sub: 'děj a představení díla' },
  { id: 'serazeni', title: 'Seřazení', sub: 'díla a epochy podle doby' },
  { id: 'test', title: 'Test na čas', sub: '10 / 20 / 30 otázek' },
  { id: 'opakovani', title: 'Jen ke zopakování', sub: 'chybně zodpovězené' },
  { id: 'prirazovani', title: 'Přiřazování', sub: 'autor, postava, druh, období' },
  { id: 'trideni', title: 'Třídění', sub: 'díla do období + epochy' },
  { id: 'losovani', title: 'Losování k projevu', sub: '7 minut + osnova' },
  { id: 'simulace', title: 'Simulace zkoušky', sub: 'otázka + body odpovědi' },
  { id: 'srovnani', title: 'Srovnání dvou děl', sub: 'shody a rozdíly z dat' }
];

const MATCH_TYPES = [
  { id: 'autor', label: 'Autor × dílo' },
  { id: 'postava', label: 'Postava × dílo' },
  { id: 'charakteristika', label: 'Popis postavy × jméno' },
  { id: 'druh', label: 'Dílo × druh (lyrika / epika / drama)' },
  { id: 'obdobi', label: 'Dílo × století' }
];

const DRUHY = ['lyrika', 'epika', 'drama'];
const MATCH_ROUND = 6;   // počet položek v jednom kole přiřazování
const SORT_ROUND = 8;    // počet děl v jednom kole třídění
const UPPER = /[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/;
// Role bez vlastního jména by šly zaměnit s jiným dílem, proto se v otázkách na postavy nepoužijí.
const GENERIC_ROLES = ['Učitel', 'Ředitel školy', 'Inspektor', 'Zemský školní rada'];

/* ---------- Čeština: localStorage ---------- */

function emptyCjStats() {
  return { verze: 1, answered: 0, correct: 0, wrong: 0, q: {}, review: [], los: {}, dila: {}, epochy: {}, zkouska: {} };
}

function loadCjStats() {
  const saved = storageGet(CJ_STATS_KEY);
  return saved ? Object.assign(emptyCjStats(), saved) : emptyCjStats();
}

function saveCjStats() {
  storageSet(CJ_STATS_KEY, cjStats);
}

// null = zatím nic uloženo; po načtení dat se pak vyberou všechna díla.
function loadCjSelection() {
  const saved = storageGet(CJ_SELECTION_KEY);
  return Array.isArray(saved) ? new Set(saved) : null;
}

function saveCjSelection() {
  storageSet(CJ_SELECTION_KEY, [...cjSelection].sort((a, b) => a - b));
}

function saveCjSettings() {
  storageSet(CJ_SETTINGS_KEY, cjSettings);
}

// Kromě obecných statistik se počítá úspěšnost u každého díla a každé epochy.
function recordCjAnswer(q, correct) {
  applyAnswer(cjStats, q, correct);
  const bump = (bucket, key) => {
    if (key === null || key === undefined) return;
    const c = bucket[key] || (bucket[key] = { ok: 0, bad: 0 });
    if (correct) c.ok++; else c.bad++;
  };
  bump(cjStats.dila, q.cjWork);
  bump(cjStats.epochy, q.cjEpoch);
  saveCjStats();
}

function recordCjById(id, correct) {
  const q = CJ_BY_ID.get(id);
  if (q) recordAnswer(q, correct);
}

function cjMastered(id) {
  const s = cjStats.q[id];
  return !!(s && s.last === true && !cjStats.review.includes(id));
}

/* ---------- Čeština: data a generované otázky ---------- */

function setupCj(data) {
  LIT = data;
  CJ_WORKS = Array.isArray(data.dila) ? data.dila : [];
  CJ_PERIODS = Array.isArray(data.obdobi) ? data.obdobi : [];
  CJ_EPOCHS = (Array.isArray(data.epochy) ? data.epochy : []).slice().sort((a, b) => Number(a.obdobi) - Number(b.obdobi));
  CJ_WORKS.forEach((w) => CJ_BY_NUM.set(w.cislo, w));
  CJ_MOTIFS = Array.isArray(data.motivy) ? data.motivy : [];
  CJ_QUESTIONS = buildCjQuestions();
  CJ_QUESTIONS.forEach((q) => CJ_BY_ID.set(q.id, q));
  if (!cjSelection) cjSelection = new Set(CJ_WORKS.map((w) => w.cislo));
  for (const n of [...cjSelection]) if (!CJ_BY_NUM.has(n)) cjSelection.delete(n);
}

function shortTitle(w) {
  return w.dilo.replace(/ \(.*\)$/, '').replace(/ aneb .*$/, '').replace(/ za světové války$/, '');
}

function quoted(w) {
  return `„${shortTitle(w)}“`;
}

function periodName(id) {
  const p = CJ_PERIODS.find((x) => x.id === id);
  return p ? p.nazev : id;
}

function epochOf(id) {
  return CJ_EPOCHS.find((e) => e.obdobi === id);
}

function namedCharacters(w) {
  return w.postavy.map((p, i) => Object.assign({ i }, p)).filter((p) => UPPER.test(p.jmeno) && !GENERIC_ROLES.includes(p.jmeno));
}

function srcText(url) {
  try { return decodeURIComponent(String(url).replace(/^https?:\/\//, '')); } catch (e) { return String(url); }
}

// Poznámky „k ověření“ se u otázky ukážou jen tehdy, když se jí týkají.
function noteFor(w, prefixes) {
  const notes = (w.k_overeni || []).filter((t) => prefixes.some((p) => t.startsWith(p)));
  return notes.length ? notes.join(' ') : null;
}

function pickOthers(values, correct, count) {
  return shuffle([...new Set(values)].filter((v) => v !== correct)).slice(0, count);
}

// Najde první hodnotu od dané pozice dál (dokola), která splní podmínku – pro stálé chytáky u pravda/nepravda.
function rotateFind(arr, start, pred) {
  for (let k = 0; k < arr.length; k++) {
    const v = arr[(start + k) % arr.length];
    if (pred(v)) return v;
  }
  return arr[0];
}

function cjQuestion(id, w, fields) {
  return Object.assign({
    id,
    sekce: 'cj',
    prezentace: w ? shortTitle(w) : 'Epochy',
    zdroj: w ? srcText(w.zdroje[0]) : '',
    maturitni_otazky: w ? [w.cislo] : CJ_WORKS.map((x) => x.cislo),
    cjWork: w ? w.cislo : null,
    cjEpoch: w ? w.obdobi : null,
    poznamka: null
  }, fields);
}

function authorLine(w) {
  const a = w.autor;
  return `${a.jmeno} (${a.zivot}, ${a.zeme})`;
}

function buildCjQuestions() {
  const qs = [];
  const authors = CJ_WORKS.map((w) => w.autor.zkratka);
  const titles = CJ_WORKS.map(shortTitle);
  const periodIds = CJ_PERIODS.map((p) => p.id);
  const periodNames = CJ_PERIODS.map((p) => p.nazev);
  const firstWord = (s) => s.split(/[ ,(]/)[0];

  for (const w of CJ_WORKS) {
    const t = quoted(w);
    const a = w.autor;
    const base = `Dílo ${t} (${w.rok_text}): ${authorLine(w)}.`;
    const choice = (id, tema, zneni, correct, others, vysvetleni, poznamka) =>
      cjQuestion(id, w, { typ: 'vyber', tema, zneni, moznosti: [correct, ...others], spravna_odpoved: 0, vysvetleni, poznamka });

    // Výběr odpovědi
    qs.push(choice(`${w.id}-autor`, 'Autor', `Kdo je autorem díla ${t}?`, a.zkratka, pickOthers(authors, a.zkratka, 3), base, noteFor(w, ['Autorství'])));
    qs.push(choice(`${w.id}-dilo`, 'Autor', `Které dílo je od autora: ${a.zkratka}?`, shortTitle(w),
      pickOthers(CJ_WORKS.filter((x) => x.autor.zkratka !== a.zkratka).map(shortTitle), shortTitle(w), 3), base, noteFor(w, ['Autorství'])));
    qs.push(choice(`${w.id}-druh`, 'Druh', `Do kterého literárního druhu patří dílo ${t}?`, w.druh, DRUHY.filter((d) => d !== w.druh),
      `Dílo ${t} je ${w.druh}: ${w.zanr}.`, noteFor(w, ['Druh'])));
    qs.push(choice(`${w.id}-obdobi`, 'Období', `Do kterého období patří dílo ${t}?`, periodName(w.obdobi), periodNames.filter((p) => p !== periodName(w.obdobi)),
      `Dílo ${t}: ${w.rok_text} – období ${periodName(w.obdobi)}.`, noteFor(w, ['Období', 'Druh a období'])));
    qs.push(choice(`${w.id}-smer`, 'Směr', `Ke kterému směru nebo proudu se řadí dílo ${t}?`, w.literarni_smer,
      pickOthers(CJ_WORKS.map((x) => x.literarni_smer).filter((s) => firstWord(s) !== firstWord(w.literarni_smer)), w.literarni_smer, 3),
      `Dílo ${t}: ${w.literarni_smer}.`, noteFor(w, ['Literární směr'])));
    for (const p of namedCharacters(w)) {
      qs.push(choice(`${w.id}-postava-${p.i}`, 'Postavy', `Ve kterém díle vystupuje postava: ${p.jmeno}?`, shortTitle(w),
        pickOthers(titles, shortTitle(w), 3), `${p.jmeno} – ${p.role} (${t}).`, noteFor(w, ['Jméno', 'Příjmení'])));
    }

    // Popis postavy → jméno (jméno v popisu je skryté)
    w.postavy.forEach((p, i) => {
      if (!p.charakteristika) return;
      const others = w.postavy.filter((x) => x !== p).map((x) => x.jmeno);
      qs.push(choice(`${w.id}-char-${i}`, 'Postavy', `Kterou postavu z díla ${t} popisuje text: „${maskName(p.charakteristika, p.jmeno)}“`,
        p.jmeno, pickOthers(others, p.jmeno, 3), `${p.jmeno} – ${p.role}.`, noteFor(w, ['Charakteristiky', 'Jméno', 'Příjmení'])));
    });

    // Pravda / nepravda – pravdivost i chyták jsou pevně dané číslem díla, aby se otázka s daným id neměnila.
    const authorTrue = w.cislo % 2 === 1;
    const fakeAuthor = rotateFind(authors, w.cislo + 6, (z) => z !== a.zkratka);
    qs.push(cjQuestion(`${w.id}-tf-autor`, w, {
      typ: 'pravda_nepravda', tema: 'Autor',
      zneni: `Autorem díla ${t} je ${authorTrue ? a.zkratka : fakeAuthor}.`,
      spravna_odpoved: authorTrue, vysvetleni: base, poznamka: noteFor(w, ['Autorství'])
    }));
    const druhTrue = w.cislo % 3 !== 0;
    const fakeDruh = DRUHY[(DRUHY.indexOf(w.druh) + 1) % DRUHY.length];
    qs.push(cjQuestion(`${w.id}-tf-druh`, w, {
      typ: 'pravda_nepravda', tema: 'Druh',
      zneni: `Dílo ${t} patří do literárního druhu: ${druhTrue ? w.druh : fakeDruh}.`,
      spravna_odpoved: druhTrue, vysvetleni: `Dílo ${t} je ${w.druh}: ${w.zanr}.`, poznamka: noteFor(w, ['Druh'])
    }));
    const periodTrue = w.cislo % 2 === 0;
    const fakePeriod = periodIds[(periodIds.indexOf(w.obdobi) + 1) % periodIds.length];
    qs.push(cjQuestion(`${w.id}-tf-obdobi`, w, {
      typ: 'pravda_nepravda', tema: 'Období',
      zneni: `Dílo ${t} patří do období: ${periodName(periodTrue ? w.obdobi : fakePeriod)}.`,
      spravna_odpoved: periodTrue, vysvetleni: `Dílo ${t}: ${w.rok_text} – období ${periodName(w.obdobi)}.`, poznamka: noteFor(w, ['Období', 'Druh a období'])
    }));

    // Kartičky
    const card = (id, tema, zneni, odpoved, poznamka) => cjQuestion(id, w, { typ: 'karticka', tema, zneni, spravna_odpoved: odpoved, poznamka });
    qs.push(card(`${w.id}-k-autor`, 'Autor', `Kdo napsal dílo ${t}?`, `${a.zkratka}\n${authorLine(w)}`, noteFor(w, ['Autorství'])));
    qs.push(card(`${w.id}-k-zarazeni`, 'Druh', `Literární druh, žánr, směr a období díla ${t}?`,
      `${w.druh} – ${w.zanr}\nSměr: ${w.literarni_smer}\nObdobí: ${periodName(w.obdobi)} (${w.rok_text})`, noteFor(w, ['Druh', 'Období', 'Literární směr'])));
    qs.push(card(`${w.id}-k-postavy`, 'Postavy', `Hlavní postavy díla ${t}?`, w.postavy.map((p) => `${p.jmeno} – ${p.role}`).join('\n'), noteFor(w, ['Jméno', 'Příjmení'])));
    qs.push(card(`${w.id}-k-fakt`, 'Zajímavost', `Zajímavost o díle ${t} nebo o jeho autorovi?`,
      `${w.fun_fact.text}\n\n(Nad rámec povinné látky. Zdroj: ${srcText(w.fun_fact.zdroj)})`, noteFor(w, ['Zajímavost'])));

    // Otevřená odpověď
    qs.push(cjQuestion(`${w.id}-o-dej`, w, {
      typ: 'otevrena', tema: 'Děj', zneni: `Shrň děj díla ${t} včetně konce.`, spravna_odpoved: w.shrnuti_deje, poznamka: noteFor(w, ['Shrnutí'])
    }));
    qs.push(cjQuestion(`${w.id}-o-uvod`, w, {
      typ: 'otevrena', tema: 'Představení díla', zneni: `Představ dílo ${t}: autor, doba vzniku, druh a žánr, směr a o čem dílo je.`,
      spravna_odpoved: `${authorLine(w)}\n${w.rok_text} · ${periodName(w.obdobi)}\n${w.druh} – ${w.zanr} · ${w.literarni_smer}\n\n${w.obsah}`
    }));
  }

  // Seřazení děl podle doby vzniku: skupiny po 4 dílech s velkými odstupy (každé páté v chronologii).
  const chrono = CJ_WORKS.slice().sort((x, y) => x.rok - y.rok);
  for (let i = 0; i < 5; i++) {
    const group = [i, i + 5, i + 10, i + 15].map((k) => chrono[k]).filter(Boolean);
    if (group.length < 3) continue;
    qs.push(cjQuestion(`cj-chrono-${i + 1}`, null, {
      typ: 'serazeni', tema: 'Chronologie', prezentace: 'Chronologie',
      zneni: 'Seřaď díla podle doby vzniku od nejstaršího po nejnovější.',
      moznosti: group.map((x) => `${quoted(x)} – ${x.autor.zkratka}`),
      spravna_odpoved: group.map((_, k) => k),
      vysvetleni: group.map((x) => `${shortTitle(x)}: ${x.rok_text}`).join(' · '),
      zdroj: 'data/literatura.json – roky vzniku podle zdrojů u jednotlivých děl',
      maturitni_otazky: group.map((x) => x.cislo)
    }));
  }

  // Epochy: seřazení, kartičky a zařazení dalších autorů
  if (CJ_EPOCHS.length > 1) {
    qs.push(cjQuestion('cj-epochy-poradi', null, {
      typ: 'serazeni', tema: 'Epochy', zneni: 'Seřaď epochy od nejstarší po nejnovější.',
      moznosti: CJ_EPOCHS.map((e) => e.nazev), spravna_odpoved: CJ_EPOCHS.map((_, k) => k),
      vysvetleni: CJ_EPOCHS.map((e) => `${e.nazev} (${e.rozsah})`).join(' → '),
      zdroj: srcText(CJ_EPOCHS[0].zdroje[0])
    }));
  }
  for (const e of CJ_EPOCHS) {
    const note = e.k_overeni && e.k_overeni.length ? e.k_overeni.join(' ') : null;
    qs.push(cjQuestion(`cj-epocha-${e.obdobi}-k`, null, {
      typ: 'karticka', tema: 'Epocha', cjEpoch: e.obdobi, zdroj: srcText(e.zdroje[0]),
      zneni: `Charakterizuj epochu: ${e.nazev}.`,
      spravna_odpoved: `${e.rozsah}\n\n${e.popis}\n\nHlavní směry: ${e.hlavni_smery.join(', ')}`, poznamka: note
    }));
    e.dalsi_autori.forEach((da, j) => {
      const d = da.dila[0];
      qs.push(cjQuestion(`cj-epocha-${e.obdobi}-${j + 1}`, null, {
        typ: 'vyber', tema: 'Epocha', cjEpoch: e.obdobi, zdroj: srcText(da.zdroj),
        zneni: `Do kterého období patří dílo „${d.nazev}“ (${da.autor})?`,
        moznosti: [periodName(e.obdobi), ...periodNames.filter((p) => p !== periodName(e.obdobi))], spravna_odpoved: 0,
        vysvetleni: `${da.autor}: ${da.dila.map((x) => `„${x.nazev}“ (${x.rok})`).join(', ')} – ${e.nazev}, ${e.rozsah}.`
      }));
    });
  }
  return qs;
}

function cjInSelection(q) {
  return q.maturitni_otazky.some((n) => cjSelection.has(n));
}

function cjReviewIds() {
  return cjStats.review.filter((id) => CJ_BY_ID.has(id));
}

function cjBuildPool(settings) {
  if (settings.mode === 'dilo') return CJ_QUESTIONS.filter((q) => q.cjWork === settings.dilo && TEST_TYPES.includes(q.typ));
  let pool;
  if (settings.mode === 'opakovani') pool = cjReviewIds().map((id) => CJ_BY_ID.get(id));
  else if (settings.mode === 'test') pool = CJ_QUESTIONS.filter((q) => TEST_TYPES.includes(q.typ));
  else pool = CJ_QUESTIONS.filter((q) => q.typ === settings.mode);
  return pool.filter(cjInSelection);
}

function cjBadge(q) {
  if (q.cjWork) return `Dílo č. ${q.cjWork}`;
  if (q.cjEpoch) return `Epocha: ${periodName(q.cjEpoch)}`;
  return 'Více děl';
}

function cjStatTiles() {
  return [
    statTile(cjStats.answered, 'zodpovězeno'),
    statTile(cjStats.correct, 'správně', 'ok'),
    statTile(cjStats.wrong, 'špatně', 'bad'),
    statTile(percent(cjStats.correct, cjStats.answered) + ' %', 'úspěšnost')
  ];
}

function cjWorksSelected() {
  return CJ_WORKS.filter((w) => cjSelection.has(w.cislo));
}

/* ---------- Čeština: úvodní obrazovka ---------- */

// Překreslí úvod a vrátí fokus na prvek, se kterým uživatel pracoval.
function rerenderCjHome(focusSelector) {
  renderCjHome();
  const node = focusSelector && document.querySelector(focusSelector);
  if (node) node.focus({ preventScroll: true });
}

function cjPeriodPill(w) {
  return el('span', { class: 'pill castecne', text: periodName(w.obdobi) });
}

function renderCjHome() {
  const s = cjSettings;
  const isEngine = !['prirazovani', 'trideni', 'losovani', 'simulace', 'srovnani'].includes(s.mode);
  const motif = s.motiv && CJ_MOTIFS.includes(s.motiv) ? s.motiv : '';
  const shown = motif ? CJ_WORKS.filter((w) => (w.motivy || []).includes(motif)) : CJ_WORKS;

  const worksCard = el('section', { class: 'card', 'aria-labelledby': 'cj-works-title' },
    el('div', { class: 'card-head' },
      el('h2', { id: 'cj-works-title', text: 'Díla' }),
      el('div', { class: 'btn-group' },
        el('button', { type: 'button', class: 'btn btn-small', onclick: () => {
          cjSelection = new Set(CJ_WORKS.map((w) => w.cislo)); saveCjSelection(); renderCjHome();
        } }, 'Vybrat vše'),
        el('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: () => {
          cjSelection.clear(); saveCjSelection(); renderCjHome();
        } }, 'Zrušit výběr')
      )
    ),
    el('p', { class: 'selected-count', role: 'status', 'aria-live': 'polite',
      text: `Vybráno: ${plural(cjSelection.size, 'dílo', 'díla', 'děl')} · ${plural(CJ_QUESTIONS.filter(cjInSelection).length, 'otázka', 'otázky', 'otázek')} k procvičování` }),
    cjSelection.size ? null : el('p', { class: 'notice warn', text: 'Zatím není vybrané žádné dílo. Zaškrtni ta, která chceš procvičovat.' }),
    CJ_MOTIFS.length ? el('div', { class: 'field-grid motif-filter' },
      el('label', { class: 'field' }, el('span', { text: 'Motivy' }),
        el('select', { id: 'cj-sel-motiv', onchange: (e) => { s.motiv = e.target.value; saveCjSettings(); rerenderCjHome('#cj-sel-motiv'); } },
          el('option', { value: '' }, 'Všechny motivy'),
          ...CJ_MOTIFS.map((m) => el('option', { value: m, selected: m === motif },
            `${m} (${CJ_WORKS.filter((w) => (w.motivy || []).includes(m)).length})`))))
    ) : null,
    motif ? el('p', { class: 'notice', role: 'status' },
      `Motiv „${motif}“: ${plural(shown.length, 'dílo', 'díla', 'děl')}. `,
      el('button', { type: 'button', class: 'btn btn-small', onclick: () => {
        cjSelection = new Set(shown.map((w) => w.cislo)); saveCjSelection(); renderCjHome();
      } }, 'Vybrat jen tato díla')
    ) : null,
    el('ul', { class: 'mo-list' }, ...shown.map((w) => {
      const qs = CJ_QUESTIONS.filter((q) => q.cjWork === w.cislo);
      const mastered = qs.filter((q) => cjMastered(q.id)).length;
      const checked = cjSelection.has(w.cislo);
      return el('li', { class: 'mo-item' + (checked ? ' checked' : '') },
        el('label', null,
          el('input', { type: 'checkbox', value: String(w.cislo), checked, 'aria-describedby': `cj-meta-${w.cislo}`, onchange: (e) => {
            if (e.target.checked) cjSelection.add(w.cislo); else cjSelection.delete(w.cislo);
            saveCjSelection();
            rerenderCjHome(`#view-cj-home input[type="checkbox"][value="${w.cislo}"]`);
          } }),
          el('span', { class: 'mo-num', text: w.cislo + '.' }),
          el('span', { class: 'mo-name' }, el('strong', { text: shortTitle(w) }), ' – ' + w.autor.zkratka),
          el('span', { class: 'mo-meta', id: `cj-meta-${w.cislo}` },
            cjPeriodPill(w), `${w.druh} · ${plural(qs.length, 'otázka', 'otázky', 'otázek')} · zvládnuto ${mastered}`,
            w.motivy && w.motivy.length ? el('span', { class: 'motif-line', text: 'Motivy: ' + w.motivy.join(', ') }) : null)
        )
      );
    }))
  );

  const review = cjReviewIds();
  const reviewSel = review.filter((id) => cjInSelection(CJ_BY_ID.get(id)));
  const reviewCard = el('section', { class: 'card review-card' },
    el('div', null,
      el('strong', { text: 'Ke zopakování: ' + review.length }),
      el('p', { class: 'hint', text: `Z toho ve vybraných dílech: ${reviewSel.length}. Otázka zmizí až po ${REVIEW_STREAK} správných odpovědích v řadě.` })
    ),
    el('button', { type: 'button', class: 'btn btn-primary', disabled: reviewSel.length === 0,
      onclick: () => startSession({ sekce: 'cj', mode: 'opakovani', cas: s.cas, delka: 'all' }) }, 'Opakovat chybné')
  );

  const lengthOpts = [['10', '10'], ['20', '20'], ['30', '30']];
  if (s.mode !== 'test') lengthOpts.push(['all', 'Všechny']);
  if (!lengthOpts.some(([v]) => v === s.delka)) s.delka = s.mode === 'test' ? '10' : '20';
  const setField = (key) => (e) => { s[key] = e.target.value; saveCjSettings(); rerenderCjHome(`#cj-sel-${key}`); };

  const info = cjPoolInfo();
  const form = el('form', { class: 'card', onsubmit: (e) => { e.preventDefault(); startCjMode(); } },
    el('h2', { text: 'Režim' }),
    el('fieldset', null,
      el('legend', { class: 'sr-only', text: 'Režim' }),
      el('div', { class: 'mode-grid' }, ...CJ_MODES.map((m) =>
        el('label', { class: 'mode' },
          el('input', { type: 'radio', name: 'cj-mode', value: m.id, checked: m.id === s.mode, onchange: () => {
            s.mode = m.id; saveCjSettings(); rerenderCjHome(`#view-cj-home input[name="cj-mode"][value="${m.id}"]`);
          } }),
          el('span', { class: 'mode-title', text: m.title }),
          el('span', { class: 'mode-sub', text: m.sub })
        )
      ))
    ),
    isEngine ? el('div', { class: 'field-grid' },
      el('label', { class: 'field' }, el('span', { text: 'Čas na otázku' }),
        el('select', { id: 'cj-sel-cas', onchange: setField('cas') }, ...[['0', 'Bez limitu'], ['15', '15 s'], ['30', '30 s'], ['60', '60 s']].map(([v, t]) =>
          el('option', { value: v, selected: v === s.cas }, t)))),
      el('label', { class: 'field' }, el('span', { text: 'Počet otázek' }),
        el('select', { id: 'cj-sel-delka', onchange: setField('delka') }, ...lengthOpts.map(([v, t]) =>
          el('option', { value: v, selected: v === s.delka }, t))))
    ) : null,
    s.mode === 'prirazovani' ? el('div', { class: 'field-grid' },
      el('label', { class: 'field' }, el('span', { text: 'Co přiřazovat' }),
        el('select', { id: 'cj-sel-match', onchange: setField('match') }, ...MATCH_TYPES.map((t) =>
          el('option', { value: t.id, selected: t.id === s.match }, t.label))))
    ) : null,
    s.mode === 'srovnani' ? compareFields(s) : null,
    el('p', { class: 'hint', text: info.text }),
    el('button', { type: 'submit', class: 'btn btn-primary btn-block', disabled: !info.ok },
      s.mode === 'losovani' ? 'Losovat' : s.mode === 'srovnani' ? 'Porovnat' : 'Spustit')
  );

  $('#view-cj-home').replaceChildren(el('div', { class: 'stats-row' }, ...cjStatTiles()), worksCard, reviewCard, form);
}

function cjPoolInfo() {
  const s = cjSettings;
  const works = cjWorksSelected();
  if (s.mode === 'srovnani') {
    const a = Number(s.cmpA), b = Number(s.cmpB);
    if (!CJ_BY_NUM.has(a) || !CJ_BY_NUM.has(b)) return { ok: false, text: 'Vyber dvě díla ke srovnání.' };
    if (a === b) return { ok: false, text: 'Vyber dvě různá díla.' };
    return { ok: true, text: 'Srovnání ukáže shody a rozdíly v epoše, druhu, žánru, směru, motivech a postavách – jen podle dat aplikace.' };
  }
  if (!works.length) return { ok: false, text: 'Nejdřív nahoře vyber aspoň jedno dílo.' };
  if (s.mode === 'losovani') return { ok: true, text: `Vylosuje se jedno z ${plural(works.length, 'vybraného díla', 'vybraných děl', 'vybraných děl')} a spustí se odpočet 7 minut.` };
  if (s.mode === 'simulace') {
    const n = cjExamItems().length;
    return { ok: n > 0, text: `Vylosuje se jedna z ${plural(n, 'zkouškové otázky', 'zkouškových otázek', 'zkouškových otázek')} k vybraným dílům. Po odpovědi si zaškrtneš body, které jsi zmínil(a).` };
  }
  if (s.mode === 'prirazovani') {
    const n = Math.min(MATCH_ROUND, s.match === 'postava' ? works.filter((w) => namedCharacters(w).length).length : works.length);
    return { ok: n > 0, text: `V jednom kole přiřadíš ${plural(n, 'položku', 'položky', 'položek')}. Výsledek u každé uvidíš hned.` };
  }
  if (s.mode === 'trideni') {
    const n = Math.min(SORT_ROUND, works.length);
    return { ok: true, text: `Rozdělíš ${plural(n, 'dílo', 'díla', 'děl')} do období a pak seřadíš epochy od nejstarší.` };
  }
  const n = cjBuildPool(s).length;
  if (!n) return { ok: false, text: s.mode === 'opakovani' ? 'Ve vybraných dílech teď nic ke zopakování není.' : 'Pro tento výběr nejsou žádné otázky tohoto typu.' };
  const len = s.delka === 'all' ? n : Math.min(n, Number(s.delka));
  let text = `K dispozici: ${plural(n, 'otázka', 'otázky', 'otázek')}. Spustí se ${plural(len, 'otázka', 'otázky', 'otázek')}.`;
  if (s.mode === 'test' && n < Number(s.delka)) text += ' (Méně než zvolená délka – použijí se všechny dostupné.)';
  return { ok: true, text };
}

function startCjMode() {
  const s = cjSettings;
  if (s.mode === 'losovani') startCjSpeech();
  else if (s.mode === 'prirazovani') startMatch(s.match);
  else if (s.mode === 'trideni') startSort();
  else if (s.mode === 'simulace') startExam('cj');
  else if (s.mode === 'srovnani') renderCompare(Number(s.cmpA), Number(s.cmpB));
  else startSession({ sekce: 'cj', mode: s.mode, cas: s.cas, delka: s.delka });
}

function cjPracticeWork(n) {
  cjLearn = null;
  startSession({ sekce: 'cj', mode: 'dilo', dilo: n, cas: '0', delka: 'all' });
}

/* ---------- Čeština: přiřazování ---------- */

function startMatch(kind) {
  const works = shuffle(cjWorksSelected());
  let items;
  let options;
  if (kind === 'postava') {
    items = works.filter((w) => namedCharacters(w).length).slice(0, MATCH_ROUND).map((w) => {
      const p = shuffle(namedCharacters(w))[0];
      return { qid: `${w.id}-postava-${p.i}`, prompt: p.jmeno, answer: shortTitle(w), detail: `${p.jmeno} – ${p.role}` };
    });
    options = items.map((it) => it.answer);
    options.push(...pickOthers(CJ_WORKS.map(shortTitle).filter((t) => !options.includes(t)), null, Math.max(0, 4 - options.length)));
  } else if (kind === 'charakteristika') {
    // Popis postavy (bez jména) → jméno; z každého díla jedna postava
    items = works.filter((w) => w.postavy.some((p) => p.charakteristika)).slice(0, MATCH_ROUND).map((w) => {
      const i = shuffle(w.postavy.map((_, k) => k).filter((k) => w.postavy[k].charakteristika))[0];
      const p = w.postavy[i];
      return { qid: `${w.id}-char-${i}`, prompt: `${quoted(w)}: ${maskName(p.charakteristika, p.jmeno)}`, answer: p.jmeno, detail: `${p.jmeno} – ${p.role}` };
    });
    options = [...new Set(items.map((it) => it.answer))];
  } else {
    items = works.slice(0, MATCH_ROUND).map((w) => {
      const answer = kind === 'autor' ? w.autor.zkratka : kind === 'druh' ? w.druh : periodName(w.obdobi);
      const detail = kind === 'autor' ? authorLine(w) : kind === 'druh' ? `${w.druh} – ${w.zanr}` : `${w.rok_text} – ${periodName(w.obdobi)}`;
      return { qid: `${w.id}-${kind}`, prompt: quoted(w), answer, detail };
    });
    if (kind === 'autor') {
      options = [...new Set(items.map((it) => it.answer))];
      options.push(...pickOthers(CJ_WORKS.map((w) => w.autor.zkratka).filter((z) => !options.includes(z)), null, Math.max(0, 4 - options.length)));
    } else {
      options = kind === 'druh' ? DRUHY.slice() : CJ_PERIODS.map((p) => p.nazev);
    }
  }
  if (kind === 'autor' || kind === 'postava' || kind === 'charakteristika') options.sort((x, y) => x.localeCompare(y, 'cs'));
  play = { kind, items, options, done: 0, ok: 0 };
  showView('cj-play');
  renderMatch();
}

function renderMatch() {
  const type = MATCH_TYPES.find((t) => t.id === play.kind);
  const status = el('p', { class: 'step-count', role: 'status', 'aria-live': 'polite', text: `Hotovo ${play.done} / ${play.items.length}` });
  const summary = el('div');

  const rows = play.items.map((it, idx) => {
    const fb = el('p', { class: 'match-fb' });
    const li = el('li', { class: 'match-row' });
    const sel = el('select', { 'aria-label': `${type.label}: ${it.prompt}`, onchange: (e) => {
      if (!e.target.value || it.result !== undefined) return;
      const correct = e.target.value === it.answer;
      it.result = correct;
      e.target.disabled = true;
      li.classList.add(correct ? 'correct' : 'wrong');
      fb.textContent = correct ? `Správně – ${it.detail}` : `Špatně. Správně: ${it.answer} (${it.detail})`;
      recordCjById(it.qid, correct);
      play.done++;
      if (correct) play.ok++;
      status.textContent = `Hotovo ${play.done} / ${play.items.length}`;
      if (play.done === play.items.length) showMatchSummary(summary);
      else {
        const nextSel = li.parentElement.querySelectorAll('select')[idx + 1];
        if (nextSel && !nextSel.disabled) nextSel.focus();
      }
    } },
      el('option', { value: '' }, 'Vyber…'),
      ...play.options.map((o) => el('option', { value: o }, o))
    );
    li.append(el('span', { class: 'match-prompt', text: it.prompt }), sel, fb);
    return li;
  });

  $('#view-cj-play').replaceChildren(el('div', { class: 'card' },
    el('div', { class: 'quiz-head' },
      el('span', { text: 'Přiřazování' }),
      el('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => { play = null; showView('cj-home'); } }, 'Ukončit')
    ),
    el('h2', { text: type.label }),
    el('p', { class: 'hint', text: 'Ke každé položce vyber správnou možnost. Výsledek uvidíš hned a ukládá se do statistik.' }),
    status,
    el('ul', { class: 'match-list' }, ...rows),
    summary
  ));
}

function showMatchSummary(box) {
  box.replaceChildren(el('div', { class: 'feedback ' + (play.ok === play.items.length ? 'ok' : 'neutral') },
    el('p', { class: 'feedback-title', text: `Výsledek kola: ${play.ok} / ${play.items.length}` }),
    el('div', { class: 'btn-row' },
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => startMatch(play.kind) }, 'Další kolo'),
      el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { play = null; showView('cj-home'); } }, 'Zpět')
    )
  ));
  box.querySelector('button').focus({ preventScroll: true });
}

/* ---------- Čeština: třídění ---------- */

// Krok 1: díla se rozdělí do období (klepnout na dílo, pak na období). Krok 2: seřazení epoch.
function startSort() {
  const works = shuffle(cjWorksSelected()).slice(0, SORT_ROUND);
  play = { kind: 'trideni', step: 1, works, place: {}, picked: null, checked: false, epochOrder: null, epochChecked: false };
  showView('cj-play');
  renderSort();
}

function renderSort(focusSelector) {
  const view = $('#view-cj-play');
  const head = el('div', { class: 'quiz-head' },
    el('span', { text: `Třídění · krok ${play.step} ze 2` }),
    el('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => { play = null; showView('cj-home'); } }, 'Ukončit')
  );
  view.replaceChildren(el('div', { class: 'card' }, head, ...(play.step === 1 ? sortStepWorks() : sortStepEpochs())));
  const node = focusSelector && view.querySelector(focusSelector);
  if (node) node.focus({ preventScroll: true });
}

function sortChip(w, extraClass) {
  const n = w.cislo;
  const placed = play.place[n];
  return el('button', {
    type: 'button', class: 'chip' + (extraClass ? ' ' + extraClass : ''), 'data-n': String(n),
    'aria-pressed': play.checked ? null : String(play.picked === n),
    disabled: play.checked,
    'aria-label': placed ? `${shortTitle(w)}, zařazeno do: ${periodName(placed)}. Klepnutím vrátíš zpět.` : `${shortTitle(w)} – vybrat k zařazení`,
    onclick: () => {
      if (placed) { delete play.place[n]; play.picked = n; }
      else play.picked = play.picked === n ? null : n;
      renderSort(`.chip[data-n="${n}"]`);
    }
  }, `${shortTitle(w)} (${w.autor.zkratka})`);
}

function sortStepWorks() {
  const unplaced = play.works.filter((w) => !play.place[w.cislo]);
  const pickedWork = play.picked ? CJ_BY_NUM.get(play.picked) : null;
  const buckets = CJ_PERIODS.map((p) => {
    const inside = play.works.filter((w) => play.place[w.cislo] === p.id);
    return el('div', { class: 'bucket' },
      el('div', { class: 'bucket-head' },
        el('h3', { text: p.nazev }),
        play.checked ? null : el('button', {
          type: 'button', class: 'btn btn-small', 'data-bucket': p.id, disabled: !pickedWork,
          'aria-label': pickedWork ? `Vložit „${shortTitle(pickedWork)}“ do: ${p.nazev}` : `Vložit do: ${p.nazev} (nejdřív vyber dílo)`,
          onclick: () => {
            play.place[play.picked] = p.id;
            play.picked = null;
            const left = play.works.find((w) => !play.place[w.cislo]);
            renderSort(left ? `.chip[data-n="${left.cislo}"]` : '#sort-check');
          }
        }, 'Vložit sem')
      ),
      el('div', { class: 'bucket-items' }, ...inside.map((w) => {
        if (!play.checked) return sortChip(w);
        const ok = w.obdobi === p.id;
        return el('span', { class: 'chip ' + (ok ? 'correct' : 'wrong') },
          `${shortTitle(w)} ${ok ? '✓' : `✗ – správně: ${periodName(w.obdobi)}`}`);
      }))
    );
  });

  const parts = [
    el('h2', { text: 'Rozděl díla do období' }),
    el('p', { class: 'hint', text: 'Klepni na dílo a potom na „Vložit sem“ u správného období. Zařazené dílo vrátíš klepnutím zpět.' }),
    play.checked ? null : el('div', { class: 'chip-pool', 'aria-label': 'Nezařazená díla' },
      ...(unplaced.length ? unplaced.map((w) => sortChip(w)) : [el('span', { class: 'hint', text: 'Všechna díla jsou zařazená.' })])),
    el('div', { class: 'bucket-grid' }, ...buckets)
  ];

  if (!play.checked) {
    parts.push(el('div', { class: 'btn-row' },
      el('button', { type: 'button', class: 'btn btn-primary btn-block', id: 'sort-check', disabled: unplaced.length > 0, onclick: () => {
        play.checked = true;
        play.works.forEach((w) => recordCjById(`${w.id}-obdobi`, play.place[w.cislo] === w.obdobi));
        renderSort('#sort-next');
      } }, unplaced.length ? `Zbývá zařadit: ${unplaced.length}` : 'Zkontrolovat')
    ));
  } else {
    const ok = play.works.filter((w) => play.place[w.cislo] === w.obdobi).length;
    parts.push(el('div', { class: 'feedback ' + (ok === play.works.length ? 'ok' : 'neutral') },
      el('p', { class: 'feedback-title', role: 'status', text: `Správně zařazeno: ${ok} / ${play.works.length}` }),
      el('div', { class: 'btn-row' },
        el('button', { type: 'button', class: 'btn btn-primary', id: 'sort-next', onclick: () => {
          play.step = 2;
          play.epochOrder = shuffle(CJ_EPOCHS.map((_, k) => k));
          for (let guard = 0; play.epochOrder.every((v, k) => v === k) && guard < 10; guard++) play.epochOrder = shuffle(play.epochOrder);
          renderSort();
        } }, 'Pokračovat: seřadit epochy')
      )
    ));
  }
  return parts;
}

function sortStepEpochs() {
  const order = play.epochOrder;
  const move = (pos, dir) => {
    [order[pos], order[pos + dir]] = [order[pos + dir], order[pos]];
    renderSort(`.order-item:nth-child(${pos + dir + 1}) button[data-dir="${dir < 0 ? 'up' : 'down'}"]`);
  };
  const list = el('ol', { class: 'order-list' }, ...order.map((k, pos) => {
    const e = CJ_EPOCHS[k];
    const cls = play.epochChecked ? (k === pos ? ' correct' : ' wrong') : '';
    return el('li', { class: 'order-item' + cls },
      el('span', { class: 'order-num', text: (pos + 1) + '.' }),
      el('span', { class: 'order-text' }, e.nazev, play.epochChecked ? el('span', { class: 'src', text: ` (${e.rozsah})` }) : null),
      el('span', { class: 'order-btns' },
        el('button', { type: 'button', 'data-dir': 'up', 'aria-label': `Posunout nahoru: ${e.nazev}`, disabled: pos === 0 || play.epochChecked, onclick: () => move(pos, -1) }, '↑'),
        el('button', { type: 'button', 'data-dir': 'down', 'aria-label': `Posunout dolů: ${e.nazev}`, disabled: pos === order.length - 1 || play.epochChecked, onclick: () => move(pos, 1) }, '↓')
      )
    );
  }));
  const parts = [
    el('h2', { text: 'Seřaď epochy od nejstarší po nejnovější' }),
    el('p', { class: 'hint', text: 'Položky posouvej šipkami.' }),
    list
  ];
  if (!play.epochChecked) {
    parts.push(el('div', { class: 'btn-row' }, el('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => {
      play.epochChecked = true;
      recordCjById('cj-epochy-poradi', order.every((k, pos) => k === pos));
      renderSort('#sort-again');
    } }, 'Zkontrolovat pořadí')));
  } else {
    const ok = order.every((k, pos) => k === pos);
    parts.push(el('div', { class: 'feedback ' + (ok ? 'ok' : 'bad') },
      el('p', { class: 'feedback-title', role: 'status', text: ok ? 'Správně!' : 'Špatně' }),
      ok ? null : el('p', null, el('strong', { text: 'Správné pořadí: ' }), CJ_EPOCHS.map((e) => e.nazev).join(' → ')),
      el('div', { class: 'btn-row' },
        el('button', { type: 'button', class: 'btn btn-primary', id: 'sort-again', onclick: startSort }, 'Nové třídění'),
        el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { play = null; showView('cj-home'); } }, 'Zpět')
      )
    ));
  }
  return parts;
}

/* ---------- Čeština: osnova díla (výuka, losování) ---------- */

function outlineItem(label, ...content) {
  return el('li', null, el('span', { class: 'outline-label', text: label }), ...content);
}

function cjOutline(w) {
  const e = epochOf(w.obdobi);
  return el('ol', { class: 'outline' },
    outlineItem('Autor', el('p', { text: authorLine(w) })),
    e ? outlineItem('Epocha', el('p', { text: `${e.nazev} (${e.rozsah}) – ${e.hlavni_smery.join(', ')}` })) : null,
    outlineItem('Dílo', el('p', { text: `${w.dilo}, ${w.rok_text} · ${w.druh} – ${w.zanr} · ${w.literarni_smer}` })),
    outlineItem('Postavy', el('p', { text: w.postavy.map((p) => `${p.jmeno} – ${p.role}`).join('; ') })),
    outlineItem('Obsah', el('p', { text: w.obsah })),
    outlineItem('Shrnutí děje', el('p', { text: w.shrnuti_deje })),
    w.motivy && w.motivy.length ? outlineItem('Motivy', el('p', { text: w.motivy.join(', ') })) : null,
    outlineItem('Zajímavost (nad rámec)', el('p', { text: w.fun_fact.text }), el('p', { class: 'src', text: 'Zdroj: ' + srcText(w.fun_fact.zdroj) }))
  );
}

function checkList(w) {
  return w.k_overeni && w.k_overeni.length
    ? el('div', null, el('h3', { text: 'K ověření' }), el('ul', { class: 'check-list' }, ...w.k_overeni.map((t) => el('li', { text: t }))))
    : null;
}

/* ---------- Čeština: losování k projevu ---------- */

function startCjSpeech() {
  const pool = [...cjSelection].filter((n) => CJ_BY_NUM.has(n));
  if (!pool.length) return;
  const n = pool[Math.floor(Math.random() * pool.length)];
  speech = { n, cj: true, end: Date.now() + SPEECH_SECONDS * 1000, paused: null, id: null, done: false, onEnd: finishCjSpeech };
  showView('speech');
  renderCjSpeechRunning();
  speech.id = setInterval(tickSpeech, 250);
}

function renderCjSpeechRunning() {
  const w = CJ_BY_NUM.get(speech.n);
  const pauseBtn = el('button', { type: 'button', class: 'btn', onclick: () => {
    if (speech.paused === null) { speech.paused = Date.now(); pauseBtn.textContent = 'Pokračovat'; }
    else { speech.end += Date.now() - speech.paused; speech.paused = null; pauseBtn.textContent = 'Pauza'; }
    tickSpeech();
  } }, 'Pauza');

  $('#view-speech').replaceChildren(
    el('div', { class: 'card' },
      el('p', { class: 'speech-num', text: `Vylosované dílo č. ${w.cislo}` }),
      el('h2', { class: 'speech-title', text: `${quoted(w)} – ${w.autor.zkratka}` }),
      el('p', { class: 'hint', text: 'Mluv nahlas jako u maturity: autor, epocha, dílo a druh, postavy, obsah a děj. Osnova se ukáže po skončení času.' }),
      el('div', { class: 'speech-clock', id: 'speech-clock', role: 'timer', 'aria-live': 'off', text: formatClock(SPEECH_SECONDS) }),
      el('div', { class: 'btn-row' },
        pauseBtn,
        el('button', { type: 'button', class: 'btn btn-primary', onclick: finishCjSpeech }, 'Mám hotovo – ukázat osnovu'),
        el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => {
          if (!confirm('Zrušit losování? Výsledek se neuloží.')) return;
          endSpeech();
          showView('cj-home');
        } }, 'Zrušit')
      )
    )
  );
  tickSpeech();
}

function finishCjSpeech() {
  if (!speech || speech.done) return;
  speech.done = true;
  if (speech.id) clearInterval(speech.id);
  const w = CJ_BY_NUM.get(speech.n);
  const answer = (value, label) => el('button', {
    type: 'button', class: 'btn' + (value === 'ano' ? ' btn-primary' : ''),
    onclick: (e) => {
      e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      const s = cjStats.los[w.cislo] || (cjStats.los[w.cislo] = { count: 0, ano: 0, castecne: 0, ne: 0, posledni: null });
      s.count++;
      s[value]++;
      s.posledni = value;
      saveCjStats();
      $('#speech-after').replaceChildren(
        el('p', { class: 'feedback-title', role: 'status', text: `Uloženo: ${label}. Losování tohoto díla celkem: ${s.count}×.` }),
        el('div', { class: 'btn-row' },
          el('button', { type: 'button', class: 'btn btn-primary', onclick: () => { endSpeech(); startCjSpeech(); } }, 'Losovat znovu'),
          el('button', { type: 'button', class: 'btn', onclick: () => { endSpeech(); cjPracticeWork(w.cislo); } }, 'Procvičit toto dílo'),
          el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { endSpeech(); showView('cj-home'); } }, 'Zpět')
        )
      );
    }
  }, label);

  $('#view-speech').replaceChildren(
    el('div', { class: 'card' },
      el('p', { class: 'speech-num', text: `Dílo č. ${w.cislo} · ${periodName(w.obdobi)}` }),
      el('h2', { class: 'speech-title', text: `${quoted(w)} – ${w.autor.zkratka}` }),
      el('h3', { text: 'Osnova' }),
      cjOutline(w),
      checkList(w),
      el('h3', { text: 'Zvládl/a jsem to?' }),
      el('div', { id: 'speech-after' },
        el('div', { class: 'btn-row' }, answer('ano', 'Ano'), answer('castecne', 'Částečně'), answer('ne', 'Ne'))
      )
    )
  );
}

/* ---------- Čeština: výuka ---------- */

function renderCjLearnList() {
  const works = cjWorksSelected();
  const view = $('#view-cj-learn');
  if (!works.length) {
    view.replaceChildren(el('div', { class: 'card' },
      el('h2', { text: 'Výuka' }),
      el('p', { text: 'Výuka se zobrazí pro díla, která máš zaškrtnutá na úvodní obrazovce sekce Čeština.' }),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => showView('cj-home') }, 'Vybrat díla')
    ));
    return;
  }
  view.replaceChildren(el('div', { class: 'card' },
    el('h2', { text: 'Výuka' }),
    el('p', { class: 'hint', text: 'Krokovaný výklad díla: autor → epocha → dílo a druh → postavy → shrnutí děje → motivy → obsah → zajímavost. U každého kroku je zdroj.' }),
    el('ul', { class: 'learn-list' }, ...works.map((w) =>
      el('li', { class: 'learn-item' },
        el('div', { class: 'learn-name' },
          el('strong', { text: `${w.cislo}. ` }), shortTitle(w),
          el('span', { class: 'learn-meta', text: `${w.autor.zkratka} · ${w.druh} · ${periodName(w.obdobi)}` })
        ),
        el('button', { type: 'button', class: 'btn btn-primary', 'aria-label': `Začít výuku: ${shortTitle(w)}`, onclick: () => startCjLearn(w.cislo) }, 'Začít výuku')
      )
    ))
  ));
}

function startCjLearn(n) {
  cjLearn = { n, step: 0 };
  renderCjLearnStep();
  window.scrollTo(0, 0);
}

function cjLearnSteps(w) {
  const a = w.autor;
  const e = epochOf(w.obdobi);
  const para = (text) => el('p', { class: 'step-expl', text });
  return [
    { title: 'Autor', body: [para(a.jmeno), para(`${a.zivot} · ${a.zeme}`)], src: a.zdroj, notes: noteFor(w, ['Autorství']) },
    { title: 'Epocha', src: e && e.zdroje[0], notes: e && e.k_overeni.length ? e.k_overeni.join(' ') : null,
      body: e ? [
        el('p', { class: 'step-expl' }, el('strong', { text: `${e.nazev} (${e.rozsah})` })),
        para(e.popis),
        el('p', { class: 'step-expl' }, el('strong', { text: 'Hlavní směry: ' }), e.hlavni_smery.join(', ')),
        el('p', { class: 'step-expl' }, el('strong', { text: 'Další autoři: ' }),
          e.dalsi_autori.map((d) => `${d.autor} – ${d.dila.map((x) => `„${x.nazev}“ (${x.rok})`).join(', ')}`).join('; '))
      ] : [para(periodName(w.obdobi))] },
    { title: 'Dílo a druh', src: w.zdroje[0], notes: noteFor(w, ['Druh', 'Období', 'Literární směr']),
      body: [
        para(`${w.dilo} (${w.rok_text})`),
        el('dl', { class: 'char-list' },
          el('dt', { text: 'Literární druh' }), el('dd', { text: w.druh }),
          el('dt', { text: 'Žánr' }), el('dd', { text: w.zanr }),
          el('dt', { text: 'Literární směr' }), el('dd', { text: w.literarni_smer }),
          el('dt', { text: 'Období' }), el('dd', { text: periodName(w.obdobi) })
        )
      ] },
    { title: 'Postavy', src: w.zdroje[0], notes: noteFor(w, ['Charakteristiky', 'Jméno', 'Příjmení']),
      body: [el('dl', { class: 'char-list' }, ...w.postavy.flatMap((p) => [
        el('dt', { text: p.jmeno }),
        el('dd', null, el('em', { text: p.role }), p.charakteristika ? el('p', { class: 'char-text', text: p.charakteristika }) : null,
          p.zdroj && p.zdroj !== w.zdroje[0] ? el('span', { class: 'src', text: 'Zdroj: ' + srcText(p.zdroj) }) : null)
      ]))] },
    { title: 'Shrnutí děje', body: [para(w.shrnuti_deje)], src: w.zdroje[0], notes: noteFor(w, ['Shrnutí']) },
    { title: 'Motivy', src: w.zdroje[0], notes: LIT.poznamka_motivy || null,
      body: [
        el('ul', { class: 'tag-list' }, ...(w.motivy || []).map((m) => el('li', { class: 'badge', text: m }))),
        ...(w.motivy || []).map((m) => {
          const other = CJ_WORKS.filter((x) => x !== w && (x.motivy || []).includes(m)).map(shortTitle);
          return el('p', { class: 'step-expl' }, el('strong', { text: m + ': ' }), other.length ? 'také v dílech ' + other.join(', ') : 'jen v tomto díle ze seznamu');
        })
      ] },
    { title: 'Obsah (úvod k projevu)', body: [para(w.obsah)], src: w.zdroje[0] },
    { title: 'Zajímavost', body: [para(w.fun_fact.text), el('p', { class: 'src', text: 'Informace nad rámec povinné látky.' })],
      src: w.fun_fact.zdroj, notes: noteFor(w, ['Zajímavost']) }
  ];
}

function renderCjLearnStep() {
  const w = CJ_BY_NUM.get(cjLearn.n);
  const steps = cjLearnSteps(w);
  const total = steps.length;
  const view = $('#view-cj-learn');
  const title = el('p', { class: 'speech-num', text: `Výuka · dílo č. ${w.cislo}: ${shortTitle(w)} – ${w.autor.zkratka}` });
  const backToList = el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { cjLearn = null; renderCjLearnList(); } }, 'Zpět na seznam');
  const go = (step) => { cjLearn.step = step; renderCjLearnStep(); window.scrollTo(0, 0); };

  if (cjLearn.step >= total) {
    view.replaceChildren(el('div', { class: 'card' },
      title,
      el('h2', { text: 'Shrnutí' }),
      cjOutline(w),
      checkList(w),
      el('h3', { text: 'Zdroje' }),
      el('ul', { class: 'src' }, ...w.zdroje.map((u) => el('li', { text: srcText(u) }))),
      el('div', { class: 'nav-row' },
        el('button', { type: 'button', class: 'btn', onclick: () => go(total - 1) }, 'Zpět'),
        el('button', { type: 'button', class: 'btn', onclick: () => go(0) }, 'Projít znovu'),
        el('button', { type: 'button', class: 'btn btn-primary', onclick: () => cjPracticeWork(w.cislo) }, 'Procvičit toto dílo')
      ),
      el('div', { class: 'btn-row' }, backToList)
    ));
    return;
  }

  const st = steps[cjLearn.step];
  view.replaceChildren(el('div', { class: 'card' },
    title,
    el('p', { class: 'step-count', text: `Krok ${cjLearn.step + 1} z ${total}` }),
    el('div', { class: 'progress', 'aria-hidden': 'true' }, el('div', { class: 'progress-bar', style: `width:${percent(cjLearn.step + 1, total)}%` })),
    el('h2', { class: 'step-text', text: st.title }),
    ...st.body,
    st.src ? el('p', { class: 'src', text: 'Zdroj: ' + srcText(st.src) }) : null,
    st.notes ? el('p', { class: 'note hint', text: 'K ověření: ' + st.notes }) : null,
    el('div', { class: 'nav-row' },
      el('button', { type: 'button', class: 'btn', disabled: cjLearn.step === 0, onclick: () => go(cjLearn.step - 1) }, 'Zpět'),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => go(cjLearn.step + 1) }, cjLearn.step === total - 1 ? 'Dokončit' : 'Další'),
      el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => go(total) }, 'Přeskočit na konec')
    )
  ));
}

/* ---------- Čeština: přehled ---------- */

const counterText = (c) => (c ? `${c.ok} / ${c.bad}` : '0 / 0');

function renderCjOverview() {
  const review = cjReviewIds();
  $('#view-cj-overview').replaceChildren(
    el('div', { class: 'stats-row' }, ...cjStatTiles()),

    el('div', { class: 'card' },
      el('h2', { text: 'Díla' }),
      el('p', { class: 'hint', text: `„Zvládnuto“ = poslední odpověď byla správná a otázka není ke zopakování. „Správně / špatně“ počítá všechny odpovědi k dílu včetně přiřazování a třídění.` }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { class: 'num', text: '#' }), el('th', { text: 'Dílo' }), el('th', { text: 'Období' }),
            el('th', { class: 'num', text: 'Otázek' }), el('th', { class: 'num', text: 'Zvládnuto' }),
            el('th', { class: 'num', text: 'Opakovat' }), el('th', { class: 'num', text: 'Správně / špatně' }), el('th', { class: 'num', text: 'Losováno' })
          )),
          el('tbody', null, ...CJ_WORKS.map((w) => {
            const qs = CJ_QUESTIONS.filter((q) => q.cjWork === w.cislo);
            const mastered = qs.filter((q) => cjMastered(q.id)).length;
            const rev = qs.filter((q) => cjStats.review.includes(q.id)).length;
            const los = cjStats.los[w.cislo];
            return el('tr', null,
              el('td', { class: 'num', text: String(w.cislo) }),
              el('td', null, shortTitle(w), el('div', { class: 'src', text: w.autor.zkratka }), meter(mastered, qs.length)),
              el('td', null, cjPeriodPill(w)),
              el('td', { class: 'num', text: String(qs.length) }),
              el('td', { class: 'num', text: `${mastered} (${percent(mastered, qs.length)} %)` }),
              el('td', { class: 'num', text: String(rev) }),
              el('td', { class: 'num', text: counterText(cjStats.dila[w.cislo]) }),
              el('td', { class: 'num', text: los ? `${los.count}× (${SPEECH_LABELS[los.posledni]})` : '0' })
            );
          }))
        )
      )
    ),

    el('div', { class: 'card' },
      el('h2', { text: 'Epochy' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { text: 'Období' }), el('th', { text: 'Epocha' }), el('th', { class: 'num', text: 'Děl' }), el('th', { class: 'num', text: 'Správně / špatně' })
          )),
          el('tbody', null, ...CJ_EPOCHS.map((e) => el('tr', null,
            el('td', { text: e.rozsah }),
            el('td', { text: e.nazev }),
            el('td', { class: 'num', text: String(CJ_WORKS.filter((w) => w.obdobi === e.obdobi).length) }),
            el('td', { class: 'num', text: counterText(cjStats.epochy[e.obdobi]) })
          )))
        )
      )
    ),

    el('div', { class: 'card' },
      el('h2', { text: `Ke zopakování (${review.length})` }),
      review.length
        ? el('ul', { class: 'wrong-list' }, ...review.map((id) => {
            const q = CJ_BY_ID.get(id);
            const streak = (cjStats.q[id] && cjStats.q[id].streak) || 0;
            return el('li', null,
              el('div', { text: q.zneni }),
              el('div', { class: 'muted', text: `${q.prezentace} · ${TYPE_LABELS[q.typ]} · správně v řadě ${streak}/${REVIEW_STREAK}` })
            );
          }))
        : el('p', { class: 'hint', text: 'Nic ke zopakování. Otázky sem přibudou po špatné odpovědi.' })
    ),

    examResultsCard(cjStats, (id) => {
      const w = CJ_WORKS.find((x) => (x.zkouska || []).some((z) => z.id === id));
      const z = w && w.zkouska.find((x) => x.id === id);
      return z ? `${shortTitle(w)}: ${z.otazka}` : id;
    }),

    el('div', { class: 'card' },
      el('h2', { text: 'Vynulování češtiny' }),
      el('p', { class: 'hint', text: 'Smaže statistiky, kolonku „Ke zopakování“ a výsledky losování i simulace zkoušky sekce Čeština v tomto prohlížeči. Statistiky OSY ani výběr děl se nezmění. Nejde vrátit zpět.' }),
      el('button', { type: 'button', class: 'btn btn-danger', onclick: () => {
        if (!confirm('Opravdu vynulovat všechny statistiky sekce Čeština? Tuto akci nejde vrátit.')) return;
        cjStats = emptyCjStats();
        saveCjStats();
        renderCjOverview();
      } }, 'Vynulovat statistiky češtiny')
    )
  );
}

/* ---------- Čeština: skrytí jména v popisu postavy ---------- */

// Vlastní jména (i se skloňováním) se nahradí „…“; obecné role jako „otec“ se skryjí celé.
function maskName(text, name) {
  const tokens = name.split(/[^\p{L}]+/u).filter((t) => t.length >= 3);
  const proper = tokens.filter((t) => UPPER.test(t[0]));
  let out = text;
  for (const tok of proper.length ? proper : tokens) {
    const stem = tok.length > 5 ? tok.slice(0, -2) : tok;
    out = out.replace(new RegExp(`(?<!\\p{L})${stem}\\p{L}*`, proper.length ? 'gu' : 'giu'), '…');
  }
  return out;
}

/* ---------- Čeština: srovnání dvou děl ---------- */

function compareFields(s) {
  const sel = (key, label) => el('label', { class: 'field' }, el('span', { text: label }),
    el('select', { id: `cj-sel-${key}`, onchange: (e) => { s[key] = e.target.value; saveCjSettings(); rerenderCjHome(`#cj-sel-${key}`); } },
      ...CJ_WORKS.map((w) => el('option', { value: String(w.cislo), selected: String(w.cislo) === String(s[key]) }, `${w.cislo}. ${shortTitle(w)} – ${w.autor.zkratka}`))));
  return el('div', { class: 'field-grid' }, sel('cmpA', 'První dílo'), sel('cmpB', 'Druhé dílo'));
}

// Srovnání vychází jen z polí v literatura.json – žádný volný text.
function renderCompare(na, nb) {
  const A = CJ_BY_NUM.get(na);
  const B = CJ_BY_NUM.get(nb);
  if (!A || !B) return;
  const eA = epochOf(A.obdobi);
  const eB = epochOf(B.obdobi);
  const mA = A.motivy || [];
  const mB = B.motivy || [];
  const common = mA.filter((m) => mB.includes(m));
  const namesB = B.postavy.map((p) => p.jmeno);
  const commonChars = A.postavy.map((p) => p.jmeno).filter((n) => namesB.includes(n));

  const rows = [
    ['Autor', A.autor.zkratka, B.autor.zkratka],
    ['Vznik', A.rok_text, B.rok_text, false],
    ['Období', periodName(A.obdobi), periodName(B.obdobi)],
    ['Epocha', eA ? eA.nazev : '–', eB ? eB.nazev : '–'],
    ['Literární druh', A.druh, B.druh],
    ['Žánr', A.zanr, B.zanr],
    ['Literární směr', A.literarni_smer, B.literarni_smer],
    ['Motivy', mA.join(', '), mB.join(', ')]
  ];
  const yes = [];
  const no = [];
  if (A.obdobi === B.obdobi) yes.push(`stejné období a epocha: ${eA ? eA.nazev : periodName(A.obdobi)}`);
  else no.push(`jiné období: ${periodName(A.obdobi)} × ${periodName(B.obdobi)}`);
  if (A.druh === B.druh) yes.push(`stejný literární druh: ${A.druh}`);
  else no.push(`jiný literární druh: ${A.druh} × ${B.druh}`);
  if (A.autor.zkratka === B.autor.zkratka) yes.push(`stejný autor: ${A.autor.zkratka}`);
  if (common.length) yes.push(`společné motivy: ${common.join(', ')}`);
  else no.push('žádný společný motiv');
  const onlyA = mA.filter((m) => !mB.includes(m));
  const onlyB = mB.filter((m) => !mA.includes(m));
  if (onlyA.length) no.push(`motivy jen v díle ${quoted(A)}: ${onlyA.join(', ')}`);
  if (onlyB.length) no.push(`motivy jen v díle ${quoted(B)}: ${onlyB.join(', ')}`);
  if (commonChars.length) yes.push(`společné postavy: ${commonChars.join(', ')}`);
  else no.push('díla nemají společné postavy');

  const charList = (w) => el('div', { class: 'compare-col' },
    el('h3', { text: `Postavy – ${shortTitle(w)}` }),
    el('ul', { class: 'compare-chars' }, ...w.postavy.map((p) => el('li', null, el('strong', { text: p.jmeno }), ' – ' + p.role))));

  play = { kind: 'srovnani' };
  showView('cj-play');
  $('#view-cj-play').replaceChildren(el('div', { class: 'card' },
    el('div', { class: 'quiz-head' },
      el('span', { text: 'Srovnání dvou děl' }),
      el('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => { play = null; showView('cj-home'); } }, 'Zavřít')
    ),
    el('h2', { text: `${quoted(A)} × ${quoted(B)}` }),
    el('div', { class: 'table-wrap' },
      el('table', { class: 'compare-table' },
        el('thead', null, el('tr', null, el('th', { text: 'Bod' }), el('th', { text: shortTitle(A) }), el('th', { text: shortTitle(B) }))),
        el('tbody', null, ...rows.map(([label, va, vb, comparable]) => {
          const eq = comparable !== false && va === vb;
          return el('tr', { class: eq ? 'same' : '' },
            el('th', { scope: 'row' }, label, eq ? el('span', { class: 'same-mark', text: ' ✓ shoda' }) : null),
            el('td', { text: va }), el('td', { text: vb }));
        }))
      )
    ),
    el('h3', { text: 'Shody' }),
    yes.length ? el('ul', null, ...yes.map((t) => el('li', { text: t }))) : el('p', { class: 'hint', text: 'Podle dat nemají díla nic společného.' }),
    el('h3', { text: 'Rozdíly' }),
    el('ul', null, ...no.map((t) => el('li', { text: t }))),
    el('div', { class: 'compare-grid' }, charList(A), charList(B)),
    el('p', { class: 'src', text: LIT.poznamka_motivy || '' }),
    el('div', { class: 'btn-row' },
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => renderCompare(nb, na) }, 'Prohodit pořadí'),
      el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { play = null; showView('cj-home'); } }, 'Porovnat jiná díla')
    )
  ));
}

/* ---------- Simulace zkoušky (obě sekce) ---------- */
// Čeština: otázky z pole zkouska u každého díla. OSY: název maturitní otázky a body její osnovy.

function cjExamItems() {
  return cjWorksSelected().flatMap((w) => (w.zkouska || []).map((z) => ({
    id: z.id, sec: 'cj', nadpis: `${quoted(w)} – ${w.autor.zkratka}`, otazka: z.otazka, body: z.body_odpovedi,
    citace: z.citace_k_pouziti || [], note: z.k_overeni || null, zdroj: srcText(z.zdroj)
  })));
}

function osyExamItems() {
  if (!DATA) return [];
  return [...selection].filter(isSelectable).sort((a, b) => a - b).map((n) => MO_BY_NUM.get(n))
    .filter((m) => Array.isArray(m.osnova) && m.osnova.length)
    .map((m) => ({
      id: `mo-${m.cislo}`, sec: 'osy', nadpis: `Maturitní otázka č. ${m.cislo}`, otazka: m.nazev, body: m.osnova,
      citace: [], note: m.pokryti === 'ano' ? null : (m.poznamka || null), zdroj: 'osnova z prezentací (data/questions.json)'
    }));
}

function examStats(sec) {
  return sec === 'cj' ? cjStats : stats;
}

function startExam(sec) {
  const items = sec === 'cj' ? cjExamItems() : osyExamItems();
  if (!items.length) return;
  const last = exam && exam.item ? exam.item.id : null;
  const pool = items.length > 1 ? items.filter((it) => it.id !== last) : items;
  exam = { sec, item: pool[Math.floor(Math.random() * pool.length)], stage: 'ask', answer: '', checked: [] };
  showView('exam');
  renderExam();
}

function renderExam() {
  const it = exam.item;
  const home = homeView(exam.sec);
  const leave = () => { exam = null; showView(home); };
  const parts = [
    el('div', { class: 'quiz-head' },
      el('span', { text: 'Simulace zkoušky' }),
      el('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: leave }, 'Ukončit')
    ),
    el('p', { class: 'speech-num', text: it.nadpis }),
    el('h2', { class: 'speech-title', text: it.otazka }),
    it.note ? el('p', null, el('span', { class: 'badge warn', text: 'k ověření' })) : null
  ];

  if (exam.stage === 'ask') {
    const ta = el('textarea', { placeholder: 'Odpověz nahlas, nebo sem napiš svou odpověď (nepovinné)…', 'aria-label': 'Tvoje odpověď' });
    ta.value = exam.answer;
    parts.push(
      el('p', { class: 'hint', text: 'Odpověz jako u maturity – nahlas, nebo písemně do pole. Pak si zobraz body, které má odpověď obsahovat.' }),
      ta,
      el('div', { class: 'btn-row' }, el('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => {
        exam.answer = ta.value;
        exam.stage = 'check';
        renderExam();
        const first = $('#view-exam input[type="checkbox"]');
        if (first) first.focus({ preventScroll: true });
      } }, 'Zobrazit body odpovědi'))
    );
  } else {
    const done = exam.stage === 'done';
    if (exam.answer.trim()) parts.push(el('h3', { text: 'Tvoje odpověď' }), el('div', { class: 'flashcard', text: exam.answer }));
    parts.push(
      el('h3', { text: 'Body odpovědi' }),
      done ? null : el('p', { class: 'hint', text: 'Zaškrtni body, které jsi ve své odpovědi zmínil(a).' }),
      el('ul', { class: 'check-points' }, ...it.body.map((b, i) => el('li', null,
        el('label', null,
          el('input', { type: 'checkbox', checked: exam.checked.includes(i), disabled: done, onchange: (e) => {
            if (e.target.checked) exam.checked.push(i); else exam.checked = exam.checked.filter((x) => x !== i);
          } }),
          el('span', { text: b })
        )
      )))
    );
    if (it.citace.length) parts.push(el('p', { class: 'hint' }, el('strong', { text: 'Citace k použití: ' }), it.citace.join(' · ')));
    if (it.note) parts.push(el('p', { class: 'note hint', text: 'K ověření: ' + it.note }));
    parts.push(el('p', { class: 'src', text: 'Zdroj: ' + it.zdroj }));

    if (!done) {
      parts.push(el('div', { class: 'btn-row' }, el('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: saveExam }, 'Uložit výsledek')));
    } else {
      const r = examStats(exam.sec).zkouska[it.id];
      const n = exam.checked.length;
      parts.push(el('div', { class: 'feedback ' + (n === it.body.length ? 'ok' : 'neutral') },
        el('p', { class: 'feedback-title', role: 'status', text: `Zmínil(a) jsi ${n} z ${it.body.length} bodů (${percent(n, it.body.length)} %).` }),
        el('p', { text: `Pokusů u této otázky: ${r.pokusy} · nejlepší výsledek ${r.nejlepsi} / ${r.z}.` }),
        el('div', { class: 'btn-row' },
          el('button', { type: 'button', class: 'btn btn-primary', id: 'exam-next', onclick: () => startExam(exam.sec) }, 'Další otázka'),
          el('button', { type: 'button', class: 'btn btn-ghost', onclick: leave }, 'Zpět')
        )
      ));
    }
  }
  $('#view-exam').replaceChildren(el('div', { class: 'card' }, ...parts));
}

function saveExam() {
  const it = exam.item;
  const st = examStats(exam.sec);
  if (!st.zkouska) st.zkouska = {};
  const r = st.zkouska[it.id] || (st.zkouska[it.id] = { pokusy: 0, posledni: 0, nejlepsi: 0, z: it.body.length });
  r.pokusy++;
  r.posledni = exam.checked.length;
  r.nejlepsi = Math.max(r.nejlepsi, r.posledni);
  r.z = it.body.length;
  if (exam.sec === 'cj') saveCjStats(); else saveStats();
  exam.stage = 'done';
  renderExam();
  const next = $('#exam-next');
  if (next) next.focus({ preventScroll: true });
}

// Karta do Přehledu; zobrazí se jen tehdy, když už nějaká simulace proběhla.
function examResultsCard(st, labelFor) {
  const entries = Object.entries(st.zkouska || {});
  if (!entries.length) return null;
  return el('div', { class: 'card' },
    el('h2', { text: 'Simulace zkoušky' }),
    el('div', { class: 'table-wrap' },
      el('table', null,
        el('thead', null, el('tr', null,
          el('th', { text: 'Otázka' }), el('th', { class: 'num', text: 'Pokusů' }),
          el('th', { class: 'num', text: 'Poslední' }), el('th', { class: 'num', text: 'Nejlepší' })
        )),
        el('tbody', null, ...entries.map(([id, r]) => el('tr', null,
          el('td', { text: labelFor(id) }),
          el('td', { class: 'num', text: String(r.pokusy) }),
          el('td', { class: 'num', text: `${r.posledni} / ${r.z}` }),
          el('td', { class: 'num', text: `${r.nejlepsi} / ${r.z}` })
        )))
      )
    )
  );
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
    const home = homeView(session.settings.sekce === 'cj' ? 'cj' : 'osy');
    endSession();
    showView(home);
  } else if (confirm('Ukončit test a zobrazit dosavadní výsledek?')) {
    session.items = session.items.slice(0, session.results.length);
    renderResult();
  }
});

init();
