// =======================================
// SIGNALMAP - CAMPUS NETWORK MONITOR
// =======================================

const LOCATIONS = [
  "Hostel A",
  "Hostel B",
  "Central Library",
  "Tan Audi",
  "Academic Block",
  "Cafeteria"
];

const STORAGE_KEY = "signalmap_tests_v1";

let tests = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
let speedChart = null;

const $ = (id) => document.getElementById(id);

// Save data in browser
function saveTests() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tests));
}

// Average helper
function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Get tests for a location
function getLocationTests(location) {
  return tests.filter(test => test.location === location);
}

// Calculate location statistics
function getStats(location) {
  const data = getLocationTests(location);

  return {
    count: data.length,
    download: average(data.map(t => t.download)),
    upload: average(data.map(t => t.upload)),
    ping: average(data.map(t => t.ping))
  };
}

// Determine signal category
function getSignal(speed, count) {
  if (!count) return "none";
  if (speed >= 50) return "excellent";
  if (speed >= 20) return "good";
  return "weak";
}

function getStatusLabel(signal) {
  const labels = {
    excellent: "Excellent",
    good: "Good",
    weak: "Weak",
    none: "No data"
  };

  return labels[signal];
}

function formatNumber(number) {
  return Number(number).toFixed(1);
}

// =======================================
// SPEED TEST
// =======================================

async function measurePing() {
  const start = performance.now();

  const response = await fetch(
    "https://speed.cloudflare.com/__down?bytes=0",
    { cache: "no-store" }
  );

  if (!response.ok) throw new Error("Ping test failed");

  await response.arrayBuffer();

  return Math.round(performance.now() - start);
}

async function measureDownload() {
  const bytes = 5000000;
  const start = performance.now();

  const response = await fetch(
    `https://speed.cloudflare.com/__down?bytes=${bytes}&t=${Date.now()}`,
    { cache: "no-store" }
  );

  if (!response.ok) throw new Error("Download test failed");

  const data = await response.arrayBuffer();
  const seconds = (performance.now() - start) / 1000;

  return (data.byteLength * 8) / seconds / 1000000;
}

async function measureUpload() {
  const bytes = 1000000;
  const data = new Blob([new Uint8Array(bytes)]);
  const start = performance.now();

  const response = await fetch(
    `https://speed.cloudflare.com/__up?t=${Date.now()}`,
    {
      method: "POST",
      body: data,
      cache: "no-store"
    }
  );

  if (!response.ok) throw new Error("Upload test failed");

  await response.arrayBuffer();

  const seconds = (performance.now() - start) / 1000;

  return (bytes * 8) / seconds / 1000000;
}

async function runSpeedTest() {
  const button = $("testButton");
  const message = $("testMessage");
  const speedValue = $("speedValue");
  const location = $("locationSelect").value;

  button.disabled = true;
  button.textContent = "Testing...";
  speedValue.textContent = "--";

  message.textContent = "Checking ping...";

  try {
    const ping = await measurePing();

    message.textContent = "Measuring download speed...";

    const download = await measureDownload();

    message.textContent = "Measuring upload speed...";

    const upload = await measureUpload();

    const result = {
      id: Date.now(),
      location,
      download: Number(download.toFixed(2)),
      upload: Number(upload.toFixed(2)),
      ping,
      date: new Date().toISOString()
    };

    tests.unshift(result);
    saveTests();

    speedValue.textContent = formatNumber(download);
    message.textContent = "Test completed! Your result has been added to the campus data.";

    refreshDashboard();

  } catch (error) {
    console.error(error);

    message.textContent =
      "Speed test failed. Check your internet connection or try again.";

    speedValue.textContent = "--";

  } finally {
    button.disabled = false;
    button.textContent = "▶ Start speed test";
  }
}

$("testButton").addEventListener("click", runSpeedTest);

// =======================================
// DASHBOARD STATISTICS
// =======================================

function updateStatistics() {
  const totalTests = tests.length;

  const allDownloads = tests.map(t => t.download);
  const avgDownload = average(allDownloads);

  const weakLocations = LOCATIONS.filter(location => {
    const stats = getStats(location);
    return stats.count > 0 && stats.download < 10;
  });

  $("testCount").textContent = totalTests;
  $("avgSpeed").textContent = totalTests
    ? formatNumber(avgDownload)
    : "--";

  $("locationCount").textContent = LOCATIONS.length;
  $("weakCount").textContent = weakLocations.length;

  updateBestLocation();
}

function updateBestLocation() {
  let best = null;

  LOCATIONS.forEach(location => {
    const stats = getStats(location);

    if (
      stats.count > 0 &&
      (!best || stats.download > best.speed)
    ) {
      best = {
        location,
        speed: stats.download
      };
    }
  });

  $("bestLocation").textContent = best
    ? best.location
    : "Awaiting data";
}

// =======================================
// RECENT TESTS TABLE
// =======================================

function renderRecentTests() {
  const tbody = $("recentTests");

  if (!tests.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty">
          No tests yet. Be the first to contribute!
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = tests.slice(0, 8).map(test => {
    const signal = getSignal(test.download, 1);

    return `
      <tr>
        <td><strong>${escapeHTML(test.location)}</strong></td>
        <td>${formatNumber(test.download)} Mbps</td>
        <td>${formatNumber(test.upload)} Mbps</td>
        <td>${test.ping} ms</td>
        <td>
          <span class="status ${signal}">
            ${getStatusLabel(signal)}
          </span>
        </td>
        <td>${new Date(test.date).toLocaleString()}</td>
      </tr>
    `;
  }).join("");
}

// Prevent HTML injection in displayed location text
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

// =======================================
// SPEED CHART
// =======================================

function renderChart() {
  const averages = LOCATIONS.map(location => {
    return getStats(location).download;
  });

  const canvas = $("speedChart");

  if (speedChart) {
    speedChart.destroy();
  }

  speedChart = new Chart(canvas, {
    type: "bar",

    data: {
      labels: LOCATIONS,

      datasets: [{
        label: "Average Download (Mbps)",
        data: averages,
        backgroundColor: "#6477ed",
        borderRadius: 6,
        barThickness: 24
      }]
    },

    options: {
      responsive: true,
      maintainAspectRatio: false,

      plugins: {
        legend: {
          display: false
        }
      },

      scales: {
        y: {
          beginAtZero: true,
          grid: {
            color: "#edf0f5"
          },
          ticks: {
            font: {
              size: 10
            }
          }
        },

        x: {
          grid: {
            display: false
          },
          ticks: {
            font: {
              size: 9
            }
          }
        }
      }
    }
  });
}

// =======================================
// HEATMAP
// =======================================

function renderHeatmap() {
  const grid = $("heatmapGrid");

  grid.innerHTML = LOCATIONS.map(location => {
    const stats = getStats(location);
    const signal = getSignal(stats.download, stats.count);

    let description = "No measurements submitted yet.";

    if (stats.count) {
      description = `${stats.count} student test(s) submitted`;
    }

    return `
      <div class="heat-card ${signal === "none" ? "" : signal + "-zone"}">
        <h3>📍 ${escapeHTML(location)}</h3>

        <div class="heat-speed">
          ${stats.count ? formatNumber(stats.download) : "--"}
          <span style="font-size:12px">Mbps</span>
        </div>

        <p>${description}</p>

        <span class="zone-tag">
          ${getStatusLabel(signal)}
        </span>
      </div>
    `;
  }).join("");
}

// =======================================
// ADMIN REPORT
// =======================================

function renderReports() {
  const tbody = $("reportTable");

  let rows = "";

  LOCATIONS.forEach(location => {
    const stats = getStats(location);
    const signal = getSignal(stats.download, stats.count);

    rows += `
      <tr>
        <td><strong>${escapeHTML(location)}</strong></td>
        <td>${stats.count}</td>
        <td>${stats.count ? formatNumber(stats.download) + " Mbps" : "--"}</td>
        <td>${stats.count ? formatNumber(stats.upload) + " Mbps" : "--"}</td>
        <td>${stats.count ? formatNumber(stats.ping) + " ms" : "--"}</td>
        <td>
          <span class="status ${signal}">
            ${getStatusLabel(signal)}
          </span>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = rows;

  const avgDownload = average(tests.map(t => t.download));

  const weakCount = LOCATIONS.filter(location => {
    const stats = getStats(location);
    return stats.count > 0 && stats.download < 10;
  }).length;

  $("reportTests").textContent = tests.length;

  $("reportAvg").textContent = tests.length
    ? formatNumber(avgDownload) + " Mbps"
    : "--";

  $("reportWeak").textContent = weakCount;

  $("reportBest").textContent = $("bestLocation").textContent;
}

// =======================================
// CSV EXPORT
// =======================================

function exportCSV() {
  const headers = [
    "Location",
    "Tests",
    "Average Download Mbps",
    "Average Upload Mbps",
    "Average Ping ms",
    "Status"
  ];

  const rows = LOCATIONS.map(location => {
    const stats = getStats(location);
    const signal = getSignal(stats.download, stats.count);

    return [
      location,
      stats.count,
      stats.count ? formatNumber(stats.download) : "",
      stats.count ? formatNumber(stats.upload) : "",
      stats.count ? formatNumber(stats.ping) : "",
      getStatusLabel(signal)
    ];
  });

  const csv = [headers, ...rows]
    .map(row => row.map(value =>
      `"${String(value).replace(/"/g, '""')}"`
    ).join(","))
    .join("\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "SignalMap_Campus_Report.csv";

  link.click();
  URL.revokeObjectURL(url);
}

$("exportButton").addEventListener("click", exportCSV);

// =======================================
// PAGE NAVIGATION
// =======================================

function showPage(page) {
  document.querySelectorAll(".page").forEach(section => {
    section.classList.add("hidden");
  });

  document.querySelectorAll(".nav").forEach(button => {
    button.classList.remove("active");
  });

  const pageElement = $(page + "Page");

  if (!pageElement) return;

  pageElement.classList.remove("hidden");

  const navButton = document.querySelector(
    `.nav[data-page="${page}"]`
  );

  if (navButton) navButton.classList.add("active");

  const titles = {
    dashboard: "Network Dashboard",
    heatmap: "Signal Heatmap",
    reports: "Campus Reports"
  };

  $("pageTitle").textContent = titles[page];

  if (page === "heatmap") renderHeatmap();
  if (page === "reports") renderReports();
}

document.querySelectorAll(".nav").forEach(button => {
  button.addEventListener("click", () => {
    showPage(button.dataset.page);
  });
});

document.querySelectorAll("[data-goto]").forEach(button => {
  button.addEventListener("click", () => {
    showPage(button.dataset.goto);
  });
});

// =======================================
// REFRESH ALL DASHBOARD DATA
// =======================================

function refreshDashboard() {
  updateStatistics();
  renderRecentTests();
  renderChart();
  renderHeatmap();
  renderReports();
}

// Initial page load
refreshDashboard();