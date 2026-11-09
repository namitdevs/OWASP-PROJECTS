(function () {
"use strict";

/* ============ CONFIG (change for your college) ============ */
var CONFIG = {
  wardenPin: "8642",
  hostels: ["Boys Hostel A", "Boys Hostel B", "Girls Hostel A", "Girls Hostel B"],
  blocks: ["A", "B", "C", "D"],
  floors: [1, 2, 3, 4, 5]
};
var REASONS = ["Roommate conflict", "Too noisy", "Far from mess / classes", "Want to be near friends", "Medical / ground floor", "Other"];
var TYPES = ["Non-AC", "AC"];
var UKEY = "roomswap-users-v1", RKEY = "roomswap-requests-v1", PKEY = "roomswap-proposals-v1", AKEY = "roomswap-active-v1";

/* ============ helpers ============ */
function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function normRoll(r){ return String(r || "").trim().toUpperCase(); }
function initials(n){
  var p = String(n).trim().split(/\s+/);
  return ((p[0] || "?").charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : "")).toUpperCase();
}
function hue(s){ var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
function fmt(s){
  var d = new Date(s);
  if (isNaN(d)) return "–";
  return d.toLocaleString("en-IN", {day:"numeric", month:"short", hour:"numeric", minute:"2-digit", hour12:true});
}
function uid(p){ return p + Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36); }
var toastTimer = 0;
function toast(msg){
  var t = $("toast");
  t.textContent = msg;
  t.classList.remove("hide");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.add("hide"); }, 3200);
}

/* ============ storage (swap these functions for Firebase/Supabase later) ============ */
var mem = {users:[], reqs:[], props:[], active:""};
function readKey(key, fallback){
  try { var raw = localStorage.getItem(key); if (raw) return JSON.parse(raw); } catch (e) {}
  return fallback;
}
function writeKey(key, val){ try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
var Store = {
  users: function(){ var a = readKey(UKEY, null); if (Array.isArray(a)) mem.users = a; return mem.users; },
  saveUsers: function(l){ mem.users = l; writeKey(UKEY, l); },
  reqs: function(){ var a = readKey(RKEY, null); if (Array.isArray(a)) mem.reqs = a; return mem.reqs; },
  saveReqs: function(l){ mem.reqs = l; writeKey(RKEY, l); },
  props: function(){ var a = readKey(PKEY, null); if (Array.isArray(a)) mem.props = a; return mem.props; },
  saveProps: function(l){ mem.props = l; writeKey(PKEY, l); },
  active: function(){ var a = readKey(AKEY, null); if (typeof a === "string") mem.active = a; return mem.active; },
  setActive: function(r){ mem.active = r; writeKey(AKEY, r); }
};
function getUser(roll){ roll = normRoll(roll); return Store.users().filter(function(u){ return u.roll === roll; })[0]; }
function getReq(id){ return Store.reqs().filter(function(r){ return r.id === id; })[0]; }
function getProp(id){ return Store.props().filter(function(p){ return p.id === id; })[0]; }
function myReq(roll){
  roll = normRoll(roll);
  var list = Store.reqs().filter(function(r){ return r.roll === roll; }).sort(function(a, b){ return new Date(b.createdAt) - new Date(a.createdAt); });
  return list[0];
}

/* ============ rooms and wishes ============ */
function parseCode(c){
  var m = /^([A-Z])-?([1-9]\d{2})$/.exec(String(c || "").trim().toUpperCase());
  if (!m || CONFIG.blocks.indexOf(m[1]) < 0) return null;
  return {block:m[1], num:m[2], floor:parseInt(m[2].charAt(0), 10), code:m[1] + "-" + m[2]};
}
/* does `room` fit what the student wants? */
function satisfies(want, room, ownCode){
  if (room.code === ownCode) return false;
  if (want.room) return room.code === want.room;
  var bOk = !want.blocks.length || want.blocks.indexOf(room.block) >= 0;
  var fOk = !want.floors.length || want.floors.indexOf(room.floor) >= 0;
  return bOk && fOk;
}
function wantText(w){
  if (w.room) return "Room " + w.room;
  return (w.blocks.length ? "Block " + w.blocks.join("/") : "Any block") + ", " + (w.floors.length ? "floor " + w.floors.join("/") : "any floor");
}
function validateRequest(d){
  var cur = parseCode(d.block + "-" + d.num);
  if (!cur) return "Enter a valid 3-digit room number, like 214 (first digit is the floor, 1 to 9).";
  if (TYPES.indexOf(d.type) < 0) return "Choose your room type.";
  if (REASONS.indexOf(d.reason) < 0) return "Choose a reason.";
  var wr = String(d.wantRoom || "").trim();
  if (wr) {
    var p = parseCode(wr);
    if (!p) return "The exact room you want should look like A-105.";
    if (p.code === cur.code) return "You already live in that room.";
  } else if (!(d.wantBlocks || []).length && !(d.wantFloors || []).length) {
    return "Choose at least one block, one floor, or an exact room you want.";
  }
  return "";
}
function createRequest(user, d){
  var ex = myReq(user.roll);
  if (ex && (ex.status === "open" || ex.status === "proposed")) return {ok:false, msg:"You already have an active request."};
  var err = validateRequest(d);
  if (err) return {ok:false, msg:err};
  var wr = parseCode(d.wantRoom);
  var r = {id:uid("r"), roll:user.roll, name:user.name, hostel:user.hostel, type:d.type, cur:parseCode(d.block + "-" + d.num),
    want:{blocks:(d.wantBlocks || []).slice(), floors:(d.wantFloors || []).map(Number), room:wr ? wr.code : ""},
    reason:d.reason, note:(d.note || "").trim(), status:"open", createdAt:new Date().toISOString(), doneAt:null};
  var list = Store.reqs(); list.push(r); Store.saveReqs(list);
  return {ok:true, req:r};
}
function cancelRequest(id){
  var list = Store.reqs(), hit = false;
  list.forEach(function(r){ if (r.id === id && r.status === "open") { r.status = "cancelled"; hit = true; } });
  Store.saveReqs(list);
  return hit;
}
/* how many other open students would take my room? */
function demandFor(r){
  return Store.reqs().filter(function(o){
    return o.status === "open" && o.id !== r.id && o.hostel === r.hostel && o.type === r.type && satisfies(o.want, r.cur, o.cur.code);
  }).length;
}

/* ============ swap finder (2-way and 3-way cycles) ============ */
function openReqs(){ return Store.reqs().filter(function(r){ return r.status === "open"; }); }
function edge(a, b){
  return a.roll !== b.roll && a.hostel === b.hostel && a.type === b.type && satisfies(a.want, b.cur, a.cur.code);
}
function mkCycle(members){
  var n = members.length, exact = 0, oldest = members[0].createdAt;
  var moves = members.map(function(m, i){
    var to = members[(i + 1) % n].cur.code;
    if (m.want.room === to) exact++;
    if (m.createdAt < oldest) oldest = m.createdAt;
    return {req:m, to:to};
  });
  return {size:n, moves:moves, exact:exact, oldest:oldest, ids:members.map(function(m){ return m.id; })};
}
function findCycles(list){
  var L = list || openReqs(), out = [], seen = {}, i, j, k;
  for (i = 0; i < L.length; i++) for (j = 0; j < L.length; j++) {
    if (i === j || !edge(L[i], L[j])) continue;
    if (edge(L[j], L[i])) {
      var k2 = [L[i].id, L[j].id].sort().join("|");
      if (!seen[k2]) { seen[k2] = 1; out.push(mkCycle([L[i], L[j]])); }
    }
    for (k = 0; k < L.length; k++) {
      if (k === i || k === j || !edge(L[j], L[k]) || !edge(L[k], L[i])) continue;
      var m3 = [L[i], L[j], L[k]], minId = m3.map(function(x){ return x.id; }).sort()[0], s = 0;
      while (m3[s].id !== minId) s++;
      m3 = m3.slice(s).concat(m3.slice(0, s));
      var key = m3.map(function(x){ return x.id; }).join("|");
      if (!seen[key]) { seen[key] = 1; out.push(mkCycle(m3)); }
    }
  }
  out.sort(function(a, b){
    if (a.size !== b.size) return a.size - b.size;
    if (a.exact !== b.exact) return b.exact - a.exact;
    return new Date(a.oldest) - new Date(b.oldest);
  });
  return out;
}
function cyclesFor(roll){
  roll = normRoll(roll);
  return findCycles().filter(function(c){ return c.moves.some(function(m){ return m.req.roll === roll; }); });
}

/* ============ proposals ============ */
function release(prop){
  var rs = Store.reqs();
  prop.members.forEach(function(m){ rs.forEach(function(r){ if (r.id === m.reqId && r.status === "proposed") r.status = "open"; }); });
  Store.saveReqs(rs);
}
function propose(ids, proposerRoll){
  proposerRoll = normRoll(proposerRoll);
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 3) return {ok:false, msg:"A swap needs 2 or 3 students."};
  var reqs = ids.map(getReq);
  if (reqs.some(function(r){ return !r || r.status !== "open"; })) return {ok:false, msg:"One of these requests is no longer open."};
  for (var i = 0; i < reqs.length; i++) if (!edge(reqs[i], reqs[(i + 1) % reqs.length])) return {ok:false, msg:"This swap no longer works."};
  if (!reqs.some(function(r){ return r.roll === proposerRoll; })) return {ok:false, msg:"You are not part of this swap."};
  var p = {id:uid("p"), status:"awaiting", createdAt:new Date().toISOString(), proposer:proposerRoll, decidedAt:null, note:"", hostel:reqs[0].hostel,
    members:reqs.map(function(r, i){
      return {reqId:r.id, roll:r.roll, name:r.name, from:r.cur.code, to:reqs[(i + 1) % reqs.length].cur.code, consent: r.roll === proposerRoll ? "agreed" : "pending"};
    })};
  var rs = Store.reqs();
  rs.forEach(function(r){ if (ids.indexOf(r.id) >= 0) r.status = "proposed"; });
  Store.saveReqs(rs);
  var ps = Store.props(); ps.push(p); Store.saveProps(ps);
  return {ok:true, prop:p, msg:"Proposal sent. Waiting for the other student" + (ids.length > 2 ? "s" : "") + " to agree."};
}
function respond(propId, roll, agree){
  roll = normRoll(roll);
  var ps = Store.props(), p = ps.filter(function(x){ return x.id === propId; })[0];
  if (!p || p.status !== "awaiting") return {ok:false, msg:"This proposal is no longer open."};
  var m = p.members.filter(function(x){ return x.roll === roll; })[0];
  if (!m || m.consent !== "pending") return {ok:false, msg:"Nothing to answer here."};
  if (agree) {
    m.consent = "agreed";
    if (p.members.every(function(x){ return x.consent === "agreed"; })) p.status = "ready";
    Store.saveProps(ps);
    return {ok:true, msg: p.status === "ready" ? "Everyone agreed. Sent to the warden." : "You agreed. Waiting for the others."};
  }
  m.consent = "declined"; p.status = "declined"; p.decidedAt = new Date().toISOString();
  Store.saveProps(ps); release(p);
  return {ok:true, msg:"Declined. The others can look for another swap."};
}
function cancelProposal(propId, roll){
  var ps = Store.props(), p = ps.filter(function(x){ return x.id === propId; })[0];
  if (!p || (p.status !== "awaiting" && p.status !== "ready")) return {ok:false, msg:"This proposal can’t be cancelled."};
  if (p.proposer !== normRoll(roll)) return {ok:false, msg:"Only the student who proposed it can cancel."};
  p.status = "cancelled"; p.decidedAt = new Date().toISOString();
  Store.saveProps(ps); release(p);
  return {ok:true, msg:"Proposal cancelled."};
}
function wardenDecide(propId, approve, note){
  var ps = Store.props(), p = ps.filter(function(x){ return x.id === propId; })[0];
  if (!p || p.status !== "ready") return {ok:false, msg:"This proposal is not waiting for approval."};
  var rs = Store.reqs();
  if (approve) {
    var stale = p.members.some(function(m){
      var r = rs.filter(function(x){ return x.id === m.reqId; })[0];
      return !r || r.status !== "proposed" || r.cur.code !== m.from;
    });
    if (stale) { p.status = "rejected"; p.note = "Rooms changed before approval."; Store.saveProps(ps); release(p); return {ok:false, msg:"Rooms changed since the proposal. It was closed."}; }
    p.members.forEach(function(m){
      rs.forEach(function(r){ if (r.id === m.reqId) { r.cur = parseCode(m.to); r.status = "done"; r.doneAt = new Date().toISOString(); } });
    });
    Store.saveReqs(rs);
    p.status = "approved";
  } else { p.status = "rejected"; release(p); }
  p.note = String(note || "").trim().slice(0, 100); p.decidedAt = new Date().toISOString();
  Store.saveProps(ps);
  return {ok:true, msg: approve ? "Approved. Rooms updated." : "Rejected. Students can try again."};
}
function csvCell(v){ return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }
function makeCsv(){
  var rows = [["Date", "Hostel", "Student", "Roll", "From room", "To room", "Proposal"]];
  Store.props().filter(function(p){ return p.status === "approved"; }).forEach(function(p){
    p.members.forEach(function(m){ rows.push([p.decidedAt, p.hostel, m.name, m.roll, m.from, m.to, p.id]); });
  });
  return rows.map(function(r){ return r.map(csvCell).join(","); }).join("\r\n");
}

/* ============ rendering ============ */
function empty(msg){ return '<div class="empty">' + msg + '</div>'; }
function roomChip(c){ return '<span class="room">' + esc(c) + '</span>'; }
function moveLine(name, from, to, isMe, consent){
  var tag = consent === "agreed" ? '<span class="consent agreed">✓ Agreed</span>' : consent === "declined" ? '<span class="consent declined">✗ Declined</span>' :
            consent === "pending" ? '<span class="consent">⏳ Waiting</span>' : "";
  return '<li class="' + (isMe ? "me" : "") + '"><b>' + esc(isMe ? "You" : name) + '</b>' + roomChip(from) + '<span class="arrow">→</span>' + roomChip(to) + tag + '</li>';
}

function chainCard(c, myRoll){
  var h = '<article class="chain"><div class="ctop"><span class="chip k' + c.size + '">' + c.size + '-way swap</span>';
  h += '<span class="meta">' + (c.exact ? c.exact + ' exact-room match' + (c.exact > 1 ? 'es' : '') + ' · ' : '') + 'oldest request ' + fmt(c.oldest) + '</span></div><ul class="moves">';
  c.moves.forEach(function(m){ h += moveLine(m.req.name, m.req.cur.code, m.to, m.req.roll === myRoll, ""); });
  return h + '</ul><button class="btn primary" data-act="propose" data-ids="' + esc(c.ids.join(",")) + '">Propose this swap</button></article>';
}
var PSTAT = {awaiting:"Waiting for students", ready:"With the warden", approved:"Approved", rejected:"Rejected", declined:"Declined", cancelled:"Cancelled"};
function propCard(p, myRoll, ctx){
  var h = '<article class="chain"><div class="ctop"><span class="chip k' + p.members.length + '">' + p.members.length + '-way swap</span><span class="chip ' + p.status + '">' + PSTAT[p.status] + '</span>' +
          '<span class="meta">' + esc(p.hostel) + ' · ' + fmt(p.createdAt) + '</span></div><ul class="moves">';
  p.members.forEach(function(m){ h += moveLine(m.name, m.from, m.to, m.roll === myRoll, p.status === "awaiting" || p.status === "declined" ? m.consent : ""); });
  h += '</ul>';
  if (p.note) h += '<p class="hint"><b>Warden:</b> ' + esc(p.note) + '</p>';
  var a = "";
  if (ctx === "student") {
    var me = p.members.filter(function(m){ return m.roll === myRoll; })[0];
    if (p.status === "awaiting" && me && me.consent === "pending") a += '<button class="btn good" data-act="agree" data-id="' + p.id + '">Agree to swap</button><button class="btn danger" data-act="decline" data-id="' + p.id + '">Decline</button>';
    if ((p.status === "awaiting" || p.status === "ready") && p.proposer === myRoll) a += '<button class="btn ghost small" data-act="cancelprop" data-id="' + p.id + '">Cancel proposal</button>';
  } else if (ctx === "warden" && p.status === "ready") {
    a += '<input id="wnote-' + p.id + '" maxlength="100" placeholder="Note (optional)" aria-label="Note"><button class="btn good" data-act="wapprove" data-id="' + p.id + '">Approve &amp; update rooms</button><button class="btn danger" data-act="wreject" data-id="' + p.id + '">Reject</button>';
  }
  if (a) h += '<div class="acts">' + a + '</div>';
  return h + '</article>';
}

var wantNew = false;
function renderStudent(){
  var me = getUser(Store.active()), users = Store.users();
  $("signSel").innerHTML = '<option value="">Choose your name…</option>' + users.map(function(u){
    return '<option value="' + esc(u.roll) + '">' + esc(u.name) + ' (' + esc(u.roll) + ')</option>'; }).join("");
  $("signin").classList.toggle("hide", !!me);
  $("dash").classList.toggle("hide", !me);
  if (!me) return;

  $("meCard").innerHTML = '<div class="card me"><span class="avatar" style="--h:' + hue(me.roll) + '">' + esc(initials(me.name)) + '</span><div class="info"><h2>' + esc(me.name) +
    '</h2><p>' + esc(me.roll) + ' · ' + esc(me.hostel) + '</p></div><button class="btn ghost small" data-act="signout">Switch student</button></div>';

  var r = myReq(me.roll), active = r && (r.status === "open" || r.status === "proposed");
  $("reqForm").classList.toggle("hide", !!active || (r && r.status === "done" && !wantNew));
  var box = "";
  if (r && r.status === "done" && !wantNew) {
    box = '<div class="card req"><div class="top"><h2>Room changed ✔</h2><span class="chip done">Done</span></div><p>You are now in ' + roomChip(r.cur.code) + ' (' + fmt(r.doneAt) + ').</p>' +
          '<div class="acts"><button class="btn ghost small" data-act="newreq">Post a new request</button></div></div>';
  } else if (active) {
    var dem = r.status === "open" ? demandFor(r) : 0;
    box = '<div class="card req"><div class="top"><div><h2>Your request</h2></div><span class="chip ' + r.status + '">' + (r.status === "open" ? "Looking for a swap" : "Swap in progress") + '</span></div>' +
      '<p>You are in ' + roomChip(r.cur.code) + ' <small>(' + esc(r.type) + ')</small> and want <b>' + esc(wantText(r.want)) + '</b>.</p><p class="hint">Reason: ' + esc(r.reason) + (r.note ? ' · “' + esc(r.note) + '”' : '') + '</p>' +
      (dem ? '<p class="demand">🔥 ' + dem + ' other student' + (dem > 1 ? 's want' : ' wants') + ' a room like yours.</p>' : '') +
      (r.status === "open" ? '<div class="acts"><button class="btn danger small" data-act="cancelreq" data-id="' + r.id + '">Cancel request</button></div>' : '') + '</div>';
  }
  $("myReq").innerHTML = box;

  var showOpts = r && r.status === "open";
  $("optionsBox").classList.toggle("hide", !showOpts);
  if (showOpts) {
    var cs = cyclesFor(me.roll);
    $("options").innerHTML = cs.length ? cs.map(function(c){ return chainCard(c, me.roll); }).join("")
      : empty("No swap yet. Students are matched when someone wants your room <i>and</i> you want theirs. Widen your wish list or check back soon.");
  }
  var ps = Store.props().filter(function(p){ return p.members.some(function(m){ return m.roll === me.roll; }); })
    .sort(function(a, b){ return new Date(b.createdAt) - new Date(a.createdAt); });
  $("props").innerHTML = ps.length ? ps.map(function(p){ return propCard(p, me.roll, "student"); }).join("") : empty("No proposals yet.");
}

function renderWarden(){
  var rs = Store.reqs(), ps = Store.props();
  var ready = ps.filter(function(p){ return p.status === "ready"; }), done = ps.filter(function(p){ return p.status === "approved"; });
  var open = rs.filter(function(r){ return r.status === "open"; });
  $("sOpen").textContent = open.length;
  $("sFound").textContent = findCycles().length;
  $("sReady").textContent = ready.length;
  $("sDone").textContent = done.reduce(function(n, p){ return n + p.members.length; }, 0);
  $("readyList").innerHTML = ready.length ? ready.map(function(p){ return propCard(p, "", "warden"); }).join("") : empty("Nothing waiting for approval.");
  $("logList").innerHTML = done.length ? done.slice().reverse().map(function(p){ return propCard(p, "", "log"); }).join("") : empty("No room changes yet.");
  $("openList").innerHTML = open.length ? open.map(function(r){
    return '<div class="row"><div class="info"><b>' + esc(r.name) + '</b> · ' + esc(r.roll) + '<p>' + esc(r.hostel) + ' · ' + esc(r.type) + ' · ' + esc(r.reason) + '</p></div>' +
      roomChip(r.cur.code) + '<span class="arrow">→</span><span>' + esc(wantText(r.want)) + '</span></div>';
  }).join("") : empty("No open requests.");
}

/* ============ roles ============ */
var role = "student", wardenAuth = false;
try { if (sessionStorage.getItem("rs-warden") === "1") wardenAuth = true; } catch (e) {}
function renderCurrent(){ renderStudent(); if (wardenAuth) renderWarden(); }
function setRole(r){
  role = r;
  $("view-student").classList.toggle("hide", r !== "student");
  $("view-warden").classList.toggle("hide", r !== "warden");
  var tabs = document.querySelectorAll(".tab");
  for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute("aria-selected", tabs[i].getAttribute("data-role") === r ? "true" : "false");
  $("wardenLock").classList.toggle("hide", wardenAuth);
  $("wardenMain").classList.toggle("hide", !wardenAuth);
  renderCurrent();
}

/* ============ demo data ============ */
function seed(){
  var people = [
    ["Rohan Mehta","2301CS045","B-214",{blocks:["A"],floors:[1],room:""},"Too noisy"],
    ["Aman Gupta","2302EE011","A-105",{blocks:["B"],floors:[],room:""},"Want to be near friends"],
    ["Karan Verma","2301ME072","C-301",{blocks:[],floors:[2],room:""},"Far from mess / classes"],
    ["Vikram Rao","2303CE034","A-210",{blocks:["B"],floors:[],room:""},"Roommate conflict"],
    ["Dev Malhotra","2301CS088","B-402",{blocks:["C"],floors:[],room:""},"Want to be near friends"],
    ["Harsh Jain","2304IT021","C-101",{blocks:[],floors:[],room:"A-105"},"Medical / ground floor"],
    ["Neel Shah","2302IT044","D-312",{blocks:["A","B"],floors:[1],room:""},"Other"]
  ];
  var us = Store.users(), rs = Store.reqs();
  people.forEach(function(p){
    if (!us.some(function(u){ return u.roll === p[1]; })) us.push({roll:p[1], name:p[0], hostel:"Boys Hostel A"});
    if (!rs.some(function(r){ return r.roll === p[1] && (r.status === "open" || r.status === "proposed"); })) {
      rs.push({id:uid("r"), roll:p[1], name:p[0], hostel:"Boys Hostel A", type:"Non-AC", cur:parseCode(p[2]), want:p[3], reason:p[4], note:"",
        status:"open", createdAt:new Date(Date.now() - rs.length * 3600000).toISOString(), doneAt:null});
    }
  });
  Store.saveUsers(us); Store.saveReqs(rs);
}

/* ============ init ============ */
function buildForm(){
  CONFIG.hostels.forEach(function(h){ var o = document.createElement("option"); o.textContent = h; $("sHostel").appendChild(o); });
  CONFIG.blocks.forEach(function(b){ var o = document.createElement("option"); o.textContent = b; $("cBlock").appendChild(o); });
  REASONS.forEach(function(x){ var o = document.createElement("option"); o.textContent = x; $("cReason").appendChild(o); });
  $("wBlocks").innerHTML = CONFIG.blocks.map(function(b){ return '<label class="chk"><input type="checkbox" id="wb-' + b + '" value="' + b + '"><span>' + b + '</span></label>'; }).join("");
  $("wFloors").innerHTML = CONFIG.floors.map(function(f){ return '<label class="chk"><input type="checkbox" id="wf-' + f + '" value="' + f + '"><span>' + f + '</span></label>'; }).join("");
}
function showFormErr(msg){ var e = $("formErr"); e.textContent = msg; e.classList.toggle("hide", !msg); }

function init(){
  buildForm();
  var tabs = document.querySelectorAll(".tab");
  for (var i = 0; i < tabs.length; i++) tabs[i].addEventListener("click", function(){ setRole(this.getAttribute("data-role")); });

  $("signForm").addEventListener("submit", function(e){
    e.preventDefault();
    var roll = normRoll($("sRoll").value), name = $("sName").value.trim();
    if (roll.length < 3 || name.length < 2) { toast("Enter your name and roll number."); return; }
    var us = Store.users(), u = us.filter(function(x){ return x.roll === roll; })[0];
    if (u) { u.name = name; u.hostel = $("sHostel").value; } else us.push({roll:roll, name:name, hostel:$("sHostel").value});
    Store.saveUsers(us); Store.setActive(roll); wantNew = false; renderCurrent();
  });
  $("signBtn").addEventListener("click", function(){
    var r = $("signSel").value;
    if (!r) { toast("Choose your name first."); return; }
    Store.setActive(r); wantNew = false; renderCurrent();
  });

  $("swapForm").addEventListener("submit", function(e){
    e.preventDefault();
    var me = getUser(Store.active());
    if (!me) return;
    var wb = [], wf = [];
    CONFIG.blocks.forEach(function(b){ if ($("wb-" + b).checked) wb.push(b); });
    CONFIG.floors.forEach(function(f){ if ($("wf-" + f).checked) wf.push(f); });
    var r = createRequest(me, {block:$("cBlock").value, num:$("cNum").value.trim(), type:$("cType").value, reason:$("cReason").value,
      wantBlocks:wb, wantFloors:wf, wantRoom:$("wRoom").value, note:$("cNote").value});
    if (!r.ok) { showFormErr(r.msg); return; }
    showFormErr(""); wantNew = false;
    ["cNum", "wRoom", "cNote"].forEach(function(f){ $(f).value = ""; });
    CONFIG.blocks.forEach(function(b){ $("wb-" + b).checked = false; });
    CONFIG.floors.forEach(function(f){ $("wf-" + f).checked = false; });
    toast("Request posted.");
    renderCurrent();
  });

  $("lockForm").addEventListener("submit", function(e){
    e.preventDefault();
    if ($("pinInput").value === CONFIG.wardenPin) {
      wardenAuth = true;
      try { sessionStorage.setItem("rs-warden", "1"); } catch (x) {}
      $("pinInput").value = ""; $("lockErr").classList.add("hide");
      setRole("warden");
    } else { $("lockErr").textContent = "Wrong PIN. Try again."; $("lockErr").classList.remove("hide"); }
  });

  document.addEventListener("click", function(e){
    var b = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!b) return;
    var act = b.getAttribute("data-act"), id = b.getAttribute("data-id"), me = Store.active(), r;
    if (act === "propose") { r = propose(b.getAttribute("data-ids").split(","), me); toast(r.msg); }
    else if (act === "agree") { r = respond(id, me, true); toast(r.msg); }
    else if (act === "decline") { r = respond(id, me, false); toast(r.msg); }
    else if (act === "cancelprop") { r = cancelProposal(id, me); toast(r.msg); }
    else if (act === "cancelreq") { if (confirm("Cancel your request?")) { cancelRequest(id); toast("Request cancelled."); } }
    else if (act === "newreq") { wantNew = true; }
    else if (act === "signout") { Store.setActive(""); wantNew = false; }
    else if (act === "wapprove" || act === "wreject") {
      var n = $("wnote-" + id);
      r = wardenDecide(id, act === "wapprove", n ? n.value : ""); toast(r.msg);
    }
    renderCurrent();
  });

  $("csvBtn").addEventListener("click", function(){
    if (!Store.props().some(function(p){ return p.status === "approved"; })) { toast("No approved room changes to download yet."); return; }
    try {
      var blob = new Blob([makeCsv()], {type:"text/csv;charset=utf-8"});
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "room-changes.csv";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) { toast("Could not create the file in this browser."); }
  });

  $("seedBtn").addEventListener("click", function(){ seed(); toast("Sample requests loaded. Continue as Rohan Mehta to see swaps."); renderCurrent(); });
  $("resetBtn").addEventListener("click", function(){
    if (confirm("Delete all requests and proposals on this device?")) {
      Store.saveUsers([]); Store.saveReqs([]); Store.saveProps([]); Store.setActive(""); wantNew = false;
      toast("All data cleared."); renderCurrent();
    }
  });
  setRole("student");
}

if (typeof window !== "undefined") {
  window.SwapCore = {CONFIG:CONFIG, parseCode:parseCode, satisfies:satisfies, validateRequest:validateRequest, createRequest:createRequest,
    cancelRequest:cancelRequest, findCycles:findCycles, cyclesFor:cyclesFor, propose:propose, respond:respond, cancelProposal:cancelProposal,
    wardenDecide:wardenDecide, makeCsv:makeCsv, demandFor:demandFor, getReq:getReq, myReq:myReq, Store:Store, seed:seed};
}
init();
})();