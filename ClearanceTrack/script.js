/* 
  ClearanceTrack - front-end demo
  Storage: browser localStorage only.
*/
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "clearancetrack_v1";
  const SESSION_KEY = "clearancetrack_session_v1";
  const ADMIN_PIN = "9999";
  const DEPT_PIN = "1111";
  const DEADLINE_DAYS = 5;

  const DEPARTMENTS = [
    "Academic Section",
    "Accounts Department",
    "Library",
    "Hostel Office",
    "Department Office",
    "Sports Department"
  ];

  const CERT_TYPES = {
    "No-Dues Certificate": {
      departments: [
        "Accounts Department",
        "Library",
        "Hostel Office",
        "Department Office",
        "Sports Department"
      ],
      purposeRequired: false
    },
    "Bonafide Certificate": {
      departments: [
        "Academic Section",
        "Accounts Department",
        "Department Office"
      ],
      purposeRequired: true
    },
    "NOC (No Objection Certificate)": {
      departments: [
        "Academic Section",
        "Accounts Department",
        "Library",
        "Hostel Office",
        "Department Office"
      ],
      purposeRequired: true
    }
  };

  const state = {
    db: loadDB(),
    student: null,
    department: null,
    filter: "pending",
    officeSearch: ""
  };

  function loadDB() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));

      if (
        parsed &&
        Array.isArray(parsed.students) &&
        Array.isArray(parsed.requests)
      ) {
        return parsed;
      }
    } catch (_) {}

    return {
      students: [],
      requests: [],
      nextRequest: 1,
      nextCertificate: 1
    };
  }

  function saveDB() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.db));
  }

  function loadSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY));

      if (s && s.studentKey) {
        state.student =
          state.db.students.find(x => x.key === s.studentKey) || null;
      }
    } catch (_) {}
  }

  function saveSession() {
    if (state.student) {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ studentKey: state.student.key })
      );
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[ch]));
  }

  function uid(prefix) {
    return prefix + "-" +
      Date.now().toString(36) + "-" +
      Math.random().toString(36).slice(2, 7);
  }

  function dateISO(date = new Date()) {
    return date.toISOString();
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d.toISOString();
  }

  function fmtDate(value) {
    if (!value) return "—";

    const d = new Date(value);

    return Number.isNaN(d.getTime())
      ? "—"
      : d.toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric"
        });
  }

  function daysBetween(a, b = new Date()) {
    return Math.max(
      0,
      Math.floor((new Date(b) - new Date(a)) / 86400000)
    );
  }

  function isLate(req) {
    return !["issued", "cancelled"].includes(req.status) &&
      new Date() > new Date(req.deadline);
  }

  function getStudent(key) {
    return state.db.students.find(s => s.key === key);
  }

  function getReq(id) {
    return state.db.requests.find(r => r.id === id);
  }

  function getDeptStatus(req, dept) {
    return req.approvals[dept] || {
      status: "pending",
      note: "",
      updatedAt: null
    };
  }

  function deriveStatus(req) {
    const statuses = Object.values(req.approvals).map(a => a.status);

    if (statuses.includes("rejected")) return "rejected";
    if (statuses.includes("dues")) return "dues";

    if (
      statuses.length &&
      statuses.every(s => s === "approved")
    ) {
      return "ready";
    }

    return "in_progress";
  }

  function statusLabel(status) {
    return ({
      pending: "Waiting",
      in_progress: "In progress",
      dues: "Dues / action required",
      rejected: "Rejected",
      approved: "Approved",
      ready: "Ready to issue",
      issued: "Issued",
      cancelled: "Cancelled"
    })[status] || status;
  }

  function chip(status, label) {
    return `<span class="chip ${esc(status)}">
      ${esc(label || statusLabel(status))}
    </span>`;
  }

  function toast(message) {
    const el = $("toast");

    el.textContent = message;
    el.classList.remove("hide");

    clearTimeout(toast.timer);

    toast.timer = setTimeout(() => {
      el.classList.add("hide");
    }, 2800);
  }

  function empty(message) {
    return `<div class="empty">${esc(message)}</div>`;
  }

  // INITIALIZATION

  function initSelects() {
    $("rType").innerHTML =
      Object.keys(CERT_TYPES)
        .map(t => `<option value="${esc(t)}">${esc(t)}</option>`)
        .join("");

    $("oDept").innerHTML =
      DEPARTMENTS
        .map(d => `<option value="${esc(d)}">${esc(d)}</option>`)
        .join("");

    updateNeeds();
    renderStudentPicker();
  }

  function updateNeeds() {
    const type = $("rType").value;
    const config = CERT_TYPES[type];

    $("rNeeds").innerHTML = config
      ? `Approvals required from: ${
          config.departments
            .map(d => `<span class="chip dept">${esc(d)}</span>`)
            .join(" ")
        }`
      : "";

    $("purposeHint").textContent =
      config?.purposeRequired ? "(required)" : "(optional)";

    $("rPurpose").required = !!config?.purposeRequired;
  }

  function renderStudentPicker() {
    const sel = $("sSel");
    const students = state.db.students;

    sel.innerHTML = students.length
      ? students.map(s => `
          <option value="${esc(s.key)}">
            ${esc(s.name)} · ${esc(s.roll)}
          </option>
        `).join("")
      : `<option value="">No saved students yet</option>`;

    $("sBtn").disabled = !students.length;
  }

  // ROLE NAVIGATION

  function showRole(role) {
    document.querySelectorAll(".tab").forEach(tab => {
      const active = tab.dataset.role === role;

      tab.setAttribute("aria-selected", String(active));
    });

    document.querySelectorAll(".view").forEach(view => {
      view.classList.add("hide");
    });

    $("view-" + role).classList.remove("hide");

    $("certPage").classList.add("hide");
    document.body.classList.remove("showcert");

    if (role === "student") renderStudent();
    if (role === "office") renderOffice();
    if (role === "admin") renderAdmin();
  }

  // STUDENT SECTION

  function signIn(student) {
    state.student = student;

    saveSession();
    renderStudent();

    toast(`Welcome, ${student.name}`);
  }

  function renderStudent() {
    const signedIn = !!state.student;

    $("sSignin").classList.toggle("hide", signedIn);
    $("sDash").classList.toggle("hide", !signedIn);

    renderStudentPicker();

    if (!signedIn) return;

    const s = state.student;

    const initials = s.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(x => x[0])
      .join("")
      .toUpperCase();

    const hue = [...s.roll].reduce(
      (n, c) => n + c.charCodeAt(0), 0
    ) % 360;

    $("sMe").innerHTML = `
      <div class="card me">
        <div class="avatar" style="--h:${hue}">
          ${esc(initials)}
        </div>

        <div class="info">
          <h2>${esc(s.name)}</h2>
          <p>
            ${esc(s.roll)} · ${esc(s.course)} · Year ${esc(s.year)}
          </p>
        </div>

        <button class="btn ghost small"
          type="button"
          data-act="studentlogout">
          Switch student
        </button>
      </div>
    `;

    renderMyRequests();
  }

  function renderMyRequests() {
    const requests = state.db.requests
      .filter(r => r.studentKey === state.student?.key)
      .sort((a, b) =>
        new Date(b.createdAt) - new Date(a.createdAt)
      );

    if (!requests.length) {
      $("myReqs").innerHTML =
        empty("You have not submitted any requests yet.");
      return;
    }

    $("myReqs").innerHTML = requests.map(req => {

      const done = Object.values(req.approvals)
        .filter(a => a.status === "approved").length;

      const total = Object.keys(req.approvals).length;

      const percent = total
        ? Math.round(done / total * 100)
        : 0;

      const status = req.status;

      const steps = Object.entries(req.approvals)
        .map(([dept, approval]) => {

          const cls =
            approval.status === "approved" ? "approved" :
            approval.status === "dues" ? "dues" :
            approval.status === "rejected" ? "rejected" :
            "pending";

          const symbol =
            approval.status === "approved" ? "✓" :
            approval.status === "dues" ? "!" :
            approval.status === "rejected" ? "×" :
            "…";

          return `
            <li class="st ${cls}">
              <span class="dot">${symbol}</span>

              <div class="sinfo">
                <b>${esc(dept)}</b>

                <p>
                  ${esc(statusLabel(approval.status))}
                  ${approval.updatedAt
                    ? ` · ${fmtDate(approval.updatedAt)}`
                    : ""}
                </p>

                ${approval.note
                  ? `<p class="why">${esc(approval.note)}</p>`
                  : ""}
              </div>
            </li>
          `;
        }).join("");

      return `
        <article class="card req ${esc(status)}">

          <div class="rtop">
            <div>
              <div class="rtype">${esc(req.type)}</div>
              <h3>Request #${esc(req.id)}</h3>
            </div>

            ${chip(status)}
          </div>

          <p class="small">
            Submitted ${fmtDate(req.createdAt)}
            · Deadline ${fmtDate(req.deadline)}
          </p>

          ${req.purpose
            ? `<p class="small">Purpose: ${esc(req.purpose)}</p>`
            : ""}

          <div class="prog">
            <i style="width:${percent}%"></i>
          </div>

          <p class="small">
            ${done} of ${total} departments approved (${percent}%)
          </p>

          <ul class="steps">${steps}</ul>

          ${req.certificateCode
            ? `
              <div class="acts">
                ${chip("issued", req.certificateCode)}

                <button class="btn primary small"
                  data-act="viewcert"
                  data-id="${esc(req.id)}">
                  View certificate
                </button>
              </div>
            `
            : ""}

          ${status === "rejected"
            ? `
              <p class="small">
                This request cannot be issued because a department
                rejected it. Contact the relevant office.
              </p>
            `
            : ""}

        </article>
      `;
    }).join("");
  }

  function createRequest(student, type, purpose) {
    const config = CERT_TYPES[type];

    const now = dateISO();
    const approvals = {};

    config.departments.forEach(dept => {
      approvals[dept] = {
        status: "pending",
        note: "",
        updatedAt: null,
        firstResponseAt: null
      };
    });

    const req = {
      id: state.db.nextRequest++,
      studentKey: student.key,
      type,
      purpose,
      createdAt: now,
      deadline: addDays(now, DEADLINE_DAYS),
      approvals,
      status: "in_progress",
      certificateCode: null,
      issuedAt: null
    };

    state.db.requests.push(req);

    saveDB();

    return req;
  }

  // OFFICE SECTION

  function renderOffice() {
    const unlocked = !!state.department;

    $("oLock").classList.toggle("hide", unlocked);
    $("oMain").classList.toggle("hide", !unlocked);

    if (!unlocked) return;

    $("oHead").innerHTML = `
      <div class="avatar" style="--h:345">🏢</div>

      <div class="info">
        <h2>${esc(state.department)}</h2>
        <p>Department approval dashboard</p>
      </div>

      <button class="btn ghost small"
        data-act="officelogout">
        Lock
      </button>
    `;

    const relevant = state.db.requests.filter(r =>
      Object.hasOwn(r.approvals, state.department)
    );

    const waiting = relevant.filter(r =>
      getDeptStatus(r, state.department).status === "pending"
    );

    const late = relevant.filter(r =>
      getDeptStatus(r, state.department).status === "pending" &&
      isLate(r)
    );

    const responseTimes = relevant.flatMap(r => {
      const a = getDeptStatus(r, state.department);

      return a.firstResponseAt
        ? [daysBetween(r.createdAt, a.firstResponseAt)]
        : [];
    });

    const avg = responseTimes.length
      ? (
          responseTimes.reduce((a, b) => a + b, 0) /
          responseTimes.length
        ).toFixed(1)
      : "–";

    $("osWait").textContent = waiting.length;
    $("osLate").textContent = late.length;
    $("osAvg").textContent = avg;

    $("oBanner").innerHTML = late.length
      ? `
        <div class="banner">
          ⚠ ${late.length} request${late.length === 1 ? "" : "s"}
          are past the ${DEADLINE_DAYS}-day response deadline.
        </div>
      `
      : "";

    document.querySelectorAll(".chip-btn").forEach(btn => {
      btn.classList.toggle(
        "active",
        btn.dataset.filter === state.filter
      );
    });

    renderOfficeList();
  }

  function renderOfficeList() {
    if (!state.department) return;

    const query = state.officeSearch.trim().toLowerCase();

    let requests = state.db.requests.filter(r =>
      Object.hasOwn(r.approvals, state.department)
    );

    requests = requests.filter(req => {
      const s = getDeptStatus(req, state.department).status;

      if (state.filter === "pending") return s === "pending";

      if (state.filter === "blocked") {
        return s === "dues" || s === "rejected";
      }

      return s === "approved";
    });

    requests = requests.filter(req => {
      const student = getStudent(req.studentKey);

      return !query ||
        `${student?.name || ""} ${student?.roll || ""}`
          .toLowerCase()
          .includes(query);
    }).sort((a, b) =>
      new Date(a.createdAt) - new Date(b.createdAt)
    );

    if (!requests.length) {
      $("oList").innerHTML =
        empty("No requests match this filter.");
      return;
    }

    $("oList").innerHTML = requests.map(req => {

      const student = getStudent(req.studentKey) || {};
      const a = getDeptStatus(req, state.department);

      const late =
        a.status === "pending" && isLate(req);

      const cardClass = late
        ? "late"
        : a.status === "dues" || a.status === "rejected"
          ? "dues"
          : a.status === "approved"
            ? "approved"
            : "";

      return `
        <article class="qcard ${cardClass}">

          <div class="qtop">
            <div>
              <div class="rtype">${esc(req.type)}</div>
              <h3>${esc(student.name || "Unknown student")}</h3>

              <p>
                ${esc(student.roll || "")}
                · ${esc(student.course || "")}
                · Year ${esc(student.year || "")}
              </p>
            </div>

            ${chip(
              a.status,
              late ? "Past deadline" : statusLabel(a.status)
            )}
          </div>

          <p>
            <b>Request #${esc(req.id)}</b>
            · Submitted ${fmtDate(req.createdAt)}
            · Due ${fmtDate(req.deadline)}
          </p>

          ${req.purpose
            ? `<p>Purpose: ${esc(req.purpose)}</p>`
            : ""}

          ${a.note
            ? `<p><b>Previous note:</b> ${esc(a.note)}</p>`
            : ""}

          ${a.status === "pending"
            ? `
              <div class="qacts">

                <input
                  id="note-${esc(req.id)}"
                  maxlength="180"
                  placeholder="Optional note / reason">

                <div class="r2">

                  <button class="btn good small"
                    data-act="deptapprove"
                    data-id="${esc(req.id)}">
                    Approve
                  </button>

                  <button class="btn warnb small"
                    data-act="deptdues"
                    data-id="${esc(req.id)}">
                    Mark dues
                  </button>

                  <button class="btn danger small"
                    data-act="deptreject"
                    data-id="${esc(req.id)}">
                    Reject
                  </button>

                </div>
              </div>
            `
            : `
              <div class="acts">
                <button class="btn ghost small"
                  data-act="deptreopen"
                  data-id="${esc(req.id)}">
                  Reopen / update
                </button>
              </div>
            `
          }

        </article>
      `;
    }).join("");
  }

  // ADMIN SECTION

  function renderAdmin() {
    const unlocked =
      $("aMain").classList.contains("hide") === false;

    $("aLock").classList.toggle("hide", unlocked);
    $("aMain").classList.toggle("hide", !unlocked);

    if (!unlocked) return;

    const requests = state.db.requests;

    const ready = requests.filter(r => r.status === "ready");
    const issued = requests.filter(r => r.status === "issued");

    const progress = requests.filter(r =>
      ["in_progress", "dues", "rejected"].includes(r.status)
    );

    const stuck = requests.filter(isLate);

    $("asProg").textContent = progress.length;
    $("asReady").textContent = ready.length;
    $("asIssued").textContent = issued.length;
    $("asStuck").textContent = stuck.length;

    // Ready to issue

    $("aReady").innerHTML = ready.length
      ? ready.map(req => {

          const s = getStudent(req.studentKey) || {};

          return `
            <article class="qcard approved">

              <div class="qtop">
                <div>
                  <div class="rtype">${esc(req.type)}</div>
                  <h3>
                    ${esc(s.name || "Unknown")}
                    · ${esc(s.roll || "")}
                  </h3>
                </div>

                ${chip("ready")}
              </div>

              <p>
                Request #${esc(req.id)}
                · All ${Object.keys(req.approvals).length}
                departments approved
                · Submitted ${fmtDate(req.createdAt)}
              </p>

              <div class="acts">
                <button class="btn primary small"
                  data-act="issuecert"
                  data-id="${esc(req.id)}">
                  Issue certificate
                </button>
              </div>

            </article>
          `;
        }).join("")
      : empty("No requests are ready to issue.");

    // Department bottlenecks

    const counts = DEPARTMENTS.map(dept => {

      const total = requests.filter(r =>
        Object.hasOwn(r.approvals, dept)
      );

      const waiting = total.filter(r =>
        getDeptStatus(r, dept).status === "pending"
      );

      return {
        dept,
        total: total.length,
        waiting: waiting.length
      };

    }).filter(x => x.total)
      .sort((a, b) => b.waiting - a.waiting);

    const max = Math.max(
      1,
      ...counts.map(x => x.waiting)
    );

    $("aBott").innerHTML = counts.length
      ? `
        <div class="bott">
          ${counts.map((x, i) => `
            <div class="brow ${i === 0 && x.waiting ? "top" : ""}">

              <div class="bn">
                ${esc(x.dept)}
                <span>
                  ${x.waiting} waiting / ${x.total} total
                </span>
              </div>

              <div class="meter">
                <i style="width:${x.waiting / max * 100}%"></i>
              </div>

            </div>
          `).join("")}
        </div>
      `
      : `<p class="hint">No requests yet.</p>`;

    // Past deadline

    $("aStuck").innerHTML = stuck.length
      ? stuck
          .sort((a, b) =>
            new Date(a.deadline) - new Date(b.deadline)
          )
          .map(req => {

            const s = getStudent(req.studentKey) || {};

            const waitingDepts = Object.entries(req.approvals)
              .filter(([, a]) => a.status === "pending")
              .map(([d]) => d);

            return `
              <article class="qcard late">

                <div class="qtop">
                  <div>
                    <h3>
                      ${esc(s.name || "Unknown")}
                      · ${esc(s.roll || "")}
                    </h3>

                    <p>
                      ${esc(req.type)}
                      · Request #${esc(req.id)}
                    </p>
                  </div>

                  ${chip("rejected", "Past deadline")}
                </div>

                <p>
                  Deadline: ${fmtDate(req.deadline)}
                  · Waiting at: ${esc(waitingDepts.join(", ") ||
                    "No pending department")}
                </p>

              </article>
            `;
          }).join("")
      : empty("No requests are past the deadline.");

    $("csvBtn").disabled = !requests.length;
  }

  // CERTIFICATE GENERATION

  function issueCertificate(req) {
    if (req.status !== "ready") {
      toast(
        "All required departments must approve before issuing."
      );
      return;
    }

    const year = new Date().getFullYear();

    req.certificateCode =
      `CT-${year}-${String(state.db.nextCertificate++).padStart(4, "0")}`;

    req.issuedAt = dateISO();
    req.status = "issued";

    saveDB();
    renderAdmin();

    toast(`Certificate ${req.certificateCode} issued.`);
  }

  function showCertificate(req) {
    if (
      !req ||
      req.status !== "issued" ||
      !req.certificateCode
    ) {
      toast("This request does not have an issued certificate.");
      return;
    }

    const student = getStudent(req.studentKey) || {};

    const rows = Object.entries(req.approvals)
      .map(([dept, a]) => `
        <tr>
          <td>${esc(dept)}</td>
          <td>${esc(statusLabel(a.status))}</td>
          <td>${esc(fmtDate(a.updatedAt))}</td>
        </tr>
      `).join("");

    $("certBody").innerHTML = `
      <div class="col">CLEARANCETRACK</div>

      <div class="ttl">${esc(req.type)}</div>

      <div class="meta">
        <span>
          <b>Certificate No.:</b>
          ${esc(req.certificateCode)}
        </span>

        <span>
          <b>Issue date:</b>
          ${fmtDate(req.issuedAt)}
        </span>
      </div>

      <p class="body">
        This is to certify that
        <b>${esc(student.name)}</b>,
        bearing roll number
        <b>${esc(student.roll)}</b>,
        enrolled in
        <b>${esc(student.course)}</b>
        (Year ${esc(student.year)}),
        has completed the approvals recorded below
        for the requested certificate.
      </p>

      ${req.purpose
        ? `<p class="body"><b>Purpose:</b> ${esc(req.purpose)}</p>`
        : ""}

      <table>
        <thead>
          <tr>
            <th>Department</th>
            <th>Decision</th>
            <th>Date</th>
          </tr>
        </thead>

        <tbody>${rows}</tbody>
      </table>

      <div class="sig">
        <div>Issuing Authority</div>
        <div>Registrar / Administration</div>
      </div>

      <p class="fine">
        Demo certificate generated by ClearanceTrack.
        Verify certificate number in the application.
        This prototype is not an official institutional document.
      </p>
    `;

    $("certPage").classList.remove("hide");
    document.body.classList.add("showcert");
  }

  // CERTIFICATE VERIFICATION

  function verifyCertificate(code) {
    const req = state.db.requests.find(r =>
      r.certificateCode?.toLowerCase() ===
      code.trim().toLowerCase()
    );

    const target = $("vResult");

    if (req && req.status === "issued") {

      const s = getStudent(req.studentKey) || {};

      target.innerHTML = `
        <div class="vres ok">
          <b>✓ Genuine demo record found</b>

          <p>Certificate: ${esc(req.certificateCode)}</p>
          <p>Student: ${esc(s.name)} · ${esc(s.roll)}</p>
          <p>Type: ${esc(req.type)}</p>
          <p>Issued: ${fmtDate(req.issuedAt)}</p>
        </div>
      `;

    } else {

      target.innerHTML = `
        <div class="vres bad">
          <b>Certificate not found</b>

          <p>
            Check the number and try again.
            Only certificates issued in this browser demo
            can be verified.
          </p>
        </div>
      `;
    }
  }

  // CSV DOWNLOAD

  function downloadCSV() {

    const headers = [
      "Request ID",
      "Student Name",
      "Roll Number",
      "Course",
      "Year",
      "Certificate Type",
      "Purpose",
      "Department",
      "Department Status",
      "Department Note",
      "Submitted At",
      "Deadline",
      "Request Status",
      "Certificate Number"
    ];

    const rows = [headers];

    state.db.requests.forEach(req => {

      const s = getStudent(req.studentKey) || {};

      Object.entries(req.approvals).forEach(([dept, a]) => {

        rows.push([
          req.id,
          s.name,
          s.roll,
          s.course,
          s.year,
          req.type,
          req.purpose,
          dept,
          a.status,
          a.note,
          req.createdAt,
          req.deadline,
          req.status,
          req.certificateCode || ""
        ]);

      });
    });

    const csv = rows.map(row =>
      row.map(value =>
        `"${String(value ?? "").replace(/"/g, '""')}"`
      ).join(",")
    ).join("\r\n");

    const blob = new Blob(
      ["\uFEFF" + csv],
      { type: "text/csv;charset=utf-8;" }
    );

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");

    a.href = url;
    a.download = "clearancetrack-requests.csv";

    document.body.appendChild(a);

    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }

  // SAMPLE DATA

  function seedSampleData() {

    const sampleStudents = [
      {
        name: "Rohan Mehta",
        roll: "2301CS045",
        course: "B.Tech CSE",
        year: "3"
      },
      {
        name: "Aarav Sharma",
        roll: "2401CS018",
        course: "B.Tech CSE",
        year: "2"
      },
      {
        name: "Isha Kapoor",
        roll: "2201CS072",
        course: "B.Tech CSE",
        year: "4"
      }
    ];

    sampleStudents.forEach(data => {

      if (!state.db.students.some(s =>
        s.roll.toLowerCase() === data.roll.toLowerCase()
      )) {

        state.db.students.push({
          ...data,
          key: uid("student"),
          createdAt: dateISO()
        });

      }
    });

    const students = sampleStudents.map(x =>
      state.db.students.find(s => s.roll === x.roll)
    );

    if (!state.db.requests.length) {

      const r1 = createRequest(
        students[0],
        "No-Dues Certificate",
        "End of semester clearance"
      );

      r1.deadline = addDays(new Date(), -2);

      r1.approvals["Library"] = {
        status: "approved",
        note: "No books pending",
        updatedAt: dateISO(),
        firstResponseAt: dateISO()
      };

      r1.approvals["Accounts Department"] = {
        status: "dues",
        note: "Please clear the pending fee.",
        updatedAt: dateISO(),
        firstResponseAt: dateISO()
      };

      r1.status = deriveStatus(r1);

      const r2 = createRequest(
        students[1],
        "Bonafide Certificate",
        "Internship application"
      );

      r2.approvals["Academic Section"] = {
        status: "approved",
        note: "Verified",
        updatedAt: dateISO(),
        firstResponseAt: dateISO()
      };

      r2.status = deriveStatus(r2);

      const r3 = createRequest(
        students[2],
        "NOC (No Objection Certificate)",
        "Higher studies application"
      );

      Object.keys(r3.approvals).forEach(dept => {

        r3.approvals[dept] = {
          status: "approved",
          note: "No objection",
          updatedAt: dateISO(),
          firstResponseAt: dateISO()
        };

      });

      r3.status = deriveStatus(r3);
    }

    saveDB();

    renderStudentPicker();
    renderStudent();
    renderOffice();
    renderAdmin();

    toast("Sample requests loaded.");
  }

  // RESET DATA

  function resetAll() {

    if (!confirm(
      "Clear all ClearanceTrack demo data from this browser? This cannot be undone."
    )) return;

    state.db = {
      students: [],
      requests: [],
      nextRequest: 1,
      nextCertificate: 1
    };

    state.student = null;
    state.department = null;
    state.filter = "pending";
    state.officeSearch = "";

    saveDB();

    sessionStorage.removeItem(SESSION_KEY);

    $("oPin").value = "";
    $("aPin").value = "";

    $("oMain").classList.add("hide");
    $("aMain").classList.add("hide");

    $("oLock").classList.remove("hide");
    $("aLock").classList.remove("hide");

    $("oSearch").value = "";
    $("vResult").innerHTML = "";

    renderStudent();
    renderStudentPicker();
    renderOffice();
    renderAdmin();

    toast("All demo data cleared.");
  }

  // EVENT LISTENERS

  document.querySelectorAll(".tab").forEach(tab => {

    tab.addEventListener("click", () => {
      showRole(tab.dataset.role);
    });

  });

  // Student registration

  $("signForm").addEventListener("submit", event => {

    event.preventDefault();

    const name = $("sName").value.trim();
    const roll = $("sRoll").value.trim().toUpperCase();
    const course = $("sCourse").value.trim();
    const year = $("sYear").value;

    if (!name || !roll || !course) return;

    let student = state.db.students.find(s =>
      s.roll.toLowerCase() === roll.toLowerCase()
    );

    if (student) {

      student.name = name;
      student.course = course;
      student.year = year;

    } else {

      student = {
        key: uid("student"),
        name,
        roll,
        course,
        year,
        createdAt: dateISO()
      };

      state.db.students.push(student);
    }

    saveDB();
    signIn(student);

  });

  // Continue as existing student

  $("sBtn").addEventListener("click", () => {

    const student = getStudent($("sSel").value);

    if (student) signIn(student);

  });

  // Submit certificate request

  $("reqForm").addEventListener("submit", event => {

    event.preventDefault();

    const type = $("rType").value;
    const purpose = $("rPurpose").value.trim();

    const config = CERT_TYPES[type];

    if (!config) return;

    if (config.purposeRequired && !purpose) {

      $("rErr").textContent =
        "Please enter the purpose for this certificate.";

      $("rErr").classList.remove("hide");

      return;
    }

    $("rErr").classList.add("hide");

    const req = createRequest(
      state.student,
      type,
      purpose
    );

    $("rPurpose").value = "";

    renderMyRequests();

    toast(
      `Request #${req.id} submitted to ${Object.keys(req.approvals).length} departments.`
    );

  });

  $("rType").addEventListener("change", updateNeeds);

  // Office login

  $("oLockForm").addEventListener("submit", event => {

    event.preventDefault();

    if ($("oPin").value !== DEPT_PIN) {

      $("oErr").textContent =
        "Incorrect PIN. Use the demo PIN shown above.";

      $("oErr").classList.remove("hide");

      return;
    }

    state.department = $("oDept").value;

    $("oErr").classList.add("hide");
    $("oPin").value = "";

    renderOffice();

    toast(`${state.department} unlocked.`);

  });

  // Admin login

  $("aLockForm").addEventListener("submit", event => {

    event.preventDefault();

    if ($("aPin").value !== ADMIN_PIN) {

      $("aErr").textContent =
        "Incorrect admin PIN. Use the demo PIN shown above.";

      $("aErr").classList.remove("hide");

      return;
    }

    $("aErr").classList.add("hide");
    $("aPin").value = "";

    $("aMain").classList.remove("hide");

    renderAdmin();

    toast("Admin dashboard unlocked.");

  });

  // Office filters

  document.querySelectorAll(".chip-btn").forEach(btn => {

    btn.addEventListener("click", () => {

      state.filter = btn.dataset.filter;

      document.querySelectorAll(".chip-btn").forEach(x => {
        x.classList.toggle("active", x === btn);
      });

      renderOfficeList();

    });

  });

  // Office search

  $("oSearch").addEventListener("input", event => {

    state.officeSearch = event.target.value;

    renderOfficeList();

  });

  // Certificate verification

  $("verifyForm").addEventListener("submit", event => {

    event.preventDefault();

    verifyCertificate($("vCode").value);

  });

  // Other buttons

  $("csvBtn").addEventListener("click", downloadCSV);
  $("seedBtn").addEventListener("click", seedSampleData);
  $("resetBtn").addEventListener("click", resetAll);

  // Dynamic button actions

  document.addEventListener("click", event => {

    const button = event.target.closest("[data-act]");

    if (!button) return;

    const action = button.dataset.act;
    const id = Number(button.dataset.id);
    const req = id ? getReq(id) : null;

    if (action === "studentlogout") {

      state.student = null;

      saveSession();
      renderStudent();

      toast("Choose a student to continue.");

    } else if (action === "officelogout") {

      state.department = null;

      $("oMain").classList.add("hide");
      $("oLock").classList.remove("hide");
      $("oPin").value = "";

    } else if (action === "viewcert") {

      showCertificate(req);

    } else if (action === "issuecert" && req) {

      issueCertificate(req);

    } else if (
      ["deptapprove", "deptdues", "deptreject", "deptreopen"]
        .includes(action) &&
      req &&
      state.department
    ) {

      const approval = getDeptStatus(req, state.department);

      const noteInput = $("note-" + id);

      const note = noteInput
        ? noteInput.value.trim()
        : approval.note || "";

      if (action === "deptreopen") {

        approval.status = "pending";
        approval.note = "";
        approval.updatedAt = null;

      } else {

        const next =
          action === "deptapprove" ? "approved" :
          action === "deptdues" ? "dues" :
          "rejected";

        if (
          (next === "dues" || next === "rejected") &&
          !note
        ) {

          toast(
            "Please enter a short reason before marking dues or rejecting."
          );

          if (noteInput) noteInput.focus();

          return;
        }

        approval.status = next;
        approval.note = note;
        approval.updatedAt = dateISO();

        if (!approval.firstResponseAt) {
          approval.firstResponseAt = approval.updatedAt;
        }

      }

      req.status = deriveStatus(req);

      saveDB();

      renderOffice();
      renderStudent();
      renderAdmin();

      toast(
        action === "deptreopen"
          ? "Department response reopened."
          : "Department response saved."
      );

    } else if (action === "closecert") {

      $("certPage").classList.add("hide");
      document.body.classList.remove("showcert");

    } else if (action === "printcert") {

      window.print();

    }

  });

  // Synchronize data across browser tabs

  window.addEventListener("storage", event => {

    if (event.key === STORAGE_KEY) {

      state.db = loadDB();

      loadSession();

      renderStudent();
      renderOffice();
      renderAdmin();

    }

  });

  // START APPLICATION

  initSelects();

  loadSession();

  renderStudent();
  renderOffice();
  renderAdmin();

})();