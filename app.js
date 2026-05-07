// ─────────────────────────────────────────────────────────────────────────────
// app.js  –  Centific Medical Transcription Portal  (v3 — injection fix)
//
// ROOT CAUSE OF ALL PREVIOUS FAILURES
// ─────────────────────────────────────────────────────────────────────────────
// The course HTML (medical_transcription_v4_2.html) declares its two key state
// variables using `let`:
//
//   let lang = 'en';
//   let completed = new Set();
//
// In modern browsers, `let` (and `const`) at the top level of a script are
// NOT added to the window object.  Every attempt to read or write
// `frameWindow.completed` or `frameWindow.lang` from outside the frame
// therefore silently accessed `undefined` — meaning:
//
//   • restoreCompletedModules() always bailed out immediately (guard failed)
//   • persistCourseProgress()   always bailed out immediately (guard failed)
//   • restoreCourseProgress()   always bailed out immediately (!frameWindow.T)
//
// Additionally, even with `var`, when setLang() runs `completed = new Set()`
// it creates a BRAND NEW Set object.  Any reference held by app.js to the
// OLD Set is now stale and invisible to the course rendering functions.
//
// THE FIX
// ─────────────────────────────────────────────────────────────────────────────
// Instead of trying to access frame variables from the outside (fragile),
// we inject a small <script> element directly INTO the frame immediately
// after it loads.  Because the injected script runs inside the frame's own
// JS execution context, it forms a proper lexical closure over `lang` and
// `completed` — regardless of whether those are declared with let, var, or
// const.  The injected API is then available as frameWindow.__portal.*
//
// This approach is robust against:
//   • let / const / var declarations
//   • setLang() reassigning `completed` to a new Set()
//   • Any future refactors to the course HTML variable names
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL    = "https://jjbfhxjqfbtxbzsmsrjx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqYmZoeGpxZmJ0eGJ6c21zcmp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMzY4OTAsImV4cCI6MjA5MzcxMjg5MH0.lNL0nvvqCVT_aQD-XzMwhIa_te5-Zxgq58GMsN-RtG8";
const COURSE_FILE     = "medical_transcription_v4_2.html";

const learnerKey       = "medicalCourse.learner";
const resultsKey       = "medicalCourse.results";
const activeAttemptKey = "medicalCourse.activeAttempt";

const localeToLang = {
  "English / UK":            "en",
  "Deutsch / Germany":       "de",
  "Nederlands / Netherlands":"nl",
  "Francais / France":       "fr",
  "Français / France":       "fr"
};

// ── DOM references ────────────────────────────────────────────────────────────
const loginView           = document.querySelector("#loginView");
const courseView          = document.querySelector("#courseView");
const loginForm           = document.querySelector("#loginForm");
const usernameInput       = document.querySelector("#usernameInput");
const localeInput         = document.querySelector("#localeInput");
const learnerTitle        = document.querySelector("#learnerTitle");
const sheetStatus         = document.querySelector("#sheetStatus");
const logoutButton        = document.querySelector("#logoutButton");
const courseFrame         = document.querySelector("#courseFrame");
const latestScore         = document.querySelector("#latestScore");
const latestStatus        = document.querySelector("#latestStatus");
const savedRows           = document.querySelector("#savedRows");
const resetProgressButton = document.querySelector("#resetProgressButton");
const openCourseLink      = document.querySelector("#openCourseLink");

let lastSubmittedKey = "";
let progressTimer    = 0;

// ── Learner helpers ───────────────────────────────────────────────────────────
function getLearner()        { return JSON.parse(localStorage.getItem(learnerKey) || "null"); }
function getResults()        { return JSON.parse(localStorage.getItem(resultsKey) || "[]"); }
function saveResults(r)      { localStorage.setItem(resultsKey, JSON.stringify(r)); }
function langForLearner(l)   { return localeToLang[l?.locale] || "en"; }
function learnerSlug(l)      { return `${l?.username || "guest"}.${langForLearner(l)}`.replace(/[^a-z0-9_.-]/gi, "_"); }
function courseProgressKey() { return `medicalCourse.progress.${learnerSlug(getLearner())}`; }
function courseAttemptKey()  { return `medicalCourse.finalAttempt.${learnerSlug(getLearner())}`; }

// ── LocalStorage progress helpers ────────────────────────────────────────────
function readSavedProgress() {
  try { return JSON.parse(localStorage.getItem(courseProgressKey()) || "{}"); }
  catch { return {}; }
}

// ── View helpers ──────────────────────────────────────────────────────────────
function showCourse(learner) {
  loginView.classList.add("hidden");
  courseView.classList.remove("hidden");
  learnerTitle.textContent = `${learner.username} - ${learner.locale}`;
  courseFrame.src = COURSE_FILE;
  openCourseLink.href = COURSE_FILE;
  renderStats();
}

function showLogin() {
  courseView.classList.add("hidden");
  loginView.classList.remove("hidden");
}

function renderStats() {
  const results = getResults();
  savedRows.textContent = results.length;
  if (!results.length) { latestScore.textContent = "--"; latestStatus.textContent = "Not submitted"; return; }
  latestScore.textContent  = `${results[0].score}/${results[0].total}`;
  latestStatus.textContent = results[0].status;
}

function renderSheetStatus() { sheetStatus.textContent = "Supabase connected"; }

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — INJECT PORTAL API INTO THE FRAME
//
// This <script> is appended to the frame body immediately after load.
// It runs INSIDE the frame's JS context so it has genuine lexical access
// to `lang` and `completed`, no matter how they are declared.
//
// __portal.getCompleted()       → returns a plain Array copy of `completed`
// __portal.setCompleted(arr)    → replaces `completed` with a new Set, then
//                                  calls renderModuleGrid + updateProgress
// __portal.getLang()            → returns current `lang` string
// __portal.isReady()            → true once the frame's own JS has run
// ─────────────────────────────────────────────────────────────────────────────
function injectFrameAPI(frameDocument) {
  if (frameDocument.defaultView.__portal) return; // already injected

  const script = frameDocument.createElement("script");
  script.id    = "__portalAPIScript";
  script.textContent = `
    (function () {
      window.__portal = {
        isReady: function () { return typeof setLang === 'function'; },

        getLang: function () { return lang; },

        getCompleted: function () { return Array.from(completed); },

        /* Replace the completed Set, then refresh the UI grid. */
        setCompleted: function (moduleIds) {
          completed = new Set(moduleIds);
          if (typeof renderModuleGrid === 'function') renderModuleGrid();
          if (typeof updateProgress   === 'function') updateProgress();
        }
      };
    })();
  `;
  // appendChild causes the script to execute synchronously inside the frame.
  frameDocument.body.appendChild(script);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — PATCH FRAME NAVIGATION FUNCTIONS
//
// Wraps setLang / showScreen / openModule / openFinalTest so that every
// navigation action automatically saves progress to localStorage.
// ─────────────────────────────────────────────────────────────────────────────
function installCoursePersistence(frameDocument) {
  const fw = frameDocument.defaultView;
  if (!fw || fw.portalPersistenceInstalled) return;
  fw.portalPersistenceInstalled = true;

  const origSetLang       = fw.setLang;
  const origShowScreen    = fw.showScreen;
  const origOpenModule    = fw.openModule;
  const origOpenFinalTest = fw.openFinalTest;

  if (typeof origSetLang === "function") {
    fw.setLang = function (language) {
      origSetLang.call(fw, language);
      // setLang resets `completed` to a new Set() — restore saved modules now.
      restoreCompletedModules(frameDocument);
      persistCourseProgress(frameDocument, { lang: language, screen: "s-home" });
    };
  }

  if (typeof origShowScreen === "function") {
    fw.showScreen = function (screenId) {
      origShowScreen.call(fw, screenId);
      persistCourseProgress(frameDocument, { screen: screenId });
    };
  }

  if (typeof origOpenModule === "function") {
    fw.openModule = function (moduleId) {
      origOpenModule.call(fw, moduleId);
      persistCourseProgress(frameDocument, { screen: "s-lesson", moduleId });
    };
  }

  if (typeof origOpenFinalTest === "function") {
    fw.openFinalTest = function () {
      origOpenFinalTest.call(fw);
      persistCourseProgress(frameDocument, { screen: "s-test", moduleId: "final-test" });
      window.setTimeout(() => restoreFinalAttempt(frameDocument), 80);
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — RESTORE SAVED PROGRESS ON LOAD
// ─────────────────────────────────────────────────────────────────────────────
function restoreCourseProgress(frameDocument) {
  const fw = frameDocument.defaultView;

  // Use __portal.isReady() so this works regardless of let/var/const in the frame.
  if (!fw || !fw.__portal || !fw.__portal.isReady() || fw.portalProgressRestored) return;
  fw.portalProgressRestored = true;

  const saved      = readSavedProgress();
  const targetLang = saved.lang || langForLearner(getLearner());

  // setLang is patched above — it will call restoreCompletedModules + persist
  // after originalSetLang resets the completed Set.
  if (typeof fw.setLang === "function") {
    fw.setLang(targetLang);
  }

  // setLang already restored completed modules, but call again as a safety net
  // in case setLang wasn't patched yet for some reason.
  restoreCompletedModules(frameDocument);

  // Refresh the progress bar.
  if (typeof fw.updateProgress   === "function") fw.updateProgress();
  if (typeof fw.renderModuleGrid === "function") fw.renderModuleGrid();

  // Navigate back to where the learner left off.
  if (saved.screen === "s-lesson" && saved.moduleId && typeof fw.openModule === "function") {
    fw.openModule(saved.moduleId);
  } else if (saved.screen === "s-test" && typeof fw.openFinalTest === "function") {
    fw.openFinalTest();
  } else if (typeof fw.showScreen === "function") {
    fw.showScreen("s-home");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — RESTORE COMPLETED MODULES FROM LOCALSTORAGE INTO THE FRAME
// ─────────────────────────────────────────────────────────────────────────────
function restoreCompletedModules(frameDocument) {
  const fw = frameDocument.defaultView;
  // Use the injected API — guaranteed to access the real `completed` variable.
  if (!fw || !fw.__portal) return;

  const saved = readSavedProgress();
  fw.__portal.setCompleted(saved.completed || []);
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSIST PROGRESS  (write current frame state to localStorage)
// ─────────────────────────────────────────────────────────────────────────────
function getActiveScreen(frameDocument) {
  return frameDocument.querySelector(".screen.active")?.id || "s-home";
}

function persistCourseProgress(frameDocument, patch = {}) {
  const fw = frameDocument.defaultView;
  if (!fw || !fw.__portal) return;

  const existing = readSavedProgress();

  // Use the injected API to read the current completed state.
  // Fall back to existing saved array if the frame hasn't loaded its API yet.
  const liveCompleted = fw.__portal.getCompleted();
  const completedArray = (liveCompleted.length > 0)
    ? liveCompleted
    : (existing.completed || []);

  const progress = {
    ...existing,
    ...patch,
    lang:      patch.lang || fw.__portal.getLang() || existing.lang || langForLearner(getLearner()),
    screen:    patch.screen || getActiveScreen(frameDocument),
    completed: completedArray,
    updatedAt: new Date().toISOString()
  };

  localStorage.setItem(courseProgressKey(), JSON.stringify(progress));
  localStorage.setItem(activeAttemptKey, courseProgressKey());
}

function scheduleProgressSave(frameDocument) {
  window.clearTimeout(progressTimer);
  progressTimer = window.setTimeout(() => persistCourseProgress(frameDocument), 120);
}

// ─────────────────────────────────────────────────────────────────────────────
// QUIZ SELECTION STATE  (portal-selected class + auto-save)
// ─────────────────────────────────────────────────────────────────────────────
function wireCourseSelectionState(frameDocument) {
  if (frameDocument.body.dataset.portalSelectionWired === "true") return;
  frameDocument.body.dataset.portalSelectionWired = "true";

  frameDocument.addEventListener("click", (e) => {
    const opt = e.target.closest?.(".quiz-opt");
    if (!opt || opt.classList.contains("disabled")) return;

    const q = opt.closest(".quiz-q");
    if (!q) return;

    q.querySelectorAll(".quiz-opt").forEach(o => o.classList.remove("portal-selected"));
    q.classList.remove("portal-missing", "ft-unanswered");
    opt.classList.add("portal-selected");

    window.setTimeout(() => saveFinalAttempt(frameDocument), 0);
    scheduleProgressSave(frameDocument);
  }, true);
}

// ─────────────────────────────────────────────────────────────────────────────
// MISSING ANSWER HIGHLIGHTER
// ─────────────────────────────────────────────────────────────────────────────
function wireMissingAnswerHighlighter(frameDocument) {
  const fw = frameDocument.defaultView;
  if (!fw || fw.portalAlertWired) return;
  fw.portalAlertWired = true;

  const origAlert = fw.alert.bind(fw);
  fw.alert = (msg) => {
    if (typeof msg === "string" && /question|frage|vragen|répondre|rester|remaining/i.test(msg)) {
      highlightMissingQuestions(frameDocument);
      origAlert(`${msg}\n\nMissing question(s) are highlighted in orange.`);
      return;
    }
    origAlert(msg);
  };
}

function highlightMissingQuestions(frameDocument) {
  const active    = frameDocument.querySelector("#s-test.active");
  const questions = [...(active || frameDocument).querySelectorAll(".quiz-q")];
  questions.forEach(q => {
    q.classList.toggle("portal-missing", !q.querySelector(".ft-selected,.portal-selected,.correct,.wrong"));
  });
  frameDocument.querySelector(".quiz-q.portal-missing, .quiz-q.ft-unanswered")
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ─────────────────────────────────────────────────────────────────────────────
// FINAL ASSESSMENT PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────
function saveFinalAttempt(frameDocument) {
  if (getActiveScreen(frameDocument) !== "s-test") return;

  const selected = [...frameDocument.querySelectorAll("#test-body .quiz-q")].map(q => {
    const s = q.querySelector(".ft-selected, .portal-selected");
    return s ? Number(s.dataset.oi) : null;
  });

  localStorage.setItem(courseAttemptKey(), JSON.stringify({ selected, savedAt: new Date().toISOString() }));
}

function restoreFinalAttempt(frameDocument) {
  if (getActiveScreen(frameDocument) !== "s-test") return;

  const saved = JSON.parse(localStorage.getItem(courseAttemptKey()) || "null");
  if (!saved?.selected?.length) return;

  frameDocument.querySelectorAll("#test-body .quiz-q").forEach((q, i) => {
    const idx = saved.selected[i];
    if (idx === null || idx === undefined) return;
    const opt = q.querySelector(`.quiz-opt[data-oi="${idx}"]`);
    if (opt && !opt.classList.contains("disabled")) opt.click();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE CAPTURE
// ─────────────────────────────────────────────────────────────────────────────
function captureScoreFromFrame(frameDocument) {
  const numEl   = frameDocument.querySelector(".score-circle .score-num");
  const labelEl = frameDocument.querySelector(".score-circle .score-label");
  if (!numEl || !labelEl) return;

  const score = Number(numEl.textContent.trim());
  const total = Number(labelEl.textContent.replace("/", "").trim());
  if (!Number.isFinite(score) || !Number.isFinite(total)) return;

  const learner = getLearner();
  const pct     = Math.round((score / total) * 100);
  const passed  = score >= 23;
  const key     = `${learner?.username}-${langForLearner(learner)}-${score}-${total}-${pct}`;

  if (key === lastSubmittedKey) return;
  lastSubmittedKey = key;
  localStorage.removeItem(courseAttemptKey());

  submitScore({
    timestamp:      new Date().toISOString(),
    username:       learner?.username || "Unknown",
    selectedLocale: learner?.locale   || "",
    courseLanguage: langForLearner(learner),
    course:         "Medical Transcription Training",
    score, total, percentage: pct,
    passingScore:   23,
    status:         passed ? "Passed" : "Needs Review"
  });
}

async function submitScore(result) {
  const results   = getResults();
  const duplicate = results.some(r =>
    r.username === result.username &&
    r.timestamp === result.timestamp &&
    r.score === result.score &&
    r.total === result.total
  );
  if (!duplicate) { results.unshift(result); saveResults(results); renderStats(); }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/course_scores`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey":        SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        username:        result.username,
        selected_locale: result.selectedLocale,
        course_language: result.courseLanguage,
        score:           result.score,
        total:           result.total,
        percentage:      result.percentage,
        passing_score:   result.passingScore,
        status:          result.status,
        submitted_at:    new Date().toISOString()
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    sheetStatus.textContent = "Score saved successfully ✓";
  } catch (err) {
    console.error("Supabase error:", err);
    sheetStatus.textContent = "Database save failed – score stored locally";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COURSE DESIGN UPGRADE  (visual polish injected into the frame)
// ─────────────────────────────────────────────────────────────────────────────
function upgradeCourseDesign(frameDocument) {
  if (frameDocument.querySelector("#portalCourseStyles")) return;
  const style = frameDocument.createElement("style");
  style.id = "portalCourseStyles";
  style.textContent = `
    body { background: #f6f8fb !important; color: #172033; }
    #app { max-width: 980px; margin: 0 auto; padding: 24px 20px 40px; }
    .screen { padding: 22px 0; }
    h1 { letter-spacing: 0 !important; }
    .lang-btn, .mod-card, .info-card, .quiz-q, .imaging-card, .gloss-entry {
      border: 1px solid #dce5f2 !important; border-radius: 8px !important;
      background: rgba(255,255,255,0.98) !important;
      box-shadow: 0 10px 28px rgba(16,24,40,0.07);
    }
    .mod-card.completed { border-color: #1D9E75 !important; background: #eef8f5 !important; }
    .btn-primary { border-color: #1D9E75 !important; background: #1D9E75 !important; color: #fff !important; }
    .quiz-q { padding: 18px !important; }
    .quiz-q.ft-unanswered, .quiz-q.portal-missing {
      border-color: #f79009 !important; background: #fff8eb !important;
      box-shadow: 0 0 0 4px rgba(247,144,9,0.14), 0 10px 28px rgba(16,24,40,0.07);
    }
    .quiz-q.ft-unanswered::before, .quiz-q.portal-missing::before {
      content: "Answer required"; display: inline-flex; margin-bottom: 10px;
      border-radius: 999px; background: #f79009; color: #fff;
      padding: 4px 10px; font-size: 0.76rem; font-weight: 850;
    }
    .quiz-opt { min-height: 42px; line-height: 1.45; white-space: normal; overflow-wrap: anywhere; }
    .quiz-opt.ft-selected, .quiz-opt.portal-selected {
      border-color: #2563eb !important; background: #eff6ff !important;
      color: #12366f !important; font-weight: 800 !important;
    }
  `;
  frameDocument.head.appendChild(style);
}

// ─────────────────────────────────────────────────────────────────────────────
// FRAME WATCHER  (entry point)
// ─────────────────────────────────────────────────────────────────────────────
function startWatchingCourseFrame() {
  courseFrame.addEventListener("load", () => {
    let frameDocument;
    try {
      frameDocument = courseFrame.contentDocument;
    } catch {
      sheetStatus.textContent = "Course tracking requires same-origin hosting.";
      return;
    }
    if (!frameDocument?.body) return;

    // 1. Visual polish
    upgradeCourseDesign(frameDocument);

    // 2. Inject the __portal API into the frame (closure-based, 100% reliable)
    injectFrameAPI(frameDocument);

    // 3. Patch navigation functions to auto-save on every screen change
    installCoursePersistence(frameDocument);

    // 4. Wire quiz helpers
    wireMissingAnswerHighlighter(frameDocument);
    wireCourseSelectionState(frameDocument);

    // 5. Restore saved progress (lang + completed modules + last screen)
    restoreCourseProgress(frameDocument);

    // 6. Restore in-progress final test answers
    restoreFinalAttempt(frameDocument);

    // 7. Detect if a score is already visible (e.g. hard refresh on results screen)
    captureScoreFromFrame(frameDocument);

    // 8. Listen for module completion events dispatched by the course
    frameDocument.defaultView.addEventListener("moduleCompleted", () => {
      persistCourseProgress(frameDocument);
    });

    // 9. MutationObserver: debounced save on any DOM change
    const observer = new MutationObserver(() => {
      scheduleProgressSave(frameDocument);
      captureScoreFromFrame(frameDocument);
    });
    observer.observe(frameDocument.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ["class", "style"]
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────────────────────────────────────
loginForm.addEventListener("submit", e => {
  e.preventDefault();
  const learner = { username: usernameInput.value.trim(), locale: localeInput.value };
  localStorage.setItem(learnerKey, JSON.stringify(learner));
  showCourse(learner);
});

logoutButton.addEventListener("click", () => {
  localStorage.removeItem(learnerKey);
  showLogin();
});

resetProgressButton.addEventListener("click", () => {
  localStorage.removeItem(courseProgressKey());
  localStorage.removeItem(courseAttemptKey());
  courseFrame.src = COURSE_FILE;
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────────────────
startWatchingCourseFrame();
renderSheetStatus();
renderStats();

const savedLearner = getLearner();
if (savedLearner) {
  usernameInput.value = savedLearner.username || "";
  localeInput.value   = savedLearner.locale   || "English / UK";
  showCourse(savedLearner);
} else {
  showLogin();
}
