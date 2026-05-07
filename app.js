// ─────────────────────────────────────────────────────────────────────────────
// app.js  –  Centific Medical Transcription Portal
//
// FIX LOG (all bugs found in analysis):
//
//  BUG 1 ── CRITICAL SCOPE DEFECT (root cause of progress loss on refresh)
//    restoreCourseProgress(), restoreCompletedModules(), and readSavedProgress()
//    were accidentally defined INSIDE installCoursePersistence() due to a
//    missing closing brace.  All calls to those functions from
//    startWatchingCourseFrame() therefore targeted undefined identifiers and
//    silently failed with a ReferenceError, so progress was never written or
//    read on reload.  Fixed by hoisting all three functions to module scope.
//
//  BUG 2 ── RACE CONDITION: restoreFinalAttempt called before DOM is ready
//    restoreFinalAttempt() was invoked immediately after openFinalTest()
//    inside installCoursePersistence, but the test DOM renders asynchronously.
//    Fixed with a short setTimeout to let the frame render before re-applying
//    saved selections.
//
//  BUG 3 ── PROGRESS OVERWRITTEN BY EMPTY COMPLETED SET
//    persistCourseProgress() spread the existing saved object first, then
//    always overwrote `completed` with [...frameWindow.completed].  If the
//    frame had not yet called restoreCompletedModules() (because of Bug 1),
//    completed was always an empty Set, silently erasing the stored array on
//    every MutationObserver tick.  Fixed by only writing `completed` when the
//    frameWindow.completed Set has been populated (or fallback to existing).
//
//  BUG 4 ── moduleCompleted event listener registered before T is defined
//    The listener was attached immediately after the iframe loaded, but
//    restoreCourseProgress() (which sets portalProgressRestored and calls
//    setLang, which populates T) was called afterwards.  No functional change
//    needed here – just re-ordered so the listener is last, after restoration.
//
//  BUG 5 ── SCROLL: middle-click / scroll-wheel autoscroll blocked
//    The outer <body> had no explicit overflow, and the sticky .topbar +
//    iframe caused the browser to treat the viewport as a scroll container
//    without the expected scrollbar.  See styles.css fix.  Additionally the
//    iframe itself must not capture pointer events during autoscroll.
//    Fixed in styles.css (overflow-y: scroll on html/body; user-select:
//    none is NOT set — we want text selection, just reliable scroll anchoring).
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = "https://jjbfhxjqfbtxbzsmsrjx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqYmZoeGpxZmJ0eGJ6c21zcmp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMzY4OTAsImV4cCI6MjA5MzcxMjg5MH0.lNL0nvvqCVT_aQD-XzMwhIa_te5-Zxgq58GMsN-RtG8";
const COURSE_FILE = "medical_transcription_v4_2.html";

// ── LocalStorage key constants ────────────────────────────────────────────────
const learnerKey      = "medicalCourse.learner";
const resultsKey      = "medicalCourse.results";
const activeAttemptKey = "medicalCourse.activeAttempt";

// ── Locale → language code map ────────────────────────────────────────────────
const localeToLang = {
  "English / UK":           "en",
  "Deutsch / Germany":      "de",
  "Nederlands / Netherlands":"nl",
  "Francais / France":      "fr",
  "Français / France":      "fr"
};

// ── DOM references ────────────────────────────────────────────────────────────
const loginView         = document.querySelector("#loginView");
const courseView        = document.querySelector("#courseView");
const loginForm         = document.querySelector("#loginForm");
const usernameInput     = document.querySelector("#usernameInput");
const localeInput       = document.querySelector("#localeInput");
const learnerTitle      = document.querySelector("#learnerTitle");
const sheetStatus       = document.querySelector("#sheetStatus");
const logoutButton      = document.querySelector("#logoutButton");
const courseFrame       = document.querySelector("#courseFrame");
const latestScore       = document.querySelector("#latestScore");
const latestStatus      = document.querySelector("#latestStatus");
const savedRows         = document.querySelector("#savedRows");
const resetProgressButton = document.querySelector("#resetProgressButton");
const openCourseLink    = document.querySelector("#openCourseLink");

let lastSubmittedKey = "";
let progressTimer    = 0;

// ── Learner / result helpers ──────────────────────────────────────────────────
function getLearner() {
  return JSON.parse(localStorage.getItem(learnerKey) || "null");
}

function getResults() {
  return JSON.parse(localStorage.getItem(resultsKey) || "[]");
}

function saveResults(results) {
  localStorage.setItem(resultsKey, JSON.stringify(results));
}

function langForLearner(learner) {
  return localeToLang[learner?.locale] || "en";
}

function learnerSlug(learner) {
  return `${learner?.username || "guest"}.${langForLearner(learner)}`
    .replace(/[^a-z0-9_.-]/gi, "_");
}

// ── Per-learner progress keys ─────────────────────────────────────────────────
function courseProgressKey() {
  return `medicalCourse.progress.${learnerSlug(getLearner())}`;
}

function courseAttemptKey() {
  return `medicalCourse.finalAttempt.${learnerSlug(getLearner())}`;
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

  if (results.length === 0) {
    latestScore.textContent  = "--";
    latestStatus.textContent = "Not submitted";
    return;
  }

  latestScore.textContent  = `${results[0].score}/${results[0].total}`;
  latestStatus.textContent = results[0].status;
}

function renderSheetStatus() {
  sheetStatus.textContent = "Supabase connected";
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE HELPERS  (module-scope — accessible from everywhere)
//
// FIX: These three functions were previously trapped inside
// installCoursePersistence() due to a missing closing brace at line ~221 of
// the original file.  Any call to them from startWatchingCourseFrame() or
// from the frame's load handler would throw a ReferenceError at runtime,
// silently swallowed by the iframe load event, meaning progress was NEVER
// saved and NEVER restored on refresh.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read the persisted progress object for the current learner.
 * Returns an empty object when nothing has been saved yet.
 */
function readSavedProgress() {
  try {
    return JSON.parse(localStorage.getItem(courseProgressKey()) || "{}");
  } catch {
    return {};
  }
}

/**
 * Restore the completed-modules Set inside the course frame from localStorage.
 * Safe to call even when the frame has not yet initialised its `completed` Set.
 */
function restoreCompletedModules(frameWindow) {
  // frameWindow.completed is a Set created by the course JS.
  // If it doesn't exist yet, do nothing — restoreCourseProgress will call
  // this again once setLang() has run and the Set is initialised.
  if (!frameWindow.completed) return;

  const saved = readSavedProgress();
  frameWindow.completed.clear();
  (saved.completed || []).forEach((moduleId) => frameWindow.completed.add(moduleId));
}

/**
 * Restore full course progress (language, screen, completed modules) after the
 * frame's JS has initialised (i.e. window.T is defined).
 *
 * FIX: Guard portalProgressRestored so this runs exactly once per frame load,
 * preventing a re-render loop.
 */
function restoreCourseProgress(frameDocument) {
  const frameWindow = frameDocument.defaultView;
  const learner     = getLearner();

  // Wait until the course JS has defined its translation table (T).
  if (!frameWindow || !frameWindow.T || frameWindow.portalProgressRestored) return;

  frameWindow.portalProgressRestored = true;

  const saved      = readSavedProgress();
  const targetLang = saved.lang || langForLearner(learner);

  // Set language — this initialises frameWindow.completed among other state.
  if (typeof frameWindow.setLang === "function") {
    frameWindow.setLang(targetLang);
  } else {
    frameWindow.lang = targetLang;
  }

  // Re-apply completed modules AFTER setLang() so the Set exists.
  restoreCompletedModules(frameWindow);

  // Refresh progress bar / module grid.
  if (typeof frameWindow.updateProgress    === "function") frameWindow.updateProgress();
  if (typeof frameWindow.renderModuleGrid  === "function") frameWindow.renderModuleGrid();

  // Navigate to the last known screen.
  if (saved.screen === "s-lesson" && saved.moduleId && typeof frameWindow.openModule === "function") {
    frameWindow.openModule(saved.moduleId);
  } else if (saved.screen === "s-test" && typeof frameWindow.openFinalTest === "function") {
    frameWindow.openFinalTest();
  } else if (typeof frameWindow.showScreen === "function") {
    frameWindow.showScreen("s-home");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COURSE DESIGN UPGRADE
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
      border: 1px solid #dce5f2 !important;
      border-radius: 8px !important;
      background: rgba(255,255,255,0.98) !important;
      box-shadow: 0 10px 28px rgba(16,24,40,0.07);
    }
    .mod-card.completed { border-color: #1D9E75 !important; background: #eef8f5 !important; }
    .btn-primary { border-color: #1D9E75 !important; background: #1D9E75 !important; color: #fff !important; }
    .quiz-q { padding: 18px !important; }
    .quiz-q.ft-unanswered, .quiz-q.portal-missing {
      border-color: #f79009 !important;
      background: #fff8eb !important;
      box-shadow: 0 0 0 4px rgba(247,144,9,0.14), 0 10px 28px rgba(16,24,40,0.07);
    }
    .quiz-q.ft-unanswered::before, .quiz-q.portal-missing::before {
      content: "Answer required";
      display: inline-flex;
      margin-bottom: 10px;
      border-radius: 999px;
      background: #f79009;
      color: #fff;
      padding: 4px 10px;
      font-size: 0.76rem;
      font-weight: 850;
    }
    .quiz-opt { min-height: 42px; line-height: 1.45; white-space: normal; overflow-wrap: anywhere; }
    .quiz-opt.ft-selected, .quiz-opt.portal-selected {
      border-color: #2563eb !important;
      background: #eff6ff !important;
      color: #12366f !important;
      font-weight: 800 !important;
    }
  `;
  frameDocument.head.appendChild(style);
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTALL COURSE PERSISTENCE  (patches frame functions to auto-save on nav)
// ─────────────────────────────────────────────────────────────────────────────
function installCoursePersistence(frameDocument) {
  const frameWindow = frameDocument.defaultView;
  if (!frameWindow || frameWindow.portalPersistenceInstalled) return;

  frameWindow.portalPersistenceInstalled = true;

  const originalSetLang      = frameWindow.setLang;
  const originalShowScreen   = frameWindow.showScreen;
  const originalOpenModule   = frameWindow.openModule;
  const originalOpenFinalTest= frameWindow.openFinalTest;

  if (typeof originalSetLang === "function") {
    frameWindow.setLang = function setLangAndPersist(language) {
      originalSetLang.call(frameWindow, language);
      // Restore completed modules immediately after language switch so the
      // grid renders with the correct completion badges.
      restoreCompletedModules(frameWindow);
      persistCourseProgress(frameDocument, { lang: language, screen: "s-home" });
    };
  }

  if (typeof originalShowScreen === "function") {
    frameWindow.showScreen = function showScreenAndPersist(screenId) {
      originalShowScreen.call(frameWindow, screenId);
      persistCourseProgress(frameDocument, { screen: screenId });
    };
  }

  if (typeof originalOpenModule === "function") {
    frameWindow.openModule = function openModuleAndPersist(moduleId) {
      originalOpenModule.call(frameWindow, moduleId);
      persistCourseProgress(frameDocument, { screen: "s-lesson", moduleId });
    };
  }

  if (typeof originalOpenFinalTest === "function") {
    frameWindow.openFinalTest = function openFinalTestAndPersist() {
      originalOpenFinalTest.call(frameWindow);
      persistCourseProgress(frameDocument, { screen: "s-test", moduleId: "final-test" });
      // FIX (Bug 2): defer restoreFinalAttempt so the test DOM has rendered.
      window.setTimeout(() => restoreFinalAttempt(frameDocument), 80);
    };
  }
} // ← this closing brace was MISSING in the original, which caused Bug 1

// ─────────────────────────────────────────────────────────────────────────────
// PERSIST PROGRESS  (write current state to localStorage)
// ─────────────────────────────────────────────────────────────────────────────
function getActiveScreen(frameDocument) {
  return frameDocument.querySelector(".screen.active")?.id || "s-home";
}

function persistCourseProgress(frameDocument, patch = {}) {
  const frameWindow = frameDocument.defaultView;
  if (!frameWindow) return;

  const existing = readSavedProgress();

  // FIX (Bug 3): Only overwrite `completed` when the frame's Set actually
  // contains entries, OR when we have no existing saved data yet.
  // This prevents an uninitialised empty Set from erasing stored progress.
  const completedArray = (frameWindow.completed && frameWindow.completed.size > 0)
    ? [...frameWindow.completed]
    : (existing.completed || []);

  const progress = {
    ...existing,
    ...patch,
    lang:      patch.lang || frameWindow.lang || existing.lang || langForLearner(getLearner()),
    screen:    patch.screen || getActiveScreen(frameDocument),
    completed: completedArray,
    updatedAt: new Date().toISOString()
  };

  localStorage.setItem(courseProgressKey(), JSON.stringify(progress));
  // Track which progress key is "active" (useful for multi-learner scenarios).
  localStorage.setItem(activeAttemptKey, courseProgressKey());
}

function scheduleProgressSave(frameDocument) {
  window.clearTimeout(progressTimer);
  progressTimer = window.setTimeout(() => persistCourseProgress(frameDocument), 120);
}

// ─────────────────────────────────────────────────────────────────────────────
// QUIZ SELECTION STATE  (highlight selected options and auto-save)
// ─────────────────────────────────────────────────────────────────────────────
function wireCourseSelectionState(frameDocument) {
  if (frameDocument.body.dataset.portalSelectionWired === "true") return;

  frameDocument.body.dataset.portalSelectionWired = "true";

  frameDocument.addEventListener("click", (event) => {
    const selectedOption = event.target.closest?.(".quiz-opt");
    if (!selectedOption || selectedOption.classList.contains("disabled")) return;

    const question = selectedOption.closest(".quiz-q");
    if (!question) return;

    question.querySelectorAll(".quiz-opt").forEach((opt) => opt.classList.remove("portal-selected"));
    question.classList.remove("portal-missing", "ft-unanswered");
    selectedOption.classList.add("portal-selected");

    window.setTimeout(() => saveFinalAttempt(frameDocument), 0);
    scheduleProgressSave(frameDocument);
  }, true);
}

// ─────────────────────────────────────────────────────────────────────────────
// MISSING ANSWER HIGHLIGHTER  (intercepts alert() inside the frame)
// ─────────────────────────────────────────────────────────────────────────────
function wireMissingAnswerHighlighter(frameDocument) {
  const frameWindow = frameDocument.defaultView;
  if (!frameWindow || frameWindow.portalAlertWired) return;

  frameWindow.portalAlertWired = true;
  const originalAlert = frameWindow.alert.bind(frameWindow);

  frameWindow.alert = (message) => {
    if (typeof message === "string" && /question|frage|vragen|répondre|rester|remaining/i.test(message)) {
      highlightMissingQuestions(frameDocument);
      originalAlert(`${message}\n\nMissing question(s) are highlighted in orange.`);
      return;
    }
    originalAlert(message);
  };
}

function highlightMissingQuestions(frameDocument) {
  const activeTest = frameDocument.querySelector("#s-test.active");
  const questions  = [...(activeTest || frameDocument).querySelectorAll(".quiz-q")];

  questions.forEach((question) => {
    const hasAnswer = Boolean(question.querySelector(".ft-selected, .portal-selected, .correct, .wrong"));
    question.classList.toggle("portal-missing", !hasAnswer);
  });

  const firstMissing = frameDocument.querySelector(".quiz-q.portal-missing, .quiz-q.ft-unanswered");
  if (firstMissing) firstMissing.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ─────────────────────────────────────────────────────────────────────────────
// FINAL ASSESSMENT PERSISTENCE  (save / restore individual answer selections)
// ─────────────────────────────────────────────────────────────────────────────
function saveFinalAttempt(frameDocument) {
  if (getActiveScreen(frameDocument) !== "s-test") return;

  const selected = [...frameDocument.querySelectorAll("#test-body .quiz-q")].map((question) => {
    const selectedOption = question.querySelector(".ft-selected, .portal-selected");
    return selectedOption ? Number(selectedOption.dataset.oi) : null;
  });

  localStorage.setItem(courseAttemptKey(), JSON.stringify({
    selected,
    savedAt: new Date().toISOString()
  }));
}

function restoreFinalAttempt(frameDocument) {
  if (getActiveScreen(frameDocument) !== "s-test") return;

  const savedAttempt = JSON.parse(localStorage.getItem(courseAttemptKey()) || "null");
  if (!savedAttempt?.selected?.length) return;

  frameDocument.querySelectorAll("#test-body .quiz-q").forEach((question, index) => {
    const selectedIndex = savedAttempt.selected[index];
    if (selectedIndex === null || selectedIndex === undefined) return;

    const option = question.querySelector(`.quiz-opt[data-oi="${selectedIndex}"]`);
    if (option && !option.classList.contains("disabled")) {
      option.click();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE CAPTURE  (detect when the score circle appears and submit to Supabase)
// ─────────────────────────────────────────────────────────────────────────────
function captureScoreFromFrame(frameDocument) {
  const scoreNumber = frameDocument.querySelector(".score-circle .score-num");
  const scoreLabel  = frameDocument.querySelector(".score-circle .score-label");
  if (!scoreNumber || !scoreLabel) return;

  const score = Number(scoreNumber.textContent.trim());
  const total = Number(scoreLabel.textContent.replace("/", "").trim());
  if (!Number.isFinite(score) || !Number.isFinite(total)) return;

  const learner       = getLearner();
  const percentage    = Math.round((score / total) * 100);
  const passed        = score >= 23;
  const submittedAt   = new Date().toISOString();
  const submissionKey = `${learner?.username}-${langForLearner(learner)}-${score}-${total}-${percentage}-${scoreLabel.textContent}`;

  if (submissionKey === lastSubmittedKey) return;
  lastSubmittedKey = submissionKey;

  // Clear the in-progress attempt once a score is captured.
  localStorage.removeItem(courseAttemptKey());

  submitScore({
    timestamp:      submittedAt,
    username:       learner?.username || "Unknown",
    selectedLocale: learner?.locale   || "",
    courseLanguage: langForLearner(learner),
    course:         "Medical Transcription Training",
    score,
    total,
    percentage,
    passingScore:   23,
    status:         passed ? "Passed" : "Needs Review"
  });
}

async function submitScore(result) {
  // Persist locally first so the score is never lost even if Supabase is down.
  const results   = getResults();
  const duplicate = results.some(
    (row) => row.username === result.username &&
             row.timestamp === result.timestamp &&
             row.score === result.score &&
             row.total === result.total
  );

  if (!duplicate) {
    results.unshift(result);
    saveResults(results);
    renderStats();
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/course_scores`, {
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

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    sheetStatus.textContent = "Score saved successfully ✓";
  } catch (error) {
    console.error("Supabase submit error:", error);
    sheetStatus.textContent = "Database save failed – score stored locally";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FRAME WATCHER  (entry point – runs once per page load)
// ─────────────────────────────────────────────────────────────────────────────
function startWatchingCourseFrame() {
  courseFrame.addEventListener("load", () => {
    let frameDocument;

    try {
      frameDocument = courseFrame.contentDocument;
    } catch {
      sheetStatus.textContent =
        "Course tracking requires the course HTML to be hosted in the same GitHub folder.";
      return;
    }

    if (!frameDocument?.body) return;

    // ── 1. Inject portal styling ──────────────────────────────────────────────
    upgradeCourseDesign(frameDocument);

    // ── 2. Patch frame navigation functions so every nav auto-saves ───────────
    installCoursePersistence(frameDocument);

    // ── 3. Wire interactive helpers ───────────────────────────────────────────
    wireMissingAnswerHighlighter(frameDocument);
    wireCourseSelectionState(frameDocument);

    // ── 4. Restore saved progress  ────────────────────────────────────────────
    // FIX (Bug 1 + Bug 4): restoreCourseProgress is now module-scope and called
    // AFTER installCoursePersistence so the patched setLang/showScreen functions
    // are in place before restoration runs.
    restoreCourseProgress(frameDocument);

    // ── 5. Restore final-test attempt if applicable ───────────────────────────
    restoreFinalAttempt(frameDocument);

    // ── 6. Check for an already-visible score (e.g. after hard refresh) ───────
    captureScoreFromFrame(frameDocument);

    // ── 7. Listen for custom moduleCompleted event dispatched by the course ───
    frameDocument.defaultView.addEventListener("moduleCompleted", () => {
      persistCourseProgress(frameDocument);
    });

    // ── 8. MutationObserver: auto-save on any DOM change (debounced 120 ms) ──
    const observer = new MutationObserver(() => {
      scheduleProgressSave(frameDocument);
      captureScoreFromFrame(frameDocument);
    });

    observer.observe(frameDocument.body, {
      childList:       true,
      subtree:         true,
      characterData:   true,
      attributes:      true,
      attributeFilter: ["class", "style"]
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────────────────────────────────────
loginForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const learner = {
    username: usernameInput.value.trim(),
    locale:   localeInput.value
  };

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
  // Reload the frame so the course starts fresh.
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
