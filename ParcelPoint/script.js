(function () {
"use strict";

/* ============ CONFIG (change for your college) ============ */
var CONFIG = {
  deskPin: "2468",
  agingDays: 3,     /* parcel is flagged "3+ days" */
  urgentDays: 7     /* parcel is flagged "return to sender soon" */
};
var PKEY = "parcelpoint-parcels-v1", EKEY = "parcelpoint-expected-v1", UKEY = "parcelpoint-profile-v1", DKEY = "parcelpoint-directory-v1";
var ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var COURIERS = ["Amazon", "Flipkart", "Myntra", "Meesho", "Delhivery", "Blue Dart", "India Post", "Other"];
var LABEL = {waiting:"Waiting", aging:"3+ days", urgent:"Return soon", collected:"Collected", returned:"Returned"};
var DAY = 86400000;

/* ============ helpers ============ */
function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function pad(n){ return (n < 10 ? "0" : "") + n; }
function fmt(s){
  var d = new Date(s);
  if (isNaN(d)) return "–";
  return d.toLocaleString("en-IN", {day:"numeric", month:"short", hour:"numeric", minute:"2-digit", hour12:true});
}
function sameDay(a, b){ return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
var toastTimer = 0;
function toast(msg){
  var t = $("toast");
  t.textContent = msg;
  t.classList.remove("hide");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.add("hide"); }, 3200);
}

/* ============ storage (swap these functions for Firebase/Supabase later) ============ */
var mem = {parcels:[], expected:[], profile:null, dir:{}};
function readKey(key, fallback){
  try { var raw = localStorage.getItem(key); if (raw) return JSON.parse(raw); } catch (e) {}
  return fallback;
}
function writeKey(key, val){ try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
var Store = {
  parcels: function(){ var a = readKey(PKEY, null); if (Array.isArray(a)) mem.parcels = a; return mem.parcels; },
  saveParcels: function(l){ mem.parcels = l; writeKey(PKEY, l); },
  expected: function(){ var a = readKey(EKEY, null); if (Array.isArray(a)) mem.expected = a; return mem.expected; },
  saveExpected: function(l){ mem.expected = l; writeKey(EKEY, l); },
  profile: function(){ var p = readKey(UKEY, null); if (p) mem.profile = p; return mem.profile; },
  saveProfile: function(p){
    mem.profile = p; writeKey(UKEY, p);
    var d = Store.directory(); d[p.roll] = p; mem.dir = d; writeKey(DKEY, d);
  },
  directory: function(){ var d = readKey(DKEY, null); if (d && typeof d === "object") mem.dir = d; return mem.dir; }
};

/* ============ core logic ============ */
function genCode(list){
  var c;
  do {
    c = "PK-";
    for (var i = 0; i < 5; i++) c += ALPHA.charAt(Math.floor(Math.random() * ALPHA.length));
  } while (list.some(function(p){ return p.code === c; }));
  return c;
}
function daysWaiting(p, now){
  return Math.max(0, Math.floor(((now || new Date()).getTime() - new Date(p.loggedAt).getTime()) / DAY));
}
function statusOf(p, now){
  if (p.status === "collected") return "collected";
  if (p.status === "returned") return "returned";
  var d = daysWaiting(p, now);
  if (d >= CONFIG.urgentDays) return "urgent";
  if (d >= CONFIG.agingDays) return "aging";
  return "waiting";
}
function isOpen(p){ return p.status === "waiting"; }
function suggestShelf(size, parcels){
  var pre = {Small:"S", Medium:"M", Large:"L"}[size] || "S";
  var n = parcels.filter(function(p){ return p.status === "waiting" && p.size === size; }).length + 1;
  return pre + "-" + pad(n);
}
function normRoll(r){ return String(r || "").trim().toUpperCase(); }
function validateLog(d){
  if (!normRoll(d.roll)) return "Enter the student’s roll number.";
  if (!d.name || d.name.trim().length < 2) return "Enter the student’s name.";
  if (COURIERS.indexOf(d.courier) < 0) return "Choose a courier.";
  if (!d.shelf || !d.shelf.trim()) return "Enter a shelf location.";
  var cod = Number(d.cod || 0);
  if (!isFinite(cod) || cod < 0 || cod > 100000) return "Cash on delivery must be between 0 and 100000.";
  if (d.phone && String(d.phone).replace(/\D/g, "").length !== 10) return "Phone must be 10 digits (or leave it empty).";
  return "";
}
function logParcel(d){
  var list = Store.parcels(), roll = normRoll(d.roll);
  var p = {
    id: "p" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    code: genCode(list),
    student: {name:d.name.trim(), roll:roll, room:(d.room || "").trim().toUpperCase(), phone:String(d.phone || "").replace(/\D/g, "")},
    courier: d.courier, awb: (d.awb || "").trim(), item: (d.item || "").trim(),
    size: d.size || "Small", fragile: !!d.fragile, cod: Math.round(Number(d.cod || 0)), shelf: d.shelf.trim().toUpperCase(),
    loggedAt: d.loggedAt || new Date().toISOString(), status: "waiting",
    collectedAt: null, collectedBy: "", authorizedName: ""
  };
  list.push(p);
  Store.saveParcels(list);
  /* match against something the student said they were expecting */
  var matched = false, ex = Store.expected();
  for (var i = 0; i < ex.length; i++) {
    if (!ex[i].arrived && ex[i].roll === roll && ex[i].courier === p.courier) {
      ex[i].arrived = true; ex[i].parcelId = p.id; matched = true; break;
    }
  }
  if (matched) Store.saveExpected(ex);
  return {parcel:p, matched:matched};
}
function byId(id){ return Store.parcels().filter(function(p){ return p.id === id; })[0]; }
function findByCode(code){
  code = String(code || "").trim().toUpperCase();
  return Store.parcels().filter(function(p){ return p.code === code; })[0];
}
function updateParcel(id, fn){
  var list = Store.parcels(), hit = null;
  list.forEach(function(p){ if (p.id === id) { fn(p); hit = p; } });
  Store.saveParcels(list);
  return hit;
}
function authorize(id, name){
  name = String(name || "").trim().slice(0, 40);
  return updateParcel(id, function(p){ if (p.status === "waiting") p.authorizedName = name; });
}
function handover(id, o, now){
  var p = byId(id);
  if (!p) return {ok:false, msg:"Parcel not found."};
  if (p.status !== "waiting") return {ok:false, msg:"This parcel is not waiting for pickup."};
  if (!o.verified) return {ok:false, msg:"Confirm that you checked the pickup code or ID card."};
  if (o.by === "authorized" && !p.authorizedName) return {ok:false, msg:"No friend is authorised for this parcel."};
  if (p.cod > 0 && !o.codOk) return {ok:false, msg:"Collect the cash on delivery amount first."};
  updateParcel(id, function(x){
    x.status = "collected";
    x.collectedAt = (now || new Date()).toISOString();
    x.collectedBy = o.by === "authorized" ? x.authorizedName + " (authorised)" : "Self";
  });
  return {ok:true, msg:"Handed over to " + (o.by === "authorized" ? p.authorizedName : p.student.name) + "."};
}
function returnToSender(id){
  var p = byId(id);
  if (!p || p.status !== "waiting") return {ok:false, msg:"Parcel is not waiting."};
  updateParcel(id, function(x){ x.status = "returned"; x.collectedAt = new Date().toISOString(); x.collectedBy = "Returned to sender"; });
  return {ok:true, msg:"Marked as returned to sender."};
}
function addExpected(profile, d){
  var list = Store.expected();
  var e = {id:"e" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), roll:profile.roll,
    courier:d.courier, item:(d.item || "").trim(), awb:(d.awb || "").trim(), createdAt:new Date().toISOString(), arrived:false, parcelId:""};
  list.push(e);
  Store.saveExpected(list);
  return e;
}
function waMessage(p){
  return "Hi " + p.student.name + ", your " + p.courier + " parcel has arrived at the hostel parcel desk. Pickup code: " + p.code +
    ". Shelf: " + p.shelf + "." + (p.cod > 0 ? " Please bring ₹" + p.cod + " cash (cash on delivery)." : "");
}
function waLink(p){
  var d = String(p.student.phone || "").replace(/\D/g, "");
  if (d.length === 10) d = "91" + d;
  if (d.length < 10) return "";
  return '<a class="btn ghost small" target="_blank" rel="noopener" href="https://wa.me/' + d + '?text=' + encodeURIComponent(waMessage(p)) + '">Notify on WhatsApp</a>';
}

/* ============ rendering ============ */
function empty(msg){ return '<div class="empty">' + msg + '</div>'; }
function title(p){ return p.item || (p.courier + " parcel"); }

function parcelCard(p, ctx){
  var st = statusOf(p), d = daysWaiting(p), open = isOpen(p);
  var h = '<article class="parcel ' + st + '"><div class="p-top"><div><span class="courier">' + esc(p.courier) + (p.awb ? ' · ' + esc(p.awb) : '') +
          '</span><h3>' + esc(title(p)) + '</h3></div><span class="chip ' + st + '">' + LABEL[st] + '</span></div>';
  if (ctx === "desk") h += '<p class="who"><b>' + esc(p.student.name) + '</b> · ' + esc(p.student.roll) + (p.student.room ? ' · Room ' + esc(p.student.room) : '') + '</p>';
  if (open && ctx === "student") {
    h += '<div class="label"><div><small>Pickup code</small><span class="code">' + esc(p.code) + '</span></div><div><small>Shelf</small><span class="shelf">' + esc(p.shelf) + '</span></div><div class="bars"></div></div>';
  }
  h += '<dl class="grid"><div><dt>Arrived</dt><dd>' + fmt(p.loggedAt) + '</dd></div>';
  if (open) h += '<div><dt>Waiting</dt><dd>' + d + (d === 1 ? ' day' : ' days') + '</dd></div>';
  if (ctx === "desk") h += '<div><dt>Code / shelf</dt><dd>' + esc(p.code) + ' · ' + esc(p.shelf) + '</dd></div>';
  h += '<div><dt>Size</dt><dd>' + esc(p.size) + '</dd></div>';
  if (!open) h += '<div><dt>' + (p.status === "returned" ? 'Returned' : 'Collected') + '</dt><dd>' + fmt(p.collectedAt) + '</dd></div><div><dt>By</dt><dd>' + esc(p.collectedBy) + '</dd></div>';
  h += '</dl>';
  var fl = "";
  if (p.fragile) fl += '<span class="flag">⚠ Fragile</span>';
  if (p.cod > 0) fl += '<span class="flag cod">💵 Pay ₹' + p.cod + ' on pickup</span>';
  if (open && p.authorizedName) fl += '<span class="flag auth">🤝 ' + esc(p.authorizedName) + ' can collect</span>';
  if (fl) h += '<div class="flags">' + fl + '</div>';
  if (open && st === "urgent") h += '<p class="warnline">' + (ctx === "student" ? 'Collect this soon. It may be sent back to the seller.' : 'Waiting ' + d + ' days. Consider returning to sender.') + '</p>';

  var acts = "";
  if (ctx === "student" && open) {
    if (p.authorizedName) {
      acts += '<button class="btn ghost small" data-act="unauth" data-id="' + p.id + '">Remove ' + esc(p.authorizedName) + '</button>';
    } else {
      acts += '<input id="auth-' + p.id + '" maxlength="40" placeholder="Friend allowed to collect (name)" aria-label="Friend name">' +
              '<button class="btn ghost small" data-act="auth" data-id="' + p.id + '">Allow friend</button>';
    }
  }
  if (ctx === "desk" && open) {
    acts += '<button class="btn good small" data-act="handover" data-id="' + p.id + '">Hand over</button>' + waLink(p);
    if (st === "urgent") acts += '<button class="btn danger small" data-act="rts" data-id="' + p.id + '">Return to sender</button>';
  }
  if (acts) h += '<div class="acts">' + acts + '</div>';
  return h + '</article>';
}

function expectedCard(e){
  var st = e.arrived ? "arrived" : "expected";
  return '<div class="card" style="margin:0"><div class="p-top"><div><span class="courier">' + esc(e.courier) + (e.awb ? ' · ' + esc(e.awb) : '') +
    '</span><h3>' + esc(e.item || "Parcel") + '</h3></div><span class="chip ' + st + '">' + (e.arrived ? "Arrived ✔" : "On the way") + '</span></div>' +
    (e.arrived ? '' : '<div class="acts"><button class="btn danger small" data-act="delexp" data-id="' + e.id + '">Remove</button></div>') + '</div>';
}

function renderStudent(){
  var prof = Store.profile();
  $("needProfile").classList.toggle("hide", !!prof);
  $("studentMain").classList.toggle("hide", !prof);
  var badge = $("badge");
  if (!prof) { badge.classList.add("hide"); return; }
  var mine = Store.parcels().filter(function(p){ return p.student.roll === prof.roll; })
    .sort(function(a, b){ return new Date(b.loggedAt) - new Date(a.loggedAt); });
  var waiting = mine.filter(isOpen), past = mine.filter(function(p){ return !isOpen(p); });
  badge.textContent = waiting.length;
  badge.classList.toggle("hide", waiting.length === 0);
  $("waitBanner").innerHTML = waiting.length
    ? '<div class="banner">📦 ' + waiting.length + (waiting.length === 1 ? ' parcel is' : ' parcels are') + ' waiting for you at the gate</div>'
    : '<div class="banner none">No parcels waiting right now.</div>';
  $("waitList").innerHTML = waiting.length ? waiting.map(function(p){ return parcelCard(p, "student"); }).join("") : empty("Nothing to collect. We will alert you when something arrives.");
  var ex = Store.expected().filter(function(e){ return e.roll === prof.roll; })
    .sort(function(a, b){ return new Date(b.createdAt) - new Date(a.createdAt); });
  $("expList").innerHTML = ex.map(expectedCard).join("");
  $("pastList").innerHTML = past.length ? past.map(function(p){ return parcelCard(p, "student"); }).join("") : empty("No past parcels yet.");
}

var filter = "waiting";
function matches(p, q){
  if (!q) return true;
  q = q.toLowerCase();
  return [p.student.name, p.student.roll, p.student.room, p.code, p.courier, p.awb, p.item, p.shelf].join(" ").toLowerCase().indexOf(q) >= 0;
}
function renderDesk(){
  var all = Store.parcels(), now = new Date();
  var waiting = all.filter(isOpen);
  $("sWait").textContent = waiting.length;
  $("sAging").textContent = waiting.filter(function(p){ var s = statusOf(p); return s === "aging" || s === "urgent"; }).length;
  $("sToday").textContent = all.filter(function(p){ return p.status === "collected" && p.collectedAt && sameDay(new Date(p.collectedAt), now); }).length;

  var dl = $("rollList"), dir = Store.directory(), opts = "";
  Object.keys(dir).forEach(function(r){ opts += '<option value="' + esc(r) + '">' + esc(dir[r].name) + '</option>'; });
  dl.innerHTML = opts;

  var q = $("search").value.trim(), list;
  if (filter === "waiting") list = waiting.sort(function(a, b){ return new Date(a.loggedAt) - new Date(b.loggedAt); });
  else if (filter === "aging") list = waiting.filter(function(p){ var s = statusOf(p); return s === "aging" || s === "urgent"; }).sort(function(a, b){ return new Date(a.loggedAt) - new Date(b.loggedAt); });
  else list = all.filter(function(p){ return !isOpen(p); }).sort(function(a, b){ return new Date(b.collectedAt) - new Date(a.collectedAt); });
  list = list.filter(function(p){ return matches(p, q); });
  var msgs = {waiting:"No parcels waiting. All clear.", aging:"No old parcels. Nice and tidy.", done:"Nothing collected yet."};
  $("deskList").innerHTML = list.length ? list.map(function(p){ return parcelCard(p, "desk"); }).join("") : empty(q ? "No parcels match your search." : msgs[filter]);
}

/* ============ handover dialog ============ */
var hoId = "";
function openHandover(id){
  var p = byId(id);
  if (!p) return;
  hoId = id;
  var h = '<h2>Hand over parcel</h2><p><b>' + esc(title(p)) + '</b> · ' + esc(p.courier) + '<br>For ' + esc(p.student.name) + ' · ' + esc(p.student.roll) + ' · Shelf ' + esc(p.shelf) + '</p>';
  h += '<div class="opts"><label><input type="radio" name="hoby" id="hoSelf" checked> Student collects it themselves</label>';
  if (p.authorizedName) h += '<label><input type="radio" name="hoby" id="hoAuth"> ' + esc(p.authorizedName) + ' (authorised by student)</label>';
  h += '<label><input type="checkbox" id="hoVer"> I checked the pickup code or ID card</label>';
  if (p.cod > 0) h += '<label><input type="checkbox" id="hoCod"> I received ₹' + p.cod + ' cash on delivery</label>';
  h += '</div><div class="dlg-acts"><button class="btn ghost" data-act="closeho" type="button">Cancel</button><button class="btn good" data-act="confirmho" type="button">Confirm handover</button></div>';
  $("hoBody").innerHTML = h;
  var d = $("hoDialog");
  if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
}
function closeHandover(){
  var d = $("hoDialog");
  if (typeof d.close === "function") d.close(); else d.removeAttribute("open");
  hoId = "";
}

/* ============ roles ============ */
var role = "student", deskAuth = false;
try { if (sessionStorage.getItem("pp-desk") === "1") deskAuth = true; } catch (e) {}

function renderCurrent(){
  renderStudent();
  if (deskAuth) renderDesk();
}
function setRole(r){
  role = r;
  $("view-student").classList.toggle("hide", r !== "student");
  $("view-desk").classList.toggle("hide", r !== "desk");
  var tabs = document.querySelectorAll(".tab");
  for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute("aria-selected", tabs[i].getAttribute("data-role") === r ? "true" : "false");
  $("deskLock").classList.toggle("hide", deskAuth);
  $("deskMain").classList.toggle("hide", !deskAuth);
  renderCurrent();
}

/* ============ demo data ============ */
function seed(){
  var now = Date.now(), parcels = Store.parcels(), dir = Store.directory();
  var people = [
    {name:"Rohan Mehta", roll:"2301CS045", room:"B-214", phone:"9876543210"},
    {name:"Ananya Singh", roll:"2302EC018", room:"A-110", phone:"9876500011"},
    {name:"Karan Verma", roll:"2301ME072", room:"C-305", phone:"9876500022"}
  ];
  people.forEach(function(p){ dir[p.roll] = p; });
  Store.directory(); writeKey(DKEY, dir); mem.dir = dir;
  function mk(pi, courier, item, size, shelf, cod, fragile, daysAgo, status, extra){
    var p = {id:"s" + Math.floor(Math.random() * 1e9).toString(36), code:genCode(parcels),
      student:people[pi], courier:courier, awb:"", item:item, size:size, fragile:fragile, cod:cod, shelf:shelf,
      loggedAt:new Date(now - daysAgo * DAY).toISOString(), status:status, collectedAt:null, collectedBy:"", authorizedName:""};
    for (var k in extra) p[k] = extra[k];
    parcels.push(p);
  }
  mk(0, "Amazon", "Headphones", "Small", "S-01", 0, true, 0, "waiting", {});
  mk(0, "Flipkart", "Study table lamp", "Medium", "M-01", 599, false, 4, "waiting", {});
  mk(1, "Myntra", "Clothes", "Small", "S-02", 0, false, 1, "waiting", {authorizedName:"Meera Joshi"});
  mk(2, "Delhivery", "Cricket kit", "Large", "L-01", 0, false, 8, "waiting", {});
  mk(0, "Meesho", "Phone cover", "Small", "S-03", 0, false, 6, "collected", {collectedAt:new Date(now - 5 * DAY).toISOString(), collectedBy:"Self"});
  mk(1, "Amazon", "Books", "Medium", "M-02", 0, false, 0, "collected", {collectedAt:new Date(now - 3600000).toISOString(), collectedBy:"Self"});
  Store.saveParcels(parcels);
}

/* ============ init ============ */
function fillCouriers(sel){
  COURIERS.forEach(function(c){ var o = document.createElement("option"); o.textContent = c; sel.appendChild(o); });
}
var shelfTouched = false;
function autoShelf(){
  if (!shelfTouched) $("lShelf").value = suggestShelf($("lSize").value, Store.parcels());
}
function showLogErr(msg){
  var e = $("logErr"); e.textContent = msg; e.classList.toggle("hide", !msg);
}

function init(){
  fillCouriers($("eCourier")); fillCouriers($("lCourier"));
  var prof = Store.profile();
  if (prof) { $("pName").value = prof.name; $("pRoll").value = prof.roll; $("pRoom").value = prof.room; $("pPhone").value = prof.phone; }

  var tabs = document.querySelectorAll(".tab");
  for (var i = 0; i < tabs.length; i++) tabs[i].addEventListener("click", function(){ setRole(this.getAttribute("data-role")); });

  $("profileForm").addEventListener("submit", function(e){
    e.preventDefault();
    var phone = $("pPhone").value.replace(/\D/g, "");
    if (phone.length !== 10) { toast("Phone must be 10 digits."); return; }
    Store.saveProfile({name:$("pName").value.trim(), roll:normRoll($("pRoll").value), room:$("pRoom").value.trim().toUpperCase(), phone:phone});
    toast("Details saved.");
    renderCurrent();
  });

  $("expForm").addEventListener("submit", function(e){
    e.preventDefault();
    var pr = Store.profile();
    if (!pr) { toast("Save your details first."); return; }
    addExpected(pr, {courier:$("eCourier").value, item:$("eItem").value, awb:$("eAwb").value});
    $("eItem").value = ""; $("eAwb").value = "";
    toast("Added. We will match it when it arrives.");
    renderStudent();
  });

  $("lockForm").addEventListener("submit", function(e){
    e.preventDefault();
    if ($("pinInput").value === CONFIG.deskPin) {
      deskAuth = true;
      try { sessionStorage.setItem("pp-desk", "1"); } catch (x) {}
      $("pinInput").value = ""; $("lockErr").classList.add("hide");
      setRole("desk"); autoShelf();
    } else { $("lockErr").textContent = "Wrong PIN. Try again."; $("lockErr").classList.remove("hide"); }
  });

  /* desk: autofill from directory, auto shelf */
  $("lRoll").addEventListener("input", function(){
    var s = Store.directory()[normRoll(this.value)];
    if (s) { $("lName").value = s.name; $("lRoom").value = s.room; $("lPhone").value = s.phone; }
  });
  $("lSize").addEventListener("change", function(){ shelfTouched = false; autoShelf(); });
  $("lShelf").addEventListener("input", function(){ shelfTouched = true; });

  $("logForm").addEventListener("submit", function(e){
    e.preventDefault();
    var d = {roll:$("lRoll").value, name:$("lName").value, room:$("lRoom").value, phone:$("lPhone").value, courier:$("lCourier").value,
      size:$("lSize").value, item:$("lItem").value, awb:$("lAwb").value, shelf:$("lShelf").value, cod:$("lCod").value, fragile:$("lFragile").checked};
    var err = validateLog(d);
    if (err) { showLogErr(err); return; }
    showLogErr("");
    var r = logParcel(d), p = r.parcel;
    $("logResult").innerHTML = '<div class="result"><p><b>Parcel logged for ' + esc(p.student.name) + '.</b>' +
      (r.matched ? ' Matched with what the student was expecting.' : '') + '</p>' +
      '<p>Pickup code <span class="code">' + esc(p.code) + '</span></p><p>Put it on shelf <b>' + esc(p.shelf) + '</b>.</p>' + (waLink(p) || '<p class="hint">Add a phone number to send a WhatsApp alert.</p>') + '</div>';
    ["lRoll", "lName", "lRoom", "lPhone", "lItem", "lAwb"].forEach(function(f){ $(f).value = ""; });
    $("lCod").value = "0"; $("lFragile").checked = false; shelfTouched = false; autoShelf();
    toast("Parcel logged.");
    renderDesk();
  });

  $("codeForm").addEventListener("submit", function(e){
    e.preventDefault();
    var p = findByCode($("codeInput").value);
    if (!p) { toast("No parcel with that code."); return; }
    if (!isOpen(p)) { toast("Already " + (p.status === "returned" ? "returned" : "collected") + " on " + fmt(p.collectedAt) + "."); return; }
    $("codeInput").value = "";
    openHandover(p.id);
  });

  var chips = document.querySelectorAll(".chip-btn");
  for (var k = 0; k < chips.length; k++) {
    chips[k].addEventListener("click", function(){
      filter = this.getAttribute("data-filter");
      for (var m = 0; m < chips.length; m++) chips[m].classList.toggle("active", chips[m] === this);
      renderDesk();
    });
  }
  $("search").addEventListener("input", renderDesk);

  document.addEventListener("click", function(e){
    var b = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!b) return;
    var act = b.getAttribute("data-act"), id = b.getAttribute("data-id");
    if (act === "auth") {
      var inp = $("auth-" + id), name = inp ? inp.value.trim() : "";
      if (name.length < 2) { toast("Type your friend’s name."); return; }
      authorize(id, name); toast(name + " can now collect this parcel."); renderStudent();
    } else if (act === "unauth") { authorize(id, ""); toast("Friend removed."); renderStudent(); }
    else if (act === "delexp") { Store.saveExpected(Store.expected().filter(function(x){ return x.id !== id; })); renderStudent(); }
    else if (act === "handover") openHandover(id);
    else if (act === "closeho") closeHandover();
    else if (act === "confirmho") {
      var by = ($("hoAuth") && $("hoAuth").checked) ? "authorized" : "self";
      var r = handover(hoId, {by:by, verified:$("hoVer").checked, codOk:$("hoCod") ? $("hoCod").checked : false});
      toast(r.msg);
      if (r.ok) { closeHandover(); renderDesk(); }
    }
    else if (act === "rts") {
      if (confirm("Mark this parcel as returned to sender?")) { toast(returnToSender(id).msg); renderDesk(); }
    }
  });

  $("seedBtn").addEventListener("click", function(){ seed(); toast("Sample data loaded. Save details with roll 2301CS045 to see Rohan’s parcels."); renderCurrent(); autoShelf(); });
  $("resetBtn").addEventListener("click", function(){
    if (confirm("Delete all parcels, expected items and saved details on this device?")) {
      Store.saveParcels([]); Store.saveExpected([]); mem.profile = null; mem.dir = {};
      try { localStorage.removeItem(UKEY); localStorage.removeItem(DKEY); } catch (e) {}
      ["pName", "pRoll", "pRoom", "pPhone"].forEach(function(f){ $(f).value = ""; });
      $("logResult").innerHTML = "";
      toast("All data cleared.");
      renderCurrent();
    }
  });

  setInterval(function(){ if (!document.hidden) renderCurrent(); }, 60000);
  setRole("student");
  if (deskAuth) autoShelf();
}

if (typeof window !== "undefined") {
  window.ParcelCore = {CONFIG:CONFIG, statusOf:statusOf, logParcel:logParcel, validateLog:validateLog, handover:handover, authorize:authorize,
    returnToSender:returnToSender, addExpected:addExpected, findByCode:findByCode, suggestShelf:suggestShelf, daysWaiting:daysWaiting,
    waLink:waLink, Store:Store, seed:seed};
}
init();
})();