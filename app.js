const ONBOARDING_KEY = 'mwt_onboarding_seen_v1';
const STORAGE_KEYS = { entries: 'mwt_entries_v1', customTriggers: 'mwt_custom_triggers_v1', savedLocation: 'mwt_saved_location_v1' };
const symptomOptions = ['nausea','aura','light sensitivity','sound sensitivity','neck pain','dizziness','fatigue','vision changes','brain fog'];
const defaultTriggers = ['weather change','air pressure drop','poor sleep','stress','dehydration','caffeine','screen time','bright light','exercise','skipped meals','processed food'];
const pollenKeys = ['alder_pollen','birch_pollen','grass_pollen','mugwort_pollen','olive_pollen','ragweed_pollen'];

const form = document.getElementById('entry-form');
const entriesEl = document.getElementById('entries');
const dashboardEl = document.getElementById('dashboard');
const locationResultEl = document.getElementById('location-result');
const submitStatusEl = document.getElementById('submit-status');
const symptomTagsEl = document.getElementById('symptom-tags');
const triggerTagsEl = document.getElementById('trigger-tags');
let matchedLocation = null;

const savedConfirmationEl = document.getElementById('saved-confirmation');
const exportDataBtn = document.getElementById('export-data');
const importDataInput = document.getElementById('import-data');
const clearDataBtn = document.getElementById('clear-data');


document.getElementById('entry-date').valueAsDate = new Date();

const jget=(k,d='[]')=>JSON.parse(localStorage.getItem(k)||d); const jset=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const loadEntries=()=>{ const data=jget(STORAGE_KEYS.entries); console.log('Loaded entries from localStorage', data.length); return data; }; const saveEntries=(v)=>{ jset(STORAGE_KEYS.entries,v); console.log('Saved entries to localStorage', v.length); };
const loadCustomTriggers=()=>jget(STORAGE_KEYS.customTriggers); const saveCustomTriggers=(v)=>jset(STORAGE_KEYS.customTriggers,v);
const loadSavedLocation=()=>jget(STORAGE_KEYS.savedLocation,'null'); const saveSavedLocation=(v)=>jset(STORAGE_KEYS.savedLocation,v);

function createTagButtons(container, tags, type){ container.innerHTML=''; tags.forEach(tag=>{const b=document.createElement('button'); b.type='button'; b.className='tag'; b.dataset.value=tag; b.dataset.type=type; b.textContent=tag; b.onclick=()=>b.classList.toggle('active'); container.appendChild(b);}); }
const selectedTags=(type)=>Array.from(document.querySelectorAll(`.tag[data-type="${type}"].active`)).map(el=>el.dataset.value);
const avg = (arr)=>Array.isArray(arr)&&arr.length?Number((arr.filter(v=>v!=null).reduce((s,v)=>s+v,0)/arr.filter(v=>v!=null).length).toFixed(2)):null;
function humidityCategory(h){ if(h==null||h==='') return 'Not available'; const n=Number(h); if(n>=75) return 'High'; if(n>=45) return 'Moderate'; return 'Low'; }
const fmt=(v,unit='')=>v==null||v===''?'Not available':`${Number(v).toFixed(1)}${unit}`;

function fetchWithTimeout(url, timeoutMs = 5000){
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
}


async function resolveLocation(){
  const city = document.getElementById('location-city').value.trim();
  const country = document.getElementById('location-country').value.trim();
  if(!city){ locationResultEl.textContent='Please enter a city/location before weather lookup.'; return null; }
  if(!navigator.onLine){ locationResultEl.textContent='You appear offline. Location lookup unavailable.'; return null; }
  try{
    locationResultEl.textContent='Looking up location...';
    const q = encodeURIComponent(city);
    const cc = country ? `&countryCode=${encodeURIComponent(country)}` : '';
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=en&format=json${cc}`;
    const r = await fetchWithTimeout(url, 5000);
    if(!r.ok) throw new Error(`Geocoding HTTP ${r.status}`);
    const data = await r.json();
    if(!data.results?.length){ matchedLocation=null; locationResultEl.textContent='No location match found. Try city + country (e.g., Tokyo + JP).'; return null; }
    const m = data.results[0];
    matchedLocation = { name: m.name, country: m.country, latitude: m.latitude, longitude: m.longitude };
    saveSavedLocation({ city, country, matchedLocation });
    locationResultEl.innerHTML = `Matched: <strong>${m.name}, ${m.country}</strong> (${m.latitude.toFixed(4)}, ${m.longitude.toFixed(4)})`;
    return matchedLocation;
  } catch (err) {
    console.error('Location lookup failed', err);
    locationResultEl.textContent='Location lookup failed. Please verify city/country and try again.';
    return null;
  }
}

function weatherUrls(date, lat, lon){
  const today = new Date().toISOString().slice(0,10);
  const isPast = date < today;
  const base = isPast ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const shared = `latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&timezone=auto`;
  const hourly = 'hourly=temperature_2m,relative_humidity_2m,surface_pressure,pressure_msl,precipitation,weather_code';
  return `${base}?${shared}&${hourly}`;
}

async function fetchEnv(date, lat, lon){
  if(!navigator.onLine) throw new Error('offline');
  const prev = new Date(date); prev.setDate(prev.getDate()-1); const pd = prev.toISOString().slice(0,10);
  const weatherUrl = weatherUrls(date, lat, lon);
  const prevUrl = weatherUrls(pd, lat, lon);
  const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&hourly=pm2_5,pm10,dust,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen&timezone=auto`;

  let weather = {}; let weatherFetchStatus='success';
  try {
    const [w, wp] = await Promise.all([fetchWithTimeout(weatherUrl, 5000), fetchWithTimeout(prevUrl, 5000)]);
    if(!w.ok || !wp.ok) throw new Error(`Weather HTTP ${w.status}/${wp.status}`);
    const wd = await w.json(); const wpd = await wp.json();
    const h = wd.hourly || {}; const ph = wpd.hourly || {};
    const pressure = avg(h.surface_pressure) ?? avg(h.pressure_msl);
    const prevPressure = avg(ph.surface_pressure) ?? avg(ph.pressure_msl);
    const precipitation = (h.precipitation || []).filter(v=>v!=null).reduce((s,v)=>s+v,0) || null;
    weather = {
      temperature: avg(h.temperature_2m),
      humidity: avg(h.relative_humidity_2m),
      precipitation,
      pressure,
      weatherCode: h.weather_code?.[12] ?? h.weather_code?.[0] ?? null,
      pressureChange: (pressure != null && prevPressure != null) ? Number((pressure - prevPressure).toFixed(1)) : null,
      humidityCategory: humidityCategory(avg(h.relative_humidity_2m)),
      rain: (precipitation ?? 0) > 0
    };
  } catch (err) {
    weatherFetchStatus = 'failed';
    console.error('Weather fetch failed', { err, date, lat, lon, weatherUrl, prevUrl });
  }

  let airQuality = { unavailable: true }; let pollenFetchStatus = 'not_available';
  try {
    const a = await fetchWithTimeout(airUrl, 5000);
    if(!a.ok) throw new Error(`Air quality HTTP ${a.status}`);
    const ad = await a.json(); const h = ad.hourly || {};
    airQuality = { pm2_5: avg(h.pm2_5), pm10: avg(h.pm10), dust: avg(h.dust) };
    pollenKeys.forEach(k=>{ airQuality[k]=avg(h[k]); });
    pollenFetchStatus = Object.values(airQuality).some(v=>v!=null) ? 'success' : 'not_available';
  } catch (err) {
    pollenFetchStatus = 'failed';
    console.error('Pollen/air fetch failed', { err, date, lat, lon, airUrl });
  }

  return { weather, weatherFetchStatus, airQuality, pollenFetchStatus };
}

function envRisk(entry){ let score=0; if((entry.weather?.pressureChange ?? 0)<=-4) score+=2; if(entry.weather?.humidityCategory==='High') score+=1; if(entry.weather?.rain) score+=1; const pvals=pollenKeys.map(k=>entry.airQuality?.[k]).filter(v=>v!=null); if(pvals.some(v=>v>=30)) score+=2; if((entry.airQuality?.pm2_5??0)>=25) score+=1; if((entry.airQuality?.pm10??0)>=50) score+=1; return Math.min(score,10); }
function renderDashboard(entries){ if(!entries.length){ dashboardEl.innerHTML='<p>Add entries to reveal patterns.</p>'; return; } const severe=entries.filter(e=>e.severity>=6); const pct=(n,d)=>d?`${((n/d)*100).toFixed(0)}%`:'0%'; const highHumidity=severe.filter(e=>e.weather?.humidityCategory==='High').length; const rain=severe.filter(e=>e.weather?.rain).length; const pressureDrop=severe.filter(e=>(e.weather?.pressureChange??999)<=-4).length; const highPollen=severe.filter(e=>pollenKeys.some(k=>(e.airQuality?.[k]??0)>=30)).length; const pmBad=severe.filter(e=>(e.airQuality?.pm2_5??0)>=25||(e.airQuality?.pm10??0)>=50).length; const avgRisk=(entries.reduce((s,e)=>s+envRisk(e),0)/entries.length).toFixed(1); dashboardEl.innerHTML=`<div class="metric"><strong>Pressure drops on severe days:</strong> ${pressureDrop}/${severe.length} (${pct(pressureDrop,severe.length)})</div><div class="metric"><strong>High humidity on severe days:</strong> ${highHumidity}/${severe.length} (${pct(highHumidity,severe.length)})</div><div class="metric"><strong>Rain on severe days:</strong> ${rain}/${severe.length} (${pct(rain,severe.length)})</div><div class="metric"><strong>High pollen on severe days:</strong> ${highPollen}/${severe.length} (${pct(highPollen,severe.length)})</div><div class="metric"><strong>PM2.5/PM10 elevated on severe days:</strong> ${pmBad}/${severe.length} (${pct(pmBad,severe.length)})</div><div class="metric"><strong>Average environmental risk score:</strong> ${avgRisk}/10</div>`; }

function retryWeather(index){ return async ()=>{ submitStatusEl.textContent='Retrying weather and pollen fetch...'; await refreshEntryWeather(index); submitStatusEl.textContent='Retry complete.'; }; }
function renderEntries(entries){ entriesEl.innerHTML=''; entries.slice().reverse().forEach((e,reverseIdx)=>{ const idx=entries.length-1-reverseIdx; const card=document.createElement('article'); card.className='entry-item'; card.innerHTML=`<h3>${e.date} · Severity ${e.severity}/10</h3><p><strong>Location:</strong> ${e.location?.name || 'Not available'}, ${e.location?.country || ''}</p><p><strong>Weather:</strong> Temp ${fmt(e.weather?.temperature,'°C')}, Humidity ${fmt(e.weather?.humidity,'%')} (${e.weather?.humidityCategory||'Not available'}), Precip ${fmt(e.weather?.precipitation,' mm')}, Pressure ${fmt(e.weather?.pressure,' hPa')}, ΔPressure ${fmt(e.weather?.pressureChange,' hPa')}, Rain: ${e.weather?.rain ? 'Yes':'No'}</p><p><strong>Pollen/Air:</strong> Birch ${fmt(e.airQuality?.birch_pollen)}, Grass ${fmt(e.airQuality?.grass_pollen)}, Mugwort ${fmt(e.airQuality?.mugwort_pollen)}, Olive ${fmt(e.airQuality?.olive_pollen)}, Ragweed ${fmt(e.airQuality?.ragweed_pollen)}, Alder ${fmt(e.airQuality?.alder_pollen)}, Dust ${fmt(e.airQuality?.dust)}, PM2.5 ${fmt(e.airQuality?.pm2_5)}, PM10 ${fmt(e.airQuality?.pm10)}</p><p><strong>Fetch status:</strong> Weather ${e.weatherFetchStatus || 'unknown'} · Pollen ${e.pollenFetchStatus || 'unknown'}</p><p><strong>Env risk score:</strong> ${envRisk(e)}/10</p>`; const b=document.createElement('button'); b.type='button'; b.textContent='Retry weather data'; b.onclick=retryWeather(idx); card.appendChild(b); entriesEl.appendChild(card); }); }
function refresh(){ const entries=loadEntries(); renderEntries(entries); renderDashboard(entries); }

document.getElementById('resolve-location').addEventListener('click', resolveLocation);
document.getElementById('add-custom-trigger').addEventListener('click', ()=>{ const raw=document.getElementById('custom-trigger-input').value.trim().toLowerCase(); if(!raw) return; const combined=[...defaultTriggers,...loadCustomTriggers()].map(t=>t.toLowerCase()); if(combined.includes(raw)) return; const next=[...loadCustomTriggers(),raw]; saveCustomTriggers(next); createTagButtons(triggerTagsEl,[...defaultTriggers,...next],'trigger'); document.getElementById('custom-trigger-input').value=''; });

async function refreshEntryWeather(index){
  const entries = loadEntries();
  const e = entries[index];
  if(!e?.location) return;
  entries[index] = { ...e, weatherFetchStatus: 'pending', pollenFetchStatus: 'pending' };
  saveEntries(entries); refresh();
  try {
    const env = await fetchEnv(e.date, e.location.latitude, e.location.longitude);
    const latest = loadEntries();
    latest[index] = { ...latest[index], ...env };
    saveEntries(latest);
  } catch (err) {
    console.error('Background weather refresh failed', err);
    const latest = loadEntries();
    latest[index] = { ...latest[index], weatherFetchStatus: 'failed', pollenFetchStatus: 'failed' };
    saveEntries(latest);
  }
  refresh();
}

form.addEventListener('submit', async (event)=>{ event.preventDefault(); submitStatusEl.textContent='Saving entry...'; const city = document.getElementById('location-city').value.trim(); if(!city){ submitStatusEl.textContent='Location is required before weather fetch.'; return; } let location = matchedLocation; if(!location) location = await resolveLocation(); if(!location){ submitStatusEl.textContent='Please fix location before saving.'; return; }
  const entry = { date: document.getElementById('entry-date').value, severity:Number(document.getElementById('severity').value), sleep:document.getElementById('sleep').value, stress:document.getElementById('stress').value, mealTime:document.getElementById('meal-time').value, caffeine:document.getElementById('caffeine').value, alcohol:document.getElementById('alcohol').value, hydration:document.getElementById('hydration').value, skippedMeals:document.getElementById('skipped-meals').checked, foodNotes:document.getElementById('food-notes').value.trim(), symptoms:selectedTags('symptom'), triggers:selectedTags('trigger'), notes:document.getElementById('notes').value.trim(), location, weather: {}, weatherFetchStatus: 'pending', airQuality: { unavailable: true }, pollenFetchStatus: 'pending' };
  const entries=loadEntries(); entries.push(entry); const newIndex = entries.length - 1; saveEntries(entries); submitStatusEl.textContent='Entry saved. Fetching weather and pollen in background...'; if(savedConfirmationEl) savedConfirmationEl.textContent='✅ Saved locally';
  form.reset(); document.getElementById('entry-date').valueAsDate = new Date(); document.querySelectorAll('.tag.active').forEach(el=>el.classList.remove('active')); refresh();
  refreshEntryWeather(newIndex);
});

const saved=loadSavedLocation(); if(saved){ document.getElementById('location-city').value=saved.city||''; document.getElementById('location-country').value=saved.country||''; matchedLocation=saved.matchedLocation||null; if(matchedLocation){ locationResultEl.innerHTML=`Saved: <strong>${matchedLocation.name}, ${matchedLocation.country}</strong> (${matchedLocation.latitude.toFixed(4)}, ${matchedLocation.longitude.toFixed(4)})`; }}
createTagButtons(symptomTagsEl, symptomOptions, 'symptom'); createTagButtons(triggerTagsEl, [...defaultTriggers,...loadCustomTriggers()], 'trigger'); refresh();


const rangeFilterEl = document.getElementById('range-filter');
const triggerFilterEl = document.getElementById('trigger-filter');
const symptomFilterEl = document.getElementById('symptom-filter');
const summaryCardsEl = document.getElementById('summary-cards');
const trendsGridEl = document.getElementById('trends-grid');
const calendarViewEl = document.getElementById('calendar-view');

function corr(points){
  const n=points.length; if(n<2) return null;
  const sx=points.reduce((a,p)=>a+p.x,0), sy=points.reduce((a,p)=>a+p.y,0);
  const mx=sx/n,my=sy/n; let num=0,dx=0,dy=0;
  points.forEach(p=>{const a=p.x-mx,b=p.y-my; num+=a*b; dx+=a*a; dy+=b*b;});
  if(!dx||!dy) return null; return num/Math.sqrt(dx*dy);
}
function filterEntries(entries){
  const range=rangeFilterEl?.value||'30'; const t=triggerFilterEl?.value||'all'; const s=symptomFilterEl?.value||'all';
  let out=[...entries]; if(range!=='all'){ const d=new Date(); d.setDate(d.getDate()-Number(range)); out=out.filter(e=>new Date(e.date)>=d); }
  if(t!=='all') out=out.filter(e=>(e.triggers||[]).includes(t));
  if(s!=='all') out=out.filter(e=>(e.symptoms||[]).includes(s));
  return out.sort((a,b)=>a.date.localeCompare(b.date));
}
function lineChart(title, points, yLabel){
  if(!points.length) return `<div class="chart-card"><h4>${title}</h4><p>No data.</p></div>`;
  const w=320,h=140,p=20; const min=Math.min(...points.map(p=>p.y)), max=Math.max(...points.map(p=>p.y)); const span=(max-min)||1;
  const path=points.map((pt,i)=>`${i?'L':'M'} ${p+i*(w-2*p)/Math.max(1,points.length-1)} ${h-p-((pt.y-min)/span)*(h-2*p)}`).join(' ');
  const dots=points.map((pt,i)=>`<circle cx="${p+i*(w-2*p)/Math.max(1,points.length-1)}" cy="${h-p-((pt.y-min)/span)*(h-2*p)}" r="2.5"><title>${pt.label}: ${pt.y}</title></circle>`).join('');
  return `<div class="chart-card"><h4>${title}</h4><svg viewBox="0 0 ${w} ${h}"><path d="${path}" class="line"/>${dots}</svg><p>${yLabel}</p></div>`;
}
function barChart(title, rows){
  if(!rows.length) return `<div class="chart-card"><h4>${title}</h4><p>No data.</p></div>`;
  const top=Math.max(...rows.map(r=>r.value),1);
  return `<div class="chart-card"><h4>${title}</h4>${rows.slice(0,8).map(r=>`<div class="bar-row"><span>${r.label}</span><div class="bar"><i style="width:${(r.value/top)*100}%"></i></div><b>${r.value}</b></div>`).join('')}</div>`;
}
function renderTrends(entries){
  if(!trendsGridEl) return;
  const filtered=filterEntries(entries);
  if(!filtered.length){ trendsGridEl.innerHTML='<p>No entries for selected filters.</p>'; summaryCardsEl.innerHTML=''; calendarViewEl.innerHTML=''; return; }
  const p=(f)=>filtered.filter(e=>e[f]!=null&&e[f]!=='').map(e=>({label:e.date,y:Number(e[f])}));
  const pw=(f)=>filtered.filter(e=>e.weather?.[f]!=null).map(e=>({label:e.date,y:Number(e.weather[f])}));
  const sev=filtered.map(e=>({label:e.date,y:Number(e.severity)}));
  const pollen=filtered.map(e=>({label:e.date,y: [e.airQuality?.birch_pollen,e.airQuality?.grass_pollen,e.airQuality?.mugwort_pollen,e.airQuality?.olive_pollen,e.airQuality?.ragweed_pollen,e.airQuality?.alder_pollen].filter(v=>v!=null).reduce((a,b)=>a+b,0)})).filter(x=>x.y>0);
  const triggerCounts={}; const symptomCounts={};
  filtered.forEach(e=>{(e.triggers||[]).forEach(t=>triggerCounts[t]=(triggerCounts[t]||0)+1); (e.symptoms||[]).forEach(t=>symptomCounts[t]=(symptomCounts[t]||0)+1);});
  trendsGridEl.innerHTML = [
    lineChart('Migraine severity over time', sev, 'Severity 0-10'),
    lineChart('Air pressure over time', pw('pressure'), 'hPa'),
    lineChart('Humidity over time', pw('humidity'), '%'),
    lineChart('Sleep quality vs migraine severity', p('sleep'), 'hours (compare with severity line visually)'),
    lineChart('Stress level vs migraine severity', p('stress'), 'stress score'),
    lineChart('Hydration vs migraine severity', p('hydration'), 'hydration score'),
    lineChart('Caffeine intake vs migraine severity', p('caffeine'), 'mg'),
    lineChart('Pollen level vs migraine severity', pollen, 'total pollen index'),
    barChart('Trigger frequency over time', Object.entries(triggerCounts).map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value)),
    barChart('Symptom frequency over time', Object.entries(symptomCounts).map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value)),
  ].join('');

  const avg=(arr)=>arr.length?(arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1):'N/A';
  const strongest=[
    {label:'Sleep vs Severity',v:corr(filtered.filter(e=>e.sleep!=='').map(e=>({x:Number(e.sleep),y:Number(e.severity)})))},
    {label:'Stress vs Severity',v:corr(filtered.filter(e=>e.stress!=='').map(e=>({x:Number(e.stress),y:Number(e.severity)})))},
    {label:'Hydration vs Severity',v:corr(filtered.filter(e=>e.hydration!=='').map(e=>({x:Number(e.hydration),y:Number(e.severity)})))},
    {label:'Pressure vs Severity',v:corr(filtered.filter(e=>e.weather?.pressure!=null).map(e=>({x:Number(e.weather.pressure),y:Number(e.severity)})))},
  ].filter(x=>x.v!=null).sort((a,b)=>Math.abs(b.v)-Math.abs(a.v))[0];
  const topTrig=Object.entries(triggerCounts).sort((a,b)=>b[1]-a[1])[0]?.[0]||'N/A';
  const topSym=Object.entries(symptomCounts).sort((a,b)=>b[1]-a[1])[0]?.[0]||'N/A';
  summaryCardsEl.innerHTML = `
    <div class="sum-card"><strong>Average migraine severity</strong><span>${avg(filtered.map(e=>Number(e.severity)))}</span></div>
    <div class="sum-card"><strong>Number of migraine days</strong><span>${filtered.filter(e=>Number(e.severity)>0).length}</span></div>
    <div class="sum-card"><strong>Most common trigger</strong><span>${topTrig}</span></div>
    <div class="sum-card"><strong>Most common symptom</strong><span>${topSym}</span></div>
    <div class="sum-card"><strong>Average sleep quality</strong><span>${avg(filtered.filter(e=>e.sleep!=='').map(e=>Number(e.sleep)))}</span></div>
    <div class="sum-card"><strong>Average stress level</strong><span>${avg(filtered.filter(e=>e.stress!=='').map(e=>Number(e.stress)))}</span></div>
    <div class="sum-card"><strong>Average air pressure</strong><span>${avg(filtered.filter(e=>e.weather?.pressure!=null).map(e=>Number(e.weather.pressure)))}</span></div>
    <div class="sum-card"><strong>Strongest suspected correlation</strong><span>${strongest?`${strongest.label} (${strongest.v.toFixed(2)})`:'N/A'}</span></div>`;

  calendarViewEl.innerHTML = filtered.map(e=>{const s=Number(e.severity)||0; const op=0.15+s/12; const dot=(e.weather?.rain?'🌧️':'')+(e.airQuality?.pm2_5?'🌿':''); return `<div class="day" style="background:rgba(43,109,233,${op})" title="${e.date} severity ${s}">${e.date.slice(5)}<small>${s}/10 ${dot}</small></div>`;}).join('');
}

function populateTrendFilters(entries){
  if(!triggerFilterEl||!symptomFilterEl) return;
  const ts=[...new Set(entries.flatMap(e=>e.triggers||[]))].sort(); const ss=[...new Set(entries.flatMap(e=>e.symptoms||[]))].sort();
  triggerFilterEl.innerHTML='<option value="all">All triggers</option>'+ts.map(t=>`<option value="${t}">${t}</option>`).join('');
  symptomFilterEl.innerHTML='<option value="all">All symptoms</option>'+ss.map(t=>`<option value="${t}">${t}</option>`).join('');
}

const _refresh = refresh;
refresh = function(){ const entries=loadEntries(); renderEntries(entries); renderDashboard(entries); populateTrendFilters(entries); renderTrends(entries); }
if(rangeFilterEl){ [rangeFilterEl,triggerFilterEl,symptomFilterEl].forEach(el=>el?.addEventListener('change', ()=>refresh())); }


function initExperienceUi(){
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panels = Array.from(document.querySelectorAll('.tab-panel'));
  tabs.forEach((tab)=>tab.addEventListener('click', ()=>{
    tabs.forEach(t=>t.classList.remove('active')); panels.forEach(p=>p.classList.remove('active'));
    tab.classList.add('active');
    const panel = document.getElementById(`tab-${tab.dataset.tab}`);
    if(panel) panel.classList.add('active');
    window.scrollTo({top:0, behavior:'smooth'});
  }));

  const onboarding = document.getElementById('onboarding');
  const startBtn = document.getElementById('start-app');
  const seen = localStorage.getItem(ONBOARDING_KEY) === '1';
  if(onboarding && !seen){ onboarding.classList.remove('hidden'); }
  if(startBtn){ startBtn.addEventListener('click', ()=>{ localStorage.setItem(ONBOARDING_KEY, '1'); onboarding?.classList.add('hidden'); }); }
}

initExperienceUi();
