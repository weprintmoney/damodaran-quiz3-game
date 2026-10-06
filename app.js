(() => {
  const CHAPTERS = [
    { id: "warmup", n: "0", title: "Module 2 warm-up", meta: "Lessons 18–19 refresher · optional, never locks anything", gated: false },
    { id: "l20", n: "1", title: "The Cost of Capital: Wrap Up", meta: "Lesson 20 · cyclical, family-group and private firms", gated: true },
    { id: "l21", n: "2", title: "Alternative Approaches", meta: "Lesson 21 · adjusted present value", gated: true },
    { id: "l22", n: "3", title: "Moving to the Optimal", meta: "Lesson 22 · how fast, and how", gated: true },
    { id: "l23", n: "4", title: "The Right Financing", meta: "Lesson 23 · matching debt to assets", gated: true },
    { id: "l24-25", n: "5", title: "Dividends: Trends and the Trade Off", meta: "Lessons 24–25 · patterns, taxes, signals", gated: true },
    { id: "l26", n: "6", title: "Assessments", meta: "Lesson 26 · potential dividends vs cash returned", gated: true },
  ];
  const GATED = CHAPTERS.filter(c => c.gated).map(c => c.id);
  const FINAL_SECONDS_PER_Q = 240;
  const KEY = "doubt-everything:v1";

  let BANK = [];
  let byId = {};
  let state = load();
  let view = { name: "map" };
  let timerHandle = null;

  // ---------- storage ----------
  function blank() { return { mastered: {}, queue: {}, misses: {}, finalBest: null }; }
  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); return s && s.mastered ? s : blank(); }
    catch (e) { return blank(); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ } }

  // ---------- theme ----------
  const root = document.documentElement;
  try { const t = localStorage.getItem(KEY + ":theme"); if (t) root.dataset.theme = t; } catch (e) {}
  document.getElementById("themeToggle").onclick = () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem(KEY + ":theme", root.dataset.theme); } catch (e) {}
  };
  document.getElementById("resetBtn").onclick = () => {
    if (view.name === "reset-confirm") return;
    const app = el("main");
    view = { name: "reset-confirm" };
    app.innerHTML = `<div class="card done-panel"><h2>Start over?</h2><p>This clears every mastered question and your final-round score on this device.</p>
      <div class="actions" style="justify-content:center"><button class="btn ghost" data-go="map">Keep my progress</button><button class="btn" id="doReset">Reset</button></div></div>`;
    el("#doReset").onclick = () => { state = blank(); save(); go("map"); };
    window.scrollTo(0, 0);
  };
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-go]");
    if (t) { e.preventDefault(); go(t.dataset.go); }
  });

  // ---------- helpers ----------
  function el(sel) { return document.querySelector(sel); }
  function md(s) { return s ? marked.parse(String(s)) : ""; }
  function mdInline(s) { return s ? marked.parseInline(String(s)) : ""; }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function chapterQs(id) { return BANK.filter(q => q.chapter === id && !q.holdout); }
  function masteredCount(id) { return chapterQs(id).filter(q => state.mastered[q.id]).length; }
  function isDone(id) { const qs = chapterQs(id); return qs.length > 0 && qs.every(q => state.mastered[q.id]); }
  function isUnlocked(id) {
    const c = CHAPTERS.find(c => c.id === id);
    if (!c || !c.gated) return true;
    const i = GATED.indexOf(id);
    return i === 0 || isDone(GATED[i - 1]);
  }
  function finalUnlocked() { return GATED.every(isDone); }
  function queueFor(id) {
    const live = chapterQs(id).filter(q => !state.mastered[q.id]).map(q => q.id);
    const saved = (state.queue[id] || []).filter(qid => live.includes(qid));
    const q = saved.concat(live.filter(qid => !saved.includes(qid)));
    state.queue[id] = q;
    return q;
  }

  function fmt(n, unit) {
    const abs = Math.abs(n);
    const d = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : 4;
    const s = Number(n).toLocaleString("en-US", { maximumFractionDigits: d });
    if (unit === "%") return s + "%";
    if (unit && unit.startsWith("$")) return (n < 0 ? "−$" + s.replace("-", "") : "$" + s) + (unit.length > 1 ? " " + unit.slice(1).replace(/^\s*/, "") : "");
    return unit ? s + " " + unit : s;
  }
  function parseNum(raw, step) {
    if (raw == null) return NaN;
    let s = String(raw).trim().toLowerCase().replace(/[$,\s]/g, "").replace(/(million|billion|years?|yrs?|mil|bn|m|b|x)$/,"");
    const pct = s.endsWith("%");
    s = s.replace(/%$/, "");
    if (/^\(.*\)$/.test(s)) s = "-" + s.slice(1, -1);
    let v = Number(s);
    if (!isFinite(v) || s === "") return NaN;
    // "0.0803" typed for 8.03% — accept the decimal form too
    if (step.unit === "%" && !pct && Math.abs(v) < 1 && Math.abs(step.answer) >= 1) v *= 100;
    return v;
  }
  function close(v, target, step) {
    if (step.tol_abs != null) return Math.abs(v - target) <= step.tol_abs + 1e-9;
    if (step.unit === "%" && step.tol == null) return Math.abs(v - target) <= 0.05 + 1e-9;
    const tol = step.tol != null ? step.tol : 0.01;
    if (target === 0) return Math.abs(v) <= tol;
    return Math.abs(v - target) <= Math.abs(target) * tol + 1e-9;
  }

  // ---------- routing ----------
  function go(name, arg) {
    clearInterval(timerHandle);
    if (name === "map") view = { name: "map" };
    else if (name === "final") view = startFinal();
    else view = { name: "chapter", id: name, ...(arg || {}) };
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    const app = el("main");
    if (view.name === "map") return renderMap(app);
    if (view.name === "chapter") return renderChapter(app);
    if (view.name === "final") return renderFinal(app);
  }

  // ---------- map ----------
  function renderMap(app) {
    const row = (c) => {
      const total = chapterQs(c.id).length;
      const m = masteredCount(c.id);
      const unlocked = isUnlocked(c.id);
      const done = isDone(c.id);
      const state = !total ? "coming soon" : done ? "mastered ✓" : !unlocked ? "locked" : `${m} / ${total}`;
      return `<li><button class="chapter ${done ? "done" : ""}" ${unlocked && total ? `data-go="${c.id}"` : "disabled"}>
        <span class="num">${unlocked ? c.n : "🔒"}</span>
        <span><span class="title">${esc(c.title)}</span><br><span class="meta">${esc(c.meta)}</span>
          ${total ? `<span class="bar"><i style="width:${(m / total) * 100}%"></i></span>` : ""}</span>
        <span class="state">${state}</span></button></li>`;
    };
    const holdouts = BANK.filter(q => q.holdout).length;
    const fu = finalUnlocked();
    app.innerHTML = `
      <h1>Doubt Everything</h1>
      <p class="lede">Module 3 comprehension tests from the professor's own past quizzes and exams. A chapter opens when you've gotten every question in the one before it correct.</p>
      <ul class="chapters">${row(CHAPTERS[0])}</ul>
      <div class="group-label">Module 3</div>
      <ul class="chapters">${CHAPTERS.slice(1).map(row).join("")}
        <li><button class="chapter ${state.finalBest != null ? "done" : ""}" ${fu && holdouts ? 'data-go="final"' : "disabled"}>
          <span class="num">${fu ? "★" : "🔒"}</span>
          <span><span class="title">Final round</span><br><span class="meta">${holdouts} held-back questions · timed · one shot each</span></span>
          <span class="state">${state.finalBest != null ? "best " + state.finalBest + "%" : fu ? "ready" : "locked"}</span></button></li>
      </ul>`;
  }

  // ---------- chapter play ----------
  function renderChapter(app) {
    const c = CHAPTERS.find(c => c.id === view.id);
    if (!c || !isUnlocked(c.id)) return go("map");
    const queue = queueFor(c.id);
    save();
    if (!queue.length) {
      const next = GATED[GATED.indexOf(c.id) + 1];
      const nextC = CHAPTERS.find(x => x.id === next);
      app.innerHTML = `<div class="card done-panel"><div class="big">✓</div><h2>${esc(c.title)}: mastered</h2>
        <p>You got every question right on a clean attempt.</p>
        <div class="actions" style="justify-content:center">
          <button class="btn ghost" data-go="map">Chapter map</button>
          ${nextC ? `<button class="btn" data-go="${nextC.id}">Next: ${esc(nextC.title)}</button>` : c.gated && finalUnlocked() ? `<button class="btn" data-go="final">Final round</button>` : ""}
        </div></div>`;
      return;
    }
    if (!view.qid || !queue.includes(view.qid)) Object.assign(view, { qid: queue[0], step: 0, wrong: false, answers: [] });
    const q = byId[view.qid];
    const total = chapterQs(c.id).length;
    const retry = state.misses[q.id] ? ` · retry` : "";
    app.innerHTML = `
      <div class="crumbs"><span><a href="#" data-go="map">Map</a> / ${esc(c.title)}</span>
        <span>${masteredCount(c.id)} of ${total} mastered · ${queue.length} to go${retry}</span></div>
      ${questionCard(q, view, false)}`;
    wireQuestion(q, view, false, (correctAll) => {
      if (correctAll) {
        state.mastered[q.id] = true;
        state.queue[c.id] = queueFor(c.id).filter(x => x !== q.id);
      } else {
        state.misses[q.id] = (state.misses[q.id] || 0) + 1;
        const rest = queueFor(c.id).filter(x => x !== q.id);
        state.queue[c.id] = rest.concat(q.id);
      }
      save();
    }, () => { view = { name: "chapter", id: c.id }; render(); window.scrollTo(0, 0); });
  }

  function questionCard(q, v, finalMode) {
    const src = q.source
      ? `<a href="${esc(q.source.url)}" target="_blank" rel="noopener">${esc(q.source.label)}</a>`
      : q.basis
        ? (q.basis.url ? `<a href="${esc(q.basis.url)}" target="_blank" rel="noopener">${esc(q.basis.label)}</a>` : esc(q.basis.label))
        : "";
    const steps = q.steps.map((s, i) => {
      if (i > v.step) return "";
      return `<div class="step ${i < v.step ? "past" : ""}" data-i="${i}">
        <div class="ask">${mdInline(s.ask)}</div>
        ${s.kind === "choice" ? choiceInput(s, v.answers[i], finalMode) : numInput(s, v.answers[i])}
        ${v.answers[i] ? feedbackBlock(s, v.answers[i], finalMode) : ""}
      </div>`;
    }).join("");
    const finished = v.answers.length === q.steps.length && v.answers[q.steps.length - 1];
    return `<div class="card" data-qid="${esc(q.id)}">
      <div class="crumbs" style="margin-bottom:8px"><span class="pill">Lesson ${esc(q.lesson)} · ${esc(q.objective || "")}</span><span class="src">${src}</span></div>
      <div class="context">${md(q.context)}</div>
      ${steps}
      ${finished && !finalMode ? explainBlock(q) : ""}
      <div class="actions" id="actions"></div>
    </div>`;
  }
  function numInput(s, a) {
    return `<div class="answer-row">
      <input type="text" inputmode="decimal" autocomplete="off" placeholder="Your answer" aria-label="Your answer" ${a ? `value="${esc(a.raw)}" disabled` : ""}>
      ${s.unit ? `<span class="unit">${esc(s.unit)}</span>` : ""}
      ${a ? "" : `<button class="btn submit">Check</button>`}
    </div>${a ? "" : `<div class="hint">Numbers only. ${s.unit === "%" ? "8.03 or 8.03% or 0.0803 all work." : ""}</div>`}`;
  }
  function choiceInput(s, a, hide) {
    return `<div class="choices">${s.choices.map((c, j) => {
      const cls = a && hide && !a.revealed ? (j === a.pick ? "picked" : "") : a ? (j === s.correct ? "right" : j === a.pick ? "wrong" : "") : "";
      return `<button class="choice ${cls}" data-j="${j}" ${a ? "disabled" : ""}>${mdInline(c)}</button>`;
    }).join("")}</div>`;
  }
  function feedbackBlock(s, a, finalMode) {
    if (finalMode && !a.revealed) return `<div class="hint">Locked in.</div>`;
    let trap = "";
    if (!a.ok && s.kind === "numeric" && s.traps) {
      const t = s.traps.find(t => close(a.val, t.value, s));
      if (t) trap = `<p class="trap"><strong>What probably happened:</strong> ${mdInline(t.why)}</p>`;
    }
    if (!a.ok && s.kind === "choice" && s.choice_feedback && s.choice_feedback[a.pick]) {
      trap = `<p class="trap">${s.fromNumeric ? "<strong>What probably happened:</strong> " : ""}${mdInline(s.choice_feedback[a.pick])}</p>`;
    }
    const target = s.kind === "numeric" ? `The answer is <strong>${fmt(s.answer, s.unit)}</strong>.` : !a.ok && s.fromNumeric ? `The answer is <strong>${esc(s.choices[s.correct])}</strong>.` : "";
    return `<div class="feedback ${a.ok ? "right" : "wrong"}">
      <div class="verdict">${a.ok ? "Right." : "Not quite."} ${a.alt ? "" : target}</div>
      ${a.alt ? `<p class="trap">${mdInline(a.alt.why)} The textbook route gives <strong>${fmt(s.answer, s.unit)}</strong>.</p>` : ""}
      ${trap}
      ${!a.ok && s.explain_simple ? `<div class="scratch"><div class="scratch-title">From scratch</div>${md(s.explain_simple)}</div>` : ""}
      ${s.worked ? `<div class="worked">${!a.ok && s.explain_simple ? '<span class="worked-label">The math in one line</span>\n' : ""}${esc(s.worked)}</div>` : ""}
      ${a.ok && s.explain_simple ? `<details class="scratch-toggle"><summary>Show me from scratch</summary><div class="scratch">${md(s.explain_simple)}</div></details>` : ""}
      ${a.ok && s.kind === "choice" && s.choice_feedback && s.choice_feedback[s.correct] ? `<p>${mdInline(s.choice_feedback[s.correct])}</p>` : ""}
    </div>`;
  }
  function explainBlock(q) {
    return `<div class="explain">
      <h3>The intuition</h3>
      ${md(q.intuition)}
      ${q.doubt ? `<p class="doubt">${mdInline(q.doubt)}</p>` : ""}
      ${q.cite ? `<p class="src">${esc(q.cite)}</p>` : ""}
    </div>`;
  }

  function wireQuestion(q, v, finalMode, onFinish, onNext) {
    const stepEl = el(`.step[data-i="${v.step}"]`);
    const s = q.steps[v.step];
    const actions = el("#actions");
    const answered = v.answers[v.step];
    const record = (ans) => {
      v.answers[v.step] = ans;
      if (!ans.ok) v.wrong = true;
      if (finalMode) { v.score.push(ans.ok); }
      rerender();
    };
    const rerender = () => render();
    if (!answered) {
      if (s.kind === "choice") {
        stepEl.querySelectorAll(".choice").forEach(b => b.onclick = () => {
          const pick = Number(b.dataset.j);
          record({ pick, ok: pick === s.correct });
        });
      } else {
        const input = stepEl.querySelector("input");
        const btn = stepEl.querySelector(".submit");
        input.focus({ preventScroll: true });
        const submit = () => {
          const val = parseNum(input.value, s);
          if (isNaN(val)) { input.setCustomValidity("Enter a number"); input.reportValidity(); return; }
          record({ raw: input.value, val, ok: close(val, s.answer, s) || (s.accept || []).some(a => close(val, a.value, s)), alt: (s.accept || []).find(a => close(val, a.value, s)) });
        };
        btn.onclick = submit;
        input.onkeydown = e => { if (e.key === "Enter") submit(); };
        input.oninput = () => input.setCustomValidity("");
      }
      return;
    }
    // answered current step: offer next
    const isLast = v.step === q.steps.length - 1;
    const b = document.createElement("button");
    b.className = "btn";
    if (!isLast) {
      b.textContent = "Next part";
      b.onclick = () => { v.step++; render(); el(`.step[data-i="${v.step}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }); };
    } else {
      b.textContent = finalMode ? "Next question" : v.wrong ? "Got it. It'll come back later." : "Next question";
      b.onclick = () => { if (!v.finished) { v.finished = true; onFinish(!v.wrong); } onNext(); };
    }
    actions.appendChild(b);
    b.focus({ preventScroll: true });
  }

  // ---------- final round ----------
  function startFinal() {
    if (!finalUnlocked()) return { name: "map" };
    const ids = BANK.filter(q => q.holdout).map(q => q.id).sort(() => Math.random() - 0.5);
    return { name: "final", ids, i: 0, score: [], ends: Date.now() + ids.length * FINAL_SECONDS_PER_Q * 1000, cur: null, results: [] };
  }
  function renderFinal(app) {
    const f = view;
    const timeLeft = Math.max(0, Math.round((f.ends - Date.now()) / 1000));
    if (f.i >= f.ids.length || timeLeft === 0) {
      clearInterval(timerHandle);
      const totalSteps = f.ids.reduce((n, id) => n + byId[id].steps.length, 0);
      const right = f.score.filter(Boolean).length;
      const pct = Math.round((right / totalSteps) * 100);
      if (!f.saved) { f.saved = true; state.finalBest = Math.max(state.finalBest || 0, pct); save(); }
      app.innerHTML = `<div class="card done-panel"><div class="big">${pct}%</div>
        <h2>${right} of ${totalSteps} parts right${timeLeft === 0 && f.i < f.ids.length ? " before time ran out" : ""}</h2>
        <p>Review below. The chapters stay open so you can keep practicing.</p>
        <div class="actions" style="justify-content:center"><button class="btn ghost" data-go="map">Chapter map</button><button class="btn" data-go="final">Try again</button></div></div>
        ${f.results.map(r => `<div style="margin-top:16px">${questionCard(byId[r.id], { step: r.answers.length - 1, answers: r.answers.map(a => ({ ...a, revealed: true })) }, false)}</div>`).join("")}`;
      return;
    }
    const q = byId[f.ids[f.i]];
    if (!f.cur || f.cur.id !== q.id) f.cur = { id: q.id, step: 0, answers: [], wrong: false, score: f.score };
    const mm = String(Math.floor(timeLeft / 60)).padStart(2, "0"), ss = String(timeLeft % 60).padStart(2, "0");
    app.innerHTML = `<div class="crumbs"><span><a href="#" data-go="map">Map</a> / Final round</span>
      <span>Question ${f.i + 1} of ${f.ids.length} · <span class="timer ${timeLeft < 60 ? "low" : ""}" id="timer">${mm}:${ss}</span></span></div>
      ${questionCard(q, f.cur, true)}`;
    wireQuestion(q, f.cur, true, () => {}, () => {
      f.results.push({ id: q.id, answers: f.cur.answers });
      f.i++; f.cur = null; render(); window.scrollTo(0, 0);
    });
    clearInterval(timerHandle);
    timerHandle = setInterval(() => {
      const t = Math.max(0, Math.round((f.ends - Date.now()) / 1000));
      const tEl = el("#timer");
      if (t === 0) { if (f.cur && f.cur.answers.length) f.results.push({ id: q.id, answers: f.cur.answers }); f.i = f.ids.length; render(); return; }
      if (tEl) { tEl.textContent = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; tEl.classList.toggle("low", t < 60); }
    }, 1000);
  }

  // Every step plays as multiple choice. Numeric steps become choices here:
  // wrong options are the diagnosed mistakes (traps) first, then nearby values.
  function toChoices(q) {
    q.steps.forEach((s, k) => {
      if (s.kind !== "numeric") return;
      const show = v => fmt(v, s.unit);
      const right = show(s.answer);
      const opts = [{ v: s.answer, why: "" }];
      const taken = new Set([right]);
      const ok = v => isFinite(v) && !close(v, s.answer, s) && !(s.accept || []).some(x => close(v, x.value, s)) && !taken.has(show(v)) && !(s.answer > 0 && v <= 0);
      for (const t of s.traps || []) {
        if (opts.length >= 4) break;
        if (ok(t.value)) { opts.push({ v: t.value, why: t.why }); taken.add(show(t.value)); }
      }
      const a = s.answer;
      const pct = s.unit === "%";
      const nudges = pct
        ? [0.75, -0.75, 1.5, -1.5, 2.5, -2.5, 4, -4].map(d => a + d)
        : [1.15, 0.87, 1.3, 0.75, 1.5, 0.6, 2, 0.5].map(m => a * m);
      let h = 0;
      for (const ch of q.id + k) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const start = h % 2;
      for (let i = 0; opts.length < 4 && i < nudges.length; i++) {
        const v = Number(nudges[(i + start) % nudges.length].toPrecision(4));
        if (ok(v)) { opts.push({ v, why: "" }); taken.add(show(v)); }
      }
      s.kind = "choice";
      s.fromNumeric = true;
      s.choices = opts.map(o => show(o.v));
      s.choice_feedback = opts.map(o => o.why);
      s.correct = 0;
    });
    return q;
  }

  // Authors tend to put the right answer first; shuffle each question's options
  // in a fixed order (seeded by id) so the position gives nothing away.
  function shuffleChoices(q) {
    q.steps.forEach((s, k) => {
      if (s.kind !== "choice") return;
      const plain = s.choices.map(c => String(c).trim().toLowerCase());
      const ordered = plain.every(c => /^[a-e]$/.test(c)) || plain.every(c => c === "true" || c === "false");
      if (ordered) return;
      let h = 2166136261;
      for (const ch of q.id + ":" + k) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
      const order = s.choices.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
        const j = h % (i + 1);
        [order[i], order[j]] = [order[j], order[i]];
      }
      s.choices = order.map(i => s.choices[i]);
      if (s.choice_feedback) s.choice_feedback = order.map(i => s.choice_feedback[i]);
      s.correct = order.indexOf(s.correct);
    });
    return q;
  }

  // ---------- boot ----------
  fetch("questions.json", { cache: "no-cache" })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(data => {
      BANK = data.map(toChoices).map(shuffleChoices);
      byId = Object.fromEntries(BANK.map(q => [q.id, q]));
      render();
    })
    .catch(() => { el("main").innerHTML = `<p>Couldn't load the questions. Refresh to try again.</p>`; });
})();
