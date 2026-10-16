/* 單字複習 + 口說活用 — app.js
 * Plain classic script (no modules) so it works from file:// as well as http://.
 * Sections:
 *   1. Utilities          8. Dashboard
 *   2. Word data          9. Triage (快速篩查)
 *   3. Storage / state   10. Review (SRS 複習)
 *   4. Headword matching 11. Speaking practice (口說活用)
 *   5. TTS               12. Browse (單字表)
 *   6. Speech recognition 13. Settings (設定)
 *   7. Router / keys     14. AI 批改
 *   15. Boot
 */
(function () {
  "use strict";

  /* =========================================================
   * 1. Utilities
   * ======================================================= */
  var MIN = 60 * 1000;
  var DAY = 24 * 60 * 60 * 1000;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function todayKey(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function sample(arr, n) { return shuffle(arr).slice(0, n); }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function fmtDuration(ms) {
    if (ms <= 0) return "現在";
    var m = Math.round(ms / MIN);
    if (m < 60) return m + " 分鐘後";
    var h = Math.round(ms / (60 * MIN));
    if (h < 48) return h + " 小時後";
    return Math.round(ms / DAY) + " 天後";
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 2600);
  }

  /** Countdown timer helper. onTick(remainingSec), onDone(). */
  function makeTimer(seconds, onTick, onDone) {
    var end = 0, iv = null, remaining = seconds;
    function tick() {
      remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      onTick(remaining);
      if (remaining <= 0) { stop(); onDone(); }
    }
    function start() {
      if (iv) return;
      end = Date.now() + remaining * 1000;
      iv = setInterval(tick, 250);
      tick();
    }
    function stop() { if (iv) { clearInterval(iv); iv = null; } }
    function add(sec) {
      remaining += sec;
      if (iv) end += sec * 1000;
      onTick(iv ? Math.max(0, Math.ceil((end - Date.now()) / 1000)) : remaining);
    }
    return { start: start, stop: stop, add: add, running: function () { return !!iv; }, remaining: function () { return remaining; } };
  }

  /* =========================================================
   * 2. Word data
   * ======================================================= */
  var WORDS = (Array.isArray(window.WORDS) ? window.WORDS : []).filter(function (w) {
    return w && w.id != null && typeof w.w === "string" && w.w.trim();
  });
  var BY_ID = new Map();
  WORDS.forEach(function (w) { BY_ID.set(w.id, w); });
  var ALPHA = WORDS.slice().sort(function (a, b) {
    return a.w.toLowerCase().localeCompare(b.w.toLowerCase());
  }).map(function (w) { return w.id; });

  function getWord(id) { return BY_ID.get(Number(id)) || BY_ID.get(id) || null; }
  function cols(w) { return Array.isArray(w && w.col) ? w.col.filter(function (c) { return typeof c === "string" && c.trim(); }) : []; }
  function lvOf(w) { var n = Number(w.lv); return n >= 1 && n <= 6 ? n : 0; }
  /** First real word of the headword, for TTS and first-letter hints. */
  function mainForm(w) {
    var f = headwordForms(w).list[0];
    return f || w.w;
  }
  function speakableHeadword(w) {
    // "actor/actress" -> "actor, actress";  "agree(ment)" -> "agree, agreement"
    return headwordForms(w).list.join(", ") || w.w;
  }

  /* =========================================================
   * 3. Storage / state
   * ======================================================= */
  var STORE_KEY = "vocab.v1";
  var DEFAULT_SETTINGS = {
    rate: 0.95, voice: "", dailyNew: 20, apiKey: "", autoSpeak: true,
    triageLevels: [1], triageOrder: "alpha"
  };
  var S = loadState();

  function freshState() {
    return { cards: {}, speak: {}, log: {}, settings: Object.assign({}, DEFAULT_SETTINGS) };
  }
  function normalizeState(raw) {
    var st = freshState();
    if (raw && typeof raw === "object") {
      if (raw.cards && typeof raw.cards === "object") st.cards = raw.cards;
      if (raw.speak && typeof raw.speak === "object") st.speak = raw.speak;
      if (raw.log && typeof raw.log === "object") st.log = raw.log;
      if (raw.settings && typeof raw.settings === "object") st.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings);
    }
    st.settings.rate = clamp(Number(st.settings.rate) || 0.95, 0.6, 1.2);
    if (!Array.isArray(st.settings.triageLevels) || !st.settings.triageLevels.length) st.settings.triageLevels = [1];
    return st;
  }
  function loadState() {
    try {
      var txt = localStorage.getItem(STORE_KEY);
      return normalizeState(txt ? JSON.parse(txt) : null);
    } catch (e) {
      return freshState();
    }
  }
  var saveWarned = false;
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(S));
    } catch (e) {
      if (!saveWarned) { saveWarned = true; toast("無法儲存進度（瀏覽器可能封鎖了 localStorage）", 5000); }
    }
  }
  function logInc(field, delta) {
    var k = todayKey();
    var e = S.log[k] || (S.log[k] = { seen: 0, review: 0, speak: 0 });
    e[field] = Math.max(0, (e[field] || 0) + (delta == null ? 1 : delta));
  }
  function dayActive(k) {
    var e = S.log[k];
    return !!(e && ((e.seen || 0) + (e.review || 0) + (e.speak || 0) > 0));
  }
  function streak() {
    var d = new Date();
    if (!dayActive(todayKey(d))) d.setDate(d.getDate() - 1);
    var n = 0;
    while (dayActive(todayKey(d)) && n < 10000) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  function statusOf(id) { var c = S.cards[id]; return c ? c.st : "new"; }
  function inSpeak(id) { return !!S.speak[id]; }
  function clone(o) { return o ? JSON.parse(JSON.stringify(o)) : o; }

  function newCard() { return { st: "learning", due: Date.now(), ivl: 0, ease: 2.5, reps: 0, lapses: 0, last: 0 }; }
  function setCard(id, patch) {
    var c = S.cards[id] || newCard();
    Object.assign(c, patch, { last: Date.now() });
    if (c.ease == null) c.ease = 2.5;
    S.cards[id] = c;
    return c;
  }
  function markForgot(id) { return setCard(id, { st: "forgot", due: Date.now(), ivl: 0 }); }
  function markLearning(id) { return setCard(id, { st: "learning", due: Date.now() + DAY, ivl: 1 }); }
  function markKnown(id) { return setCard(id, { st: "known", due: Date.now() + 45 * DAY, ivl: 45 }); }
  /** Add to speaking queue (box 0, due now). Returns true if newly added. */
  function addToSpeak(id) {
    if (S.speak[id]) return false;
    S.speak[id] = { box: 0, due: Date.now(), last: 0, uses: 0 };
    return true;
  }

  function dueReviewIds() {
    var now = Date.now(), rank = { forgot: 0, learning: 1, known: 2 };
    return Object.keys(S.cards).filter(function (id) {
      var c = S.cards[id]; return getWord(id) && c && c.due <= now;
    }).sort(function (a, b) {
      var ca = S.cards[a], cb = S.cards[b];
      return (rank[ca.st] - rank[cb.st]) || (ca.due - cb.due);
    }).map(Number);
  }
  function dueSpeakIds() {
    var now = Date.now();
    return Object.keys(S.speak).filter(function (id) {
      var s = S.speak[id]; return getWord(id) && s && s.due <= now;
    }).sort(function (a, b) { return S.speak[a].due - S.speak[b].due; }).map(Number);
  }

  /* =========================================================
   * 4. Headword matching (inflection-tolerant)
   * ======================================================= */
  var formCache = new Map();
  /** Parse headword into forms: "actor/actress", "agree(ment)", "he (him, his, himself)". */
  function headwordForms(w) {
    if (formCache.has(w.id)) return formCache.get(w.id);
    var s = String(w.w).toLowerCase().replace(/[’`]/g, "'");
    var raw = [];
    // " (him, his, himself)" — space before the parenthesis means alternative forms
    s = s.replace(/\s+\(([^)]*)\)/g, function (m, inner) {
      inner.split(/[,\/]/).forEach(function (x) { raw.push(x); });
      return "";
    });
    s.split("/").forEach(function (part) {
      if (/\([^)]*\)/.test(part)) {
        raw.push(part.replace(/\([^)]*\)/g, ""));      // agree
        raw.push(part.replace(/[()]/g, ""));           // agreement
      } else {
        raw.push(part);
      }
    });
    var list = [], seen = {};
    raw.forEach(function (f) {
      f = f.replace(/[^a-z' \-]/g, "").replace(/\s+/g, " ").trim();
      if (f && !seen[f]) { seen[f] = 1; list.push(f); }
    });
    var singles = [], multis = [];
    list.forEach(function (f) {
      var toks = f.split(/[\s\-]+/).filter(Boolean);
      if (toks.length === 1) singles.push(makeForm(toks[0]));
      else if (toks.length > 1) multis.push(toks.map(makeForm));
    });
    var info = { list: list, singles: singles, multis: multis };
    formCache.set(w.id, info);
    return info;
  }
  function makeForm(tok) { return { t: tok, stems: stemSet(tok) }; }

  /** Short headwords (<= 3 letters) are matched against explicit inflections only. */
  function shortVariants(form) {
    if (form.short) return form.short;
    var f = form.t.replace(/'/g, ""), set = new Set([f]);
    if (f.length === 3) {
      ["s", "es", "ed", "ing", "er", "est", "ly"].forEach(function (s) { set.add(f + s); });
      var last = f.charAt(2);
      if (last === "e") {                                  // use -> used, using, user
        var b = f.slice(0, 2);
        ["d", "r", "st", "ing"].forEach(function (s) { set.add((s === "ing" ? b : f) + s); });
      } else if (last === "y") {                           // try -> tries, tried
        var by = f.slice(0, 2);
        ["ies", "ied", "ier", "iest"].forEach(function (s) { set.add(by + s); });
      } else if (/[^aeiou][aeiou][^aeiouwxy]$/.test(f)) {  // run -> running, big -> bigger
        ["ing", "ed", "er", "est"].forEach(function (s) { set.add(f + last + s); });
      }
    }
    form.short = set;
    return set;
  }

  var SUFFIXES = ["ments", "ment", "tions", "tion", "ness", "ings", "ing", "est", "ies", "ied", "ed", "er", "en", "es", "ly", "s"];
  function normStem(x) {
    if (x.length > 3) x = x.replace(/e$/, "");
    x = x.replace(/([b-df-hj-np-tv-z])\1$/, "$1");
    x = x.replace(/i$/, "y");
    return x;
  }
  /** Candidate stems for a token: itself plus each single-suffix strip. */
  function stemSet(tok) {
    tok = tok.toLowerCase().replace(/'s$/, "").replace(/'/g, "");
    var set = new Set([normStem(tok)]);
    SUFFIXES.forEach(function (suf) {
      if (tok.length > suf.length && tok.slice(-suf.length) === suf) {
        var base = tok.slice(0, -suf.length);
        if (suf === "ies" || suf === "ied") base += "y";
        if (base.length >= 2) set.add(normStem(base));
        // used -> use, user -> use (strip only the trailing d / r / s)
        if (suf.charAt(0) === "e" && suf.length >= 2) {
          var b2 = tok.slice(0, -(suf.length - 1));
          if (b2.length >= 2) set.add(normStem(b2));
        }
      }
    });
    return set;
  }
  // Irregular verb / adjective forms: "base past pp [more...]"
  var IRREGULAR = {};
  ("arise arose arisen|awake awoke awoken|be am is are was were been being|bear bore born borne|beat beaten|" +
   "become became|begin began begun|bend bent|bet|bind bound|bite bit bitten|bleed bled|blow blew blown|" +
   "break broke broken|breed bred|bring brought|broadcast|build built|burn burnt|burst|buy bought|cast|" +
   "catch caught|choose chose chosen|cling clung|come came|cost|creep crept|cut|deal dealt|dig dug|" +
   "do does did done|draw drew drawn|dream dreamt|drink drank drunk|drive drove driven|eat ate eaten|" +
   "fall fell fallen|feed fed|feel felt|fight fought|find found|flee fled|fling flung|fly flew flown flies|" +
   "forbid forbade forbidden|forecast|forget forgot forgotten|forgive forgave forgiven|freeze froze frozen|" +
   "get got gotten|give gave given|go goes went gone|grind ground|grow grew grown|hang hung|have has had|" +
   "hear heard|hide hid hidden|hit|hold held|hurt|keep kept|kneel knelt|know knew known|lay laid|lead led|" +
   "lean leant|leap leapt|learn learnt|leave left|lend lent|let|lie lay lain|light lit|lose lost|make made|" +
   "mean meant|meet met|mislead misled|mistake mistook mistaken|overcome overcame|overtake overtook overtaken|" +
   "pay paid|prove proven|put|quit|read|ride rode ridden|ring rang rung|rise rose risen|run ran|say said|" +
   "see saw seen|seek sought|sell sold|send sent|set|sew sewn|shake shook shaken|shed|shine shone|" +
   "shoot shot|show shown|shrink shrank shrunk|shut|sing sang sung|sink sank sunk|sit sat|slay slew slain|" +
   "sleep slept|slide slid|sling slung|speak spoke spoken|speed sped|spend spent|spill spilt|spin spun|" +
   "spit spat|split|spread|spring sprang sprung|stand stood|steal stole stolen|stick stuck|sting stung|" +
   "stink stank stunk|strike struck stricken|strive strove striven|swear swore sworn|sweep swept|" +
   "swell swollen|swim swam swum|swing swung|take took taken|teach taught|tear tore torn|tell told|" +
   "think thought|throw threw thrown|thrust|tread trod trodden|undergo underwent undergone|" +
   "understand understood|undertake undertook undertaken|upset|wake woke woken|wear wore worn|" +
   "weave wove woven|weep wept|win won|wind wound|withdraw withdrew withdrawn|write wrote written|" +
   "good better best|well better best|bad worse worst|badly worse worst|far farther further farthest furthest|" +
   "many more most|much more most|little less least|man men|woman women|child children|foot feet|tooth teeth|" +
   "mouse mice|goose geese|person people|knife knives|leaf leaves|life lives|wife wives|wolf wolves|half halves|" +
   "thief thieves|shelf shelves|loaf loaves|potato potatoes|tomato tomatoes|hero heroes|crisis crises|" +
   "phenomenon phenomena|criterion criteria|medium media|bacterium bacteria|analysis analyses|basis bases|" +
   "die dying|lie lying|tie tying|panic panicked panicking|picnic picnicked picnicking|ad ads|" +
   "overthrow overthrew overthrown|overdo overdid overdone overdoes|outdo outdid outdone|" +
   "can cant cannot|will wont|shall shant")
    .split("|").forEach(function (g) {
      var p = g.split(" ");
      IRREGULAR[p[0]] = (IRREGULAR[p[0]] || []).concat(p.slice(1));
    });
  function tokenMatchesForm(tok, form) {
    tok = tok.toLowerCase().replace(/'/g, "");
    var f = form.t.replace(/'/g, "");
    if (tok === f) return true;
    var irr = IRREGULAR[f];
    if (irr && irr.indexOf(tok) >= 0) return true;
    if (/nt$/.test(tok) && tok.length > 3 && tok.slice(0, -2) === f) return true;   // don't, isn't, didn't
    if (f.length <= 3) return shortVariants(form).has(tok);
    var ts = stemSet(tok);
    var hit = false;
    form.stems.forEach(function (s) { if (s.length >= 3 && ts.has(s)) hit = true; });
    return hit;
  }
  /** Returns a Set of token indices (in tokens[]) that belong to the headword. */
  function matchIndices(tokens, w) {
    var info = headwordForms(w), hits = new Set();
    for (var i = 0; i < tokens.length; i++) {
      for (var k = 0; k < info.singles.length; k++) {
        if (tokenMatchesForm(tokens[i], info.singles[k])) { hits.add(i); break; }
      }
      info.multis.forEach(function (seq) {
        if (i + seq.length > tokens.length) return;
        for (var j = 0; j < seq.length; j++) if (!tokenMatchesForm(tokens[i + j], seq[j])) return;
        for (var j2 = 0; j2 < seq.length; j2++) hits.add(i + j2);
      });
    }
    return hits;
  }
  var TOKEN_RE = /([A-Za-z][A-Za-z'’]*)/;
  function splitTokens(text) {
    text = String(text || "").replace(/\b([ap])\.m\./gi, "$1m");   // 6 a.m. -> 6 am
    var parts = text.split(TOKEN_RE), toks = [], idxMap = [];
    parts.forEach(function (p, i) { if (i % 2 === 1) { idxMap.push(i); toks.push(p.replace(/’/g, "'")); } });
    return { parts: parts, toks: toks, idxMap: idxMap };
  }
  function containsHeadword(text, w) {
    if (!text || !w) return false;
    return matchIndices(splitTokens(text).toks, w).size > 0;
  }
  /** Escape text and transform tokens matching the headword with fn(escapedToken). */
  function transformMatches(text, w, fn) {
    var sp = splitTokens(text), hits = matchIndices(sp.toks, w);
    var out = sp.parts.map(function (p) { return esc(p); });
    hits.forEach(function (ti) { var pi = sp.idxMap[ti]; out[pi] = fn(out[pi]); });
    return out.join("");
  }
  function highlight(text, w) { return transformMatches(text, w, function (t) { return "<mark>" + t + "</mark>"; }); }
  function blankHeadword(text, w) { return transformMatches(text, w, function () { return "____"; }); }

  /* =========================================================
   * 5. TTS (speechSynthesis)
   * ======================================================= */
  var TTS_OK = "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
  var voices = [];
  function loadVoices() {
    if (!TTS_OK) return;
    voices = speechSynthesis.getVoices().filter(function (v) { return /^en[-_]/i.test(v.lang) || v.lang === "en"; });
    if (current === "settings") renderVoiceOptions();
  }
  function pickVoice() {
    if (!voices.length) return null;
    var want = S.settings.voice;
    if (want) { var v = voices.find(function (x) { return x.voiceURI === want; }); if (v) return v; }
    var us = voices.filter(function (x) { return /en[-_]US/i.test(x.lang); });
    return us.find(function (x) { return x.localService; }) || us[0] || voices[0];
  }
  function stopSpeaking() { if (TTS_OK) { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } } }
  /** Speak English text. opts: {rate, onend}. */
  function speak(text, opts) {
    opts = opts || {};
    var done = false;
    function finish() { if (done) return; done = true; if (opts.onend) opts.onend(); }
    if (!TTS_OK || !text) { if (opts.onend) setTimeout(finish, 0); return; }
    stopSpeaking();
    var u = new SpeechSynthesisUtterance(String(text));
    var v = pickVoice();
    if (v) u.voice = v;
    u.lang = v ? v.lang : "en-US";
    u.rate = opts.rate || S.settings.rate || 1;
    u.onend = finish;
    u.onerror = finish;
    // Safari sometimes never fires onend: fall back on a length-based estimate.
    if (opts.onend) {
      var est = (String(text).split(/\s+/).length * 450) / u.rate + 1500;
      setTimeout(finish, est);
    }
    speechSynthesis.speak(u);
  }
  if (TTS_OK) {
    loadVoices();
    if ("onvoiceschanged" in speechSynthesis) speechSynthesis.onvoiceschanged = loadVoices;
  }

  /* =========================================================
   * 6. Speech recognition + answer box
   * ======================================================= */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var SR_NOTE = "此瀏覽器不支援語音辨識，請用 Chrome 或 Safari；也可以直接打字";
  var activeBox = null;

  function stopRecording() { if (activeBox) activeBox.stop(); }

  function answerBoxHTML(placeholder) {
    return '<div class="answer-box" data-answer>' +
      (SR
        ? '<div class="row"><button type="button" class="mic" data-mic aria-label="開始／停止錄音" title="開始／停止錄音 (M)">🎤</button>' +
          '<span class="rec-state" data-recstate>按 🎤 開始說（也可以直接打字）</span></div>'
        : '<div class="note">' + esc(SR_NOTE) + '</div>') +
      '<textarea data-text rows="3" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="' +
      esc(placeholder || "你的回答（可修改辨識結果，或直接打字）") + '"></textarea></div>';
  }

  /** Bind behaviour to an answer box rendered by answerBoxHTML. opts.onInput(text). */
  function bindAnswerBox(root, opts) {
    opts = opts || {};
    var wrap = $("[data-answer]", root);
    var ta = $("[data-text]", wrap);
    var micBtn = $("[data-mic]", wrap);
    var stateEl = $("[data-recstate]", wrap);
    var rec = null, recording = false, base = "";

    function setUI(on, msg) {
      recording = on;
      if (micBtn) { micBtn.classList.toggle("rec", on); micBtn.textContent = on ? "■" : "🎤"; }
      if (stateEl) {
        stateEl.classList.toggle("on", on);
        stateEl.textContent = msg || (on ? "● 錄音中…再按一次停止" : "按 🎤 開始說（也可以直接打字）");
      }
    }
    function changed() { if (opts.onInput) opts.onInput(ta.value); }

    var ctl = {
      text: function () { return ta.value.trim(); },
      setText: function (t) { ta.value = t || ""; changed(); },
      isRecording: function () { return recording; },
      start: function () {
        if (!SR || recording) return;
        stopRecording();
        stopSpeaking();
        try {
          rec = new SR();
          rec.lang = "en-US";
          rec.interimResults = true;
          rec.continuous = true;
          rec.maxAlternatives = 1;
        } catch (e) { toast("無法啟動語音辨識"); return; }
        base = ta.value.trim() ? ta.value.trim() + " " : "";
        rec.onresult = function (ev) {
          var fin = "", interim = "";
          for (var i = 0; i < ev.results.length; i++) {
            var r = ev.results[i];
            if (r.isFinal) fin += r[0].transcript + " "; else interim += r[0].transcript;
          }
          ta.value = (base + fin + interim).replace(/\s+/g, " ").replace(/^\s+/, "");
          changed();
        };
        rec.onerror = function (ev) {
          if (ev.error === "not-allowed" || ev.error === "service-not-allowed") toast("麥克風權限被拒，請在瀏覽器設定允許，或直接打字", 4500);
          else if (ev.error === "network") toast("語音辨識需要網路連線");
          else if (ev.error !== "no-speech" && ev.error !== "aborted") toast("語音辨識錯誤：" + ev.error);
        };
        rec.onend = function () {
          setUI(false);
          if (activeBox === ctl) activeBox = null;
          rec = null;
          if (opts.onStop) opts.onStop(ta.value);
        };
        try {
          rec.start();
          activeBox = ctl;
          setUI(true);
        } catch (e) {
          toast("無法啟動語音辨識");
        }
      },
      stop: function () {
        if (rec) { try { rec.stop(); } catch (e) { /* ignore */ } }
        setUI(false);
        if (activeBox === ctl) activeBox = null;
      },
      toggle: function () { if (recording) ctl.stop(); else ctl.start(); },
      focus: function () { ta.focus(); }
    };
    if (micBtn) micBtn.addEventListener("click", function () { ctl.toggle(); });
    ta.addEventListener("input", changed);
    return ctl;
  }

  /* =========================================================
   * 7. Router, delegated clicks, keyboard
   * ======================================================= */
  var VIEWS = {};
  var current = null;

  function go(name, opts) {
    if (!VIEWS[name]) name = "dashboard";
    if (current && VIEWS[current].leave) VIEWS[current].leave();
    stopRecording();
    stopSpeaking();
    current = name;
    $all(".view").forEach(function (v) { v.hidden = v.id !== "view-" + name; });
    $all(".tab").forEach(function (t) {
      var on = t.dataset.view === name;
      t.classList.toggle("active", on);
      if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
    });
    if (location.hash !== "#" + name) {
      try { history.replaceState(null, "", "#" + name); } catch (e) { /* file:// in some browsers */ }
    }
    VIEWS[name].enter(opts || {});
    window.scrollTo(0, 0);
  }
  function viewEl(name) { return $("#view-" + name); }

  /** Delegated click handling: elements with data-act="name" call handlers[name](el, ev). */
  function delegate(name, handlers) {
    viewEl(name).addEventListener("click", function (ev) {
      var t = ev.target.closest("[data-act]");
      if (!t || !viewEl(name).contains(t)) return;
      var fn = handlers[t.dataset.act];
      if (!fn) return;
      if (t.tagName === "BUTTON" && ev.detail > 0) t.blur(); // keep keyboard shortcuts working
      fn(t, ev);
    });
  }

  function isTyping(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }
  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTyping(e.target)) return;
    var v = VIEWS[current];
    if (v && v.onKey && v.onKey(e)) e.preventDefault();
  });

  $("#tabs").addEventListener("click", function (e) {
    var t = e.target.closest(".tab");
    if (t) { if (e.detail > 0) t.blur(); go(t.dataset.view); }
  });
  window.addEventListener("hashchange", function () {
    var n = location.hash.replace("#", "");
    if (VIEWS[n] && n !== current) go(n);
  });

  function speakBtn(text, label) {
    return '<button type="button" class="btn icon ghost" data-act="say" data-text="' + esc(text) + '" aria-label="' +
      esc(label || "播放發音") + '" title="' + esc(label || "播放發音") + '">🔊</button>';
  }
  function colChips(w, opts) {
    opts = opts || {};
    return cols(w).map(function (c) {
      var inner = opts.blank ? blankHeadword(c, w) : (opts.hl ? highlight(c, w) : esc(c));
      if (opts.speak) return '<button type="button" class="chip say" data-act="say" data-text="' + esc(c) + '">🔊 ' + inner + '</button>';
      return '<span class="chip static">' + inner + '</span>';
    }).join("");
  }
  function lvBadge(w) { return '<span class="badge">Lv' + esc(lvOf(w) || "?") + '</span>'; }
  function sayHandler(el) { speak(el.dataset.text); }

  /* =========================================================
   * 8. Dashboard (總覽)
   * ======================================================= */
  VIEWS.dashboard = {
    enter: function () { this.render(); },
    render: function () {
      var root = viewEl("dashboard");
      if (!WORDS.length) {
        root.innerHTML = '<div class="panel empty"><div class="big">📭</div><p>找不到單字資料（words.js 尚未產生或格式錯誤）。</p></div>';
        return;
      }
      var lv = {};
      for (var i = 1; i <= 6; i++) lv[i] = { total: 0, new: 0, known: 0, learning: 0, forgot: 0 };
      WORDS.forEach(function (w) {
        var L = lvOf(w); if (!L) return;
        lv[L].total++;
        var st = statusOf(w.id);
        lv[L][st in lv[L] ? st : "new"]++;
      });
      var dueR = dueReviewIds().length, dueS = dueSpeakIds().length, stk = streak();
      var tlog = S.log[todayKey()] || { seen: 0, review: 0, speak: 0 };

      var bars = "";
      for (var L = 1; L <= 6; L++) {
        var d = lv[L]; if (!d.total) continue;
        var pct = function (n) { return (n / d.total * 100).toFixed(2) + "%"; };
        bars += '<div class="lvrow"><div class="lvname">Lv' + L + '</div>' +
          '<div class="bar" role="img" aria-label="Lv' + L + ' 熟練 ' + d.known + '、學習中 ' + d.learning + '、忘記 ' + d.forgot + '、未篩查 ' + d.new + '">' +
          '<span class="b-known" style="width:' + pct(d.known) + '"></span>' +
          '<span class="b-learning" style="width:' + pct(d.learning) + '"></span>' +
          '<span class="b-forgot" style="width:' + pct(d.forgot) + '"></span>' +
          '<span class="b-untriaged" style="width:' + pct(d.new) + '"></span></div>' +
          '<div class="lvnums">共 ' + d.total + ' · 未篩查 ' + d.new + ' · 熟練 ' + d.known + ' · 學習中 ' + d.learning + ' · 忘記 ' + d.forgot + '</div></div>';
      }
      root.innerHTML =
        '<div class="stats">' +
          '<div class="stat"><div class="stat-num">' + dueR + '</div><div class="stat-label">今日待複習</div></div>' +
          '<div class="stat"><div class="stat-num">' + dueS + '</div><div class="stat-label">口說待練習</div></div>' +
          '<div class="stat"><div class="stat-num">' + stk + '</div><div class="stat-label">連續天數 🔥</div></div>' +
        '</div>' +
        '<div class="actions-big">' +
          '<button class="btn big" data-act="go" data-view="triage">⚡ 繼續篩查</button>' +
          '<button class="btn big primary" data-act="go" data-view="review">🔁 開始複習 (' + dueR + ')</button>' +
          '<button class="btn big" data-act="go" data-view="speak">🗣️ 口說練習 (' + dueS + ')</button>' +
        '</div>' +
        '<div class="panel"><div class="row"><h3 style="margin:0">各等級進度</h3><span class="spacer"></span>' +
          '<span class="muted small">今天：篩查 ' + (tlog.seen || 0) + ' · 複習 ' + (tlog.review || 0) + ' · 口說 ' + (tlog.speak || 0) + '</span></div>' +
          bars +
          '<div class="legend"><span><i class="dot known"></i>熟練</span><span><i class="dot learning"></i>學習中</span>' +
          '<span><i class="dot forgot"></i>忘記</span><span><i class="dot"></i>未篩查</span></div></div>';
    }
  };
  delegate("dashboard", { go: function (el) { go(el.dataset.view); } });

  /* =========================================================
   * 9. Triage (快速篩查)
   * ======================================================= */
  var BATCH = 50;
  var T = {
    list: null, key: "", peek: false, undo: [],
    session: { count: 0, forgot: 0, cant: 0 },
    batch: { n: 0, forgot: [], cant: [] }, summary: false
  };
  function triageKey() { return S.settings.triageLevels.slice().sort().join(",") + "|" + S.settings.triageOrder; }
  function buildTriageList() {
    var lvs = new Set(S.settings.triageLevels.map(Number));
    var ids = ALPHA.filter(function (id) { var w = getWord(id); return lvs.has(lvOf(w)) && !S.cards[id]; });
    T.list = S.settings.triageOrder === "random" ? shuffle(ids) : ids;
    T.key = triageKey();
    T.peek = false;
  }
  function triageDecide(kind) {
    if (T.summary || !T.list || !T.list.length) return;
    var id = T.list[0];
    if (kind === "known" && T.peek) {
      kind = "cant";
      toast("偷看過了，就算「認得但說不出」— 誠實才有效 😉", 3200);
    }
    T.undo.push({ id: id, card: clone(S.cards[id]), speak: clone(S.speak[id]), kind: kind });
    if (T.undo.length > 200) T.undo.shift();
    if (kind === "forgot") { markForgot(id); T.session.forgot++; T.batch.forgot.push(id); }
    else if (kind === "cant") { markLearning(id); addToSpeak(id); T.session.cant++; T.batch.cant.push(id); }
    else markKnown(id);
    T.session.count++;
    T.batch.n++;
    logInc("seen");
    save();
    T.list.shift();
    T.peek = false;
    if (T.batch.n >= BATCH) T.summary = true;
    VIEWS.triage.render();
  }
  function triageUndo() {
    var u = T.undo.pop();
    if (!u) { toast("沒有可以復原的動作"); return; }
    if (u.card) S.cards[u.id] = u.card; else delete S.cards[u.id];
    if (u.speak) S.speak[u.id] = u.speak; else delete S.speak[u.id];
    T.session.count = Math.max(0, T.session.count - 1);
    if (u.kind === "forgot") { T.session.forgot = Math.max(0, T.session.forgot - 1); removeLast(T.batch.forgot, u.id); }
    if (u.kind === "cant") { T.session.cant = Math.max(0, T.session.cant - 1); removeLast(T.batch.cant, u.id); }
    if (T.summary) T.summary = false;
    T.batch.n = Math.max(0, T.batch.n - 1);
    logInc("seen", -1);
    save();
    if (T.list) T.list.unshift(u.id);
    T.peek = false;
    toast("已復原：" + getWord(u.id).w);
    VIEWS.triage.render();
  }
  function removeLast(arr, id) { var i = arr.lastIndexOf(id); if (i >= 0) arr.splice(i, 1); }
  function endBatch() { T.batch = { n: 0, forgot: [], cant: [] }; T.summary = false; }

  VIEWS.triage = {
    enter: function () {
      if (!T.list || T.key !== triageKey()) buildTriageList();
      else T.list = T.list.filter(function (id) { return !S.cards[id]; });
      this.render();
    },
    render: function () {
      var root = viewEl("triage");
      var lvSet = new Set(S.settings.triageLevels.map(Number));
      var chips = "";
      for (var i = 1; i <= 6; i++) chips += '<button class="chip' + (lvSet.has(i) ? " on" : "") + '" data-act="lv" data-lv="' + i + '" aria-pressed="' + lvSet.has(i) + '">Lv' + i + '</button>';
      var ord = S.settings.triageOrder;
      var head =
        '<div class="panel" style="padding:12px 14px"><div class="row">' + chips +
        '<span class="spacer"></span>' +
        '<button class="chip' + (ord === "alpha" ? " on" : "") + '" data-act="order" data-order="alpha">字母</button>' +
        '<button class="chip' + (ord === "random" ? " on" : "") + '" data-act="order" data-order="random">隨機</button>' +
        '</div></div>';
      var counter =
        '<div class="counter"><span>本輪 <b>' + T.session.count + '</b> 字 · 忘了 <b>' + T.session.forgot + '</b> · 說不出 <b>' + T.session.cant + '</b></span>' +
        '<span class="spacer"></span><span>剩 ' + (T.list ? T.list.length : 0) + ' 字未篩查</span></div>' +
        '<div class="progress-thin"><span style="width:' + (T.batch.n / BATCH * 100) + '%"></span></div>';

      if (T.summary) { root.innerHTML = head + counter + this.summaryHTML(); return; }
      if (!T.list || !T.list.length) {
        root.innerHTML = head + counter +
          '<div class="panel empty"><div class="big">🎉</div><p>所選等級的單字都篩查完了！</p>' +
          '<div class="row" style="justify-content:center">' +
          (T.batch.n ? '<button class="btn" data-act="showsummary">看本輪總結</button>' : '') +
          '<button class="btn primary" data-act="go" data-view="review">去複習</button>' +
          (T.undo.length ? '<button class="btn" data-act="undo">↶ 復原</button>' : '') + '</div></div>';
        return;
      }
      var w = getWord(T.list[0]);
      var reveal = T.peek
        ? '<div class="card-reveal"><div class="card-zh">' + esc(w.zh || "") + '</div>' +
          (cols(w).length ? '<div class="card-col">' + colChips(w, { hl: true }) + '</div>' : '') + '</div>'
        : '';
      root.innerHTML = head + counter +
        '<div class="card tapzone" data-act="peek" title="點一下偷看（空白鍵）">' +
          '<div class="card-tag">' + lvBadge(w) + '</div>' +
          '<div class="card-corner">' + speakBtn(speakableHeadword(w)) + '</div>' +
          '<div class="card-word">' + esc(w.w) + '</div>' +
          '<div class="card-pos">' + esc(w.pos || "") + '</div>' + reveal +
          (T.peek ? '' : '<div class="muted small kbdhint">在心裡想：中文意思？能用它說一句話嗎？</div>') +
        '</div>' +
        '<div class="grade">' +
          '<button class="btn g-forgot" data-act="decide" data-kind="forgot"><span>忘了／不確定</span><kbd>← / 1</kbd></button>' +
          '<button class="btn g-learning" data-act="decide" data-kind="cant"><span>認得但說不出</span><kbd>↓ / 2</kbd></button>' +
          '<button class="btn g-known" data-act="decide" data-kind="known"><span>很熟</span><kbd>→ / 3</kbd></button>' +
        '</div>' +
        '<div class="row" style="margin-top:10px;justify-content:center">' +
          '<button class="btn ghost" data-act="peek">👀 ' + (T.peek ? "收起" : "偷看") + ' <kbd>Space</kbd></button>' +
          '<button class="btn ghost" data-act="say" data-text="' + esc(speakableHeadword(w)) + '">🔊 發音 <kbd>S</kbd></button>' +
          '<button class="btn ghost" data-act="undo"' + (T.undo.length ? "" : " disabled") + '>↶ 復原 <kbd>Z</kbd></button>' +
          (T.batch.n ? '<button class="btn ghost" data-act="showsummary">📋 本輪總結</button>' : '') +
        '</div>';
    },
    summaryHTML: function () {
      function list(ids) {
        if (!ids.length) return '<p class="muted small">（沒有）</p>';
        return '<ul class="wordlist">' + ids.map(function (id) {
          var w = getWord(id); return '<li><b>' + esc(w.w) + '</b> <span class="muted">' + esc(w.zh || "") + '</span></li>';
        }).join("") + '</ul>';
      }
      var ids = T.batch.forgot.concat(T.batch.cant);
      return '<div class="panel"><h2>本輪總結（' + T.batch.n + ' 字）</h2>' +
        '<h3>😵 忘了／不確定（' + T.batch.forgot.length + '）</h3>' + list(T.batch.forgot) +
        '<h3>🤐 認得但說不出（' + T.batch.cant.length + '）</h3>' + list(T.batch.cant) +
        '<p class="muted small">「說不出」的字已自動加入口說練習。</p>' +
        '<div class="row">' +
        '<button class="btn primary" data-act="reviewthese"' + (ids.length ? "" : " disabled") + '>馬上複習這些</button>' +
        '<button class="btn" data-act="continue">繼續篩查</button>' +
        '<button class="btn ghost" data-act="undo">↶ 復原上一個</button></div></div>';
    },
    onKey: function (e) {
      var k = e.key;
      if (T.summary) {
        if (k === "Enter" || k === " ") { endBatch(); this.render(); return true; }
        if (k === "z" || k === "Z") { triageUndo(); return true; }
        return false;
      }
      if (k === "ArrowLeft" || k === "1") { triageDecide("forgot"); return true; }
      if (k === "ArrowDown" || k === "2") { triageDecide("cant"); return true; }
      if (k === "ArrowRight" || k === "3") { triageDecide("known"); return true; }
      if (k === " " || k === "Spacebar") { if (T.list && T.list.length) { T.peek = !T.peek; this.render(); } return true; }
      if (k === "s" || k === "S") { if (T.list && T.list.length) speak(speakableHeadword(getWord(T.list[0]))); return true; }
      if (k === "z" || k === "Z") { triageUndo(); return true; }
      return false;
    }
  };
  delegate("triage", {
    lv: function (el) {
      var n = Number(el.dataset.lv), lv = S.settings.triageLevels.map(Number);
      var i = lv.indexOf(n);
      if (i >= 0) { if (lv.length === 1) { toast("至少要選一個等級"); return; } lv.splice(i, 1); } else lv.push(n);
      S.settings.triageLevels = lv.sort(); save();
      buildTriageList(); VIEWS.triage.render();
    },
    order: function (el) { S.settings.triageOrder = el.dataset.order; save(); buildTriageList(); VIEWS.triage.render(); },
    decide: function (el) { triageDecide(el.dataset.kind); },
    peek: function (el, ev) {
      if (ev.target.closest("[data-act]") !== el) return;
      T.peek = !T.peek; VIEWS.triage.render();
    },
    say: function (el, ev) { ev.stopPropagation(); sayHandler(el); },
    undo: function () { triageUndo(); },
    showsummary: function () { T.summary = true; VIEWS.triage.render(); },
    continue: function () { endBatch(); VIEWS.triage.render(); },
    reviewthese: function () {
      var ids = T.batch.forgot.concat(T.batch.cant);
      endBatch();
      go("review", { ids: ids });
    },
    go: function (el) { go(el.dataset.view); }
  });

  /* =========================================================
   * 10. Review (SRS 複習)
   * ======================================================= */
  var R = { queue: [], revealed: false, done: 0, custom: false, active: false };

  function schedule(id, g) {
    var now = Date.now();
    var c = S.cards[id] || newCard();
    var ivl = Number(c.ivl) || 0, ease = Number(c.ease) || 2.5;
    if (g === 1) {
      c.lapses = (c.lapses || 0) + 1;
      ivl = 0; ease -= 0.2; c.st = "forgot"; c.due = now + 10 * MIN;
    } else {
      if (g === 2) { ivl = Math.max(1, Math.round(ivl * 1.2 * 10) / 10); ease -= 0.15; }
      else if (g === 3) { ivl = ivl === 0 ? 1 : ivl === 1 ? 3 : Math.max(1, Math.round(ivl * ease)); }
      else { ivl = ivl === 0 ? 3 : Math.max(1, Math.round(ivl * ease * 1.3)); ease += 0.15; }
      c.st = ivl >= 21 ? "known" : "learning";
      c.due = now + ivl * DAY;
    }
    c.ivl = ivl;
    c.ease = Math.max(1.3, Math.round(ease * 100) / 100);
    c.reps = (c.reps || 0) + 1;
    c.last = now;
    if (g <= 2) {
      c.hard = (c.hard || 0) + 1;  // extra field: count of 忘了/模糊 answers
      if (c.hard >= 2 && addToSpeak(id)) toast("「" + getWord(id).w + "」已加入口說練習");
    }
    S.cards[id] = c;
    logInc("review");
    save();
  }

  function reviewGrade(g) {
    if (!R.revealed || !R.queue.length) return;
    var id = R.queue.shift();
    schedule(id, g);
    R.done++;
    if (g === 1) R.queue.splice(Math.min(R.queue.length, 4), 0, id); // comes back later this session
    R.revealed = false;
    VIEWS.review.render();
  }
  function reviewReveal() {
    if (!R.queue.length || R.revealed) return;
    R.revealed = true;
    VIEWS.review.render();
    if (S.settings.autoSpeak) speak(speakableHeadword(getWord(R.queue[0])));
  }

  VIEWS.review = {
    enter: function (opts) {
      if (opts.ids && opts.ids.length) {
        R.queue = opts.ids.filter(function (id) { return S.cards[id] && getWord(id); });
        R.custom = true; R.done = 0;
      } else if (!R.active || !R.queue.length) {
        R.queue = dueReviewIds(); R.custom = false; R.done = 0;
      }
      R.active = R.queue.length > 0;
      R.revealed = false;
      this.render();
    },
    render: function () {
      var root = viewEl("review");
      var counter = '<div class="counter"><span>' + (R.custom ? "指定複習" : "到期複習") + ' · 剩 <b>' + R.queue.length + '</b> 張 · 已複習 <b>' + R.done + '</b></span></div>';
      if (!R.queue.length) {
        R.active = false;
        var next = Infinity;
        Object.keys(S.cards).forEach(function (id) { if (S.cards[id].due < next) next = S.cards[id].due; });
        var dueS = dueSpeakIds().length;
        root.innerHTML = counter + '<div class="panel empty"><div class="big">✅</div>' +
          '<p>' + (R.done ? "這輪複習完成了！共 " + R.done + " 張。" : "目前沒有到期的複習卡。") + '</p>' +
          (isFinite(next) ? '<p class="muted small">下一張到期：' + fmtDuration(next - Date.now()) + '</p>' : '<p class="muted small">先去「快速篩查」建立複習卡吧。</p>') +
          '<div class="row" style="justify-content:center">' +
          '<button class="btn primary" data-act="go" data-view="speak">🗣️ 口說練習 (' + dueS + ')</button>' +
          '<button class="btn" data-act="go" data-view="triage">⚡ 繼續篩查</button>' +
          (dueReviewIds().length ? '<button class="btn" data-act="reload">再來一輪 (' + dueReviewIds().length + ')</button>' : '') +
          '</div></div>';
        return;
      }
      var id = R.queue[0], w = getWord(id), c = S.cards[id] || newCard();
      var recall = (c.reps || 0) % 2 === 1;
      var front, back = "";
      if (!recall) {
        front = '<div class="card-tag">' + lvBadge(w) + ' 認得</div>' +
          '<div class="card-corner">' + speakBtn(speakableHeadword(w)) + '</div>' +
          '<div class="card-word">' + esc(w.w) + '</div><div class="card-pos">' + esc(w.pos || "") + '</div>';
      } else {
        var mf = mainForm(w);
        front = '<div class="card-tag">' + lvBadge(w) + ' 想得到</div>' +
          '<div class="card-zh" style="font-size:1.9rem">' + esc(w.zh || "") + '</div>' +
          '<div class="card-sub">' + esc(w.pos || "") + ' · 字首 <b>' + esc(mf.charAt(0)) + '</b>… (' + mf.replace(/[^a-z]/gi, "").length + ' 個字母)</div>' +
          (cols(w).length ? '<div class="card-col">' + colChips(w, { blank: true }) + '</div>' : '') +
          (R.revealed ? '' : '<div class="muted small">👄 先把這個字「說出來」，再翻面</div>');
      }
      if (R.revealed) {
        back = '<div class="card-reveal">' +
          (recall ? '<div class="card-word" style="font-size:2.4rem">' + esc(w.w) + ' ' + speakBtn(speakableHeadword(w)) + '</div><div class="card-pos">' + esc(w.pos || "") + '</div>'
                  : '<div class="card-zh">' + esc(w.zh || "") + '</div>') +
          (cols(w).length ? '<div class="card-col">' + colChips(w, { hl: true, speak: true }) + '</div>' : '') +
          (w.ex ? '<div class="card-ex">' + highlight(w.ex, w) + ' ' + speakBtn(w.ex, "播放例句") + '</div>' : '') +
          (w.exZh ? '<div class="card-exzh">' + esc(w.exZh) + '</div>' : '') +
          '</div>';
      }
      root.innerHTML = counter +
        '<div class="card' + (R.revealed ? '' : ' tapzone') + '"' + (R.revealed ? '' : ' data-act="reveal" title="點一下翻面（空白鍵）"') + '>' + front + back + '</div>' +
        (R.revealed
          ? '<div class="grade four">' +
              '<button class="btn g-forgot" data-act="grade" data-g="1"><span>忘了</span><kbd>1</kbd></button>' +
              '<button class="btn g-learning" data-act="grade" data-g="2"><span>模糊</span><kbd>2</kbd></button>' +
              '<button class="btn g-known" data-act="grade" data-g="3"><span>記得</span><kbd>3</kbd></button>' +
              '<button class="btn g-easy" data-act="grade" data-g="4"><span>很簡單</span><kbd>4</kbd></button></div>'
          : '<button class="btn big primary" style="width:100%" data-act="reveal">翻面 <kbd>Space</kbd></button>');
    },
    onKey: function (e) {
      var k = e.key;
      if (k === " " || k === "Spacebar" || (k === "Enter" && !R.revealed)) { reviewReveal(); return true; }
      if (R.revealed && /^[1-4]$/.test(k)) { reviewGrade(Number(k)); return true; }
      if ((k === "s" || k === "S") && R.queue.length) {
        var c = S.cards[R.queue[0]] || {};
        if (R.revealed || (c.reps || 0) % 2 === 0) speak(speakableHeadword(getWord(R.queue[0])));
        return true;
      }
      return false;
    }
  };
  delegate("review", {
    reveal: function (el, ev) { if (ev.target.closest("[data-act]") !== el) return; reviewReveal(); },
    grade: function (el) { reviewGrade(Number(el.dataset.g)); },
    say: function (el, ev) { ev.stopPropagation(); sayHandler(el); },
    go: function (el) { go(el.dataset.view); },
    reload: function () { R.active = false; VIEWS.review.enter({}); }
  });

  /* =========================================================
   * 11. Speaking practice (口說活用)
   * ======================================================= */
  var INTERVALS = [0, 1, 2, 4, 8, 16];
  var DRILLS = { A: "中翻英快說", B: "搭配詞造句", C: "真實問答" };
  var TOPICS = ["你的一天", "工作", "旅行"];
  var SP = {
    queue: [], adhoc: false, drill: null, checked: false, used: false, done: 0,
    box: null, timer: null, mission: null, pickLv: new Set([1]), aiBusy: false
  };

  function drillFor(id) {
    var s = S.speak[id], box = s ? s.box : 0;
    return box <= 1 ? "A" : box <= 3 ? "B" : "C";
  }
  function canDrill(w, d) { return d === "A" ? !!(w.ex && w.exZh) : true; }
  function fallbackQuestion(w) {
    return "Tell me something about your life using the word \"" + mainForm(w) + "\".";
  }
  function clearSpeakTimers() {
    if (SP.timer) { SP.timer.stop(); SP.timer = null; }
    if (SP.mission && SP.mission.timer) SP.mission.timer.stop();
  }
  function speakGrade(success) {
    if (!SP.queue.length) return;
    var id = SP.queue.shift();
    var s = S.speak[id] || { box: 0, due: 0, last: 0, uses: 0 };
    s.box = success ? Math.min(5, (s.box || 0) + 1) : 0;
    s.due = Date.now() + INTERVALS[s.box] * DAY;
    s.last = Date.now();
    if (SP.used) s.uses = (s.uses || 0) + 1;
    S.speak[id] = s;
    logInc("speak");
    save();
    SP.done++;
    if (!success) SP.queue.splice(Math.min(SP.queue.length, 3), 0, id);
    startSpeakItem();
  }
  function startSpeakItem() {
    stopRecording(); stopSpeaking(); clearSpeakTimers();
    SP.checked = false; SP.used = false; SP.aiBusy = false;
    SP.drill = SP.queue.length ? drillFor(SP.queue[0]) : null;
    if (SP.drill && !canDrill(getWord(SP.queue[0]), SP.drill)) SP.drill = "B";
    VIEWS.speak.render();
  }

  VIEWS.speak = {
    enter: function () {
      if (!SP.mission && !SP.queue.length) {
        SP.queue = dueSpeakIds(); SP.adhoc = false; SP.done = 0;
      }
      if (SP.mission) this.render(); else startSpeakItem();
    },
    leave: function () { clearSpeakTimers(); },
    headHTML: function () {
      var dueN = dueSpeakIds().length, total = Object.keys(S.speak).length;
      return '<div class="panel" style="padding:12px 14px"><div class="row">' +
        '<div><b>口說佇列</b> <span class="muted small">到期 ' + dueN + ' · 佇列共 ' + total + ' · 本輪已練 ' + SP.done + '</span></div>' +
        '<span class="spacer"></span>' +
        (SP.mission ? '<button class="btn" data-act="mission-close">✕ 結束任務</button>'
                    : '<button class="btn primary" data-act="mission">🎯 今日口說任務</button>') +
        '</div></div>';
    },
    render: function () {
      var root = viewEl("speak");
      if (SP.mission) { root.innerHTML = this.headHTML() + this.missionHTML(); this.bindMission(); return; }
      if (!SP.queue.length) { root.innerHTML = this.headHTML() + this.pickerHTML(); return; }
      var id = SP.queue[0], w = getWord(id), d = SP.drill;
      var tabs = '<div class="drill-tabs">' + ["A", "B", "C"].map(function (k) {
        var ok = canDrill(w, k);
        return '<button class="chip' + (k === d ? " on" : "") + '" data-act="drill" data-d="' + k + '"' + (ok ? "" : " disabled title=\"這個字沒有例句\"") + '>' + k + '. ' + DRILLS[k] + '</button>';
      }).join("") + '</div>';
      var s = S.speak[id];
      var meta = '<div class="counter"><span>' + lvBadge(w) + ' 盒子 ' + (s ? s.box : 0) + '/5' + (s && s.uses ? ' · 已用出 ' + s.uses + ' 次' : '') + (SP.adhoc ? ' · 自選練習' : '') + '</span>' +
        '<span class="spacer"></span><span>剩 ' + SP.queue.length + ' 個</span></div>';
      root.innerHTML = this.headHTML() + meta + '<div class="card" style="text-align:left;min-height:0">' + tabs + this.drillHTML(w, d) + '</div>';
      this.bindDrill(w, d);
    },
    pickerHTML: function () {
      var chips = "";
      for (var i = 1; i <= 6; i++) chips += '<button class="chip' + (SP.pickLv.has(i) ? " on" : "") + '" data-act="picklv" data-lv="' + i + '">Lv' + i + '</button>';
      var pending = Object.keys(S.speak).length;
      var learningN = Object.keys(S.cards).filter(function (id) { var st = S.cards[id].st; return (st === "learning" || st === "forgot") && getWord(id); }).length;
      return '<div class="panel"><div class="empty" style="padding:10px"><div class="big">🗣️</div>' +
        '<p>' + (SP.done ? "這輪口說練習完成了！共 " + SP.done + " 個。" : "目前沒有到期的口說練習。") + '</p></div>' +
        '<h3>自己挑字來練</h3><div class="stack">' +
        (pending ? '<div><button class="btn" data-act="pick" data-src="queue">提前練習佇列中的字（' + pending + '）</button></div>' : '') +
        '<div><button class="btn" data-act="pick" data-src="learning"' + (learningN ? "" : " disabled") + '>從「學習中／忘記」挑 10 個（共 ' + learningN + '）</button></div>' +
        '<div class="row">' + chips + '<button class="btn" data-act="pick" data-src="level">從所選等級隨機 10 個</button></div>' +
        '</div></div>';
    },
    drillHTML: function (w, d) {
      var html = "";
      var mf = mainForm(w);
      if (d === "A") {
        html += '<div class="muted small">把這句中文用英文說出來（要用到目標字）</div>' +
          '<div class="drill-prompt">' + esc(w.exZh) + '</div>' +
          '<div class="row" style="justify-content:center">' +
            '<span class="chip hint">' + esc(w.pos || "") + '</span>' +
            '<span class="chip hint">字首 ' + esc(mf.charAt(0)) + '…</span>' +
            '<span class="chip hint">' + esc(w.zh || "") + '</span>' +
            colChips(w, { blank: true }) +
          '</div>';
      } else if (d === "B") {
        html += '<div class="drill-word">' + esc(w.w) + ' ' + speakBtn(speakableHeadword(w)) + '</div>' +
          '<div class="muted" style="text-align:center">' + esc(w.pos || "") + ' ' + esc(w.zh || "") + '</div>' +
          (cols(w).length ? '<div class="card-col" style="margin:10px 0">' + colChips(w, { hl: true, speak: true }) + '</div>' : '') +
          '<div class="drill-prompt" style="font-size:1.1rem">' +
          (cols(w).length ? "用任一個搭配詞說一句關於你自己的話" : "用這個字說一句關於你自己的話") + '</div>';
      } else {
        html += '<div class="muted small">目標字：<b>' + esc(w.w) + '</b> ' + esc(w.pos || "") + ' ' + esc(w.zh || "") + ' ' + speakBtn(speakableHeadword(w)) + '</div>' +
          '<div class="drill-prompt">' + esc(w.q || fallbackQuestion(w)) + ' ' + speakBtn(w.q || fallbackQuestion(w), "播放問題") + '</div>' +
          '<div class="timer" data-timer>0:30</div>' +
          '<div class="row" style="justify-content:center">' +
            '<button class="btn primary" data-act="cstart">▶ 開始（30 秒，先說再想）</button>' +
            '<button class="btn" data-act="cextend">+15 秒</button></div>';
      }
      html += answerBoxHTML();
      html += '<div class="row" style="margin-top:8px"><button class="btn primary" data-act="check">' + (SP.checked ? "重新檢查" : "檢查／看答案") + ' <kbd>C</kbd></button></div>';
      html += '<div data-result></div>';
      return html;
    },
    bindDrill: function (w, d) {
      var root = viewEl("speak");
      var self = this;
      SP.box = bindAnswerBox(root, {
        onInput: function () { if (SP.checked) self.renderResult(w, d); }
      });
      if (d === "C") {
        var tEl = $("[data-timer]", root);
        SP.timer = makeTimer(30, function (r) {
          tEl.textContent = Math.floor(r / 60) + ":" + pad2(r % 60);
          tEl.classList.toggle("low", r <= 5);
        }, function () {
          stopRecording();
          toast("時間到！");
          self.doCheck(w, d);
        });
      }
    },
    doCheck: function (w, d) {
      SP.checked = true;
      this.renderResult(w, d);
      var btn = $('[data-act="check"]', viewEl("speak"));
      if (btn) btn.innerHTML = '重新檢查 <kbd>C</kbd>';
    },
    renderResult: function (w, d) {
      var el = $("[data-result]", viewEl("speak"));
      if (!el) return;
      var ans = SP.box ? SP.box.text() : "";
      var used = containsHeadword(ans, w);
      SP.used = used;
      var html = '<div class="stack" style="margin-top:12px">';
      html += ans
        ? '<div class="check ' + (used ? "ok" : "no") + '">' + (used ? "✔ 有用到目標字「" + esc(w.w) + "」" : "✘ 還沒用到目標字「" + esc(w.w) + "」") + '</div>'
        : '<div class="check no">（還沒有回答）</div>';
      html += '<div class="compare">';
      if (ans) html += '<div><span class="lbl">你的回答</span>' + highlight(ans, w) + '</div>';
      if (w.ex) html += '<div><span class="lbl">' + (d === "A" ? "範例答案" : "參考例句") + '</span>' + highlight(w.ex, w) + ' ' + speakBtn(w.ex, "播放例句") +
        (w.exZh ? '<div class="muted small">' + esc(w.exZh) + '</div>' : '') + '</div>';
      if (d !== "A") html += '<div><span class="lbl">目標字</span><b>' + esc(w.w) + '</b> ' + esc(w.pos || "") + ' ' + esc(w.zh || "") + '</div>';
      html += '</div>';
      html += '<div class="row">' +
        '<button class="btn" data-act="again">🔁 再說一次</button>' +
        (w.ex ? '<button class="btn" data-act="shadow">🎧 跟讀 (shadow)</button>' : '') +
        (S.settings.apiKey && ans ? '<button class="btn" data-act="ai"' + (SP.aiBusy ? " disabled" : "") + '>🤖 AI 批改</button>' : '') +
        '</div><div data-ai></div>';
      html += '<div class="grade" style="grid-template-columns:1fr 1fr">' +
        '<button class="btn g-forgot" data-act="sgrade" data-ok="0"><span>還不行</span><kbd>1</kbd></button>' +
        '<button class="btn g-known" data-act="sgrade" data-ok="1"><span>說得出來</span><kbd>2</kbd></button></div>';
      html += '</div>';
      var aiPrev = $("[data-ai]", el);
      var keepAi = aiPrev ? aiPrev.innerHTML : "";
      el.innerHTML = html;
      if (keepAi) $("[data-ai]", el).innerHTML = keepAi;
    },
    taskText: function (w, d) {
      if (d === "A") return "Translate this Chinese sentence into spoken English using the target word: " + (w.exZh || "");
      if (d === "B") return "Say one sentence about yourself using the target word, ideally with one of these collocations: " + cols(w).join("; ");
      return "Answer this personal question out loud (30-second timed answer), using the target word: " + (w.q || fallbackQuestion(w));
    },
    // ---- Today's speaking mission ----
    startMission: function () {
      var picked = [], seen = new Set();
      function add(ids) { ids.forEach(function (id) { id = Number(id); if (picked.length < 5 && !seen.has(id) && getWord(id)) { seen.add(id); picked.push(id); } }); }
      add(shuffle(dueSpeakIds()));
      add(Object.keys(S.speak).sort(function (a, b) { return S.speak[a].due - S.speak[b].due; }));
      add(shuffle(Object.keys(S.cards).filter(function (id) { return S.cards[id].st !== "known"; })));
      add(sample(WORDS.filter(function (w) { return lvOf(w) <= 3; }).map(function (w) { return w.id; }), 10));
      add(sample(ALPHA, 10));
      if (!picked.length) { toast("沒有可用的單字"); return; }
      stopRecording(); clearSpeakTimers();
      SP.mission = { ids: picked, topic: TOPICS[Math.floor(Math.random() * TOPICS.length)], timer: null, finished: false };
      this.render();
    },
    missionHTML: function () {
      var m = SP.mission;
      return '<div class="card" style="text-align:left;min-height:0">' +
        '<h2>🎯 今日口說任務</h2>' +
        '<div class="drill-prompt" style="font-size:1.15rem">用這 ' + m.ids.length + ' 個字講一段 1 分鐘的話（主題：' + esc(m.topic) + '）</div>' +
        '<ul class="checklist" data-checklist>' + m.ids.map(function (id) {
          var w = getWord(id);
          return '<li data-mid="' + esc(id) + '"><span data-tick>☐</span> <b>' + esc(w.w) + '</b> <span class="muted small">' + esc(w.zh || "") + '</span></li>';
        }).join("") + '</ul>' +
        '<div class="timer" data-timer>1:00</div>' +
        '<div class="row" style="justify-content:center">' +
          '<button class="btn primary" data-act="mstart">▶ 開始（60 秒）</button>' +
          '<button class="btn" data-act="mextend">+15 秒</button>' +
          '<button class="btn" data-act="mdone">完成</button>' +
          '<button class="btn ghost" data-act="mission">🔀 換一組</button></div>' +
        answerBoxHTML("你的獨白（可修改辨識結果，或直接打字）") +
        '<div data-mresult></div></div>';
    },
    bindMission: function () {
      var root = viewEl("speak"), m = SP.mission, self = this;
      SP.box = bindAnswerBox(root, { onInput: function () { self.updateChecklist(); } });
      var tEl = $("[data-timer]", root);
      m.timer = makeTimer(60, function (r) {
        tEl.textContent = Math.floor(r / 60) + ":" + pad2(r % 60);
        tEl.classList.toggle("low", r <= 10);
      }, function () { stopRecording(); toast("時間到！"); self.finishMission(); });
    },
    updateChecklist: function () {
      var root = viewEl("speak"), txt = SP.box ? SP.box.text() : "", n = 0;
      SP.mission.ids.forEach(function (id) {
        var li = $('[data-mid="' + id + '"]', root); if (!li) return;
        var hit = containsHeadword(txt, getWord(id));
        if (hit) n++;
        li.classList.toggle("done", hit);
        $("[data-tick]", li).textContent = hit ? "☑" : "☐";
      });
      return n;
    },
    finishMission: function () {
      var m = SP.mission; if (!m) return;
      if (m.timer) m.timer.stop();
      stopRecording();
      var txt = SP.box ? SP.box.text() : "";
      var n = this.updateChecklist();
      if (!m.finished && txt) {
        m.finished = true;
        m.ids.forEach(function (id) {
          if (containsHeadword(txt, getWord(id)) && S.speak[id]) S.speak[id].uses = (S.speak[id].uses || 0) + 1;
        });
        logInc("speak");
        save();
      }
      var el = $("[data-mresult]", viewEl("speak"));
      if (el) el.innerHTML = '<div class="check ' + (n === m.ids.length ? "ok" : "no") + '" style="margin-top:10px">用到 ' + n + ' / ' + m.ids.length + ' 個目標字' +
        (n === m.ids.length ? " 🎉 太棒了！" : "") + '</div>' +
        (S.settings.apiKey && txt ? '<div class="row" style="margin-top:8px"><button class="btn" data-act="mai">🤖 AI 批改</button></div><div data-ai></div>' : '');
    },
    onKey: function (e) {
      var k = e.key;
      if (k === "m" || k === "M") { if (SP.box) SP.box.toggle(); return true; }
      if (SP.mission || !SP.queue.length) return false;
      var w = getWord(SP.queue[0]);
      if (k === "c" || k === "C") { this.doCheck(w, SP.drill); return true; }
      if (SP.checked && k === "1") { speakGrade(false); return true; }
      if (SP.checked && k === "2") { speakGrade(true); return true; }
      if (k === "s" || k === "S") { speak(SP.checked && w.ex ? w.ex : (SP.drill === "A" ? "" : speakableHeadword(w))); return true; }
      return false;
    }
  };
  delegate("speak", {
    say: function (el) { sayHandler(el); },
    drill: function (el) {
      if (el.disabled) return;
      stopRecording(); clearSpeakTimers();
      SP.drill = el.dataset.d; SP.checked = false; SP.used = false;
      VIEWS.speak.render();
    },
    check: function () { VIEWS.speak.doCheck(getWord(SP.queue[0]), SP.drill); },
    again: function () {
      if (!SP.box) return;
      SP.box.setText("");
      if (SR) SP.box.start(); else SP.box.focus();
    },
    shadow: function () {
      var w = getWord(SP.queue[0]); if (!w || !w.ex || !SP.box) return;
      stopRecording();
      SP.box.setText("");
      toast("先聽，播完後會自動開始錄音，請跟著說一遍");
      speak(w.ex, { rate: S.settings.rate, onend: function () { if (SR && SP.box && current === "speak") SP.box.start(); } });
    },
    sgrade: function (el) { speakGrade(el.dataset.ok === "1"); },
    cstart: function () {
      if (!SP.timer) return;
      SP.timer.start();
      if (SR && SP.box) SP.box.start(); else if (SP.box) SP.box.focus();
    },
    cextend: function () { if (SP.timer) SP.timer.add(15); },
    ai: function (el) {
      var w = getWord(SP.queue[0]), out = $("[data-ai]", viewEl("speak"));
      runAI(el, out, {
        word: w, drill: DRILLS[SP.drill], task: VIEWS.speak.taskText(w, SP.drill), answer: SP.box ? SP.box.text() : ""
      });
    },
    picklv: function (el) {
      var n = Number(el.dataset.lv);
      if (SP.pickLv.has(n)) { if (SP.pickLv.size > 1) SP.pickLv.delete(n); } else SP.pickLv.add(n);
      VIEWS.speak.render();
    },
    pick: function (el) {
      var src = el.dataset.src, ids = [];
      if (src === "queue") ids = Object.keys(S.speak).sort(function (a, b) { return S.speak[a].due - S.speak[b].due; }).slice(0, 20);
      else if (src === "learning") ids = sample(Object.keys(S.cards).filter(function (id) { var st = S.cards[id].st; return st === "learning" || st === "forgot"; }), 10);
      else ids = sample(WORDS.filter(function (w) { return SP.pickLv.has(lvOf(w)); }).map(function (w) { return w.id; }), 10);
      ids = ids.map(Number).filter(function (id) { return getWord(id); });
      if (!ids.length) { toast("沒有符合的單字"); return; }
      SP.queue = ids; SP.adhoc = true;
      startSpeakItem();
    },
    mission: function () { VIEWS.speak.startMission(); },
    "mission-close": function () {
      stopRecording(); clearSpeakTimers(); SP.mission = null;
      if (!SP.queue.length) SP.queue = dueSpeakIds();
      startSpeakItem();
    },
    mstart: function () {
      var m = SP.mission; if (!m || !m.timer) return;
      m.timer.start();
      if (SR && SP.box) SP.box.start(); else if (SP.box) SP.box.focus();
    },
    mextend: function () { if (SP.mission && SP.mission.timer) SP.mission.timer.add(15); },
    mdone: function () { VIEWS.speak.finishMission(); },
    mai: function (el) {
      var m = SP.mission, out = $("[data-ai]", viewEl("speak"));
      var words = m.ids.map(function (id) { var w = getWord(id); return w.w + " (" + (w.zh || "") + ")"; });
      runAI(el, out, {
        word: { w: words.join(", "), pos: "", zh: "" }, multi: true, drill: "今日口說任務 (1-minute monologue)",
        task: "Speak for one minute about the topic \"" + m.topic + "\" using all of these target words: " + words.join(", "),
        answer: SP.box ? SP.box.text() : ""
      });
    }
  });

  /* =========================================================
   * 12. Browse (單字表)
   * ======================================================= */
  var BR = { q: "", lv: new Set(), status: "all", limit: 200, open: new Set(), timer: null };
  var STATUS_LABEL = { all: "全部", new: "未篩查", known: "熟練", learning: "學習中", forgot: "忘記", speak: "口說中" };

  function browseFilter() {
    var q = BR.q.trim().toLowerCase();
    return ALPHA.filter(function (id) {
      var w = getWord(id);
      if (BR.lv.size && !BR.lv.has(lvOf(w))) return false;
      if (BR.status !== "all") {
        if (BR.status === "speak") { if (!inSpeak(id)) return false; }
        else if (statusOf(id) !== BR.status) return false;
      }
      if (q && w.w.toLowerCase().indexOf(q) < 0 && String(w.zh || "").toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  VIEWS.browse = {
    enter: function () { this.render(); },
    render: function () {
      var root = viewEl("browse");
      var lvChips = '<button class="chip' + (BR.lv.size ? "" : " on") + '" data-act="lv" data-lv="0">全部等級</button>';
      for (var i = 1; i <= 6; i++) lvChips += '<button class="chip' + (BR.lv.has(i) ? " on" : "") + '" data-act="lv" data-lv="' + i + '">Lv' + i + '</button>';
      var stChips = Object.keys(STATUS_LABEL).map(function (k) {
        return '<button class="chip' + (BR.status === k ? " on" : "") + '" data-act="st" data-st="' + k + '">' + STATUS_LABEL[k] + '</button>';
      }).join("");
      root.innerHTML = '<div class="filters">' +
        '<input type="search" data-search placeholder="搜尋英文或中文…" value="' + esc(BR.q) + '" aria-label="搜尋單字">' +
        '<div class="row">' + lvChips + '</div><div class="row">' + stChips + '</div></div>' +
        '<div data-list></div>';
      var input = $("[data-search]", root);
      input.addEventListener("input", function () {
        clearTimeout(BR.timer);
        BR.timer = setTimeout(function () { BR.q = input.value; BR.limit = 200; VIEWS.browse.renderList(); }, 150);
      });
      this.renderList();
    },
    renderList: function () {
      var el = $("[data-list]", viewEl("browse"));
      var ids = browseFilter();
      var shown = ids.slice(0, BR.limit);
      var html = '<div class="counter"><span>共 <b>' + ids.length + '</b> 字' + (ids.length > shown.length ? '，顯示前 ' + shown.length + ' 個' : '') + '</span></div>';
      if (!ids.length) { el.innerHTML = html + '<div class="panel empty">沒有符合的單字</div>'; return; }
      html += '<ul class="list">' + shown.map(function (id) { return VIEWS.browse.rowHTML(id); }).join("") + '</ul>';
      if (ids.length > shown.length) html += '<div class="row" style="justify-content:center;margin-top:12px"><button class="btn" data-act="more">載入更多（還有 ' + (ids.length - shown.length) + '）</button></div>';
      el.innerHTML = html;
    },
    rowHTML: function (id) {
      var w = getWord(id), st = statusOf(id), open = BR.open.has(id);
      var row = '<li data-row="' + esc(id) + '"><button type="button" class="list-row" data-act="toggle" data-id="' + esc(id) + '" aria-expanded="' + open + '">' +
        '<span class="dot ' + (st === "new" ? "" : st) + (inSpeak(id) ? " speak" : "") + '" title="' + STATUS_LABEL[st] + (inSpeak(id) ? "・口說中" : "") + '"></span>' +
        '<span class="list-w">' + esc(w.w) + '</span><span class="list-pos">' + esc(w.pos || "") + '</span>' + lvBadge(w) +
        '<span class="list-zh">' + esc(w.zh || "") + '</span></button>';
      if (open) {
        row += '<div class="list-detail">' +
          '<div>' + speakBtn(speakableHeadword(w)) + ' <b>' + esc(w.w) + '</b> ' + esc(w.zh || "") + ' <span class="muted small">（' + STATUS_LABEL[st] + (inSpeak(id) ? "・口說中" : "") + '）</span></div>' +
          (cols(w).length ? '<div><div class="lbl">搭配詞</div><div class="row">' + colChips(w, { hl: true, speak: true }) + '</div></div>' : '') +
          (w.ex ? '<div><div class="lbl">例句</div>' + highlight(w.ex, w) + ' ' + speakBtn(w.ex, "播放例句") + (w.exZh ? '<div class="muted small">' + esc(w.exZh) + '</div>' : '') + '</div>' : '') +
          (w.q ? '<div><div class="lbl">口說問題</div>' + esc(w.q) + '</div>' : '') +
          '<div class="row">' +
            '<button class="btn" data-act="addspeak" data-id="' + esc(id) + '"' + (inSpeak(id) ? " disabled" : "") + '>🗣️ ' + (inSpeak(id) ? "已在口說練習" : "加入口說練習") + '</button>' +
            '<button class="btn g-forgot" data-act="markforgot" data-id="' + esc(id) + '">標記忘了</button>' +
            '<button class="btn g-known" data-act="markknown" data-id="' + esc(id) + '">標記熟練</button></div>' +
          '</div>';
      }
      return row + '</li>';
    },
    refreshRow: function (id) {
      var li = $('[data-row="' + id + '"]', viewEl("browse"));
      if (li) li.outerHTML = this.rowHTML(id);
    }
  };
  delegate("browse", {
    lv: function (el) {
      var n = Number(el.dataset.lv);
      if (!n) BR.lv.clear(); else if (BR.lv.has(n)) BR.lv.delete(n); else BR.lv.add(n);
      BR.limit = 200; VIEWS.browse.render();
    },
    st: function (el) { BR.status = el.dataset.st; BR.limit = 200; VIEWS.browse.render(); },
    more: function () { BR.limit += 200; VIEWS.browse.renderList(); },
    toggle: function (el) {
      var id = Number(el.dataset.id);
      if (BR.open.has(id)) BR.open.delete(id); else BR.open.add(id);
      VIEWS.browse.refreshRow(id);
    },
    say: function (el) { sayHandler(el); },
    addspeak: function (el) { var id = Number(el.dataset.id); if (addToSpeak(id)) { save(); toast("已加入口說練習"); } VIEWS.browse.refreshRow(id); },
    markforgot: function (el) { var id = Number(el.dataset.id); markForgot(id); save(); toast("已標記為忘了（會出現在複習）"); VIEWS.browse.refreshRow(id); },
    markknown: function (el) { var id = Number(el.dataset.id); markKnown(id); save(); toast("已標記為熟練"); VIEWS.browse.refreshRow(id); }
  });

  /* =========================================================
   * 13. Settings (設定)
   * ======================================================= */
  function renderVoiceOptions() {
    var sel = $("[data-voice]", viewEl("settings"));
    if (!sel) return;
    var cur = S.settings.voice;
    sel.innerHTML = '<option value="">自動（優先 en-US）</option>' + voices.map(function (v) {
      return '<option value="' + esc(v.voiceURI) + '"' + (v.voiceURI === cur ? " selected" : "") + '>' + esc(v.name + " (" + v.lang + ")") + '</option>';
    }).join("");
  }
  VIEWS.settings = {
    enter: function () { this.render(); },
    render: function () {
      var root = viewEl("settings"), st = S.settings;
      var nCards = Object.keys(S.cards).length, nSpeak = Object.keys(S.speak).length;
      root.innerHTML =
        '<div class="panel"><h2>發音（TTS）</h2>' +
          (TTS_OK ? '' : '<div class="note">此瀏覽器不支援語音合成。</div>') +
          '<div class="field"><label for="set-voice">聲音</label><select id="set-voice" data-voice></select></div>' +
          '<div class="field"><label for="set-rate">語速：<span data-rateval>' + st.rate.toFixed(2) + '</span></label>' +
            '<input id="set-rate" type="range" min="0.6" max="1.2" step="0.05" value="' + st.rate + '" data-rate></div>' +
          '<div class="row"><button class="btn" data-act="testvoice">🔊 試聽</button>' +
          '<label class="switch"><input type="checkbox" data-autospeak' + (st.autoSpeak ? " checked" : "") + '> 複習翻面時自動發音</label></div>' +
        '</div>' +
        '<div class="panel"><h2>AI 批改（選用）</h2>' +
          '<div class="field"><label for="set-key">Claude API 金鑰</label>' +
            '<div class="row" style="flex-wrap:nowrap"><input id="set-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" data-key value="' + esc(st.apiKey || "") + '">' +
            '<button class="btn" data-act="togglekey">顯示</button></div>' +
            '<div class="note">金鑰只存在這台電腦的瀏覽器裡；只有按『AI 批改』時才會送到 Anthropic</div></div>' +
          '<div class="row"><button class="btn" data-act="savekey">儲存金鑰</button>' +
          (st.apiKey ? '<button class="btn danger" data-act="clearkey">清除金鑰</button>' : '') + '</div>' +
        '</div>' +
        '<div class="panel"><h2>進度資料</h2>' +
          '<p class="muted small">單字 ' + WORDS.length + ' 個 · 已篩查 ' + nCards + ' · 口說佇列 ' + nSpeak + ' · 活動天數 ' + Object.keys(S.log).length + '</p>' +
          '<div class="row">' +
            '<button class="btn" data-act="export">⬇️ 匯出進度 (JSON)</button>' +
            '<button class="btn" data-act="import">⬆️ 匯入進度</button>' +
            '<input type="file" accept="application/json,.json" data-file hidden>' +
            '<button class="btn danger" data-act="reset">重設所有進度</button></div>' +
          '<p class="muted small">匯出檔不包含 API 金鑰。</p>' +
        '</div>' +
        '<div class="panel"><h2>鍵盤快捷鍵</h2><div class="small muted">' +
          '<p><b>快速篩查：</b>← / 1 忘了 · ↓ / 2 說不出 · → / 3 很熟 · Space 偷看 · S 發音 · Z 復原</p>' +
          '<p><b>複習：</b>Space 翻面 · 1 忘了 · 2 模糊 · 3 記得 · 4 很簡單 · S 發音</p>' +
          '<p><b>口說活用：</b>M 麥克風 · C 檢查 · 1 還不行 · 2 說得出來 · S 播放</p>' +
          '<p>（在輸入框打字時快捷鍵不會作用）</p></div></div>';
      renderVoiceOptions();
      var sel = $("[data-voice]", root), rate = $("[data-rate]", root), auto = $("[data-autospeak]", root);
      sel.addEventListener("change", function () { S.settings.voice = sel.value; save(); });
      rate.addEventListener("input", function () {
        S.settings.rate = clamp(Number(rate.value), 0.6, 1.2);
        $("[data-rateval]", root).textContent = S.settings.rate.toFixed(2);
      });
      rate.addEventListener("change", save);
      auto.addEventListener("change", function () { S.settings.autoSpeak = auto.checked; save(); });
      var file = $("[data-file]", root);
      file.addEventListener("change", function () {
        var f = file.files && file.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          var data;
          try { data = JSON.parse(reader.result); } catch (e) { toast("檔案不是有效的 JSON"); return; }
          if (!data || typeof data !== "object" || (!data.cards && !data.speak)) { toast("這不是本工具匯出的進度檔"); return; }
          if (!confirm("匯入會取代目前的所有進度，確定嗎？")) return;
          var key = S.settings.apiKey;
          S = normalizeState(data);
          if (!S.settings.apiKey) S.settings.apiKey = key;
          save(); resetSessions();
          toast("匯入完成：" + Object.keys(S.cards).length + " 張卡片");
          VIEWS.settings.render();
        };
        reader.readAsText(f);
        file.value = "";
      });
    }
  };
  function resetSessions() {
    T.list = null; T.undo = []; T.session = { count: 0, forgot: 0, cant: 0 }; endBatch();
    R.queue = []; R.active = false; R.done = 0;
    SP.queue = []; SP.mission = null; SP.done = 0;
  }
  delegate("settings", {
    testvoice: function () { speak("Hi! This is how I sound. Practice makes perfect."); },
    togglekey: function (el) {
      var inp = $("[data-key]", viewEl("settings"));
      var show = inp.type === "password";
      inp.type = show ? "text" : "password";
      el.textContent = show ? "隱藏" : "顯示";
    },
    savekey: function () {
      S.settings.apiKey = $("[data-key]", viewEl("settings")).value.trim();
      save(); toast(S.settings.apiKey ? "金鑰已儲存在此瀏覽器" : "金鑰已清除");
      VIEWS.settings.render();
    },
    clearkey: function () { S.settings.apiKey = ""; save(); toast("金鑰已清除"); VIEWS.settings.render(); },
    export: function () {
      var data = clone(S);
      data.settings.apiKey = "";
      data.exportedAt = new Date().toISOString();
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = "vocab-progress-" + todayKey() + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast("已匯出進度檔");
    },
    import: function () { $("[data-file]", viewEl("settings")).click(); },
    reset: function () {
      if (!confirm("確定要清除所有學習進度（篩查、複習、口說、紀錄）嗎？設定與金鑰會保留。")) return;
      if (!confirm("真的確定？此動作無法復原（建議先匯出備份）。")) return;
      S = normalizeState({ settings: S.settings });
      save(); resetSessions();
      toast("進度已重設");
      VIEWS.settings.render();
    }
  });

  /* =========================================================
   * 14. AI 批改 (Anthropic SDK, lazily imported)
   * ======================================================= */
  var SYSTEM_PROMPT = [
    "You are a friendly, encouraging English speaking coach for a Taiwanese adult learner who recognises many words but struggles to use them when speaking.",
    "You will receive the target word(s), the practice task (drill type and prompt), and the learner's answer.",
    "The answer is a transcript produced by speech recognition, so ignore punctuation, capitalisation and obvious speech-recognition slips (homophones, missing small words); judge what the learner most likely said.",
    "Reply in Traditional Chinese as used in Taiwan (繁體中文), keeping English words and sentences in English. Use exactly these short sections, each starting on its own line with the heading shown:",
    "✅ 有沒有正確使用目標字 — say whether the target word was used correctly (meaning, form, collocation) and briefly why.",
    "✏️ 修正版 — a minimal correction of the learner's own sentence(s); keep their idea and wording as much as possible. If it is already correct, say so and repeat it.",
    "🗣️ 更自然的說法 — 1–2 natural, native-sounding spoken alternatives that use the target word.",
    "💡 一個小提醒 — one short tip about usage or a useful collocation of the word.",
    "Keep the whole reply under 120 Chinese words (English sentences not counted). Plain text only: no Markdown tables, no code blocks, no HTML."
  ].join("\n");

  var sdkPromise = null;
  function loadSDK() {
    if (!sdkPromise) {
      sdkPromise = import("https://esm.sh/@anthropic-ai/sdk").catch(function (e) { sdkPromise = null; throw e; });
    }
    return sdkPromise;
  }
  function aiErrorMessage(err, Anthropic) {
    if (Anthropic && err) {
      if (Anthropic.AuthenticationError && err instanceof Anthropic.AuthenticationError) return "API 金鑰無效，請到「設定」確認金鑰。";
      if (Anthropic.PermissionDeniedError && err instanceof Anthropic.PermissionDeniedError) return "這把金鑰沒有使用此模型的權限。";
      if (Anthropic.RateLimitError && err instanceof Anthropic.RateLimitError) return "請求太頻繁或額度不足，請稍後再試。";
      if (Anthropic.BadRequestError && err instanceof Anthropic.BadRequestError) return "請求被拒絕：" + (err.message || "格式錯誤");
      if (Anthropic.APIConnectionError && err instanceof Anthropic.APIConnectionError) return "網路連線失敗，請檢查網路後再試。";
      if (Anthropic.APIError && err instanceof Anthropic.APIError) {
        if (err.status >= 500) return "Anthropic 伺服器暫時忙碌（" + err.status + "），請稍後再試。";
        if (err.status === 402) return "帳戶餘額不足，請到 Anthropic Console 確認帳單。";
        return "API 錯誤" + (err.status ? "（" + err.status + "）" : "") + "：" + (err.message || "");
      }
    }
    return "發生錯誤：" + ((err && err.message) || String(err));
  }
  function renderAIText(text) {
    return esc(text.trim())
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br>");
  }
  /** btn: button to disable while running; out: container element; ctx: {word, drill, task, answer, multi} */
  function runAI(btn, out, ctx) {
    var apiKey = S.settings.apiKey;
    if (!apiKey) { toast("請先到「設定」輸入 API 金鑰"); return; }
    if (!ctx.answer) { toast("先說或打一段回答，再請 AI 批改"); return; }
    if (!out) return;
    btn.disabled = true;
    SP.aiBusy = true;
    out.innerHTML = '<div class="ai-out"><span class="spinner"></span> AI 批改中…</div>';
    var w = ctx.word;
    var userContent =
      (ctx.multi ? "Target words: " + w.w : "Target word: " + w.w + (w.pos ? " (" + w.pos + ")" : "") + (w.zh ? " — 中文：" + w.zh : "")) + "\n" +
      "Drill: " + ctx.drill + "\n" +
      "Task: " + ctx.task + "\n" +
      (!ctx.multi && w.ex ? "Reference example sentence (for your reference only): " + w.ex + "\n" : "") +
      "Learner's transcript:\n\"\"\"\n" + ctx.answer + "\n\"\"\"";
    var Anthropic = null;
    loadSDK().then(function (mod) {
      Anthropic = mod.default;
      var client = new Anthropic({ apiKey: apiKey, dangerouslyAllowBrowser: true });
      return client.beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 2000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }]
      });
    }).then(function (res) {
      if (res.stop_reason === "refusal") {
        out.innerHTML = '<div class="ai-out err">AI 無法處理這段內容</div>';
        return;
      }
      var text = (res.content || []).filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("");
      out.innerHTML = text.trim()
        ? '<div class="ai-out">' + renderAIText(text) + '</div>'
        : '<div class="ai-out err">AI 沒有回傳內容，請再試一次。</div>';
    }).catch(function (err) {
      var msg = Anthropic ? aiErrorMessage(err, Anthropic) : "無法載入 AI 套件（需要網路連線）：" + ((err && err.message) || err);
      out.innerHTML = '<div class="ai-out err">' + esc(msg) + '</div>';
    }).then(function () {
      btn.disabled = false;
      SP.aiBusy = false;
    });
  }

  /* =========================================================
   * 15. Boot
   * ======================================================= */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopRecording();
  });
  var start = location.hash.replace("#", "");
  go(VIEWS[start] ? start : "dashboard");

  // Small hook for debugging / headless checks.
  window.__vocab = { state: function () { return S; }, containsHeadword: function (t, id) { return containsHeadword(t, getWord(id)); }, headwordForms: function (id) { return headwordForms(getWord(id)).list; } };
})();
