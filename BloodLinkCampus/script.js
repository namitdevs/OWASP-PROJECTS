// ==========================================
// BLOODLINK CAMPUS - MAIN JAVASCRIPT
// ==========================================

const STORAGE = {
  donors: "bloodlink_donors_v1",
  requests: "bloodlink_requests_v1",
  camps: "bloodlink_camps_v1"
};

const BLOOD_GROUPS = [
  "A+", "A-", "B+", "B-",
  "AB+", "AB-", "O+", "O-"
];

const COOLDOWN_DAYS = 90;

function loadData(key) {
  try {
    const data = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

let donors = loadData(STORAGE.donors);
let requests = loadData(STORAGE.requests);
let camps = loadData(STORAGE.camps);

let latestMatches = [];

const $ = id => document.getElementById(id);

function saveData() {
  localStorage.setItem(STORAGE.donors, JSON.stringify(donors));
  localStorage.setItem(STORAGE.requests, JSON.stringify(requests));
  localStorage.setItem(STORAGE.camps, JSON.stringify(camps));
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function getDate(date) {
  return new Date(date + "T00:00:00");
}

function formatDate(date) {
  if (!date) return "Not provided";

  return getDate(date).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function todayString() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const result = getDate(date);
  result.setDate(result.getDate() + days);

  const year = result.getFullYear();
  const month = String(result.getMonth() + 1).padStart(2, "0");
  const day = String(result.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

// ==========================================
// DONATION COOLDOWN TRACKER
// ==========================================

function getCooldown(donationDate) {
  if (!donationDate) {
    return {
      status: "review",
      label: "Date not provided",
      message: "Confirm donation history with blood bank"
    };
  }

  if (donationDate > todayString()) {
    return {
      status: "review",
      label: "Invalid date",
      message: "Donation date cannot be in the future"
    };
  }

  const nextDate = addDays(donationDate, COOLDOWN_DAYS);
  const remaining = Math.ceil(
    (getDate(nextDate) - getDate(todayString())) / 86400000
  );

  if (remaining > 0) {
    return {
      status: "cooldown",
      label: `${remaining} days remaining`,
      message: `90-day reminder period ends ${formatDate(nextDate)}`
    };
  }

  return {
    status: "ready",
    label: "Interval elapsed",
    message: "Blood bank screening still required"
  };
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

  const selectedPage = $(page + "Page");

  if (!selectedPage) return;

  selectedPage.classList.remove("hidden");

  const navButton = document.querySelector(
    `.nav[data-page="${page}"]`
  );

  if (navButton) {
    navButton.classList.add("active");
  }

  const titles = {
    dashboard: "Dashboard",
    donors: "Donor Registry",
    requests: "Blood Requests",
    camps: "Camp Reminders"
  };

  $("pageTitle").textContent = titles[page];

  if (page === "donors") renderDonors();
  if (page === "requests") renderRequests();
  if (page === "camps") renderCamps();
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

// ==========================================
// DONOR REGISTRATION
// ==========================================

$("donorForm").addEventListener("submit", function(event) {
  event.preventDefault();

  const name = $("donorName").value.trim();
  const age = Number($("donorAge").value);
  const blood = $("donorBlood").value;
  const location = $("donorLocation").value;
  const email = $("donorEmail").value.trim().toLowerCase();
  const phone = $("donorPhone").value.trim();
  const lastDonation = $("lastDonation").value;

  if (!name || !email || !phone || !blood || !location) {
    alert("Please complete all required fields.");
    return;
  }

  if (!Number.isInteger(age) || age < 18 || age > 100) {
    alert("Only adults aged 18 or above can register as donors.");
    return;
  }

  if (!BLOOD_GROUPS.includes(blood)) {
    alert("Please select a valid blood group.");
    return;
  }

  if (!/^[0-9]{10}$/.test(phone)) {
    alert("Enter a valid 10-digit phone number.");
    return;
  }

  if (lastDonation && lastDonation > todayString()) {
    alert("Last donation date cannot be in the future.");
    return;
  }

  const duplicate = donors.some(donor =>
    donor.email === email || donor.phone === phone
  );

  if (duplicate) {
    alert("A donor with this email or phone number is already registered.");
    return;
  }

  const donor = {
    id: Date.now(),
    name,
    age,
    blood,
    location,
    email,
    phone,
    lastDonation,
    createdAt: new Date().toISOString()
  };

  donors.push(donor);
  saveData();

  this.reset();

  refreshAll();

  alert("Donor registered successfully!");

  showPage("donors");
});

// ==========================================
// DONOR DIRECTORY
// ==========================================

function renderDonors() {
  const tbody = $("donorTable");
  const filter = $("donorFilter").value;

  const filtered = donors.filter(donor => {
    return filter === "all" || donor.blood === filter;
  });

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty">
          No donors found for this blood group.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(donor => {
    const cooldown = getCooldown(donor.lastDonation);

    return `
      <tr>
        <td><strong>${escapeHTML(donor.name)}</strong></td>
        <td><span class="tag">${escapeHTML(donor.blood)}</span></td>
        <td>${escapeHTML(donor.location)}</td>
        <td>${formatDate(donor.lastDonation)}</td>
        <td>
          <span class="status ${cooldown.status}">
            ${escapeHTML(cooldown.label)}
          </span>
          <p class="muted">${escapeHTML(cooldown.message)}</p>
        </td>
      </tr>
    `;
  }).join("");
}

$("donorFilter").addEventListener("change", renderDonors);

// ==========================================
// BLOOD GROUP STATISTICS
// ==========================================

function renderBloodGroupStats() {
  const container = $("bloodGroupStats");

  container.innerHTML = BLOOD_GROUPS.map(group => {
    const count = donors.filter(d => d.blood === group).length;

    return `
      <div class="group-card">
        <h3>${group}</h3>
        <p>${count} donor${count === 1 ? "" : "s"}</p>
      </div>
    `;
  }).join("");
}

// ==========================================
// BLOOD REQUEST SUBMISSION
// ==========================================

$("requestForm").addEventListener("submit", function(event) {
  event.preventDefault();

  const patient = $("patientName").value.trim();
  const blood = $("requestBlood").value;
  const hospital = $("hospitalName").value.trim();
  const units = Number($("unitsRequired").value);
  const urgency = $("requestUrgency").value;
  const contact = $("requestContact").value.trim();

  if (!patient || !blood || !hospital || !contact) {
    alert("Please fill in all required fields.");
    return;
  }

  if (!BLOOD_GROUPS.includes(blood)) {
    alert("Please select a valid blood group.");
    return;
  }

  if (!Number.isInteger(units) || units < 1 || units > 20) {
    alert("Enter a valid number of units.");
    return;
  }

  if (!/^[0-9]{10}$/.test(contact)) {
    alert("Enter a valid 10-digit contact number.");
    return;
  }

  const request = {
    id: Date.now(),
    patient,
    blood,
    hospital,
    units,
    urgency,
    contact,
    status: "Open",
    createdAt: new Date().toISOString()
  };

  requests.unshift(request);
  saveData();

  latestMatches = donors.filter(donor => donor.blood === blood);

  this.reset();

  refreshAll();

  showMatchResults(request);

  alert("Blood request submitted successfully!");
});

// ==========================================
// FIND POTENTIAL DONORS
// ==========================================

function showMatchResults(request) {
  const panel = $("matchResult");
  const list = $("matchList");

  panel.classList.remove("hidden");

  $("matchHeading").textContent =
    `${latestMatches.length} potential donor(s) found`;

  $("matchDescription").textContent =
    `Exact blood-group matches for ${request.blood}. ` +
    `The hospital or blood bank must independently confirm compatibility and donor eligibility.`;

  if (!latestMatches.length) {
    list.innerHTML = `
      <p class="muted">
        No registered donors with this exact blood group were found.
        Contact a licensed blood bank directly.
      </p>
    `;
  } else {
    list.innerHTML = latestMatches.map(donor => {
      const cooldown = getCooldown(donor.lastDonation);

      return `
        <div class="match-card">
          <strong>${escapeHTML(donor.name)}</strong>
          <p>Blood group: ${escapeHTML(donor.blood)}</p>
          <p>Location: ${escapeHTML(donor.location)}</p>
          <p>Donation tracker: ${escapeHTML(cooldown.label)}</p>
          <p>Medical screening: Required</p>
        </div>
      `;
    }).join("");
  }

  $("broadcastMessage").textContent = "";
  $("broadcastButton").disabled = latestMatches.length === 0;

  panel.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

// ==========================================
// SIMULATED EMERGENCY BROADCAST
// ==========================================

$("broadcastButton").addEventListener("click", function() {
  if (!latestMatches.length) {
    alert("No matching donors available.");
    return;
  }

  const confirmed = confirm(
    `Simulate an emergency alert for ${latestMatches.length} matching donor(s)?\n\n` +
    `This demo will NOT send actual messages or reveal contact details.`
  );

  if (!confirmed) return;

  $("broadcastMessage").textContent =
    `Demo broadcast completed: ${latestMatches.length} potential donor(s) would be notified through an integrated alert service. No real messages were sent.`;
});

// ==========================================
// REQUEST HISTORY
// ==========================================

function renderRequests() {
  const tbody = $("requestTable");

  if (!requests.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty">
          No blood requests have been submitted yet.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = requests.map(request => {
    const urgencyClass = request.urgency.toLowerCase();

    return `
      <tr>
        <td><strong>${escapeHTML(request.patient)}</strong></td>
        <td><span class="tag">${escapeHTML(request.blood)}</span></td>
        <td>${escapeHTML(request.hospital)}</td>
        <td>${request.units}</td>
        <td>
          <span class="status ${urgencyClass}">
            ${escapeHTML(request.urgency)}
          </span>
        </td>
        <td>${escapeHTML(request.status)}</td>
      </tr>
    `;
  }).join("");
}

// ==========================================
// CAMP REMINDERS
// ==========================================

$("campDate").min = todayString();

$("campForm").addEventListener("submit", function(event) {
  event.preventDefault();

  const name = $("campName").value.trim();
  const date = $("campDate").value;
  const time = $("campTime").value;
  const venue = $("campVenue").value.trim();

  if (!name || !date || !time || !venue) {
    alert("Please complete all camp details.");
    return;
  }

  if (date < todayString()) {
    alert("Please select today or a future date.");
    return;
  }

  const camp = {
    id: Date.now(),
    name,
    date,
    time,
    venue
  };

  camps.push(camp);

  camps.sort((a, b) =>
    new Date(`${a.date}T${a.time}`) -
    new Date(`${b.date}T${b.time}`)
  );

  saveData();

  this.reset();
  $("campDate").min = todayString();

  refreshAll();

  alert("Camp reminder added successfully!");
});

// ==========================================
// DISPLAY CAMPS
// ==========================================

function renderCamps() {
  const container = $("campList");

  if (!camps.length) {
    container.innerHTML = `
      <p class="muted">
        No upcoming camps have been scheduled.
      </p>
    `;
    return;
  }

  container.innerHTML = camps.map(camp => {
    const date = getDate(camp.date);

    const day = date.toLocaleDateString("en-IN", {
      day: "2-digit"
    });

    const month = date.toLocaleDateString("en-IN", {
      month: "short"
    });

    return `
      <div class="camp-card">
        <div class="camp-date">
          ${day}
          <small>${month}</small>
        </div>

        <div class="camp-info">
          <h3>${escapeHTML(camp.name)}</h3>
          <p>📍 ${escapeHTML(camp.venue)}</p>
          <p>🕒 ${escapeHTML(camp.time)} · ${formatDate(camp.date)}</p>
        </div>

        <button class="remove-btn" data-remove-camp="${camp.id}">
          Remove
        </button>
      </div>
    `;
  }).join("");
}

// Remove camp using event delegation
$("campList").addEventListener("click", function(event) {
  const button = event.target.closest("[data-remove-camp]");

  if (!button) return;

  const id = Number(button.dataset.removeCamp);

  if (!confirm("Remove this camp reminder?")) return;

  camps = camps.filter(camp => camp.id !== id);

  saveData();
  refreshAll();
});

// ==========================================
// DASHBOARD STATISTICS
// ==========================================

function updateDashboard() {
  $("donorCount").textContent = donors.length;
  $("requestCount").textContent = requests.length;

  const openRequests = requests.filter(
    request => request.status === "Open"
  );

  const totalMatches = openRequests.reduce((total, request) => {
    return total + donors.filter(
      donor => donor.blood === request.blood
    ).length;
  }, 0);

  $("matchCount").textContent = totalMatches;

  const today = todayString();

  const upcomingCamps = camps.filter(camp => camp.date >= today);

  $("campCount").textContent = upcomingCamps.length;

  renderBloodGroupStats();
  renderRecentRequests();
}

// ==========================================
// RECENT REQUESTS
// ==========================================

function renderRecentRequests() {
  const tbody = $("recentRequests");

  if (!requests.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty">
          No recent requests.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = requests.slice(0, 5).map(request => {
    return `
      <tr>
        <td><strong>${escapeHTML(request.patient)}</strong></td>
        <td>${escapeHTML(request.blood)}</td>
        <td>${escapeHTML(request.hospital)}</td>
        <td>
          <span class="status ${request.urgency.toLowerCase()}">
            ${escapeHTML(request.urgency)}
          </span>
        </td>
        <td>${escapeHTML(request.status)}</td>
      </tr>
    `;
  }).join("");
}

// ==========================================
// REFRESH APPLICATION
// ==========================================

function refreshAll() {
  updateDashboard();
  renderDonors();
  renderRequests();
  renderCamps();
}

// Initial application load
refreshAll();