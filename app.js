const SCORE_ENDPOINT = "https://script.google.com/macros/s/AKfycbw4v8WKvCHRsyahSQmNrSFccVfHyZF9yoVIidDJ-i_Hnp7cRJxtBdIBIHr6diwCvCQjFw/exec";
const COURSE_FILE = "medical_transcription_v4_2.html";

const learnerKey = "medicalCourse.learner";
const resultsKey = "medicalCourse.results";
const activeAttemptKey = "medicalCourse.activeAttempt";

const localeToLang = {
  "English / UK": "en",
  "Deutsch / Germany": "de",
  "Nederlands / Netherlands": "nl",
  "Francais / France": "fr",
  "Français / France": "fr"
};

const loginView = document.querySelector("#loginView");
const courseView = document.querySelector("#courseView");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const localeInput = document.querySelector("#localeInput");
const learnerTitle = document.querySelector("#learnerTitle");
const sheetStatus = document.querySelector("#sheetStatus");
const logoutButton = document.querySelector("#logoutButton");
const courseFrame = document.querySelector("#courseFrame");
const latestScore = document.querySelector("#latestScore");
const latestStatus = document.querySelector("#latestStatus");
const savedRows = document.querySelector("#savedRows");
const resetProgressButton = document.querySelector("#resetProgressButton");
const openCourseLink = document.querySelector("#openCourseLink");

let lastSubmittedKey = "";
let progressTimer = 0;

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
  return `${learner?.username || "guest"}.${langForLearner(learner)}`.replace(/[^a-z0-9_.-]/gi, "_");
}

function courseProgressKey() {
  return `medicalCourse.progress.${learnerSlug(getLearner())}`;
}

function courseAttemptKey() {
  return `medicalCourse.finalAttempt.${learnerSlug(getLearner())}`;
}

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
    latestScore.textContent = "--";
    latestStatus.textContent = "Not submitted";
    return;
  }

  latestScore.textContent = `${results[0].score}/${results[0].total}`;
  latestStatus.textContent = results[0].status;
}

function renderSheetStatus() {
  sheetStatus.textContent = SCORE_ENDPOINT
    ? "Google Sheet connected"
    : "Google Sheet not connected yet";
}

function startWatchingCourseFrame() {
  courseFrame.addEventListener("load", () => {
    let frameDocument;

    try {
      frameDocument = courseFrame.contentDocument;
    } catch (error) {
      sheetStatus.textContent = "Course tracking requires the course HTML to be hosted in this same GitHub folder.";
      return;
    }

    if (!frameDocument?.body) {
      return;
    }

    upgradeCourseDesign(frameDocument);
    installCoursePersistence(frameDocument);
    wireMissingAnswerHighlighter(frameDocument);
    wireCourseSelectionState(frameDocument);
    restoreCourseProgress(frameDocument);
    restoreFinalAttempt(frameDocument);
    captureScoreFromFrame(frameDocument);

    const observer = new MutationObserver(() => {
      scheduleProgressSave(frameDocument);
      captureScoreFromFrame(frameDocument);
    });

    observer.observe(frameDocument.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style"]
    });
  });
}

function upgradeCourseDesign(frameDocument) {
  if (frameDocument.querySelector("#portalCourseStyles")) {
    return;
  }

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
    .quiz-opt.ft-selected, .quiz-opt.portal-selected { border-color: #2563eb !important; background: #eff6ff !important; color: #12366f !important; font-weight: 800 !important; }
  `;

  frameDocument.head.appendChild(style);
}

function installCoursePersistence(frameDocument) {
  const frameWindow = frameDocument.defaultView;

  if (!frameWindow || frameWindow.portalPersistenceInstalled) {
    return;
  }

  frameWindow.portalPersistenceInstalled = true;
  const originalSetLang = frameWindow.setLang;
  const originalShowScreen = frameWindow.showScreen;
  const originalOpenModule = frameWindow.openModule;
  const originalOpenFinalTest = frameWindow.openFinalTest;

  if (typeof originalSetLang === "function") {
    frameWindow.setLang = function setLangAndPersist(language) {
      originalSetLang.call(frameWindow, language);
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
      restoreFinalAttempt(frameDocument);
    };
  }
}

function restoreCourseProgress(frameDocument) {
  const frameWindow = frameDocument.defaultView;
  const learner = getLearner();

  if (!frameWindow || !frameWindow.T || frameWindow.portalProgressRestored) {
    return;
  }

  frameWindow.portalProgressRestored = true;
  const saved = readSavedProgress();
  const targetLang = saved.lang || langForLearner(learner);

  if (typeof frameWindow.setLang === "function") {
    frameWindow.setLang(targetLang);
  } else {
    frameWindow.lang = targetLang;
  }

  restoreCompletedModules(frameWindow);

  if (typeof frameWindow.updateProgress === "function") {
    frameWindow.updateProgress();
  }

  if (typeof frameWindow.renderModuleGrid === "function") {
    frameWindow.renderModuleGrid();
  }

  if (saved.screen === "s-lesson" && saved.moduleId && typeof frameWindow.openModule === "function") {
    frameWindow.openModule(saved.moduleId);
  } else if (saved.screen === "s-test" && typeof frameWindow.openFinalTest === "function") {
    frameWindow.openFinalTest();
  } else if (typeof frameWindow.showScreen === "function") {
    frameWindow.showScreen("s-home");
  }

  persistCourseProgress(frameDocument);
}

function restoreCompletedModules(frameWindow) {
  const saved = readSavedProgress();

  if (!frameWindow.completed) {
    return;
  }

  frameWindow.completed.clear();
  (saved.completed || []).forEach((moduleId) => frameWindow.completed.add(moduleId));
}

function readSavedProgress() {
  return JSON.parse(localStorage.getItem(courseProgressKey()) || "{}");
}

function getActiveScreen(frameDocument) {
  return frameDocument.querySelector(".screen.active")?.id || "s-home";
}

function persistCourseProgress(frameDocument, patch = {}) {
  const frameWindow = frameDocument.defaultView;

  if (!frameWindow || !frameWindow.completed) {
    return;
  }

  const existing = readSavedProgress();
  const progress = {
    ...existing,
    ...patch,
    lang: patch.lang || frameWindow.lang || existing.lang || langForLearner(getLearner()),
    screen: patch.screen || getActiveScreen(frameDocument),
    completed: [...frameWindow.completed],
    updatedAt: new Date().toISOString()
  };

  localStorage.setItem(courseProgressKey(), JSON.stringify(progress));
  localStorage.setItem(activeAttemptKey, courseProgressKey());
}

function scheduleProgressSave(frameDocument) {
  window.clearTimeout(progressTimer);
  progressTimer = window.setTimeout(() => persistCourseProgress(frameDocument), 120);
}

function wireCourseSelectionState(frameDocument) {
  if (frameDocument.body.dataset.portalSelectionWired === "true") {
    return;
  }

  frameDocument.body.dataset.portalSelectionWired = "true";
  frameDocument.addEventListener("click", (event) => {
    const selectedOption = event.target.closest?.(".quiz-opt");

    if (!selectedOption || selectedOption.classList.contains("disabled")) {
      return;
    }

    const question = selectedOption.closest(".quiz-q");

    if (!question) {
      return;
    }

    question.querySelectorAll(".quiz-opt").forEach((option) => option.classList.remove("portal-selected"));
    question.classList.remove("portal-missing", "ft-unanswered");
    selectedOption.classList.add("portal-selected");
    window.setTimeout(() => saveFinalAttempt(frameDocument), 0);
    scheduleProgressSave(frameDocument);
  }, true);
}

function wireMissingAnswerHighlighter(frameDocument) {
  const frameWindow = frameDocument.defaultView;

  if (!frameWindow || frameWindow.portalAlertWired) {
    return;
  }

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
  const questions = [...(activeTest || frameDocument).querySelectorAll(".quiz-q")];

  questions.forEach((question) => {
    const hasAnswer = Boolean(question.querySelector(".ft-selected, .portal-selected, .correct, .wrong"));
    question.classList.toggle("portal-missing", !hasAnswer);
  });

  const firstMissing = frameDocument.querySelector(".quiz-q.portal-missing, .quiz-q.ft-unanswered");

  if (firstMissing) {
    firstMissing.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function saveFinalAttempt(frameDocument) {
  if (getActiveScreen(frameDocument) !== "s-test") {
    return;
  }

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
  if (getActiveScreen(frameDocument) !== "s-test") {
    return;
  }

  const savedAttempt = JSON.parse(localStorage.getItem(courseAttemptKey()) || "null");

  if (!savedAttempt?.selected?.length) {
    return;
  }

  frameDocument.querySelectorAll("#test-body .quiz-q").forEach((question, index) => {
    const selectedIndex = savedAttempt.selected[index];

    if (selectedIndex === null || selectedIndex === undefined) {
      return;
    }

    const option = question.querySelector(`.quiz-opt[data-oi="${selectedIndex}"]`);

    if (option && !option.classList.contains("disabled")) {
      option.click();
    }
  });
}

function captureScoreFromFrame(frameDocument) {
  const scoreNumber = frameDocument.querySelector(".score-circle .score-num");
  const scoreLabel = frameDocument.querySelector(".score-circle .score-label");

  if (!scoreNumber || !scoreLabel) {
    return;
  }

  const score = Number(scoreNumber.textContent.trim());
  const total = Number(scoreLabel.textContent.replace("/", "").trim());

  if (!Number.isFinite(score) || !Number.isFinite(total)) {
    return;
  }

  const learner = getLearner();
  const percentage = Math.round((score / total) * 100);
  const passed = score >= 23;
  const submittedAt = new Date().toISOString();
  const submissionKey = `${learner?.username}-${langForLearner(learner)}-${score}-${total}-${percentage}-${scoreLabel.textContent}`;

  if (submissionKey === lastSubmittedKey) {
    return;
  }

  lastSubmittedKey = submissionKey;
  localStorage.removeItem(courseAttemptKey());

  submitScore({
    timestamp: submittedAt,
    username: learner?.username || "Unknown",
    selectedLocale: learner?.locale || "",
    courseLanguage: langForLearner(learner),
    course: "Medical Transcription Training",
    score,
    total,
    percentage,
    passingScore: 23,
    status: passed ? "Passed" : "Needs Review"
  });
}

async function submitScore(result) {
  const results = getResults();
  const duplicate = results.some((row) => row.username === result.username && row.timestamp === result.timestamp && row.score === result.score && row.total === result.total);

  if (!duplicate) {
    results.unshift(result);
    saveResults(results);
    renderStats();
  }

  if (!SCORE_ENDPOINT) {
    sheetStatus.textContent = "Score saved locally. Paste your Apps Script URL into app.js to save to Google Sheets.";
    return;
  }

  try {
    await fetch(SCORE_ENDPOINT, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result)
    });

    sheetStatus.textContent = "Score sent to Google Sheets.";
  } catch (error) {
    sheetStatus.textContent = "Could not send score. It is saved locally in this browser.";
  }
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const learner = {
    username: usernameInput.value.trim(),
    locale: localeInput.value
  };

  localStorage.setItem(learnerKey, JSON.stringify(learner));
  showCourse(learner);
});

logoutButton.addEventListener("click", () => {
  localStorage.removeItem(learnerKey);
  showLogin();
});

resetProgressButton.addEventListener("click", () => {
  const key = courseProgressKey();
  localStorage.removeItem(key);
  localStorage.removeItem(courseAttemptKey());
  courseFrame.src = COURSE_FILE;
});

startWatchingCourseFrame();
renderSheetStatus();
renderStats();

const savedLearner = getLearner();

if (savedLearner) {
  usernameInput.value = savedLearner.username || "";
  localeInput.value = savedLearner.locale || "English / UK";
  showCourse(savedLearner);
} else {
  showLogin();
}

