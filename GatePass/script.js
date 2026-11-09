(function () {
"use strict";

/* ============ CONFIG (change these for your college) ============ */
var CONFIG = {
  wardenPin: "1234",
  guardPin: "4321",
  curfew: "22:00",     /* hostel curfew, 24h format */
  graceMin: 15,        /* minutes of grace before a pass counts as late */
  earlyExitMin: 30     /* guard can let student out up to this many minutes before the pass start */
};
var KEY = "gatepass-passes-v1", PKEY = "gatepass-profile-v1";
var ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var LABEL = {pending:"Pending", approved:"Approved", rejected:"Rejected", out:"Out of hostel",
             overdue:"Overdue", returned:"Returned", expired:"Expired"};

/* ============ helpers ============ */
function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function pad(n){ return (n < 10 ? "0" : "") + n; }
function toLocalInput(d){
  return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}
function fmt(s){
  var d = new Date(s);
  if (isNaN(d)) return "–";
  return d.toLocaleString("en-IN", {day:"numeric", month:"short", hour:"numeric", minute:"2-digit", hour12:true});
}
var toastTimer = 0;
function toast(msg){
  var t = $("toast");
  t.textContent = msg;
  t.classList.remove("hide");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.add("hide"); }, 3200);
}

/* ============ storage (swap these 4 functions for Firebase/Supabase later) ============ */
var mem = {passes: [], profile: null};
var Store = {
  load: function(){
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { var a = JSON.parse(raw); if (Array.isArray(a)) { mem.passes = a; return a; } }
    } catch (e) {}
    return mem.passes;
  },
  save: function(list){
    mem.passes = list;
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
  },
  getProfile: function(){
    try { var raw = localStorage.getItem(PKEY); if (raw) { mem.profile = JSON.parse(raw); } } catch (e) {}
    return mem.profile;
  },
  setProfile: function(p){
    mem.profile = p;
    try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch (e) {}
  }
};

/* ============ core logic ============ */
function genCode(list){
  var c;
  do {
    c = "GP-";
    for (var i = 0; i < 6; i++) c += ALPHA.charAt(Math.floor(Math.random() * ALPHA.length));
  } while (list.some(function(p){ return p.code === c; }));
  return c;
}
function graceMs(){ return CONFIG.graceMin * 60000; }

function statusOf(p, now){
  now = now || new Date();
  var back = new Date(p.returnTime).getTime();
  if (p.status === "rejected") return "rejected";
  if (p.status === "pending") return back < now.getTime() ? "expired" : "pending";
  if (p.inAt) return "returned";
  if (p.outAt) return now.getTime() > back + graceMs() ? "overdue" : "out";
  return now.getTime() > back ? "expired" : "approved";
}
function lateMinutes(p){
  if (!p.inAt) return 0;
  var m = Math.round((new Date(p.inAt) - new Date(p.returnTime)) / 60000);
  return m > CONFIG.graceMin ? m : 0;
}
function validateRequest(d, now){
  now = now || new Date();
  if (!d.dest || d.dest.trim().length < 2) return "Please enter where you are going.";
  if (!d.reason || d.reason.trim().length < 3) return "Please give a short reason.";
  var o = new Date(d.outTime), r = new Date(d.returnTime);
  if (isNaN(o) || isNaN(r)) return "Please choose both date and time.";
  if (o.getTime() < now.getTime() - 3600000) return "Going-out time is in the past.";
  if (r <= o) return "Return time must be after the going-out time.";
  if (r - o > 30 * 86400000) return "A pass can be for 30 days at most.";
  return "";
}
function createPass(student, d){
  var list = Store.load();
  var p = {
    id: "p" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    code: genCode(list),
    student: {name: student.name, roll: student.roll, room: student.room, phone: student.phone},
    type: d.type, dest: d.dest.trim(), reason: d.reason.trim(),
    outTime: d.outTime, returnTime: d.returnTime,
    status: "pending", note: "", createdAt: new Date().toISOString(),
    decidedAt: null, outAt: null, inAt: null
  };
  list.push(p);
  Store.save(list);
  return p;
}
function findById(id){ return Store.load().filter(function(p){ return p.id === id; })[0]; }
function findByCode(code){
  code = String(code || "").trim().toUpperCase();
  return Store.load().filter(function(p){ return p.code === code; })[0];
}
function update(id, fn){
  var list = Store.load(), hit = null;
  list.forEach(function(p){ if (p.id === id) { fn(p); hit = p; } });
  Store.save(list);
  return hit;
}
function decide(id, approve, note){
  return update(id, function(p){
    if (p.status !== "pending") return;
    p.status = approve ? "approved" : "rejected";
    p.note = (note || "").trim();
    p.decidedAt = new Date().toISOString();
  });
}
function verifyCode(code, now){
  now = now || new Date();
  var p = findByCode(code);
  if (!p) return {found:false, tone:"bad", title:"✖ Pass not found", msg:"No pass with this code. Do not let the student out.", canOut:false, canIn:false};
  var st = statusOf(p, now), r = {found:true, pass:p, status:st, canOut:false, canIn:false};
  if (st === "approved") {
    var startOk = now.getTime() >= new Date(p.outTime).getTime() - CONFIG.earlyExitMin * 60000;
    if (startOk) { r.tone = "ok"; r.title = "✔ Valid pass – can go out"; r.msg = "Approved by warden. Return by " + fmt(p.returnTime) + "."; r.canOut = true; }
    else { r.tone = "warn"; r.title = "⏳ Too early"; r.msg = "This pass starts at " + fmt(p.outTime) + "."; }
  } else if (st === "out") { r.tone = "warn"; r.title = "Student is outside"; r.msg = "Left at " + fmt(p.outAt) + ". Mark IN when they return."; r.canIn = true; }
  else if (st === "overdue") { r.tone = "bad"; r.title = "⚠ Returning late"; r.msg = "Was due at " + fmt(p.returnTime) + ". Mark IN and inform the warden."; r.canIn = true; }
  else if (st === "returned") { r.tone = "ok"; r.title = "Already returned"; r.msg = "Returned at " + fmt(p.inAt) + ". This pass is finished."; }
  else if (st === "pending") { r.tone = "bad"; r.title = "✖ Not approved yet"; r.msg = "Warden has not approved this request."; }
  else if (st === "rejected") { r.tone = "bad"; r.title = "✖ Rejected"; r.msg = "The warden rejected this request."; }
  else { r.tone = "bad"; r.title = "✖ Expired"; r.msg = "This pass time window has ended."; }
  return r;
}
function markOut(code, now){
  var v = verifyCode(code, now);
  if (!v.canOut) return {ok:false, msg: v.msg};
  update(v.pass.id, function(p){ p.outAt = (now || new Date()).toISOString(); });
  return {ok:true, msg: v.pass.student.name + " marked OUT."};
}
function markIn(code, now){
  var v = verifyCode(code, now);
  if (!v.canIn) return {ok:false, msg: v.msg};
  update(v.pass.id, function(p){ p.inAt = (now || new Date()).toISOString(); });
  return {ok:true, msg: v.pass.student.name + " marked IN."};
}

/* ============ QR ============ */
function qrSvg(text){
  if (typeof qrcode !== "function") return "";
  try {
    var q = qrcode(0, "M");
    q.addData(text);
    q.make();
    return q.createSvgTag({scalable: true, margin: 2});
  } catch (e) { return ""; }
}

/* ============ rendering ============ */
function parentLink(p){
  var d = String(p.student.phone || "").replace(/\D/g, "");
  if (d.length === 10) d = "91" + d;
  if (d.length < 10) return "";
  var msg = "Hello, this is the hostel office. " + p.student.name + " has an approved outpass to " + p.dest +
            " from " + fmt(p.outTime) + " to " + fmt(p.returnTime) + ". Pass code: " + p.code + ".";
  return '<a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/' + d + '?text=' + encodeURIComponent(msg) + '">Notify parent on WhatsApp</a>';
}

function ticket(p, ctx){
  var st = statusOf(p), s = p.student;
  var h = '<article class="ticket ' + st + '">';
  h += '<div class="t-top"><div><span class="t-type">' + esc(p.type) + '</span><h3>' + esc(p.dest) + '</h3></div>' +
       '<span class="chip ' + st + '">' + LABEL[st] + '</span></div>';
  if (ctx !== "student") h += '<p class="who"><b>' + esc(s.name) + '</b> · ' + esc(s.roll) + ' · Room ' + esc(s.room) + '</p>';
  h += '<dl class="grid"><div><dt>Going out</dt><dd>' + fmt(p.outTime) + '</dd></div><div><dt>Back by</dt><dd>' + fmt(p.returnTime) + '</dd></div>';
  if (p.outAt) h += '<div><dt>Left at</dt><dd>' + fmt(p.outAt) + '</dd></div>';
  if (p.inAt) {
    var late = lateMinutes(p);
    h += '<div><dt>Returned at</dt><dd>' + fmt(p.inAt) + (late ? ' <span class="late">(' + late + ' min late)</span>' : '') + '</dd></div>';
  }
  h += '</dl><p class="reason">“' + esc(p.reason) + '”</p>';
  if (p.note) h += '<p class="note"><b>Warden:</b> ' + esc(p.note) + '</p>';

  var acts = "";
  var live = (st === "approved" || st === "out" || st === "overdue");
  if (ctx === "student") {
    if (live) acts += '<button class="btn primary" data-act="showqr" data-id="' + p.id + '">Show QR pass</button>';
    if (st === "pending") acts += '<button class="btn ghost" data-act="cancel" data-id="' + p.id + '">Cancel request</button>';
  } else if (ctx === "warden") {
    if (st === "pending") {
      acts += '<input id="note-' + p.id + '" placeholder="Note (optional)" maxlength="100" aria-label="Note for student">' +
              '<button class="btn good" data-act="approve" data-id="' + p.id + '">Approve</button>' +
              '<button class="btn danger" data-act="reject" data-id="' + p.id + '">Reject</button>';
    } else if (live) { acts += parentLink(p); }
  } else if (ctx === "guard") {
    acts += '<button class="btn good" data-act="markin" data-code="' + p.code + '">Mark IN</button>';
  }
  if (acts) h += '<div class="acts">' + acts + '</div>';
  return h + '</article>';
}
function empty(msg){ return '<div class="empty">' + msg + '</div>'; }
function byNewest(a, b){ return new Date(b.createdAt) - new Date(a.createdAt); }

function renderStudent(){
  var prof = Store.getProfile();
  $("reqForm").classList.toggle("hide", !prof);
  $("reqLock").classList.toggle("hide", !!prof);
  var mine = prof ? Store.load().filter(function(p){ return p.student.roll === prof.roll; }).sort(byNewest) : [];
  $("myPasses").innerHTML = mine.length ? mine.map(function(p){ return ticket(p, "student"); }).join("")
    : empty("No passes yet. Send your first request above.");
}

var wardenFilter = "pending";
function renderWarden(){
  var all = Store.load(), list;
  var cnt = {pending:0, out:0, overdue:0};
  all.forEach(function(p){ var s = statusOf(p); if (s === "pending") cnt.pending++; if (s === "out") cnt.out++; if (s === "overdue") cnt.overdue++; });
  $("sPending").textContent = cnt.pending;
  $("sOut").textContent = cnt.out + cnt.overdue;
  $("sOverdue").textContent = cnt.overdue;
  if (wardenFilter === "pending") {
    list = all.filter(function(p){ return statusOf(p) === "pending"; }).sort(function(a, b){ return new Date(a.createdAt) - new Date(b.createdAt); });
  } else if (wardenFilter === "out") {
    list = all.filter(function(p){ var s = statusOf(p); return s === "out" || s === "overdue"; })
      .sort(function(a, b){ return (statusOf(b) === "overdue") - (statusOf(a) === "overdue"); });
  } else {
    list = all.filter(function(p){ return statusOf(p) !== "pending"; }).sort(byNewest);
  }
  var msgs = {pending:"No requests waiting. All caught up.", out:"Nobody is out of the hostel right now.", history:"No history yet."};
  $("wardenList").innerHTML = list.length ? list.map(function(p){ return ticket(p, "warden"); }).join("") : empty(msgs[wardenFilter]);
}

function renderGuard(){
  var all = Store.load();
  var out = all.filter(function(p){ var s = statusOf(p); return s === "out" || s === "overdue"; })
    .sort(function(a, b){ return (statusOf(b) === "overdue") - (statusOf(a) === "overdue"); });
  $("outList").innerHTML = out.length ? out.map(function(p){ return ticket(p, "guard"); }).join("") : empty("Nobody is out right now.");
  var ev = [];
  all.forEach(function(p){
    if (p.outAt) ev.push({t:p.outAt, k:"OUT", p:p});
    if (p.inAt) ev.push({t:p.inAt, k:"IN", p:p});
  });
  ev.sort(function(a, b){ return new Date(b.t) - new Date(a.t); });
  $("moveLog").innerHTML = ev.length ? ev.slice(0, 12).map(function(e){
    return '<li><span class="tag ' + e.k + '">' + e.k + '</span><span><b>' + esc(e.p.student.name) + '</b> · ' + esc(e.p.dest) + '</span><time>' + fmt(e.t) + '</time></li>';
  }).join("") : '<li>No movements recorded yet.</li>';
}

function showResult(code){
  var v = verifyCode(code);
  var box = $("verifyResult");
  if (!v.found) {
    box.innerHTML = '<div class="result bad"><div class="banner">' + v.title + '</div><div class="rbody">' + esc(v.msg) + '</div></div>';
    return;
  }
  var p = v.pass, s = p.student, h = '<div class="result ' + v.tone + '"><div class="banner">' + v.title + '</div><div class="rbody">';
  h += '<p style="margin:0 0 8px"><b>' + esc(s.name) + '</b> · ' + esc(s.roll) + ' · Room ' + esc(s.room) + '</p>';
  h += '<p style="margin:0 0 8px">' + esc(p.type) + ' to <b>' + esc(p.dest) + '</b></p>';
  h += '<p style="margin:0 0 12px">' + esc(v.msg) + '</p>';
  if (v.canOut) h += '<button class="btn good" data-act="markout" data-code="' + p.code + '">Mark OUT</button>';
  if (v.canIn) h += '<button class="btn good" data-act="markin" data-code="' + p.code + '">Mark IN</button>';
  box.innerHTML = h + '</div></div>';
}

function showQr(id){
  var p = findById(id);
  if (!p) return;
  var svg = qrSvg(p.code);
  var h = '<div class="qrwrap"><h2>Gate pass</h2>';
  h += svg ? '<div class="qr">' + svg + '</div>' : '<p>QR could not load. Show this code to the guard:</p>';
  h += '<p class="bigcode">' + esc(p.code) + '</p>';
  h += '<p><b>' + esc(p.student.name) + '</b> · Room ' + esc(p.student.room) + '</p>';
  h += '<p>' + esc(p.dest) + '</p><p>' + fmt(p.outTime) + ' → ' + fmt(p.returnTime) + '</p></div>';
  $("qrBody").innerHTML = h;
  var d = $("qrDialog");
  if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
}

/* ============ roles, locks ============ */
var role = "student";
var auth = {warden:false, guard:false};
try {
  if (sessionStorage.getItem("gp-auth-warden") === "1") auth.warden = true;
  if (sessionStorage.getItem("gp-auth-guard") === "1") auth.guard = true;
} catch (e) {}

function renderCurrent(){
  if (role === "student") renderStudent();
  if (role === "warden" && auth.warden) renderWarden();
  if (role === "guard" && auth.guard) renderGuard();
}
function setRole(r){
  role = r;
  ["student", "warden", "guard"].forEach(function(x){ $("view-" + x).classList.toggle("hide", x !== r); });
  var tabs = document.querySelectorAll(".tab");
  for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute("aria-selected", tabs[i].getAttribute("data-role") === r ? "true" : "false");
  ["warden", "guard"].forEach(function(x){
    $(x + "Lock").classList.toggle("hide", auth[x]);
    $(x + "Main").classList.toggle("hide", !auth[x]);
  });
  if (r !== "guard") stopScan();
  renderCurrent();
}

/* ============ camera scan ============ */
var scan = {stream:null, raf:0};
function stopScan(){
  if (scan.raf) cancelAnimationFrame(scan.raf);
  scan.raf = 0;
  if (scan.stream) { scan.stream.getTracks().forEach(function(t){ t.stop(); }); scan.stream = null; }
  $("scanBox").classList.add("hide");
}
function tick(){
  if (!scan.stream) return;
  var v = $("scanVideo");
  if (v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth) {
    var c = $("scanCanvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    var x = c.getContext("2d");
    x.drawImage(v, 0, 0, c.width, c.height);
    var img = x.getImageData(0, 0, c.width, c.height);
    var r = jsQR(img.data, img.width, img.height);
    if (r && r.data) {
      var m = String(r.data).toUpperCase().match(/GP-[A-Z0-9]{6}/);
      if (m) { stopScan(); $("codeInput").value = m[0]; showResult(m[0]); return; }
    }
  }
  scan.raf = requestAnimationFrame(tick);
}
function startScan(){
  if (typeof jsQR !== "function") { toast("Scanner could not load. Please type the code instead."); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast("Camera is not supported here. Type the code instead."); return; }
  navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}}).then(function(stream){
    scan.stream = stream;
    var v = $("scanVideo");
    v.srcObject = stream;
    v.play();
    $("scanBox").classList.remove("hide");
    tick();
  }).catch(function(){ toast("Camera permission was denied. Type the code instead."); });
}

/* ============ demo data ============ */
function seed(){
  var now = Date.now(), H = 3600000, list = Store.load();
  function iso(ms){ return toLocalInput(new Date(now + ms)); }
  function mk(name, roll, room, type, dest, reason, outOff, retOff, status, extra){
    var p = {
      id: "s" + Math.floor(Math.random() * 1e9).toString(36), code: genCode(list),
      student: {name:name, roll:roll, room:room, phone:"9876543210"},
      type:type, dest:dest, reason:reason, outTime:iso(outOff), returnTime:iso(retOff),
      status:status, note:"", createdAt:new Date(now + outOff - 2 * H).toISOString(),
      decidedAt:null, outAt:null, inAt:null
    };
    for (var k in extra) p[k] = extra[k];
    list.push(p);
  }
  mk("Ananya Singh", "2302EC018", "A-110", "Day outpass", "Connaught Place", "Buying books and stationery", H, 5 * H, "pending", {});
  mk("Karan Verma", "2301ME072", "C-305", "Night out", "Friend’s house, Dwarka", "Birthday dinner", 2 * H, 10 * H, "approved", {note:"Be back before 8 am.", decidedAt:new Date().toISOString()});
  mk("Rohan Mehta", "2301CS045", "B-214", "Day outpass", "Select Citywalk, Saket", "Movie with friends", -3 * H, 2 * H, "approved", {outAt:new Date(now - 3 * H).toISOString(), decidedAt:new Date(now - 4 * H).toISOString()});
  mk("Priya Nair", "2303CE009", "A-204", "Late return (after curfew)", "Hauz Khas", "Project meeting with team", -7 * H, -2 * H, "approved", {outAt:new Date(now - 7 * H).toISOString(), decidedAt:new Date(now - 8 * H).toISOString()});
  mk("Rohan Mehta", "2301CS045", "B-214", "Home leave", "Gurugram", "Weekend at home", -30 * H, -20 * H, "approved", {outAt:new Date(now - 30 * H).toISOString(), inAt:new Date(now - 19 * H).toISOString(), decidedAt:new Date(now - 40 * H).toISOString()});
  mk("Meera Joshi", "2302CS031", "A-118", "Night out", "Noida", "Cousin’s wedding", -50 * H, -40 * H, "rejected", {note:"Please apply with a parent’s consent letter.", decidedAt:new Date(now - 55 * H).toISOString()});
  Store.save(list);
}

/* ============ init ============ */
function setDefaultTimes(){
  var d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  $("rOut").value = toLocalInput(d);
  $("rReturn").value = toLocalInput(new Date(d.getTime() + 4 * 3600000));
}
function updateCurfewHint(){
  var v = $("rReturn").value, h = $("curfewHint");
  if (v && v.slice(11, 16) >= CONFIG.curfew) {
    h.textContent = "Your return time is after the " + CONFIG.curfew + " curfew. The warden will check this closely.";
    h.classList.remove("hide");
  } else h.classList.add("hide");
}
function showFormErr(msg){
  var e = $("formErr");
  e.textContent = msg;
  e.classList.toggle("hide", !msg);
}

function init(){
  var prof = Store.getProfile();
  if (prof) { $("pName").value = prof.name; $("pRoll").value = prof.roll; $("pRoom").value = prof.room; $("pPhone").value = prof.phone; }
  setDefaultTimes();
  updateCurfewHint();

  var tabs = document.querySelectorAll(".tab");
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener("click", function(){ setRole(this.getAttribute("data-role")); });
  }

  $("profileForm").addEventListener("submit", function(e){
    e.preventDefault();
    var phone = $("pPhone").value.replace(/\D/g, "");
    if (phone.length !== 10) { toast("Parent phone must be 10 digits."); return; }
    Store.setProfile({name:$("pName").value.trim(), roll:$("pRoll").value.trim().toUpperCase(), room:$("pRoom").value.trim().toUpperCase(), phone:phone});
    toast("Details saved.");
    renderStudent();
  });

  $("rReturn").addEventListener("input", updateCurfewHint);
  $("reqForm").addEventListener("submit", function(e){
    e.preventDefault();
    var st = Store.getProfile();
    if (!st) { showFormErr("Save your details first."); return; }
    var d = {type:$("rType").value, dest:$("rDest").value, reason:$("rReason").value, outTime:$("rOut").value, returnTime:$("rReturn").value};
    var err = validateRequest(d);
    if (err) { showFormErr(err); return; }
    showFormErr("");
    createPass(st, d);
    $("rDest").value = ""; $("rReason").value = "";
    setDefaultTimes(); updateCurfewHint();
    toast("Request sent to the warden.");
    renderStudent();
  });

  var locks = document.querySelectorAll("form.lock");
  for (var j = 0; j < locks.length; j++) {
    locks[j].addEventListener("submit", function(e){
      e.preventDefault();
      var who = this.getAttribute("data-lock"), inp = this.querySelector("input"), er = this.parentNode.querySelector(".err");
      var pin = who === "warden" ? CONFIG.wardenPin : CONFIG.guardPin;
      if (inp.value === pin) {
        auth[who] = true;
        try { sessionStorage.setItem("gp-auth-" + who, "1"); } catch (x) {}
        inp.value = ""; er.classList.add("hide");
        setRole(who);
      } else { er.textContent = "Wrong PIN. Try again."; er.classList.remove("hide"); }
    });
  }

  var chips = document.querySelectorAll(".chip-btn");
  for (var k = 0; k < chips.length; k++) {
    chips[k].addEventListener("click", function(){
      wardenFilter = this.getAttribute("data-filter");
      for (var m = 0; m < chips.length; m++) chips[m].classList.toggle("active", chips[m] === this);
      renderWarden();
    });
  }

  $("verifyForm").addEventListener("submit", function(e){ e.preventDefault(); showResult($("codeInput").value); });
  $("scanBtn").addEventListener("click", startScan);
  $("stopScan").addEventListener("click", stopScan);

  /* one click handler for every action button */
  document.addEventListener("click", function(e){
    var b = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!b) return;
    var act = b.getAttribute("data-act"), id = b.getAttribute("data-id"), code = b.getAttribute("data-code");
    if (act === "showqr") showQr(id);
    else if (act === "cancel") {
      if (confirm("Cancel this request?")) { Store.save(Store.load().filter(function(p){ return p.id !== id; })); toast("Request cancelled."); renderStudent(); }
    }
    else if (act === "approve" || act === "reject") {
      var n = $("note-" + id);
      decide(id, act === "approve", n ? n.value : "");
      toast(act === "approve" ? "Pass approved." : "Request rejected.");
      renderWarden();
    }
    else if (act === "markout" || act === "markin") {
      var r = act === "markout" ? markOut(code) : markIn(code);
      toast(r.msg);
      if (r.ok) { showResult(code); renderGuard(); }
    }
  });

  $("seedBtn").addEventListener("click", function(){ seed(); toast("Sample data loaded. Use roll 2301CS045 to see Rohan’s passes."); renderCurrent(); });
  $("resetBtn").addEventListener("click", function(){
    if (confirm("Delete all passes and saved details on this device?")) {
      Store.save([]); mem.profile = null;
      try { localStorage.removeItem(PKEY); } catch (e) {}
      ["pName", "pRoll", "pRoom", "pPhone"].forEach(function(f){ $(f).value = ""; });
      $("verifyResult").innerHTML = "";
      toast("All data cleared.");
      renderCurrent();
    }
  });

  setInterval(function(){ if (!document.hidden) renderCurrent(); }, 30000);
  setRole("student");
}

if (typeof window !== "undefined") {
  window.GatePassCore = {CONFIG:CONFIG, statusOf:statusOf, createPass:createPass, decide:decide, verifyCode:verifyCode,
    markOut:markOut, markIn:markIn, validateRequest:validateRequest, lateMinutes:lateMinutes, Store:Store, seed:seed};
}
init();
})();