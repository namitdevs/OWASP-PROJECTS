(function () {
"use strict";

var PLACES = [
  {n:"Central Delhi", la:28.6139, lo:77.2090},
  {n:"North Delhi (University area)", la:28.6889, lo:77.2105},
  {n:"South Delhi", la:28.5355, lo:77.2100},
  {n:"East Delhi (Mayur Vihar)", la:28.6090, lo:77.2970},
  {n:"West Delhi (Dwarka)", la:28.5921, lo:77.0460},
  {n:"Noida", la:28.5355, lo:77.3910},
  {n:"Gurugram", la:28.4595, lo:77.0266}
];
var CATS = [
  {max:50,  name:"Good",         col:"#00b050"},
  {max:100, name:"Satisfactory", col:"#92d050"},
  {max:200, name:"Moderate",     col:"#f5c400"},
  {max:300, name:"Poor",         col:"#f57c00"},
  {max:400, name:"Very poor",    col:"#e53935"},
  {max:9999,name:"Severe",       col:"#8e1b3a"}
];
var PM25 = [[0,30,0,50],[30,60,50,100],[60,90,100,200],[90,120,200,300],[120,250,300,400],[250,380,400,500]];
var PM10 = [[0,50,0,50],[50,100,50,100],[100,250,100,200],[250,350,200,300],[350,430,300,400],[430,600,400,500]];
/* icon, name, comfortable limit, caution limit, strenuous */
var ACTS = [
  ["🚶","Walking between blocks",150,250,false],
  ["🎓","Outdoor class or lab",120,200,false],
  ["🏃","Jogging or outdoor gym",80,150,true],
  ["🏏","Cricket, football, ground practice",80,130,true]
];
var CIRC = 364.4; /* 2 * PI * 58 */
var data = null;

function $(id){ return document.getElementById(id); }
function isNum(x){ return typeof x === "number" && isFinite(x); }
function sub(c, bp){
  for (var i = 0; i < bp.length; i++) {
    var b = bp[i];
    if (c <= b[1]) return b[2] + (b[3] - b[2]) * (Math.max(c, b[0]) - b[0]) / (b[1] - b[0]);
  }
  return 500;
}
function iaqi(p25, p10){
  var a = isNum(p25) ? sub(p25, PM25) : 0;
  var b = isNum(p10) ? sub(p10, PM10) : 0;
  return Math.round(Math.max(a, b));
}
function catOf(a){ for (var i = 0; i < CATS.length; i++) if (a <= CATS[i].max) return i; return CATS.length - 1; }
function hourOf(t){ return parseInt(String(t).slice(11,13), 10) || 0; }
function hr(h){ return (h % 12 || 12) + (h < 12 ? " am" : " pm"); }
function num(x, unit){ return isNum(x) ? Math.round(x) + unit : "–"; }

/* ---------- network ---------- */
function fetchJSON(url, ms){
  return new Promise(function(resolve, reject){
    var done = false;
    var timer = setTimeout(function(){ if (!done){ done = true; reject(new Error("Request timed out")); } }, ms || 12000);
    fetch(url).then(function(r){
      if (!r.ok) throw new Error("Server replied with status " + r.status);
      return r.json();
    }).then(function(j){
      if (!done){ done = true; clearTimeout(timer); resolve(j); }
    }).catch(function(e){
      if (!done){ done = true; clearTimeout(timer); reject(e); }
    });
  });
}
function wait(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

function getAir(la, lo){
  var url = "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=" + la + "&longitude=" + lo +
            "&hourly=pm2_5,pm10&forecast_days=2&timezone=auto";
  return fetchJSON(url).catch(function(){ return wait(900).then(function(){ return fetchJSON(url, 15000); }); });
}
function getWeather(la, lo){
  var url = "https://api.open-meteo.com/v1/forecast?latitude=" + la + "&longitude=" + lo +
            "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m&timezone=auto";
  return fetchJSON(url).then(function(w){ return w && w.current ? w.current : null; }).catch(function(){ return null; });
}

function buildData(a, w, name){
  if (!a || !a.hourly || !a.hourly.time || !a.hourly.pm2_5) throw new Error("Air quality response had no data for this place");
  var offset = isNum(a.utc_offset_seconds) ? a.utc_offset_seconds : 19800;
  var key = new Date(Date.now() + offset * 1000).toISOString().slice(0,13) + ":00";
  var idx = a.hourly.time.indexOf(key);
  if (idx < 0) idx = 0;
  var hours = [];
  for (var i = idx; i < a.hourly.time.length && hours.length < 24; i++) {
    var p25 = a.hourly.pm2_5[i], p10 = a.hourly.pm10 ? a.hourly.pm10[i] : null;
    if (!isNum(p25) && !isNum(p10)) continue;
    hours.push({t:a.hourly.time[i], p25:p25, p10:p10, a:iaqi(p25, p10)});
  }
  if (!hours.length) throw new Error("No recent air quality readings available");
  var h0 = hours[0];
  return {
    place:name, time:h0.t, p25:h0.p25, p10:h0.p10, aqi:h0.a, hours:hours,
    temp: w ? w.temperature_2m : null, feels: w ? w.apparent_temperature : null,
    hum: w ? w.relative_humidity_2m : null, wind: w ? w.wind_speed_10m : null
  };
}

/* ---------- advice logic ---------- */
function judge(a, asthma){
  var k = asthma ? 0.6 : 1, lvl = 0, why = [];
  var feels = isNum(data.feels) ? data.feels : 0;
  if (data.aqi > a[3] * k) { lvl = 2; why.push("AQI " + data.aqi + " is too high"); }
  else if (data.aqi > a[2] * k) { lvl = 1; why.push("AQI " + data.aqi + " is above the comfortable limit"); }
  if (a[4]) {
    if (feels >= 41) { lvl = 2; why.push("it feels like " + Math.round(feels) + "°C"); }
    else if (feels >= 36) { lvl = Math.max(lvl, 1); why.push("it feels like " + Math.round(feels) + "°C"); }
  }
  if (!why.length) why.push(asthma ? "Air is fine for sensitive lungs right now" : "Air and heat are fine right now");
  var text = why.join(" and ");
  return {lvl:lvl, why:text.charAt(0).toUpperCase() + text.slice(1) + "."};
}

/* ---------- render ---------- */
function render(){
  if (!data) return;
  var asthma = $("asthma").checked;
  var ci = catOf(data.aqi), cat = CATS[ci];
  var feels = isNum(data.feels) ? data.feels : 0;
  document.documentElement.style.setProperty("--aq", cat.col);

  $("aqi").textContent = data.aqi;
  $("cat").textContent = cat.name;
  $("where").textContent = data.place + " · data for " + hr(hourOf(data.time));
  $("ring").style.strokeDashoffset = String(CIRC * (1 - Math.min(data.aqi, 500) / 500));
  $("pin").style.left = Math.min(data.aqi, 500) / 5 + "%";

  var hl, why;
  if (feels >= 41) { hl = "Dangerous heat. Keep workouts indoors."; why = "It feels like " + Math.round(feels) + "°C outside."; }
  else if (ci === 0 || (ci === 1 && !asthma)) { hl = "Good day to be outside."; why = "Air quality is " + cat.name.toLowerCase() + ". Normal activity is fine."; }
  else if (ci <= 2) { hl = asthma ? "Take it easy outside today." : "Fine for most. Go easy on hard workouts."; why = "Air is " + cat.name.toLowerCase() + "." + (asthma ? " Sensitive lungs should limit time outdoors." : ""); }
  else if (ci === 3) { hl = "Skip the ground today. Use the indoor court."; why = "Air is poor. Hard exercise outdoors makes you breathe in far more pollution."; }
  else { hl = "Stay indoors where you can."; why = "Air is " + cat.name.toLowerCase() + ". Even short walks affect sensitive people."; }
  $("headline").textContent = hl;
  $("why").textContent = why;

  var sc = $("scale"), old = sc.querySelectorAll("i");
  for (var i = 0; i < old.length; i++) sc.removeChild(old[i]);
  var widths = [10,10,20,20,20,20];
  for (var j = 0; j < CATS.length; j++) {
    var s = document.createElement("i");
    s.style.width = widths[j] + "%";
    s.style.background = CATS[j].col;
    s.title = CATS[j].name;
    sc.insertBefore(s, $("pin"));
  }

  var st = [["🌫️","PM2.5",num(data.p25," µg/m³")],["💨","PM10",num(data.p10," µg/m³")],
            ["🌡️","Temperature",num(data.temp,"°C")],["🥵","Feels like",num(data.feels,"°C")],
            ["💧","Humidity",num(data.hum,"%")],["🍃","Wind",num(data.wind," km/h")]];
  $("stats").innerHTML = st.map(function(x){
    return '<div class="stat"><span class="ic">' + x[0] + '</span><b>' + x[2] + '</b><span>' + x[1] + '</span></div>';
  }).join("");

  var lab = ["Go","Take care","Skip"], cls = ["go","care","skip"];
  var cards = ACTS.map(function(a){ var j = judge(a, asthma); return {ic:a[0], n:a[1], l:j.lvl, r:j.why}; });
  cards.push({ic:"🏸", n:"Indoor court or gym", l:(feels >= 41 ? 1 : 0),
    r: feels >= 41 ? "Safer than outdoors, but stay hydrated." : "Safe in any air. Best choice on smoggy days."});
  $("acts").innerHTML = cards.map(function(c){
    return '<div class="act ' + cls[c.l] + '"><div class="top2"><span class="ic">' + c.ic + '</span><span class="v">' + lab[c.l] +
           '</span></div><p class="n">' + c.n + '</p><p class="r">' + c.r + '</p></div>';
  }).join("");

  var best = data.hours.reduce(function(m, h){ return h.a < m.a ? h : m; });
  var next = data.hours.slice(0, 12);
  $("bestline").innerHTML = "<b>Cleanest hour in the next 24 hours: " + hr(hourOf(best.t)) + "</b> (AQI " + best.a + "). Plan outdoor time then if you can.";
  $("bars").innerHTML = next.map(function(h, i){
    var c = CATS[catOf(h.a)].col, pct = Math.max(4, Math.min(h.a, 500) / 5);
    var lbl = i === 0 ? "Now" : hr(hourOf(h.t)).replace(" ", "");
    return '<div class="bar' + (i === 0 ? " now" : "") + (h.t === best.t ? " pick" : "") + '" title="' + hr(hourOf(h.t)) + ': AQI ' + h.a +
           '"><span>' + h.a + '</span><div style="height:' + pct + '%;background:' + c + '"></div><span>' + lbl + '</span></div>';
  }).join("");

  var tips = [];
  if (ci >= 3) tips.push("Wear a fitted N95 or FFP2 mask outside. Cloth and surgical masks do little against fine dust.");
  if (ci >= 2) tips.push("Walk on inner, tree-lined paths and keep away from main roads and idling vehicles.");
  if (ci >= 2) tips.push("Move heavy workouts to the indoor court, gym or hostel, and keep windows closed during peak pollution hours.");
  if (ci <= 1) tips.push("Open your windows for a while now to air out your room.");
  if (asthma) tips.push("Keep your inhaler with you and tell a friend where you are going.");
  if (feels >= 36) tips.push("Carry water and avoid open ground between 12 pm and 4 pm.");
  tips.push("Check again before evening practice. Air quality can change a lot within a few hours.");
  $("tips").innerHTML = tips.map(function(t){ return "<li>" + t + "</li>"; }).join("");

  $("status").classList.add("hide");
  $("app").classList.remove("hide");
}

function showError(title, detail, hint){
  $("app").classList.add("hide");
  var s = $("status");
  s.classList.remove("hide");
  s.innerHTML = "";
  var p = document.createElement("p"); p.className = "err"; p.textContent = title; s.appendChild(p);
  if (hint) { var h = document.createElement("p"); h.textContent = hint; s.appendChild(h); }
  if (detail) { var d = document.createElement("p"); d.className = "det"; d.textContent = "Details: " + detail; s.appendChild(d); }
  s.appendChild(document.createElement("br"));
  var b = document.createElement("button"); b.textContent = "Try again";
  b.addEventListener("click", pick); s.appendChild(b);
}
function showLoading(){
  var s = $("status");
  s.classList.remove("hide");
  s.innerHTML = '<div class="skel"></div><p>Loading live air quality…</p>';
  $("app").classList.add("hide");
}

function load(la, lo, name){
  showLoading();
  Promise.all([getAir(la, lo), getWeather(la, lo)]).then(function(r){
    data = buildData(r[0], r[1], name);
    try { render(); }
    catch (e) { showError("Something went wrong while showing the data.", e && e.message, "Refresh the page. If it keeps happening, report this message."); }
  }).catch(function(e){
    showError("Couldn’t load live air quality.",
      e && e.message,
      "Your connection may be fine: some college Wi‑Fi networks block open-meteo.com. Try mobile data or another network.");
  });
}

function pick(){
  var v = $("place").value;
  try { localStorage.setItem("aac-place", v); } catch (e) {}
  if (v === "gps") {
    if (!navigator.geolocation) { showError("Your browser doesn’t support location.", "", "Choose an area from the list instead."); return; }
    showLoading();
    navigator.geolocation.getCurrentPosition(function(p){
      load(p.coords.latitude.toFixed(4), p.coords.longitude.toFixed(4), "Your location");
    }, function(){
      showError("Location access was blocked.", "", "Allow location in your browser, or choose an area from the list.");
    }, {timeout:10000});
    return;
  }
  var p = PLACES[parseInt(v, 10)] || PLACES[0];
  load(p.la, p.lo, p.n);
}

/* ---------- init ---------- */
var sel = $("place");
PLACES.forEach(function(p, i){
  var o = document.createElement("option"); o.value = String(i); o.textContent = p.n; sel.appendChild(o);
});
var g = document.createElement("option"); g.value = "gps"; g.textContent = "Use my location"; sel.appendChild(g);
try {
  var saved = localStorage.getItem("aac-place");
  if (saved === "gps" || (saved !== null && PLACES[parseInt(saved, 10)])) sel.value = saved;
  if (localStorage.getItem("aac-asthma") === "1") $("asthma").checked = true;
} catch (e) {}
sel.addEventListener("change", pick);
$("asthma").addEventListener("change", function(){
  try { localStorage.setItem("aac-asthma", this.checked ? "1" : "0"); } catch (e) {}
  render();
});
pick();
})();