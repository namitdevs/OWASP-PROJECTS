(function () {
"use strict";

/* ============ CONFIG (change for your college) ============ */
var CONFIG = {
  wardenPin: "1357",
  hostels: ["Boys Hostel A", "Boys Hostel B", "Girls Hostel A", "Girls Hostel B"]
};
var UKEY = "roommatch-users-v1", RKEY = "roommatch-requests-v1", AKEY = "roommatch-active-v1";

/* weight w = how much the question counts toward the score (1 to 3) */
var QUESTIONS = [
  {id:"sleep",  short:"Sleep time",  w:3, text:"When do you usually go to sleep?",           opts:["Before 11 pm", "11 pm – 1 am", "After 1 am"]},
  {id:"wake",   short:"Wake-up",     w:2, text:"When do you usually wake up?",               opts:["Before 6 am", "6 – 8 am", "After 8 am"]},
  {id:"clean",  short:"Tidiness",    w:3, text:"How tidy do you keep your space?",           opts:["Very tidy", "Mostly tidy", "Relaxed", "Messy"]},
  {id:"study",  short:"Studying",    w:2, text:"Where do you usually study?",                opts:["Library / outside", "A mix", "In the room"]},
  {id:"noise",  short:"Noise",       w:2, text:"How much noise can you handle?",             opts:["Need silence", "Some noise is fine", "Noise doesn’t bother me"]},
  {id:"guests", short:"Guests",      w:2, text:"How often will friends visit the room?",     opts:["Rarely", "Sometimes", "Often"]},
  {id:"music",  short:"Music/gaming",w:2, text:"Music or gaming in the room?",               opts:["Never", "Headphones only", "Speakers are fine"]},
  {id:"share",  short:"Sharing",     w:1, text:"Sharing your things (charger, snacks…)?",    opts:["Prefer not to", "Small things", "Happily"]},
  {id:"social", short:"Social style",w:1, text:"How would you describe yourself?",           opts:["Quiet", "Balanced", "Very social"]},
  {id:"temp",   short:"Room feel",   w:1, text:"Fan, AC and windows?",                       opts:["Cool, fan/AC on", "Flexible", "Warm, window open"]}
];

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
var toastTimer = 0;
function toast(msg){
  var t = $("toast");
  t.textContent = msg;
  t.classList.remove("hide");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.add("hide"); }, 3200);
}

/* ============ storage (swap these functions for Firebase/Supabase later) ============ */
var mem = {users:[], reqs:[], active:""};
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
  active: function(){ var a = readKey(AKEY, null); if (typeof a === "string") mem.active = a; return mem.active; },
  setActive: function(r){ mem.active = r; writeKey(AKEY, r); }
};
function getUser(roll){
  roll = normRoll(roll);
  return Store.users().filter(function(u){ return u.roll === roll; })[0];
}
function mutateUsers(fn){ var l = Store.users(); fn(l); Store.saveUsers(l); }

/* ============ matching core ============ */
function compare(a, b){
  var tw = 0, sum = 0, items = [], conf = [];
  QUESTIONS.forEach(function(q){
    var x = a.answers[q.id], y = b.answers[q.id];
    if (x == null || y == null) return;
    var d = Math.abs(x - y) / (q.opts.length - 1);
    tw += q.w; sum += q.w * (1 - d);
    items.push({q:q, x:x, y:y, d:d});
    var deal = (a.deal && a.deal[q.id]) || (b.deal && b.deal[q.id]);
    if (deal && d >= 0.5) conf.push(q.id);
  });
  return {score: tw ? Math.round(100 * sum / tw) : 0, items:items, conflicts:conf};
}
function band(score){ return score >= 85 ? "great" : score >= 70 ? "good" : score >= 55 ? "okay" : "risky"; }
var BAND_LABEL = {great:"Great match", good:"Good match", okay:"Okay match", risky:"Might clash"};

function eligible(a, b){
  return a.roll !== b.roll && a.hostel === b.hostel && a.status === "looking" && b.status === "looking";
}
function rankFor(me){
  var out = [], hidden = 0;
  Store.users().forEach(function(u){
    if (!eligible(me, u)) return;
    var c = compare(me, u);
    if (c.conflicts.length) { hidden++; return; }
    out.push({user:u, score:c.score, items:c.items});
  });
  out.sort(function(a, b){ return b.score - a.score; });
  return {list:out, hidden:hidden};
}
function insights(items){
  var same = items.filter(function(i){ return i.d === 0; }).sort(function(a, b){ return b.q.w - a.q.w; }).slice(0, 2);
  var diff = items.filter(function(i){ return i.d >= 0.5; }).sort(function(a, b){ return b.q.w - a.q.w; }).slice(0, 2);
  return {
    yes: same.map(function(i){ return "Both: " + i.q.short.toLowerCase() + " – " + i.q.opts[i.x]; }),
    no: diff.map(function(i){ return i.q.short + ": you “" + i.q.opts[i.x] + "”, they “" + i.q.opts[i.y] + "”"; })
  };
}

function validateProfile(d){
  if (!d.name || d.name.trim().length < 2) return "Please enter your name.";
  if (normRoll(d.roll).length < 3) return "Please enter your roll number.";
  if (CONFIG.hostels.indexOf(d.hostel) < 0) return "Choose your hostel.";
  for (var i = 0; i < QUESTIONS.length; i++) {
    var q = QUESTIONS[i], v = d.answers[q.id];
    if (typeof v !== "number" || v < 0 || v >= q.opts.length) return "Please answer question " + (i + 1) + ".";
  }
  return "";
}
function saveUser(d){
  var roll = normRoll(d.roll), list = Store.users(), found = null;
  list.forEach(function(u){ if (u.roll === roll) found = u; });
  var data = {roll:roll, name:d.name.trim(), hostel:d.hostel, year:d.year || "1", branch:(d.branch || "").trim(),
    about:(d.about || "").trim(), answers:d.answers, deal:d.deal || {}};
  if (found) { for (var k in data) found[k] = data[k]; }
  else { data.status = "looking"; data.partner = ""; data.room = ""; data.pairScore = 0; list.push(data); }
  Store.saveUsers(list);
  return getUser(roll);
}

/* ---- pairing and requests ---- */
function pairUsers(aRoll, bRoll){
  var a = getUser(aRoll), b = getUser(bRoll);
  if (!a || !b || a.roll === b.roll) return {ok:false, msg:"Invalid pair."};
  if (a.status !== "looking" || b.status !== "looking") return {ok:false, msg:"One of them is already matched."};
  if (a.hostel !== b.hostel) return {ok:false, msg:"They live in different hostels."};
  var score = compare(a, b).score;
  mutateUsers(function(l){
    l.forEach(function(u){
      if (u.roll === a.roll) { u.status = "matched"; u.partner = b.roll; u.room = ""; u.pairScore = score; }
      if (u.roll === b.roll) { u.status = "matched"; u.partner = a.roll; u.room = ""; u.pairScore = score; }
    });
  });
  var rs = Store.reqs();
  rs.forEach(function(r){
    if (r.status === "pending" && (r.from === a.roll || r.to === a.roll || r.from === b.roll || r.to === b.roll)) r.status = "cancelled";
  });
  Store.saveReqs(rs);
  return {ok:true, score:score};
}
function unpair(roll){
  var u = getUser(roll);
  if (!u || u.status !== "matched") return {ok:false};
  var partner = u.partner;
  mutateUsers(function(l){
    l.forEach(function(x){
      if (x.roll === u.roll || x.roll === partner) { x.status = "looking"; x.partner = ""; x.room = ""; x.pairScore = 0; }
    });
  });
  return {ok:true};
}
function allotRoom(roll, room){
  var u = getUser(roll);
  if (!u || u.status !== "matched") return false;
  room = String(room || "").trim().toUpperCase().slice(0, 12);
  mutateUsers(function(l){ l.forEach(function(x){ if (x.roll === u.roll || x.roll === u.partner) x.room = room; }); });
  return true;
}
function pendingBetween(a, b){
  return Store.reqs().filter(function(r){
    return r.status === "pending" && ((r.from === a && r.to === b) || (r.from === b && r.to === a));
  })[0];
}
function sendRequest(fromRoll, toRoll){
  var a = getUser(fromRoll), b = getUser(toRoll);
  if (!a || !b) return {ok:false, msg:"Student not found."};
  if (!eligible(a, b)) return {ok:false, msg:"This student is no longer available."};
  if (compare(a, b).conflicts.length) return {ok:false, msg:"This match clashes with a dealbreaker."};
  var ex = pendingBetween(a.roll, b.roll);
  if (ex) {
    if (ex.from === b.roll) return respond(ex.id, true);
    return {ok:false, msg:"You already sent a request."};
  }
  var rs = Store.reqs();
  rs.push({id:"r" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), from:a.roll, to:b.roll, createdAt:new Date().toISOString(), status:"pending"});
  Store.saveReqs(rs);
  return {ok:true, msg:"Request sent to " + b.name + "."};
}
function respond(id, accept){
  var rs = Store.reqs(), r = rs.filter(function(x){ return x.id === id; })[0];
  if (!r || r.status !== "pending") return {ok:false, msg:"This request is no longer open."};
  if (accept) {
    var p = pairUsers(r.from, r.to);
    if (!p.ok) { r.status = "cancelled"; Store.saveReqs(rs); return p; }
    var fresh = Store.reqs(); fresh.forEach(function(x){ if (x.id === id) x.status = "accepted"; }); Store.saveReqs(fresh);
    return {ok:true, paired:true, msg:"You are now roommates! 🎉"};
  }
  r.status = "declined"; Store.saveReqs(rs);
  return {ok:true, msg:"Request declined."};
}
function cancelRequest(id){
  var rs = Store.reqs();
  rs.forEach(function(r){ if (r.id === id && r.status === "pending") r.status = "cancelled"; });
  Store.saveReqs(rs);
}

/* ---- warden tools ---- */
function suggestPairs(){
  var users = Store.users().filter(function(u){ return u.status === "looking"; }), cands = [];
  for (var i = 0; i < users.length; i++) for (var j = i + 1; j < users.length; j++) {
    if (!eligible(users[i], users[j])) continue;
    var c = compare(users[i], users[j]);
    if (c.conflicts.length) continue;
    cands.push({a:users[i], b:users[j], score:c.score});
  }
  cands.sort(function(x, y){ return y.score - x.score; });
  var used = {}, out = [];
  cands.forEach(function(c){
    if (used[c.a.roll] || used[c.b.roll]) return;
    used[c.a.roll] = used[c.b.roll] = true; out.push(c);
  });
  return out;
}
function pairsList(){
  var out = [];
  Store.users().forEach(function(u){
    if (u.status === "matched" && u.roll < u.partner) { var p = getUser(u.partner); if (p) out.push({a:u, b:p, score:u.pairScore, room:u.room}); }
  });
  return out;
}
function csvCell(v){ return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }
function makeCsv(){
  var rows = [["Hostel", "Room", "Name 1", "Roll 1", "Name 2", "Roll 2", "Compatibility %"]];
  pairsList().forEach(function(p){ rows.push([p.a.hostel, p.room, p.a.name, p.a.roll, p.b.name, p.b.roll, p.score]); });
  return rows.map(function(r){ return r.map(csvCell).join(","); }).join("\r\n");
}

/* ============ rendering ============ */
function empty(msg){ return '<div class="empty">' + msg + '</div>'; }
function buildQuiz(){
  $("quiz").innerHTML = QUESTIONS.map(function(q, i){
    return '<fieldset class="q"><legend>' + (i + 1) + '. ' + esc(q.text) + '</legend><div class="opts">' +
      q.opts.map(function(o, j){
        return '<label class="pill"><input type="radio" name="q-' + q.id + '" value="' + j + '"><span>' + esc(o) + '</span></label>';
      }).join("") + '</div><label class="dl"><input type="checkbox" id="deal-' + q.id + '"> Dealbreaker for me</label></fieldset>';
  }).join("");
}
function readAnswers(){
  var ans = {}, deal = {};
  QUESTIONS.forEach(function(q){
    var el = document.querySelector('input[name="q-' + q.id + '"]:checked');
    if (el) ans[q.id] = parseInt(el.value, 10);
    deal[q.id] = !!$("deal-" + q.id).checked;
  });
  return {answers:ans, deal:deal};
}
function fillProfile(u){
  $("pName").value = u ? u.name : ""; $("pRoll").value = u ? u.roll : "";
  $("pHostel").value = u ? u.hostel : CONFIG.hostels[0]; $("pYear").value = u ? u.year : "1";
  $("pBranch").value = u ? u.branch : ""; $("pAbout").value = u ? u.about : "";
  QUESTIONS.forEach(function(q){
    var el = u ? document.querySelector('input[name="q-' + q.id + '"][value="' + u.answers[q.id] + '"]') : null;
    var all = document.querySelectorAll('input[name="q-' + q.id + '"]');
    for (var i = 0; i < all.length; i++) all[i].checked = false;
    if (el) el.checked = true;
    $("deal-" + q.id).checked = !!(u && u.deal && u.deal[q.id]);
  });
  $("pRoll").disabled = !!u;
}

var sub = "matches";
function mCard(r, me){
  var u = r.user, b = band(r.score), ins = insights(r.items), req = pendingBetween(me.roll, u.roll), h;
  h = '<article class="mcard"><div class="ring ' + b + '" style="--p:' + r.score + '"><span>' + r.score + '</span></div><div class="minfo">';
  h += '<h3>' + esc(u.name) + '<small>Year ' + esc(u.year) + (u.branch ? ' · ' + esc(u.branch) : '') + '</small></h3>';
  h += '<span class="chip ' + b + '">' + BAND_LABEL[b] + '</span>';
  if (u.about) h += '<p class="about">“' + esc(u.about) + '”</p>';
  h += '<ul class="why">' + ins.yes.map(function(t){ return '<li class="yes">' + esc(t) + '</li>'; }).join("") +
       ins.no.map(function(t){ return '<li class="no">' + esc(t) + '</li>'; }).join("") + '</ul></div><div class="macts">';
  if (!req) h += '<button class="btn primary" data-act="send" data-roll="' + esc(u.roll) + '">Send roommate request</button>';
  else if (req.from === me.roll) h += '<button class="btn ghost" disabled>Request sent</button><button class="btn danger small" data-act="cancelreq" data-id="' + req.id + '">Cancel</button>';
  else h += '<button class="btn good" data-act="accept" data-id="' + req.id + '">They asked you – Accept</button>';
  return h + '</div></article>';
}

function renderStudent(){
  var me = getUser(Store.active());
  var users = Store.users(), sel = $("signSel");
  sel.innerHTML = '<option value="">Choose your name…</option>' + users.map(function(u){
    return '<option value="' + esc(u.roll) + '">' + esc(u.name) + ' (' + esc(u.roll) + ')</option>'; }).join("");
  $("signin").classList.toggle("hide", !!me);
  $("dash").classList.toggle("hide", !me);
  var showProfile = !me || sub === "profile";
  $("profileSection").classList.toggle("hide", !showProfile);
  $("profTitle").textContent = me ? "Update your answers" : "Create your profile";
  if (!me) return;

  var partner = me.status === "matched" ? getUser(me.partner) : null;
  $("meCard").innerHTML = '<div class="card me"><span class="avatar" style="--h:' + hue(me.roll) + '">' + esc(initials(me.name)) + '</span>' +
    '<div class="info"><h2>' + esc(me.name) + '</h2><p>' + esc(me.roll) + ' · ' + esc(me.hostel) + '</p></div>' +
    '<span class="chip ' + me.status + '">' + (partner ? 'Matched' : 'Looking for a roommate') + '</span>' +
    '<button class="btn ghost small" data-act="signout">Switch</button></div>';

  var inc = Store.reqs().filter(function(r){ return r.status === "pending" && r.to === me.roll; });
  var badge = $("reqBadge"); badge.textContent = inc.length; badge.classList.toggle("hide", !inc.length);

  var subs = document.querySelectorAll(".sub");
  for (var i = 0; i < subs.length; i++) subs[i].classList.toggle("active", subs[i].getAttribute("data-sub") === sub);
  $("paneMatches").classList.toggle("hide", sub !== "matches");
  $("paneRequests").classList.toggle("hide", sub !== "requests");

  if (partner) {
    $("paneMatches").innerHTML = '<div class="card paircard"><h2>You’re matched! 🎉</h2><p class="names">' + esc(me.name) + ' &amp; ' + esc(partner.name) + '</p>' +
      '<p class="hint">Compatibility ' + me.pairScore + '% · ' + (me.room ? 'Room <b>' + esc(me.room) + '</b>' : 'Room will be allotted by the warden') + '</p>' +
      '<button class="btn danger small" data-act="unpair">Cancel this pairing</button></div>';
  } else {
    var rk = rankFor(me), h = "";
    if (rk.list.length) h = rk.list.map(function(r){ return mCard(r, me); }).join("");
    else h = empty("No matches yet in " + esc(me.hostel) + ". Check back as more students take the quiz.");
    if (rk.hidden) h += '<p class="hint">' + rk.hidden + ' student' + (rk.hidden > 1 ? 's are' : ' is') + ' hidden because of your dealbreakers.</p>';
    $("paneMatches").innerHTML = h;
  }

  var out = Store.reqs().filter(function(r){ return r.status === "pending" && r.from === me.roll; });
  var rq = '<h3 class="subh">Requests for you</h3>' + (inc.length ? inc.map(function(r){
    var f = getUser(r.from); if (!f) return "";
    return '<div class="reqrow"><span class="avatar" style="--h:' + hue(f.roll) + ';width:42px;height:42px;font-size:1rem">' + esc(initials(f.name)) + '</span><div class="info"><b>' + esc(f.name) +
      '</b><p>' + compare(me, f).score + '% compatible</p></div><button class="btn good small" data-act="accept" data-id="' + r.id + '">Accept</button>' +
      '<button class="btn ghost small" data-act="decline" data-id="' + r.id + '">Decline</button></div>'; }).join("") : empty("No requests right now."));
  rq += '<h3 class="subh">Requests you sent</h3>' + (out.length ? out.map(function(r){
    var t = getUser(r.to); if (!t) return "";
    return '<div class="reqrow"><div class="info"><b>' + esc(t.name) + '</b><p>Waiting for a reply</p></div><span class="chip pending">Pending</span>' +
      '<button class="btn danger small" data-act="cancelreq" data-id="' + r.id + '">Cancel</button></div>'; }).join("") : empty("You haven’t sent any requests."));
  $("paneRequests").innerHTML = rq;
}

function renderWarden(){
  var users = Store.users(), looking = users.filter(function(u){ return u.status === "looking"; });
  var pairs = pairsList(), sug = suggestPairs();
  $("sLooking").textContent = looking.length;
  $("sPairs").textContent = pairs.length;
  $("sReq").textContent = Store.reqs().filter(function(r){ return r.status === "pending"; }).length;

  $("suggestList").innerHTML = sug.length ? sug.map(function(s){
    var b = band(s.score);
    return '<div class="reqrow"><div class="info"><b>' + esc(s.a.name) + ' &amp; ' + esc(s.b.name) + '</b><p>' + esc(s.a.hostel) + '</p></div>' +
      '<span class="chip ' + b + '">' + s.score + '% · ' + BAND_LABEL[b] + '</span>' +
      '<button class="btn good small" data-act="wpair" data-a="' + esc(s.a.roll) + '" data-b="' + esc(s.b.roll) + '">Confirm pair</button></div>';
  }).join("") : empty("No pairs to suggest right now.");

  $("pairList").innerHTML = pairs.length ? pairs.map(function(p){
    return '<div class="card paircard" style="margin:0"><p class="names">' + esc(p.a.name) + ' &amp; ' + esc(p.b.name) + '</p>' +
      '<p class="hint" style="margin:2px 0 0">' + esc(p.a.hostel) + ' · ' + p.score + '% compatible</p>' +
      '<div class="roomrow"><input id="room-' + esc(p.a.roll) + '" value="' + esc(p.room) + '" maxlength="12" placeholder="Room no. e.g. B-214" aria-label="Room number">' +
      '<button class="btn primary small" data-act="room" data-roll="' + esc(p.a.roll) + '">Save room</button>' +
      '<button class="btn danger small" data-act="wunpair" data-roll="' + esc(p.a.roll) + '">Undo pair</button></div></div>';
  }).join("") : empty("No confirmed pairs yet.");

  $("lookList").innerHTML = looking.length ? looking.map(function(u){
    return '<div class="reqrow"><span class="avatar" style="--h:' + hue(u.roll) + ';width:42px;height:42px;font-size:1rem">' + esc(initials(u.name)) + '</span>' +
      '<div class="info"><b>' + esc(u.name) + '</b><p>' + esc(u.roll) + ' · ' + esc(u.hostel) + ' · Year ' + esc(u.year) + '</p></div></div>';
  }).join("") : empty("Everyone is paired. 🎉");
}

/* ============ roles ============ */
var role = "student", wardenAuth = false;
try { if (sessionStorage.getItem("rm-warden") === "1") wardenAuth = true; } catch (e) {}
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
  var rows = [
    ["Rohan Mehta","2301CS045","Boys Hostel A","2","CSE","Gym at 6 am, loves chai",[1,1,1,1,1,1,1,1,1,1],{}],
    ["Karan Verma","2301ME072","Boys Hostel A","2","Mech","Night coder, FIFA on weekends",[2,2,2,2,2,2,2,2,2,2],{}],
    ["Aman Gupta","2302EE011","Boys Hostel A","1","EEE","Early to bed, early to rise",[0,0,0,0,0,0,0,0,1,0],{sleep:true,clean:true}],
    ["Dev Malhotra","2301CS088","Boys Hostel A","2","CSE","Balanced and easy going",[1,1,1,0,1,1,1,1,1,1],{}],
    ["Vikram Rao","2303CE034","Boys Hostel A","3","Civil","Cricket and late-night chats",[2,1,2,1,2,2,2,1,2,1],{}],
    ["Harsh Jain","2304IT021","Boys Hostel A","4","IT","Needs a quiet room for GATE prep",[0,0,0,2,0,0,0,0,0,0],{noise:true}],
    ["Ananya Singh","2302EC018","Girls Hostel A","2","ECE","Bookworm and tea lover",[1,1,1,1,1,1,1,1,1,1],{}],
    ["Meera Joshi","2302CS031","Girls Hostel A","2","CSE","Early riser, yoga person",[0,0,0,0,0,0,1,1,1,0],{}],
    ["Priya Nair","2303CE009","Girls Hostel A","3","Civil","Music, friends, chaos",[2,2,3,2,2,2,2,2,2,2],{}],
    ["Sneha Kapoor","2301BT015","Girls Hostel A","1","Biotech","Quiet but friendly",[1,0,1,1,0,0,1,1,0,1],{}]
  ];
  var list = Store.users();
  rows.forEach(function(r){
    if (list.some(function(u){ return u.roll === r[1]; })) return;
    var ans = {};
    QUESTIONS.forEach(function(q, i){ ans[q.id] = r[6][i]; });
    list.push({roll:r[1], name:r[0], hostel:r[2], year:r[3], branch:r[4], about:r[5], answers:ans, deal:r[7],
      status:"looking", partner:"", room:"", pairScore:0});
  });
  Store.saveUsers(list);
}

/* ============ init ============ */
function showProfErr(msg){ var e = $("profErr"); e.textContent = msg; e.classList.toggle("hide", !msg); }

function init(){
  buildQuiz();
  CONFIG.hostels.forEach(function(h){ var o = document.createElement("option"); o.textContent = h; $("pHostel").appendChild(o); });
  fillProfile(getUser(Store.active()));

  var tabs = document.querySelectorAll(".tab");
  for (var i = 0; i < tabs.length; i++) tabs[i].addEventListener("click", function(){ setRole(this.getAttribute("data-role")); });
  var subs = document.querySelectorAll(".sub");
  for (var j = 0; j < subs.length; j++) subs[j].addEventListener("click", function(){
    sub = this.getAttribute("data-sub");
    if (sub === "profile") fillProfile(getUser(Store.active()));
    renderStudent();
  });

  $("signBtn").addEventListener("click", function(){
    var r = $("signSel").value;
    if (!r) { toast("Choose your name first."); return; }
    Store.setActive(r); sub = "matches"; fillProfile(getUser(r)); renderStudent();
  });

  $("profForm").addEventListener("submit", function(e){
    e.preventDefault();
    var qa = readAnswers();
    var d = {name:$("pName").value, roll:$("pRoll").value, hostel:$("pHostel").value, year:$("pYear").value,
      branch:$("pBranch").value, about:$("pAbout").value, answers:qa.answers, deal:qa.deal};
    var err = validateProfile(d);
    if (err) { showProfErr(err); return; }
    showProfErr("");
    var u = saveUser(d);
    Store.setActive(u.roll); sub = "matches"; fillProfile(u);
    toast("Saved! Here are your matches.");
    renderCurrent();
    try { window.scrollTo(0, 0); } catch (x) {}
  });

  $("lockForm").addEventListener("submit", function(e){
    e.preventDefault();
    if ($("pinInput").value === CONFIG.wardenPin) {
      wardenAuth = true;
      try { sessionStorage.setItem("rm-warden", "1"); } catch (x) {}
      $("pinInput").value = ""; $("lockErr").classList.add("hide");
      setRole("warden");
    } else { $("lockErr").textContent = "Wrong PIN. Try again."; $("lockErr").classList.remove("hide"); }
  });

  document.addEventListener("click", function(e){
    var b = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!b) return;
    var act = b.getAttribute("data-act"), id = b.getAttribute("data-id"), roll = b.getAttribute("data-roll"), r;
    var me = Store.active();
    if (act === "send") { r = sendRequest(me, roll); toast(r.msg); }
    else if (act === "accept") { r = respond(id, true); toast(r.msg); }
    else if (act === "decline") { r = respond(id, false); toast(r.msg); }
    else if (act === "cancelreq") { cancelRequest(id); toast("Request cancelled."); }
    else if (act === "unpair") { if (confirm("Cancel this pairing? You will both go back to looking.")) { unpair(me); toast("Pairing cancelled."); } }
    else if (act === "signout") { Store.setActive(""); sub = "matches"; fillProfile(null); }
    else if (act === "wpair") { r = pairUsers(b.getAttribute("data-a"), b.getAttribute("data-b")); toast(r.ok ? "Pair confirmed." : r.msg); }
    else if (act === "wunpair") { if (confirm("Undo this pair?")) { unpair(roll); toast("Pair undone."); } }
    else if (act === "room") {
      var inp = $("room-" + roll);
      allotRoom(roll, inp ? inp.value : "");
      toast("Room saved.");
    }
    renderCurrent();
  });

  $("csvBtn").addEventListener("click", function(){
    if (!pairsList().length) { toast("No confirmed pairs to download yet."); return; }
    try {
      var blob = new Blob([makeCsv()], {type:"text/csv;charset=utf-8"});
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "roommate-pairs.csv";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) { toast("Could not create the file in this browser."); }
  });

  $("seedBtn").addEventListener("click", function(){ seed(); toast("Sample students loaded. Choose one under “Continue as”."); renderCurrent(); });
  $("resetBtn").addEventListener("click", function(){
    if (confirm("Delete all profiles, requests and pairs on this device?")) {
      Store.saveUsers([]); Store.saveReqs([]); Store.setActive(""); sub = "matches"; fillProfile(null);
      toast("All data cleared."); renderCurrent();
    }
  });

  setRole("student");
}

if (typeof window !== "undefined") {
  window.MatchCore = {QUESTIONS:QUESTIONS, compare:compare, band:band, rankFor:rankFor, validateProfile:validateProfile, saveUser:saveUser,
    sendRequest:sendRequest, respond:respond, pairUsers:pairUsers, unpair:unpair, allotRoom:allotRoom, suggestPairs:suggestPairs,
    pairsList:pairsList, makeCsv:makeCsv, getUser:getUser, Store:Store, seed:seed, insights:insights};
}
init();
})();