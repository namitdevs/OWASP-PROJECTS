(function () {
"use strict";

/* ============ CONFIG (change for your college) ============ */
var CONFIG = {
  captainPin: "2580",
  rosterDays: 14,        /* how many days ahead the roster is kept filled */
  reminderHour: 18       /* browser reminder time (24h) if the page is open */
};
var SKEY = "floorduty-state-v1", AKEY = "floorduty-active-v1", NKEY = "floorduty-notified-v1", RKEY = "floorduty-remind-v1";
var ICONS = ["🗑️", "🚿", "💧", "🧹", "💡", "🪣", "🍽️", "📦", "🚪", "🧺"];
var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var WLABEL = {1:"Easy", 2:"Medium", 3:"Hard"};

/* ============ helpers ============ */
function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function pad(n){ return (n < 10 ? "0" : "") + n; }
function dstr(d){ return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function parseD(s){ var p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0); }
function addDays(s, n){ var d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); }
function wd(s){ return parseD(s).getDay(); }
var clock = {today:null};
function todayStr(){ return clock.today || dstr(new Date()); }
function dlabel(s){ return parseD(s).toLocaleDateString("en-IN", {weekday:"short", day:"numeric", month:"short"}); }
function validDate(s){ return /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !isNaN(parseD(s)); }
function uid(p){ return p + Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36); }
function initials(n){
  var p = String(n).trim().split(/\s+/);
  return ((p[0] || "?").charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : "")).toUpperCase();
}
function hue(s){ var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
var toastTimer = 0;
function toast(msg){
  var t = $("toast");
  t.textContent = msg;
  t.classList.remove("hide");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.add("hide"); }, 3200);
}

/* ============ storage (swap these functions for Firebase/Supabase later) ============ */
function emptyState(){ return {floor:"My Floor", members:[], duties:[], assigns:[], swaps:[], away:[]}; }
var mem = emptyState();
var Store = {
  load: function(){
    try {
      var raw = localStorage.getItem(SKEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && Array.isArray(s.members) && Array.isArray(s.duties) && Array.isArray(s.assigns)) {
          s.swaps = s.swaps || []; s.away = s.away || []; s.floor = s.floor || "My Floor"; mem = s;
        }
      }
    } catch (e) {}
    return mem;
  },
  save: function(s){ mem = s; try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch (e) {} },
  active: function(){ try { var a = localStorage.getItem(AKEY); if (a) return a; } catch (e) {} return mem._active || ""; },
  setActive: function(id){ mem._active = id; try { localStorage.setItem(AKEY, id); } catch (e) {} }
};
/* run a change on the saved state and save it */
function mutate(fn){ var s = Store.load(), r = fn(s); Store.save(s); return r; }

/* ============ lookups ============ */
function memberOf(s, id){ return s.members.filter(function(m){ return m.id === id; })[0]; }
function dutyOf(s, id){ return s.duties.filter(function(d){ return d.id === id; })[0]; }
function assignOf(s, id){ return s.assigns.filter(function(a){ return a.id === id; })[0]; }
function nameOf(s, a){ var m = memberOf(s, a.memberId); return m ? m.name : (a.name || "Someone"); }
function isAway(s, memberId, date){
  return s.away.some(function(w){ return w.memberId === memberId && date >= w.from && date <= w.to; });
}
function occursOn(d, date){ return d.freq === "daily" || wd(date) === d.weekday; }

/* ============ fair rotation ============ */
/* points = total effort of duties given (done or pending). Missed duties don't count, so they come back sooner. */
function loadOf(s, memberId){
  var t = 0;
  s.assigns.forEach(function(a){
    if (a.memberId === memberId && a.status !== "missed") { var d = dutyOf(s, a.dutyId); t += d ? d.weight : 1; }
  });
  return t;
}
function lastDate(s, memberId, dutyId){
  var best = "";
  s.assigns.forEach(function(a){
    if (a.memberId === memberId && (!dutyId || a.dutyId === dutyId) && a.date > best) best = a.date;
  });
  return best;
}
function cmpKey(a, b){
  for (var i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; }
  return 0;
}
function pickMember(s, duty, date, exclude, taken){
  var c = s.members.filter(function(m){ return !(exclude && exclude.indexOf(m.id) >= 0) && !isAway(s, m.id, date); });
  if (!c.length) return null;
  var free = c.filter(function(m){ return !taken || !taken[m.id]; });
  if (free.length) c = free;
  var best = null, bk = null;
  c.forEach(function(m){
    var k = [loadOf(s, m.id), lastDate(s, m.id, duty.id), lastDate(s, m.id, ""), m.name.toLowerCase()];
    if (!bk || cmpKey(k, bk) < 0) { best = m; bk = k; }
  });
  return best;
}
function generate(s, from, to){
  var created = 0, date = from;
  while (date <= to) {
    var taken = {};
    s.assigns.forEach(function(a){ if (a.date === date) taken[a.memberId] = true; });
    var todays = s.duties.filter(function(d){ return occursOn(d, date); })
      .sort(function(a, b){ return b.weight - a.weight || a.name.localeCompare(b.name); });
    for (var i = 0; i < todays.length; i++) {
      var d = todays[i];
      if (s.assigns.some(function(a){ return a.date === date && a.dutyId === d.id; })) continue;
      var m = pickMember(s, d, date, null, taken);
      if (!m) continue;
      s.assigns.push({id:uid("a"), date:date, dutyId:d.id, dutyName:d.name, memberId:m.id, name:m.name, status:"pending", doneAt:null, swappedFrom:""});
      taken[m.id] = true; created++;
    }
    date = addDays(date, 1);
  }
  return created;
}
function ensureRoster(s){ var t = todayStr(); return generate(s, t, addDays(t, CONFIG.rosterDays - 1)); }
function sweep(s){
  var t = todayStr(), n = 0;
  s.assigns.forEach(function(a){ if (a.status === "pending" && a.date < t) { a.status = "missed"; n++; } });
  s.swaps.forEach(function(w){
    var a = assignOf(s, w.assignId);
    if (w.status === "pending" && (!a || a.status !== "pending")) w.status = "cancelled";
  });
  return n;
}
function regenerateFuture(s){
  var t = todayStr(), gone = {};
  s.assigns = s.assigns.filter(function(a){
    if (a.status === "pending" && a.date > t) { gone[a.id] = true; return false; }
    return true;
  });
  s.swaps.forEach(function(w){ if (gone[w.assignId] && w.status === "pending") w.status = "cancelled"; });
  return generate(s, addDays(t, 1), addDays(t, CONFIG.rosterDays - 1));
}
function reassignPending(s, memberId, from, to, removeIfNone){
  var t = todayStr(), moved = 0;
  s.assigns = s.assigns.filter(function(a){
    if (a.memberId !== memberId || a.status !== "pending" || a.date < t || a.date < from || a.date > to) return true;
    var d = dutyOf(s, a.dutyId), taken = {};
    s.assigns.forEach(function(x){ if (x.date === a.date && x.id !== a.id) taken[x.memberId] = true; });
    var m = d ? pickMember(s, d, a.date, [memberId], taken) : null;
    if (m) { a.memberId = m.id; a.name = m.name; a.swappedFrom = ""; moved++; return true; }
    return !removeIfNone;
  });
  return moved;
}

/* ============ members, duties, away ============ */
function addMember(s, name, room){
  name = String(name || "").trim();
  if (name.length < 2) return {ok:false, msg:"Enter the member’s name."};
  if (s.members.some(function(m){ return m.name.toLowerCase() === name.toLowerCase(); })) return {ok:false, msg:"That name is already on the list."};
  var m = {id:uid("m"), name:name, room:String(room || "").trim().toUpperCase().slice(0, 12)};
  s.members.push(m);
  return {ok:true, member:m, msg:name + " added."};
}
function removeMember(s, id){
  var m = memberOf(s, id);
  if (!m) return {ok:false, msg:"Member not found."};
  reassignPending(s, id, "0000-01-01", "9999-12-31", true);
  s.away = s.away.filter(function(w){ return w.memberId !== id; });
  s.swaps.forEach(function(w){ if (w.status === "pending" && (w.from === id || w.to === id)) w.status = "cancelled"; });
  s.members = s.members.filter(function(x){ return x.id !== id; });
  return {ok:true, msg:m.name + " removed. Their upcoming duties moved to others."};
}
function validateDuty(d){
  var n = String(d.name || "").trim();
  if (n.length < 2) return "Enter a duty name.";
  if ([1, 2, 3].indexOf(Number(d.weight)) < 0) return "Choose the effort level.";
  if (d.freq !== "daily" && d.freq !== "weekly") return "Choose how often.";
  if (d.freq === "weekly" && !(Number(d.weekday) >= 0 && Number(d.weekday) <= 6)) return "Choose the weekday.";
  return "";
}
function addDuty(s, d){
  var err = validateDuty(d);
  if (err) return {ok:false, msg:err};
  if (s.duties.some(function(x){ return x.name.toLowerCase() === d.name.trim().toLowerCase(); })) return {ok:false, msg:"That duty already exists."};
  var duty = {id:uid("d"), name:d.name.trim(), icon:d.icon || ICONS[0], weight:Number(d.weight), freq:d.freq, weekday:d.freq === "weekly" ? Number(d.weekday) : 0};
  s.duties.push(duty);
  var t = todayStr();
  generate(s, t, addDays(t, CONFIG.rosterDays - 1));
  return {ok:true, duty:duty, msg:duty.name + " added to the roster."};
}
function removeDuty(s, id){
  var d = dutyOf(s, id), t = todayStr();
  if (!d) return {ok:false, msg:"Duty not found."};
  s.assigns = s.assigns.filter(function(a){ return !(a.dutyId === id && a.status === "pending" && a.date >= t); });
  s.duties = s.duties.filter(function(x){ return x.id !== id; });
  return {ok:true, msg:d.name + " removed."};
}
function setAway(s, memberId, from, to){
  if (!memberOf(s, memberId)) return {ok:false, msg:"Choose a member."};
  if (!validDate(from) || !validDate(to)) return {ok:false, msg:"Choose both dates."};
  if (from > to) return {ok:false, msg:"The end date must be on or after the start date."};
  if (to < todayStr()) return {ok:false, msg:"That period is already over."};
  s.away.push({id:uid("w"), memberId:memberId, from:from, to:to});
  var moved = reassignPending(s, memberId, from, to, false);
  return {ok:true, moved:moved, msg:"Marked away. " + moved + " duty" + (moved === 1 ? "" : "s") + " moved to others."};
}
function removeAway(s, id){ s.away = s.away.filter(function(w){ return w.id !== id; }); return {ok:true}; }

/* ============ doing duties ============ */
function markDone(s, id, actorId, captain){
  var a = assignOf(s, id), t = todayStr();
  if (!a) return {ok:false, msg:"Duty not found."};
  if (!captain) {
    if (a.memberId !== actorId) return {ok:false, msg:"This duty belongs to someone else."};
    if (a.status !== "pending") return {ok:false, msg:"This duty is already " + a.status + "."};
    if (a.date !== t) return {ok:false, msg:"You can mark a duty done on its day."};
  } else if (a.date > t) return {ok:false, msg:"This duty is in the future."};
  a.status = "done"; a.doneAt = new Date().toISOString();
  return {ok:true, msg:"Marked done. Thank you! 🙌"};
}
function markMissed(s, id){
  var a = assignOf(s, id);
  if (!a) return {ok:false, msg:"Duty not found."};
  if (a.date > todayStr()) return {ok:false, msg:"This duty is in the future."};
  a.status = "missed"; a.doneAt = null;
  return {ok:true, msg:"Marked missed."};
}

/* ============ swaps ============ */
function pendingSwapFor(s, assignId){ return s.swaps.filter(function(w){ return w.assignId === assignId && w.status === "pending"; })[0]; }
function requestSwap(s, assignId, fromId, toId){
  var a = assignOf(s, assignId);
  if (!a || a.status !== "pending" || a.date < todayStr()) return {ok:false, msg:"This duty can’t be swapped."};
  if (a.memberId !== fromId) return {ok:false, msg:"That duty isn’t yours."};
  if (!memberOf(s, toId) || toId === fromId) return {ok:false, msg:"Choose who to ask."};
  if (isAway(s, toId, a.date)) return {ok:false, msg:"They are away that day."};
  if (pendingSwapFor(s, assignId)) return {ok:false, msg:"You already asked someone about this duty."};
  s.swaps.push({id:uid("w"), assignId:assignId, from:fromId, to:toId, status:"pending", createdAt:new Date().toISOString()});
  return {ok:true, msg:"Swap request sent to " + memberOf(s, toId).name + "."};
}
function respondSwap(s, swapId, byId, accept){
  var w = s.swaps.filter(function(x){ return x.id === swapId; })[0];
  if (!w || w.status !== "pending") return {ok:false, msg:"This request is no longer open."};
  if (w.to !== byId) return {ok:false, msg:"This request isn’t for you."};
  var a = assignOf(s, w.assignId);
  if (!accept) { w.status = "declined"; return {ok:true, msg:"Declined."}; }
  if (!a || a.status !== "pending" || a.memberId !== w.from) { w.status = "cancelled"; return {ok:false, msg:"That duty changed, so the request was closed."}; }
  if (isAway(s, byId, a.date)) return {ok:false, msg:"You are marked away that day."};
  a.swappedFrom = a.name; a.memberId = byId; a.name = memberOf(s, byId).name;
  w.status = "accepted";
  return {ok:true, msg:"Swap accepted. It’s your duty now."};
}
function cancelSwap(s, swapId, byId){
  var w = s.swaps.filter(function(x){ return x.id === swapId; })[0];
  if (!w || w.status !== "pending" || w.from !== byId) return {ok:false, msg:"Can’t cancel this request."};
  w.status = "cancelled";
  return {ok:true, msg:"Request cancelled."};
}

/* ============ stats, calendar file ============ */
function stats(s){
  var t = todayStr();
  var rows = s.members.map(function(m){
    var done = 0, missed = 0, upcoming = 0;
    s.assigns.forEach(function(a){
      if (a.memberId !== m.id) return;
      if (a.status === "done") done++; else if (a.status === "missed") missed++; else if (a.date >= t) upcoming++;
    });
    return {member:m, done:done, missed:missed, upcoming:upcoming, load:loadOf(s, m.id), rate: done + missed ? Math.round(100 * done / (done + missed)) : null};
  });
  var loads = rows.map(function(r){ return r.load; });
  var spread = loads.length ? Math.max.apply(null, loads) - Math.min.apply(null, loads) : 0;
  return {rows:rows, spread:spread, label: spread <= 2 ? "Very fair" : spread <= 4 ? "Fair" : "A bit uneven"};
}
function icsText(v){ return String(v).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function makeIcs(s, memberId){
  var t = todayStr(), stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  var L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FloorDuty//EN", "CALSCALE:GREGORIAN"];
  s.assigns.filter(function(a){ return a.memberId === memberId && a.status === "pending" && a.date >= t; }).forEach(function(a){
    var d = dutyOf(s, a.dutyId);
    L.push("BEGIN:VEVENT", "UID:" + a.id + "@floorduty", "DTSTAMP:" + stamp,
      "DTSTART;VALUE=DATE:" + a.date.replace(/-/g, ""), "DTEND;VALUE=DATE:" + addDays(a.date, 1).replace(/-/g, ""),
      "SUMMARY:" + icsText("Duty: " + a.dutyName), "DESCRIPTION:" + icsText(s.floor + " · " + (d ? WLABEL[d.weight] : "") + " duty"),
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsText("Duty today: " + a.dutyName), "TRIGGER;RELATED=START:PT8H", "END:VALARM", "END:VEVENT");
  });
  L.push("END:VCALENDAR");
  return L.join("\r\n");
}

/* ============ rendering: member ============ */
function empty(msg){ return '<div class="empty">' + msg + '</div>'; }
function chip(cls, text){ return '<span class="chip ' + cls + '">' + text + '</span>'; }

function noteCard(s, a, meId, opts){
  var d = dutyOf(s, a.dutyId), mine = a.memberId === meId, t = todayStr();
  var h = '<article class="note' + (mine ? ' mine' : '') + '" style="--h:' + hue(a.dutyName) + '"><div class="top"><span class="ic">' + esc(d ? d.icon : "📌") + '</span>';
  h += chip(a.status === "pending" ? "pending" : a.status, a.status === "pending" ? (a.date === t ? "Today" : dlabel(a.date)) : a.status.charAt(0).toUpperCase() + a.status.slice(1)) + '</div>';
  h += '<h3>' + esc(a.dutyName) + '</h3><p>' + (opts.showWho ? '<b>' + esc(mine ? "You" : nameOf(s, a)) + '</b> · ' : '') + dlabel(a.date) + (d ? ' · ' + WLABEL[d.weight] : '') + '</p>';
  if (a.swappedFrom) h += '<p>Swapped from ' + esc(a.swappedFrom) + '</p>';
  var acts = "";
  if (opts.actions && mine && a.status === "pending") {
    if (a.date === t) acts += '<button class="btn good small" data-act="done" data-id="' + a.id + '">Mark done</button>';
    var sw = pendingSwapFor(s, a.id);
    if (sw) {
      var to = memberOf(s, sw.to);
      acts += chip("swap", "Asked " + esc(to ? to.name : "someone")) + '<button class="btn ghost small" data-act="cancelswap" data-id="' + sw.id + '">Cancel</button>';
    } else {
      var others = s.members.filter(function(m){ return m.id !== meId && !isAway(s, m.id, a.date); });
      if (others.length) {
        acts += '<select id="swapto-' + a.id + '" aria-label="Ask to swap with">' + others.map(function(m){ return '<option value="' + m.id + '">' + esc(m.name) + '</option>'; }).join("") +
                '</select><button class="btn ghost small" data-act="swap" data-id="' + a.id + '">Ask to swap</button>';
      }
    }
  }
  if (acts) h += '<div class="acts">' + acts + '</div>';
  return h + '</article>';
}

function calendarTable(s, meId, days, forPrint){
  var t = todayStr(), duties = s.duties.slice().sort(function(a, b){ return b.weight - a.weight || a.name.localeCompare(b.name); });
  if (!duties.length) return empty("No duties yet.");
  var h = (forPrint ? '<div class="ptitle">' + esc(s.floor) + ' – duty roster</div>' : '') + '<table><thead><tr><th>Date</th>' +
    duties.map(function(d){ return '<th>' + esc(d.icon) + ' ' + esc(d.name) + '</th>'; }).join("") + '</tr></thead><tbody>';
  for (var i = 0; i < days; i++) {
    var date = addDays(t, i);
    h += '<tr' + (i === 0 ? ' class="today"' : '') + '><th>' + dlabel(date) + (i === 0 ? ' (today)' : '') + '</th>';
    duties.forEach(function(d){
      var a = s.assigns.filter(function(x){ return x.date === date && x.dutyId === d.id; })[0];
      if (!a) h += '<td class="off">–</td>';
      else h += '<td class="' + (a.memberId === meId ? 'mine' : '') + '">' + esc(nameOf(s, a)) + (a.status === "done" ? ' ✓' : a.status === "missed" ? ' ✗' : '') + '</td>';
    });
    h += '</tr>';
  }
  return h + '</tbody></table>';
}

function renderMember(){
  var s = Store.load(), me = memberOf(s, Store.active());
  $("floorTitle").textContent = s.floor;
  $("mSel").innerHTML = '<option value="">Choose your name…</option>' + s.members.map(function(m){ return '<option value="' + m.id + '">' + esc(m.name) + '</option>'; }).join("");
  $("noMembers").classList.toggle("hide", s.members.length > 0);
  $("mSignin").classList.toggle("hide", !!me);
  $("mDash").classList.toggle("hide", !me);
  if (!me) return;
  var t = todayStr();

  $("mMe").innerHTML = '<div class="card me"><span class="avatar" style="--h:' + hue(me.id) + '">' + esc(initials(me.name)) + '</span><div class="info"><h2>' + esc(me.name) +
    '</h2><p>' + esc(s.floor) + (me.room ? ' · Room ' + esc(me.room) : '') + '</p></div><div class="btns">' +
    '<button class="btn ghost small" data-act="ics">📅 Add to calendar</button><button class="btn ghost small" data-act="remind">🔔 Remind me</button>' +
    '<button class="btn ghost small" data-act="signout">Switch</button></div></div>';

  var mineToday = s.assigns.filter(function(a){ return a.date === t && a.memberId === me.id; });
  var pend = mineToday.filter(function(a){ return a.status === "pending"; });
  var b;
  if (pend.length) {
    b = '<div class="banner"><h2>You have ' + pend.length + ' dut' + (pend.length > 1 ? 'ies' : 'y') + ' today</h2>' + pend.map(function(a){ var d = dutyOf(s, a.dutyId); return esc((d ? d.icon + ' ' : '') + a.dutyName); }).join(" · ") +
        '<div class="acts">' + pend.map(function(a){ return '<button class="btn good small" data-act="done" data-id="' + a.id + '">Done: ' + esc(a.dutyName) + '</button>'; }).join("") + '</div></div>';
  } else if (mineToday.length) {
    b = '<div class="banner free"><h2>All done for today ✓</h2>Thanks for doing your part.</div>';
  } else {
    var next = s.assigns.filter(function(a){ return a.memberId === me.id && a.status === "pending" && a.date > t; }).sort(function(a, c){ return a.date < c.date ? -1 : 1; })[0];
    b = '<div class="banner free"><h2>No duty today 🎉</h2>' + (next ? 'Next: ' + esc(next.dutyName) + ' on ' + dlabel(next.date) + '.' : 'Nothing scheduled yet.') + '</div>';
  }
  $("todayBanner").innerHTML = b;

  var all = s.assigns.filter(function(a){ return a.date === t; });
  $("todayAll").innerHTML = all.length ? all.map(function(a){ return noteCard(s, a, me.id, {showWho:true, actions:false}); }).join("") : empty("No duties scheduled today.");

  var mine = s.assigns.filter(function(a){ return a.memberId === me.id && a.status === "pending" && a.date >= t; }).sort(function(a, c){ return a.date < c.date ? -1 : 1; });
  $("myList").innerHTML = mine.length ? mine.map(function(a){ return noteCard(s, a, me.id, {showWho:false, actions:true}); }).join("") : empty("No upcoming duties for you right now.");

  var inc = s.swaps.filter(function(w){ return w.status === "pending" && w.to === me.id; });
  $("swapBox").innerHTML = inc.length ? inc.map(function(w){
    var a = assignOf(s, w.assignId), f = memberOf(s, w.from);
    if (!a || !f) return "";
    return '<div class="row"><div class="info"><b>' + esc(f.name) + '</b> asks you to take <b>' + esc(a.dutyName) + '</b><p>' + dlabel(a.date) + '</p></div>' +
      '<button class="btn good small" data-act="accept" data-id="' + w.id + '">Accept</button><button class="btn ghost small" data-act="declineswap" data-id="' + w.id + '">Decline</button></div>';
  }).join("") : empty("No swap requests.");

  $("calWrap").innerHTML = calendarTable(s, me.id, 7, false);

  var st = stats(s), maxLoad = Math.max.apply(null, st.rows.map(function(r){ return r.load; }).concat([1]));
  $("fairBoard").innerHTML = '<p class="verdict">Fairness: ' + st.label + ' · points gap between most and least loaded: ' + st.spread + '</p><div class="fair">' +
    st.rows.map(function(r){
      return '<div class="frow' + (r.member.id === me.id ? ' me' : '') + '"><div class="name"><span style="color:inherit;font-size:inherit;font-weight:600">' + esc(r.member.name) + '</span><span>' + r.load + ' pts · done ' + r.done +
        ' · upcoming ' + r.upcoming + ' · missed ' + r.missed + (r.rate != null ? ' · ' + r.rate + '% on time' : '') + '</span></div><div class="meter"><i style="width:' + Math.round(100 * r.load / maxLoad) + '%"></i></div></div>';
    }).join("") + '</div>';
}

/* ============ rendering: captain ============ */
function renderCaptain(){
  var s = Store.load(), t = todayStr();
  $("floorName").value = s.floor;
  $("memberList").innerHTML = s.members.length ? s.members.map(function(m){
    var w = s.away.filter(function(x){ return x.memberId === m.id && x.to >= t; })[0];
    return '<div class="row"><div class="info"><b>' + esc(m.name) + '</b>' + (m.room ? ' · Room ' + esc(m.room) : '') + '</div>' + (w ? chip("away", "Away " + dlabel(w.from) + " – " + dlabel(w.to)) : '') +
      '<button class="btn danger small" data-act="rmember" data-id="' + m.id + '">Remove</button></div>';
  }).join("") : empty("Add the people on your floor or in your room.");

  $("aMember").innerHTML = s.members.map(function(m){ return '<option value="' + m.id + '">' + esc(m.name) + '</option>'; }).join("");
  var aw = s.away.filter(function(w){ return w.to >= t && memberOf(s, w.memberId); });
  $("awayList").innerHTML = aw.map(function(w){
    return '<div class="row"><div class="info"><b>' + esc(memberOf(s, w.memberId).name) + '</b><p>' + dlabel(w.from) + ' to ' + dlabel(w.to) + '</p></div><button class="btn danger small" data-act="raway" data-id="' + w.id + '">Remove</button></div>';
  }).join("");

  $("dutyList").innerHTML = s.duties.length ? s.duties.map(function(d){
    return '<div class="row"><span style="font-size:1.4rem">' + esc(d.icon) + '</span><div class="info"><b>' + esc(d.name) + '</b><p>' + (d.freq === "daily" ? "Every day" : "Every " + DAYS[d.weekday]) + '</p></div>' +
      chip("w" + d.weight, WLABEL[d.weight]) + '<button class="btn danger small" data-act="rduty" data-id="' + d.id + '">Remove</button></div>';
  }).join("") : empty("Add the chores your floor shares, like garbage, washroom or water cans.");

  var today = s.assigns.filter(function(a){ return a.date === t; });
  $("todayAdmin").innerHTML = today.length ? today.map(function(a){
    return '<div class="row"><div class="info"><b>' + esc(a.dutyName) + '</b><p>' + esc(nameOf(s, a)) + '</p></div>' + chip(a.status, a.status.charAt(0).toUpperCase() + a.status.slice(1)) +
      '<button class="btn good small" data-act="cdone" data-id="' + a.id + '">Done</button><button class="btn danger small" data-act="cmiss" data-id="' + a.id + '">Missed</button></div>';
  }).join("") : empty("Nothing scheduled for today.");

  $("printSheet").innerHTML = calendarTable(s, "", CONFIG.rosterDays, true);
}

/* ============ roles ============ */
var role = "member", captainAuth = false;
try { if (sessionStorage.getItem("fd-captain") === "1") captainAuth = true; } catch (e) {}
function refreshData(){
  mutate(function(s){ sweep(s); ensureRoster(s); });
}
function renderCurrent(){
  refreshData();
  renderMember();
  if (captainAuth) renderCaptain();
}
function setRole(r){
  role = r;
  $("view-member").classList.toggle("hide", r !== "member");
  $("view-captain").classList.toggle("hide", r !== "captain");
  var tabs = document.querySelectorAll(".tab");
  for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute("aria-selected", tabs[i].getAttribute("data-role") === r ? "true" : "false");
  $("captainLock").classList.toggle("hide", captainAuth);
  $("captainMain").classList.toggle("hide", !captainAuth);
  renderCurrent();
}

/* ============ reminders (browser notifications while the page is open) ============ */
function reminderCheck(){
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (localStorage.getItem(RKEY) !== "1") return;
    var s = Store.load(), me = memberOf(s, Store.active()), t = todayStr();
    if (!me || new Date().getHours() < CONFIG.reminderHour) return;
    if (localStorage.getItem(NKEY) === t) return;
    var pend = s.assigns.filter(function(a){ return a.date === t && a.memberId === me.id && a.status === "pending"; });
    if (!pend.length) return;
    localStorage.setItem(NKEY, t);
    new Notification("FloorDuty", {body:"Your duty today: " + pend.map(function(a){ return a.dutyName; }).join(", ")});
  } catch (e) {}
}
function enableReminders(){
  if (typeof Notification === "undefined") { toast("This browser doesn’t support notifications. Use “Add to calendar” instead."); return; }
  Notification.requestPermission().then(function(p){
    if (p === "granted") {
      try { localStorage.setItem(RKEY, "1"); localStorage.removeItem(NKEY); } catch (e) {}
      toast("Reminders on. You’ll be nudged after " + CONFIG.reminderHour + ":00 if a duty is pending and this page is open.");
      reminderCheck();
    } else toast("Notifications were blocked. Use “Add to calendar” instead.");
  });
}
function downloadFile(name, text, type){
  try {
    var blob = new Blob([text], {type:type});
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  } catch (e) { toast("Could not create the file in this browser."); }
}

/* ============ demo data ============ */
function seed(){
  mutate(function(s){
    var t = todayStr();
    s.floor = "Block B – 2nd Floor";
    ["Rohan Mehta|B-201", "Karan Verma|B-202", "Aman Gupta|B-203", "Dev Malhotra|B-204", "Vikram Rao|B-205", "Harsh Jain|B-206"].forEach(function(x){
      var p = x.split("|"); addMember(s, p[0], p[1]);
    });
    [["Take out garbage", "🗑️", 1, "daily", 0], ["Refill water cans", "💧", 2, "daily", 0], ["Switch off corridor lights", "💡", 1, "daily", 0],
     ["Clean common washroom", "🚿", 3, "weekly", 6], ["Mop corridor", "🧹", 2, "weekly", 0]].forEach(function(d){
      if (!s.duties.some(function(x){ return x.name === d[0]; }))
        s.duties.push({id:uid("d"), name:d[0], icon:d[1], weight:d[2], freq:d[3], weekday:d[4]});
    });
    generate(s, addDays(t, -6), addDays(t, CONFIG.rosterDays - 1));
    var n = 0;
    s.assigns.forEach(function(a){
      if (a.date < t) { n++; a.status = n % 7 === 0 ? "missed" : "done"; a.doneAt = a.status === "done" ? new Date().toISOString() : null; }
    });
  });
}

/* ============ init ============ */
function buildForms(){
  $("dIcon").innerHTML = ICONS.map(function(i){ return '<option>' + i + '</option>'; }).join("");
  $("dDay").innerHTML = DAYS.map(function(d, i){ return '<option value="' + i + '">' + d + '</option>'; }).join("");
  var t = todayStr(); $("aFrom").value = t; $("aTo").value = t;
}

function init(){
  buildForms();
  var tabs = document.querySelectorAll(".tab");
  for (var i = 0; i < tabs.length; i++) tabs[i].addEventListener("click", function(){ setRole(this.getAttribute("data-role")); });

  $("mBtn").addEventListener("click", function(){
    var id = $("mSel").value;
    if (!id) { toast("Choose your name first."); return; }
    Store.setActive(id); renderCurrent();
  });

  $("lockForm").addEventListener("submit", function(e){
    e.preventDefault();
    if ($("pinInput").value === CONFIG.captainPin) {
      captainAuth = true;
      try { sessionStorage.setItem("fd-captain", "1"); } catch (x) {}
      $("pinInput").value = ""; $("lockErr").classList.add("hide");
      setRole("captain");
    } else { $("lockErr").textContent = "Wrong PIN. Try again."; $("lockErr").classList.remove("hide"); }
  });

  $("floorForm").addEventListener("submit", function(e){
    e.preventDefault();
    var n = $("floorName").value.trim();
    if (!n) return;
    mutate(function(s){ s.floor = n.slice(0, 40); });
    toast("Saved."); renderCurrent();
  });
  $("memberForm").addEventListener("submit", function(e){
    e.preventDefault();
    var r = mutate(function(s){ var x = addMember(s, $("mName").value, $("mRoom").value); if (x.ok) ensureRoster(s); return x; });
    toast(r.msg);
    if (r.ok) { $("mName").value = ""; $("mRoom").value = ""; }
    renderCurrent();
  });
  $("awayForm").addEventListener("submit", function(e){
    e.preventDefault();
    var r = mutate(function(s){ return setAway(s, $("aMember").value, $("aFrom").value, $("aTo").value); });
    toast(r.msg); renderCurrent();
  });
  $("dutyForm").addEventListener("submit", function(e){
    e.preventDefault();
    var r = mutate(function(s){
      return addDuty(s, {name:$("dName").value, icon:$("dIcon").value, weight:$("dWeight").value, freq:$("dFreq").value, weekday:$("dDay").value});
    });
    toast(r.msg);
    if (r.ok) $("dName").value = "";
    renderCurrent();
  });

  $("regenBtn").addEventListener("click", function(){
    if (!confirm("Rebuild the roster from tomorrow onward? Today and past duties stay as they are.")) return;
    mutate(function(s){ regenerateFuture(s); });
    toast("Upcoming roster rebuilt."); renderCurrent();
  });
  $("printBtn").addEventListener("click", function(){ try { window.print(); } catch (e) { toast("Printing is not available here."); } });

  document.addEventListener("click", function(e){
    var b = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!b) return;
    var act = b.getAttribute("data-act"), id = b.getAttribute("data-id"), me = Store.active(), r = null;
    if (act === "done") r = mutate(function(s){ return markDone(s, id, me, false); });
    else if (act === "swap") { var sel = $("swapto-" + id); r = mutate(function(s){ return requestSwap(s, id, me, sel ? sel.value : ""); }); }
    else if (act === "cancelswap") r = mutate(function(s){ return cancelSwap(s, id, me); });
    else if (act === "accept") r = mutate(function(s){ return respondSwap(s, id, me, true); });
    else if (act === "declineswap") r = mutate(function(s){ return respondSwap(s, id, me, false); });
    else if (act === "signout") { Store.setActive(""); }
    else if (act === "ics") {
      var st = Store.load(), txt = makeIcs(st, me);
      if (txt.indexOf("BEGIN:VEVENT") < 0) toast("You have no upcoming duties to add."); else { downloadFile("my-duties.ics", txt, "text/calendar"); toast("Open the file to add your duties to your calendar."); }
    }
    else if (act === "remind") enableReminders();
    else if (act === "rmember") { if (confirm("Remove this member? Their upcoming duties move to others.")) r = mutate(function(s){ return removeMember(s, id); }); }
    else if (act === "raway") r = mutate(function(s){ return removeAway(s, id); });
    else if (act === "rduty") { if (confirm("Remove this duty and its upcoming assignments?")) r = mutate(function(s){ return removeDuty(s, id); }); }
    else if (act === "cdone") r = mutate(function(s){ return markDone(s, id, "", true); });
    else if (act === "cmiss") r = mutate(function(s){ return markMissed(s, id); });
    if (r && r.msg) toast(r.msg);
    renderCurrent();
  });

  $("seedBtn").addEventListener("click", function(){ seed(); toast("Sample floor loaded. Choose a name under “Who are you?”."); renderCurrent(); });
  $("resetBtn").addEventListener("click", function(){
    if (confirm("Delete all members, duties and roster data on this device?")) {
      Store.save(emptyState()); Store.setActive(""); toast("All data cleared."); renderCurrent();
    }
  });

  setRole("member");
  reminderCheck();
  setInterval(function(){ if (!document.hidden) { renderCurrent(); reminderCheck(); } }, 600000);
}

if (typeof window !== "undefined") {
  window.DutyCore = {CONFIG:CONFIG, clock:clock, emptyState:emptyState, addMember:addMember, removeMember:removeMember, addDuty:addDuty, removeDuty:removeDuty,
    setAway:setAway, removeAway:removeAway, generate:generate, ensureRoster:ensureRoster, sweep:sweep, regenerateFuture:regenerateFuture,
    markDone:markDone, markMissed:markMissed, requestSwap:requestSwap, respondSwap:respondSwap, cancelSwap:cancelSwap, stats:stats, makeIcs:makeIcs,
    loadOf:loadOf, addDays:addDays, validateDuty:validateDuty};
}
init();
})();