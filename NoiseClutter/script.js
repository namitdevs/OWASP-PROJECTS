// ==========================================
// NOISECUTTER - MAIN JAVASCRIPT
// ==========================================

const STORAGE_KEY = "noisecutter_history_v1";

let currentFileText = "";
let currentFileName = "";
let currentAnalysis = null;
let history = loadHistory();

let currentInputMode = "text";

const $ = id => document.getElementById(id);

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

// ==========================================
// STORAGE
// ==========================================

function loadHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

// ==========================================
// NAVIGATION
// ==========================================

function showPage(page) {
  document.querySelectorAll(".page").forEach(section => {
    section.classList.add("hidden");
  });

  document.querySelectorAll(".nav").forEach(button => {
    button.classList.remove("active");
  });

  $(page + "Page").classList.remove("hidden");

  const nav = document.querySelector(
    `.nav[data-page="${page}"]`
  );

  if (nav) nav.classList.add("active");

  $("pageTitle").textContent =
    page === "analyzer" ? "Noise Analyzer" : "Analysis History";

  if (page === "history") renderHistory();
}

document.querySelectorAll(".nav").forEach(button => {
  button.addEventListener("click", () => {
    showPage(button.dataset.page);
  });
});

// ==========================================
// INPUT TABS
// ==========================================

document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(tab => {
      tab.classList.remove("active");
    });

    button.classList.add("active");

    currentInputMode = button.dataset.tab;

    $("textInputArea").classList.toggle(
      "hidden",
      currentInputMode !== "text"
    );

    $("pdfInputArea").classList.toggle(
      "hidden",
      currentInputMode !== "pdf"
    );

    $("inputError").textContent = "";
  });
});

// ==========================================
// TEXT INPUT
// ==========================================

$("sourceText").addEventListener("input", () => {
  const length = $("sourceText").value.length;

  $("charCount").textContent =
    `${length.toLocaleString()} characters`;
});

$("clearButton").addEventListener("click", () => {
  $("sourceText").value = "";
  $("charCount").textContent = "0 characters";
  $("inputError").textContent = "";
});

// ==========================================
// PDF UPLOAD
// ==========================================

$("browseButton").addEventListener("click", event => {
  event.stopPropagation();
  $("pdfFile").click();
});

$("dropZone").addEventListener("click", () => {
  $("pdfFile").click();
});

$("dropZone").addEventListener("dragover", event => {
  event.preventDefault();
  $("dropZone").classList.add("dragging");
});

$("dropZone").addEventListener("dragleave", () => {
  $("dropZone").classList.remove("dragging");
});

$("dropZone").addEventListener("drop", event => {
  event.preventDefault();
  $("dropZone").classList.remove("dragging");

  const file = event.dataTransfer.files[0];

  if (file) processPDF(file);
});

$("pdfFile").addEventListener("change", event => {
  const file = event.target.files[0];

  if (file) processPDF(file);
});

async function processPDF(file) {
  $("inputError").textContent = "";

  if (file.type !== "application/pdf") {
    $("inputError").textContent = "Please upload a PDF file.";
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    $("inputError").textContent =
      "File size must be less than 10 MB.";
    return;
  }

  if (!window.pdfjsLib) {
    $("inputError").textContent =
      "PDF reader could not load. Check your internet connection.";
    return;
  }

  $("fileInfo").classList.remove("hidden");
  $("fileInfo").textContent = "Reading PDF...";

  try {
    const buffer = await file.arrayBuffer();

    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer)
    }).promise;

    let extractedText = "";

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();

      const pageText = content.items
        .map(item => item.str)
        .join(" ");

      extractedText += pageText + "\n";
    }

    if (!extractedText.trim()) {
      throw new Error(
        "This PDF contains no selectable text. Scanned PDFs need OCR."
      );
    }

    currentFileText = extractedText;
    currentFileName = file.name;

    $("fileInfo").textContent =
      `✓ ${file.name} · ${pdf.numPages} page(s) · Text extracted successfully`;

  } catch (error) {
    console.error(error);

    currentFileText = "";
    currentFileName = "";

    $("fileInfo").textContent = "PDF extraction failed.";

    $("inputError").textContent =
      error.message || "Could not read this PDF.";
  }
}

// ==========================================
// TEXT NORMALIZATION
// ==========================================

function normalizeText(text) {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// Split into meaningful sentences
function splitSentences(text) {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 8);
}

// ==========================================
// PRIORITY DETECTION
// ==========================================

function getPriority(text) {
  const lower = text.toLowerCase();

  const urgentWords = [
    "urgent",
    "immediately",
    "today only",
    "last chance",
    "without fail",
    "mandatory",
    "asap",
    "final reminder",
    "strictly",
    "must attend"
  ];

  const importantWords = [
    "deadline",
    "submit",
    "submission",
    "register",
    "registration",
    "tomorrow",
    "exam",
    "test",
    "assignment",
    "attendance",
    "required",
    "bring your",
    "report to"
  ];

  if (urgentWords.some(word => lower.includes(word))) {
    return "urgent";
  }

  if (importantWords.some(word => lower.includes(word))) {
    return "important";
  }

  return "info";
}

// ==========================================
// ANNOUNCEMENT CLASSIFICATION
// ==========================================

function classifySentence(sentence) {
  const lower = sentence.toLowerCase();

  const cancellationPattern =
    /\b(cancelled|canceled|postponed|suspended|called off|will not be held|won't be held|no class|no lecture|no meeting|rescheduled)\b/;

  const venuePattern =
    /\b(room|classroom|venue|auditorium|lab|laboratory|block|hall)\b/;

  const changePattern =
    /\b(shifted|changed|moved|relocated|instead|from .* to |will be held|conducted at|held at)\b/;

  const deadlinePattern =
    /\b(deadline|last date|due date|submit|submission|register|registration|apply before|by tomorrow|by monday|by tuesday|by wednesday|by thursday|by friday|by saturday|by sunday|by \d{1,2}(?:st|nd|rd|th)?(?:\s+\w+)?|before \d{1,2})\b/;

  const actionPattern =
    /\b(please|kindly|must|submit|bring|upload|register|complete|fill|attend|report|carry|prepare|collect|visit|contact|apply|ensure)\b/;

  const results = [];

  if (cancellationPattern.test(lower)) {
    results.push("cancellation");
  }

  if (venuePattern.test(lower) && changePattern.test(lower)) {
    results.push("venue");
  }

  if (deadlinePattern.test(lower)) {
    results.push("deadline");
  }

  if (actionPattern.test(lower)) {
    results.push("action");
  }

  return [...new Set(results)];
}

// ==========================================
// DEADLINE EXTRACTION
// ==========================================

function extractDates(text) {
  const dates = [];

  const patterns = [
    /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/gi,

    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?\b/gi,

    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,

    /\b(?:today|tomorrow|day after tomorrow)\b/gi,

    /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi
  ];

  patterns.forEach(pattern => {
    const matches = text.match(pattern) || [];
    dates.push(...matches);
  });

  return [...new Set(dates)];
}

// ==========================================
// SUMMARY GENERATION
// ==========================================

function generateSummary(data) {
  const parts = [];

  if (data.deadlines.length) {
    parts.push(
      `${data.deadlines.length} deadline-related announcement(s)`
    );
  }

  if (data.venues.length) {
    parts.push(
      `${data.venues.length} venue or room change(s)`
    );
  }

  if (data.cancellations.length) {
    parts.push(
      `${data.cancellations.length} cancellation(s)`
    );
  }

  if (data.actions.length) {
    parts.push(
      `${data.actions.length} action item(s)`
    );
  }

  if (!parts.length) {
    return "No clearly recognizable deadlines, venue changes, cancellations or action items were found. Review the original message for details.";
  }

  return "Your content contains " +
    parts.join(", ") +
    ". Review the extracted announcements and complete the action checklist below. Always verify important dates and changes against the original notice.";
}

// ==========================================
// MAIN ANALYSIS ENGINE
// ==========================================

function analyzeContent(text, sourceName) {
  const sentences = splitSentences(text);

  const data = {
    id: Date.now(),
    source: sourceName,
    createdAt: new Date().toISOString(),
    totalSentences: sentences.length,
    deadlines: [],
    venues: [],
    cancellations: [],
    actions: [],
    announcements: [],
    details: [],
    summary: ""
  };

  sentences.forEach(sentence => {
    const categories = classifySentence(sentence);
    const priority = getPriority(sentence);
    const dates = extractDates(sentence);

    if (categories.length) {
      data.announcements.push({
        text: sentence,
        categories,
        priority,
        dates
      });
    }

    if (categories.includes("deadline")) {
      data.deadlines.push(sentence);
    }

    if (categories.includes("venue")) {
      data.venues.push(sentence);
    }

    if (categories.includes("cancellation")) {
      data.cancellations.push(sentence);
    }

    if (categories.includes("action")) {
      data.actions.push(sentence);
    }

    if (categories.length || dates.length) {
      data.details.push({
        text: sentence,
        categories,
        priority,
        dates
      });
    }
  });

  data.summary = generateSummary(data);

  return data;
}

// ==========================================
// ANALYZE BUTTON
// ==========================================

$("analyzeButton").addEventListener("click", () => {
  let text = "";
  let sourceName = "Pasted text";

  if (currentInputMode === "text") {
    text = $("sourceText").value.trim();
  } else {
    text = currentFileText;
    sourceName = currentFileName || "Uploaded PDF";
  }

  $("inputError").textContent = "";

  if (!text) {
    $("inputError").textContent =
      currentInputMode === "text"
        ? "Please paste some messages before analyzing."
        : "Please upload a readable PDF first.";

    return;
  }

  if (text.length > 100000) {
    $("inputError").textContent =
      "Please keep your content under 100,000 characters.";
    return;
  }

  const button = $("analyzeButton");

  button.disabled = true;
  button.textContent = "Analyzing...";

  // Simulate processing time for the prototype
  setTimeout(() => {
    try {
      currentAnalysis = analyzeContent(text, sourceName);

      renderResults(currentAnalysis);

      $("resultsSection").classList.remove("hidden");

      $("resultsSection").scrollIntoView({
        behavior: "smooth",
        block: "start"
      });

    } catch (error) {
      console.error(error);
      $("inputError").textContent =
        "Something went wrong while analyzing the content.";
    } finally {
      button.disabled = false;
      button.textContent = "✨ Analyze content";
    }
  }, 500);
});

// ==========================================
// RENDER RESULTS
// ==========================================

function renderResults(data) {
  $("summaryText").textContent = data.summary;

  $("analysisMeta").textContent =
    `${data.source} · ${data.totalSentences} text segments analyzed`;

  $("deadlineCount").textContent = data.deadlines.length;
  $("venueCount").textContent = data.venues.length;
  $("cancelCount").textContent = data.cancellations.length;
  $("actionCount").textContent = data.actions.length;

  renderAnnouncements(data);
  renderActions(data);
  renderDetails(data);
}

// ==========================================
// ANNOUNCEMENTS
// ==========================================

function renderAnnouncements(data) {
  const container = $("announcementList");

  if (!data.announcements.length) {
    container.innerHTML =
      `<p class="empty">No important announcements detected.</p>`;
    return;
  }

  container.innerHTML = data.announcements.map(item => {
    const categoryNames = {
      deadline: "DEADLINE",
      venue: "ROOM / VENUE",
      cancellation: "CANCELLATION",
      action: "ACTION"
    };

    const category = item.categories[0];
    const title = categoryNames[category] || "ANNOUNCEMENT";

    return `
      <div class="announcement">
        <div class="announcement-top">
          <h4>${title}</h4>
          <span class="priority ${item.priority}">
            ${item.priority.toUpperCase()}
          </span>
        </div>
        <p>${escapeHTML(item.text)}</p>
        ${
          item.dates.length
            ? `<p><strong>Detected date:</strong> ${escapeHTML(item.dates.join(", "))}</p>`
            : ""
        }
      </div>
    `;
  }).join("");
}

// ==========================================
// ACTION CHECKLIST
// ==========================================

function renderActions(data) {
  const container = $("actionList");

  const uniqueActions = [...new Set(data.actions)];

  if (!uniqueActions.length) {
    container.innerHTML =
      `<p class="empty">No specific action items detected.</p>`;

    $("checkProgress").textContent = "0/0 done";
    return;
  }

  container.innerHTML = uniqueActions.map((action, index) => `
    <div class="action-item" data-action="${index}">
      <input
        type="checkbox"
        id="action-${index}"
        data-action-index="${index}"
      >
      <label for="action-${index}">
        ${escapeHTML(action)}
      </label>
    </div>
  `).join("");

  updateProgress();
}

$("actionList").addEventListener("change", event => {
  if (event.target.type !== "checkbox") return;

  const item = event.target.closest(".action-item");

  item.classList.toggle("completed", event.target.checked);

  updateProgress();
});

function updateProgress() {
  const checkboxes = [
    ...$("actionList").querySelectorAll('input[type="checkbox"]')
  ];

  const completed = checkboxes.filter(
    checkbox => checkbox.checked
  ).length;

  $("checkProgress").textContent =
    `${completed}/${checkboxes.length} done`;
}

// ==========================================
// DETAILED BREAKDOWN
// ==========================================

function renderDetails(data) {
  const container = $("detailList");

  if (!data.details.length) {
    container.innerHTML =
      `<p class="empty">No specific information was extracted.</p>`;
    return;
  }

  container.innerHTML = data.details.map(item => {
    let icon = "📌";

    if (item.categories.includes("deadline")) icon = "📅";
    else if (item.categories.includes("venue")) icon = "📍";
    else if (item.categories.includes("cancellation")) icon = "🚫";
    else if (item.categories.includes("action")) icon = "☑";

    return `
      <div class="detail-item">
        <span class="detail-icon">${icon}</span>
        <div>
          <h4>
            ${item.categories.length
              ? escapeHTML(item.categories.join(" · ").toUpperCase())
              : "DATE DETECTED"}
          </h4>
          <p>${escapeHTML(item.text)}</p>
        </div>
      </div>
    `;
  }).join("");
}

// ==========================================
// COPY SUMMARY
// ==========================================

$("copyButton").addEventListener("click", async () => {
  if (!currentAnalysis) return;

  const data = currentAnalysis;

  let output = `NOISECUTTER SUMMARY\n\n${data.summary}\n\n`;

  output += "IMPORTANT ANNOUNCEMENTS:\n";

  data.announcements.forEach(item => {
    output += `- [${item.priority.toUpperCase()}] ${item.text}\n`;
  });

  output += "\nACTION CHECKLIST:\n";

  data.actions.forEach((action, index) => {
    const checkbox = $(`action-${index}`);
    const done = checkbox && checkbox.checked;

    output += `${done ? "[x]" : "[ ]"} ${action}\n`;
  });

  try {
    await navigator.clipboard.writeText(output);

    $("copyButton").textContent = "✓ Copied!";

    setTimeout(() => {
      $("copyButton").textContent = "▣ Copy summary";
    }, 1800);

  } catch {
    alert("Clipboard access failed. Try using a secure browser context.");
  }
});

// ==========================================
// SAVE ANALYSIS
// ==========================================

$("saveAnalysisButton").addEventListener("click", () => {
  if (!currentAnalysis) return;

  const alreadySaved = history.some(
    item => item.id === currentAnalysis.id
  );

  if (alreadySaved) {
    alert("This analysis is already saved.");
    return;
  }

  const saved = {
    ...currentAnalysis,
    actions: [...currentAnalysis.actions]
  };

  history.unshift(saved);

  // Keep the latest 30 analyses
  history = history.slice(0, 30);

  saveHistory();

  $("saveAnalysisButton").textContent = "✓ Saved";

  setTimeout(() => {
    $("saveAnalysisButton").textContent = "♡ Save to history";
  }, 1800);
});

// ==========================================
// HISTORY PAGE
// ==========================================

function renderHistory() {
  const container = $("historyList");

  if (!history.length) {
    container.innerHTML =
      `<p class="empty">No saved analyses yet. Analyze some content first.</p>`;
    return;
  }

  container.innerHTML = history.map(item => `
    <div class="history-card">
      <h4>${escapeHTML(item.source)}</h4>
      <p>${new Date(item.createdAt).toLocaleString()}</p>
      <p>${escapeHTML(item.summary)}</p>
      <button
        class="outline-btn"
        data-open-history="${item.id}"
      >
        View analysis
      </button>
    </div>
  `).join("");
}

$("historyList").addEventListener("click", event => {
  const button = event.target.closest("[data-open-history]");

  if (!button) return;

  const item = history.find(
    entry => entry.id === Number(button.dataset.openHistory)
  );

  if (!item) return;

  currentAnalysis = item;

  showPage("analyzer");

  renderResults(item);

  $("resultsSection").classList.remove("hidden");

  $("resultsSection").scrollIntoView({
    behavior: "smooth"
  });
});

$("clearHistoryButton").addEventListener("click", () => {
  if (!history.length) return;

  if (!confirm("Delete all saved analyses?")) return;

  history = [];
  saveHistory();
  renderHistory();
});

// ==========================================
// START A NEW ANALYSIS
// ==========================================

$("newAnalysisButton").addEventListener("click", () => {
  currentAnalysis = null;
  currentFileText = "";
  currentFileName = "";

  $("resultsSection").classList.add("hidden");

  $("sourceText").value = "";
  $("charCount").textContent = "0 characters";

  $("pdfFile").value = "";

  $("fileInfo").classList.add("hidden");

  $("inputError").textContent = "";

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
});