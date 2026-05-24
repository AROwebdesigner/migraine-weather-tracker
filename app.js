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
const savedConfirmationEl = document.getElementById('saved-confirmation');
const exportDataBtn = document.getElementById('export-data');
const importDataInput = document.getElementById('import-data');
const clearDataBtn = document.getElementById('clear-data');
const pressureForecastEl = document.getElementById('pressure-forecast');
const migraineForecastEl = document.getElementById('migraine-forecast');
const pressureTimelineEl = document.getElementById('pressure-timeline');
const pressureInsightsEl = document.getElementById('pressure-insights');
let matchedLocation = null;

const chartEls = {
  severity: document.getElementById('chart-severity'),
  pressure: document.getElementById('chart-pressure'),
  sleep: document.getElementById('chart-sleep'),
  triggers: document.getElementById('chart-triggers'),
  symptoms: document.getElementById('chart-symptoms')
};
const chartCache = {};
const chartModalEl = document.getElementById('chart-modal');
const chartModalTitleEl = document.getElementById('chart-modal-title');
const chartModalCanvasEl = document.getElementById('chart-modal-canvas');
const closeChartModalBtn = document.getElementById('close-chart-modal');
let modalChart = null;

const forecast5DayEl = document.getElementById('forecast-5day');
let forecastCache = {};

function riskLevelFromScore(score){
  if(score<=2.5) return 'Low';
  if(score<=5) return 'Moderate';
  if(score<=7.5) return 'High';
  return 'Very High';
}

function analyzeDayPressure(dayHours, historyMatch=false){
  const p = dayHours.pressure;
  const h = dayHours.humidity;
  const pp = dayHours.precipProb;
  const pr = dayHours.precip;
  const cc = dayHours.cloud;
  const velocity=[]; const acceleration=[];
  for(let i=1;i<p.length;i++) velocity.push(p[i]-p[i-1]);
  for(let i=1;i<velocity.length;i++) acceleration.push(velocity[i]-velocity[i-1]);
  const maxHourlyDrop = velocity.length ? Math.min(...velocity) : 0;
  const total24hDrop = p.length ? p[p.length-1]-p[0] : 0;
  const volatility = velocity.reduce((s,v)=>s+Math.abs(v),0);
  const accelerationSpikes = acceleration.filter(v=>Math.abs(v)>=2).length;
  const avgHumidity = avg(h) || 0;
  const avgCloud = avg(cc) || 0;
  const rainSignal = (avg(pp)||0)>=50 || (pr||[]).some(v=>v>0);

  let score=0; const drivers=[];
  if(maxHourlyDrop<=-1.5){ score+=1; drivers.push('hourly pressure drop'); }
  if(maxHourlyDrop<=-2.5){ score+=2; drivers.push('strong hourly pressure drop'); }
  if(total24hDrop<=-4){ score+=1.5; drivers.push('24h pressure drop'); }
  if(total24hDrop<=-7){ score+=2.5; drivers.push('large 24h pressure drop'); }
  if(volatility>=10){ score+=1.5; drivers.push('unstable atmospheric conditions'); }
  if(accelerationSpikes>=1){ score+=1.5; drivers.push('rapid pressure transition'); }
  if(avgHumidity>75){ score+=1; drivers.push('high humidity'); }
  if(rainSignal){ score+=1; drivers.push('rain/storm signal'); }
  if(avgCloud>80){ score+=0.75; drivers.push('heavy cloud cover'); }
  if(historyMatch){ score+=1.5; drivers.push('history pattern match'); }
  score=Math.max(0,Math.min(10,Number(score.toFixed(1))));

  return { score, level:riskLevelFromScore(score), drivers, maxHourlyDrop, total24hDrop, volatility:Number(volatility.toFixed(2)), accelerationSpikes, avgHumidity:Number(avgHumidity.toFixed(1)), avgCloud:Number(avgCloud.toFixed(1)), rainSignal };
}

function suggestionForRisk(analysis){
  const tips=[];
  if(analysis.avgHumidity>75) tips.push('Keep hydrated and avoid overheating.');
  if(analysis.maxHourlyDrop<=-1.5 || analysis.total24hDrop<=-4) tips.push('Consider preparing migraine medication if prescribed and monitor early symptoms.');
  if(analysis.rainSignal) tips.push('Consider reducing intense outdoor plans.');
  if(analysis.level==='High' || analysis.level==='Very High') tips.push('Prioritise sleep, hydration, regular meals and lower sensory load.');
  if(!tips.length) tips.push('Conditions look relatively stable. Continue normal routine.');
  tips.push('May increase risk; possible trigger; not medical advice.');
  return tips;
}

async function renderFiveDayForecast(entries){
  if(!forecast5DayEl) return;
  forecast5DayEl.innerHTML = '<p class="empty">Loading forecast…</p>';
  try {
    const loc = matchedLocation || entries.at(-1)?.location;
    if(!loc){ forecast5DayEl.innerHTML = '<p class="empty">Set location to view 5-day risk forecast.</p>'; return; }
    const start = new Date(); const end = new Date(); end.setDate(end.getDate()+4);
    const sd=start.toISOString().slice(0,10), ed=end.toISOString().slice(0,10);
    const url=`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&start_date=${sd}&end_date=${ed}&hourly=pressure_msl,surface_pressure,relative_humidity_2m,precipitation_probability,precipitation,cloud_cover&timezone=auto`;
    const res = await fetchWithTimeout(url, 5000);
    if(!res.ok) throw new Error(`Forecast HTTP ${res.status}`);
    const data = await res.json(); const h=data.hourly||{};
    const days={};
    (h.time||[]).forEach((t,i)=>{ const d=t.slice(0,10); if(!days[d]) days[d]={pressure:[],humidity:[],precipProb:[],precip:[],cloud:[]}; days[d].pressure.push((h.pressure_msl?.[i] ?? h.surface_pressure?.[i]) ?? null); days[d].humidity.push(h.relative_humidity_2m?.[i] ?? null); days[d].precipProb.push(h.precipitation_probability?.[i] ?? null); days[d].precip.push(h.precipitation?.[i] ?? null); days[d].cloud.push(h.cloud_cover?.[i] ?? null); });

    const severe = entries.filter(e=>e.severity>=7);
    const cards = Object.entries(days).slice(0,5).map(([date,vals])=>{
      vals.pressure = vals.pressure.filter(v=>v!=null);
      const historyMatch = severe.some(e=>Math.abs((e.weather?.pressureChange||0) - (vals.pressure.length?vals.pressure[vals.pressure.length-1]-vals.pressure[0]:0)) <= 2);
      const analysis = analyzeDayPressure(vals, historyMatch);
      forecastCache[date]=analysis;
      const tips=suggestionForRisk(analysis);
      return `<article class="forecast-card risk-${analysis.level.toLowerCase().replace(' ','-')}"><h4>${new Date(date).toLocaleDateString(undefined,{weekday:'long', month:'short', day:'numeric'})}</h4><p><strong>Risk:</strong> ${analysis.score}/10 — ${analysis.level}</p><p><strong>Drivers:</strong> ${(analysis.drivers.join(' · ')||'No major atmospheric drivers')}</p><p><strong>Pressure trend:</strong> drop ${analysis.maxHourlyDrop.toFixed(1)} hPa/h, 24h ${analysis.total24hDrop.toFixed(1)} hPa</p><p><strong>Humidity:</strong> ${analysis.avgHumidity}% · <strong>Rain/Cloud:</strong> ${analysis.rainSignal?'signal':'none'} / ${analysis.avgCloud}%</p><ul>${tips.map(t=>`<li>${t}</li>`).join('')}</ul></article>`;
    });
    forecast5DayEl.innerHTML = cards.join('');
  } catch (err) {
    console.error('5-day forecast failed', err);
    forecast5DayEl.innerHTML = '<p class="empty">Forecast temporarily unavailable. Try refreshing later.</p>';
  }
}

function applyForecastBadges(){
  if(!calendarHeatmapEl) return;
  const y=currentCalendarDate.getFullYear(); const m=currentCalendarDate.getMonth();
  Array.from(calendarHeatmapEl.children).forEach((cell,idx)=>{
    if(cell.classList.contains('empty')) return;
    const dayNum = Number(cell.textContent)||null;
    if(!dayNum) return;
  });
}


// Calendar heatmap (incremental feature; preserves existing architecture)
const calendarHeatmapEl = document.getElementById('calendar-heatmap');
const calendarMonthLabelEl = document.getElementById('calendar-month-label');
const calendarPrevBtn = document.getElementById('prev-month');
const calendarNextBtn = document.getElementById('next-month');
let currentCalendarDate = new Date();
currentCalendarDate.setDate(1);
let calendarViewMode = 'month';
const calendarYearViewEl = document.getElementById('calendar-year-view');
const calendarViewMonthBtn = document.getElementById('calendar-view-month');
const calendarViewYearBtn = document.getElementById('calendar-view-year');

function severityClass(sev){
  if(sev<=2) return 'sev-0';
  if(sev<=4) return 'sev-3';
  if(sev<=6) return 'sev-5';
  if(sev<=8) return 'sev-7';
  return 'sev-9';
}

function buildSeverityMap(entries){
  const map={};
  entries.forEach(e=>{ if(!e.date) return; const s=Number(e.severity||0); map[e.date]=Math.max(map[e.date]||0,s); });
  return map;
}

function renderCalendarHeatmap(entries){
  if(!calendarHeatmapEl || !calendarMonthLabelEl) return;
  const y=currentCalendarDate.getFullYear(); const m=currentCalendarDate.getMonth();
  calendarMonthLabelEl.textContent = currentCalendarDate.toLocaleDateString(undefined,{month:'long', year:'numeric'});
  const first = new Date(y,m,1); const startOffset=(first.getDay()+6)%7;
  const daysInMonth = new Date(y,m+1,0).getDate();
  const severityMap = buildSeverityMap(entries);
  const entryMap = Object.fromEntries(entries.filter(e=>e.date).map(e=>[e.date,e]));
  const cells=[];
  for(let i=0;i<startOffset;i++) cells.push('<div class="heat-cell empty"></div>');
  for(let d=1; d<=daysInMonth; d++){
    const date = new Date(y,m,d); const key=date.toISOString().slice(0,10);
    const sev = severityMap[key];
    const e = entryMap[key];
    const tip = e ? `${key}
Severity: ${sev}
Symptoms: ${(e.symptoms||[]).join(', ')||'-'}
Triggers: ${(e.triggers||[]).join(', ')||'-'}
Pressure: ${e.weather?.pressure ?? 'N/A'}` : `${key}: no migraine logged`;
    if(sev==null) cells.push(`<div class="heat-cell" data-date="${key}" title="${tip}"><span class="day-num">${d}</span></div>`);
    else cells.push(`<div class="heat-cell ${severityClass(sev)}" data-date="${key}" title="${tip}"><span class="day-num">${d}</span></div>`);
  }
  calendarHeatmapEl.innerHTML = cells.join('');
  try {
    calendarHeatmapEl.querySelectorAll('.heat-cell[data-date]').forEach((cell)=>{
      const date = cell.dataset.date; const f = forecastCache[date];
      if(f){ cell.classList.add('forecast-cell'); const dot=document.createElement('i'); dot.className=`forecast-dot risk-${f.level.toLowerCase().replace(' ','-')}`; cell.appendChild(dot); const prev=cell.getAttribute('title')||''; cell.setAttribute('title', `${prev}\nForecast risk: ${f.score}/10 (${f.level})`); }
    });
  } catch(err){ console.error('Forecast badge render failed', err); }
}

function renderAnnualHeatmap(entries){
  if(!calendarYearViewEl) return;
  const y=currentCalendarDate.getFullYear();
  const severityMap = buildSeverityMap(entries);
  const months=[];
  for(let m=0;m<12;m++){
    const first = new Date(y,m,1); const startOffset=(first.getDay()+6)%7; const daysInMonth = new Date(y,m+1,0).getDate();
    const cells=[]; for(let i=0;i<startOffset;i++) cells.push('<div class="heat-cell empty"></div>');
    for(let d=1; d<=daysInMonth; d++){
      const key=new Date(y,m,d).toISOString().slice(0,10); const sev=severityMap[key];
      cells.push(sev==null?'<div class="heat-cell"></div>':`<div class="heat-cell ${severityClass(sev)}" title="${key}: severity ${sev}"></div>`);
    }
    months.push(`<div class="mini-month"><strong>${new Date(y,m,1).toLocaleDateString(undefined,{month:'short'})}</strong><div class="calendar-heatmap">${cells.join('')}</div></div>`);
  }
  calendarYearViewEl.innerHTML = months.join('');
}

function renderCalendar(entries){
  try {
    renderCalendarHeatmap(entries);
    renderAnnualHeatmap(entries);
    const monthMode = calendarViewMode==='month';
    calendarHeatmapEl?.classList.toggle('hidden', !monthMode);
    calendarYearViewEl?.classList.toggle('hidden', monthMode);
    calendarViewMonthBtn?.classList.toggle('active', monthMode);
    calendarViewYearBtn?.classList.toggle('active', !monthMode);
  } catch (err) {
    console.error('Calendar render failed (non-blocking)', err);
  }
}




document.getElementById('entry-date').valueAsDate = new Date();

const jget=(k,d='[]')=>JSON.parse(localStorage.getItem(k)||d);
const jset=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const loadEntries=()=>{ const data=jget(STORAGE_KEYS.entries); console.log('Loaded entries from localStorage', data.length); return data; };
const saveEntries=(v)=>{ jset(STORAGE_KEYS.entries,v); console.log('Saved entries to localStorage', v.length); };
const loadCustomTriggers=()=>jget(STORAGE_KEYS.customTriggers);
const saveCustomTriggers=(v)=>jset(STORAGE_KEYS.customTriggers,v);
const loadSavedLocation=()=>jget(STORAGE_KEYS.savedLocation,'null');
const saveSavedLocation=(v)=>jset(STORAGE_KEYS.savedLocation,v);

function fetchWithTimeout(url, timeoutMs = 5000){ const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeoutMs); return fetch(url,{signal:c.signal}).finally(()=>clearTimeout(t)); }
const avg=(arr)=>Array.isArray(arr)&&arr.filter(v=>v!=null).length?Number((arr.filter(v=>v!=null).reduce((a,b)=>a+b,0)/arr.filter(v=>v!=null).length).toFixed(2)):null;
const fmt=(v,u='')=>v==null||v===''?'Not available':`${Number(v).toFixed(1)}${u}`;
const humidityCategory=(h)=>h==null?'Not available':h>=75?'High':h>=45?'Moderate':'Low';

function createTagButtons(container, tags, type){ container.innerHTML=''; tags.forEach(tag=>{const b=document.createElement('button'); b.type='button'; b.className='tag'; b.dataset.value=tag; b.dataset.type=type; b.textContent=tag; b.onclick=()=>b.classList.toggle('active'); container.appendChild(b);}); }
const selectedTags=(type)=>Array.from(document.querySelectorAll(`.tag[data-type="${type}"].active`)).map(el=>el.dataset.value);

// Normalize user country input to Open-Meteo countryCode compatibility.
function normalizeCountryCode(input){
  if(!input) return '';
  const v = input.trim().toUpperCase();
  const map = { JAPAN: 'JP', UK: 'GB', ENGLAND: 'GB', BRITAIN: 'GB', 'UNITED KINGDOM': 'GB' };
  return map[v] || v;
}


async function resolveLocation(){
  const city = document.getElementById('location-city').value.trim();
  const country = document.getElementById('location-country').value.trim();
  if(!city) return null;
  const cc = country ? `&countryCode=${encodeURIComponent(normalizeCountryCode(country))}` : '';
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json${cc}`;
  try { const r=await fetchWithTimeout(url,5000); const d=await r.json(); const m=d.results?.[0]; if(!m) return null; matchedLocation={name:m.name,country:m.country,latitude:m.latitude,longitude:m.longitude}; saveSavedLocation({city,country,matchedLocation}); locationResultEl.textContent=`${m.name}, ${m.country}`; return matchedLocation; }
  catch(e){ console.error('Location lookup failed', e); return null; }
}

function weatherBase(date){ return date < new Date().toISOString().slice(0,10) ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast'; }
async function fetchHourly(date, lat, lon){
  const url = `${weatherBase(date)}?latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&hourly=pressure_msl,surface_pressure,relative_humidity_2m,precipitation,precipitation_probability,temperature_2m,weather_code,cloud_cover&timezone=auto`;
  const r=await fetchWithTimeout(url,5000); if(!r.ok) throw new Error(`Weather HTTP ${r.status}`); return r.json();
}
async function fetchAir(date, lat, lon){
  const url=`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&hourly=pm2_5,pm10,dust,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen&timezone=auto`;
  const r=await fetchWithTimeout(url,5000); if(!r.ok) throw new Error(`Air HTTP ${r.status}`); return r.json();
}

function calculatePressureRisk(hourlyData, hadPrevDropMigraine=false){
  const p = hourlyData.pressure_msl || hourlyData.surface_pressure || [];
  const h = hourlyData.relative_humidity_2m || [];
  const pr = hourlyData.precipitation || [];
  const pp = hourlyData.precipitation_probability || [];
  const cc = hourlyData.cloud_cover || [];
  if(!p.length) return { level:'Unavailable', score:0, reason:'Pressure data unavailable.', labels:[] };

  const last6 = p.length>=7 ? p[p.length-1]-p[p.length-7] : 0;
  const next6 = p.length>=13 ? p[12]-p[0] : 0;
  const next24Series = p.slice(0,25);

  let maxDrop = 0; let maxRise = 0; const absChanges=[]; const deltas=[];
  for(let i=1;i<next24Series.length;i++){
    const d = next24Series[i]-next24Series[i-1]; deltas.push(d);
    if(d < maxDrop) maxDrop = d; if(d > maxRise) maxRise = d; absChanges.push(Math.abs(d));
  }
  const volatility = absChanges.length ? Number(absChanges.reduce((a,b)=>a+b,0).toFixed(2)) : 0;
  const avgHourlyChange = absChanges.length ? Number((absChanges.reduce((a,b)=>a+b,0)/absChanges.length).toFixed(2)) : 0;
  const rapidFluctuation = absChanges.filter(v=>v>=1.8).length >= 3 || volatility >= 16;

  // new atmospheric intelligence signals
  const avgCloud = cc.length ? avg(cc) : 0;
  const avgHumidity = h.length ? avg(h) : 0;
  const avgPrecipProb = pp.length ? avg(pp) : 0;
  const rainNow = (pr[0]||0) > 0;
  const pressureAcceleration = deltas.length>=3 ? Math.abs((deltas[deltas.length-1]||0) - (deltas[deltas.length-3]||0)) : 0;
  const stormFrontDetected = (maxDrop<=-4 && avgCloud>=70) || (avgPrecipProb>=60 && avgCloud>=75);
  const unstableAtmosphere = rapidFluctuation || (volatility>=14 && avgCloud>=65) || pressureAcceleration>=2.2;
  const weatherTransition = (maxDrop<=-3 && maxRise>=2.5) || pressureAcceleration>=1.5;

  let score=0;
  if(next6<=-3 || last6<=-3 || maxDrop<=-3) score+=1;
  if(next6<=-5 || last6<=-5 || maxDrop<=-5) score+=2;
  if(maxDrop<=-8) score+=2;
  if(maxDrop<=-10) score+=3;
  if(rapidFluctuation) score+=1.5;
  if(stormFrontDetected) score+=1.5;
  if(unstableAtmosphere) score+=1.5;
  if(weatherTransition) score+=1;
  if(rainNow) score+=0.7;
  if((avgPrecipProb||0)>=70) score+=0.7;
  if((avgHumidity||0)>80) score+=0.8;
  if((avgCloud||0)>85) score+=0.8;
  if(pressureAcceleration>=2.5) score+=1;
  if(hadPrevDropMigraine) score+=1;

  // dampening so model is nuanced and not always high
  if(score>0 && maxDrop>-2.5 && !unstableAtmosphere && (avgCloud||0)<60 && !rainNow) score -= 1;
  if(score<0) score = 0;

  const level = score>=8?'Very High':score>=5.5?'High':score>=3.2?'Moderate':'Low';

  let state='Stable';
  if(stormFrontDetected) state='Storm front detected';
  else if(unstableAtmosphere) state='Unstable atmospheric conditions';
  else if(weatherTransition) state='Rapid pressure transition';
  else if((avgCloud||0)>=80) state='Heavy cloud cover';
  else if(volatility>=8 || avgHourlyChange>=1.0) state='Mild fluctuation';

  const labels=[];
  if(stormFrontDetected) labels.push('storm front detected');
  if(unstableAtmosphere) labels.push('unstable atmospheric conditions');
  if(weatherTransition) labels.push('rapid pressure transition');
  if((avgCloud||0)>=80) labels.push('heavy cloud cover');

  const reason = state==='Stable'
    ? 'Atmosphere appears relatively stable; migraine risk may be lower right now.'
    : `${state} may increase risk.`;

  return { level, score:Number(score.toFixed(1)), reason, state, labels, last6, next6, current:p[0], humidity:h[0], rain:rainNow, maxDrop, maxRise, volatility, avgHourlyChange, rapidFluctuation, cloudCover:avgCloud, precipProbability:avgPrecipProb, pressureAcceleration };
}


// Weather and pollen enrichment (non-blocking after save).
async function fetchEnv(date, lat, lon){
  const prevDate = new Date(date); prevDate.setDate(prevDate.getDate()-1); const pd=prevDate.toISOString().slice(0,10);
  let weather={}, weatherFetchStatus='success', hourly={}, prevHourly={};
  try { hourly=(await fetchHourly(date,lat,lon)).hourly||{}; prevHourly=(await fetchHourly(pd,lat,lon)).hourly||{};
    weather={ temperature:avg(hourly.temperature_2m), humidity:avg(hourly.relative_humidity_2m), precipitation:(hourly.precipitation||[]).reduce((a,b)=>a+(b||0),0), pressure:avg(hourly.pressure_msl)||avg(hourly.surface_pressure), weatherCode:hourly.weather_code?.[0]??null,
      pressureChange: ((avg(hourly.pressure_msl)||0)-(avg(prevHourly.pressure_msl)||0)).toFixed ? Number(((avg(hourly.pressure_msl)||0)-(avg(prevHourly.pressure_msl)||0)).toFixed(1)) : null,
      humidityCategory:humidityCategory(avg(hourly.relative_humidity_2m)), rain:(hourly.precipitation||[]).some(v=>v>0) };
  } catch(e){ weatherFetchStatus='failed'; console.error('Weather fetch failed', { error:e, date, lat, lon, url: `${weatherBase(date)}?latitude=${lat}&longitude=${lon}` }); }
  let airQuality={ unavailable:true }, pollenFetchStatus='unavailable';
  try { const a=(await fetchAir(date,lat,lon)).hourly||{}; airQuality={pm2_5:avg(a.pm2_5),pm10:avg(a.pm10),dust:avg(a.dust)}; pollenKeys.forEach(k=>airQuality[k]=avg(a[k])); pollenFetchStatus=Object.values(airQuality).some(v=>v!=null)?'success':'unavailable'; }
  catch(e){ pollenFetchStatus='failed'; console.error('Pollen fetch failed', { error:e, date, lat, lon, url:`https://air-quality-api.open-meteo.com/v1/air-quality` }); }
  return { weather, weatherFetchStatus, airQuality, pollenFetchStatus, hourlySnapshot: hourly };
}

async function refreshEntryWeather(index){
  const entries=loadEntries(); const e=entries[index]; if(!e?.location) return;
  entries[index]={...e,localStatus:'Saved locally',weatherFetchStatus:'pending',pollenFetchStatus:'pending'}; saveEntries(entries); refresh();
  try{ const env=await fetchEnv(e.date,e.location.latitude,e.location.longitude); const latest=loadEntries(); latest[index]={...latest[index],...env,localStatus: (env.weatherFetchStatus==='success' ? 'Weather added' : 'Saved locally')}; saveEntries(latest); }
  catch{ const latest=loadEntries(); latest[index]={...latest[index],localStatus:'Weather failed',weatherFetchStatus:'failed',pollenFetchStatus:'failed'}; saveEntries(latest); }
  refresh();
}


function statusSummary(entry){
  const w = entry.weatherFetchStatus || 'pending';
  const p = entry.pollenFetchStatus || 'pending';
  if(w==='failed') return 'Weather failed — saved locally. Retry available.';
  if(w==='success' && (p==='failed' || p==='unavailable')) return 'Weather success · Pollen unavailable';
  if(w==='success' && p==='success') return 'Weather success · Pollen success';
  return 'Weather pending · saved locally';
}

function retryWeather(index){ return async ()=>{ try { submitStatusEl.textContent='Retrying weather...'; await refreshEntryWeather(index); submitStatusEl.textContent='Weather retry finished.'; } catch (e) { console.error('Retry weather failed', e); submitStatusEl.textContent='Weather failed.'; } }; }
function renderEntries(entries){ entriesEl.innerHTML=''; if(!entries.length){ entriesEl.innerHTML='<p class="empty">No entries yet.</p>'; return; } entries.slice().reverse().forEach((e,ri)=>{const idx=entries.length-1-ri; const card=document.createElement('article'); card.className='entry-item'; card.innerHTML=`<h3>${e.date} · Severity ${e.severity}/10</h3><p><strong>Pressure:</strong> ${fmt(e.weather?.pressure,' hPa')} · <strong>Pressure change:</strong> ${fmt(e.weather?.pressureChange,' hPa')}</p><p><strong>Humidity:</strong> ${fmt(e.weather?.humidity,'%')} · <strong>Rain:</strong> ${e.weather?.rain?'Yes':'No'} · <strong>PM2.5:</strong> ${fmt(e.airQuality?.pm2_5)} · <strong>Pollen:</strong> ${fmt(e.airQuality?.birch_pollen)}</p><p><strong>Weather:</strong> ${e.weatherFetchStatus||'pending'} · <strong>Pollen:</strong> ${e.pollenFetchStatus||'pending'}</p><p><strong>Status:</strong> ${statusSummary(e)}</p>`; const b=document.createElement('button'); b.textContent='Retry weather'; b.onclick=retryWeather(idx); const d=document.createElement('button'); d.type='button'; d.textContent='Delete'; d.onclick=()=>deleteEntry(idx); card.appendChild(b); card.appendChild(d); entriesEl.appendChild(card); }); }

function renderPressureForecast(entries){
  if(!pressureForecastEl) return;
  const loc = matchedLocation || entries.at(-1)?.location;
  if(!loc){ pressureForecastEl.innerHTML='<p class="empty">Set location to view pressure forecast.</p>'; return; }
  fetchHourly(new Date().toISOString().slice(0,10), loc.latitude, loc.longitude).then((d)=>{
    const hadPrevDropMigraine = entries.some(e=>(e.weather?.pressureChange??0)<=-3 && e.severity>=6);
    const r=calculatePressureRisk(d.hourly||{}, hadPrevDropMigraine);
    pressureForecastEl.innerHTML=`<div class="metric"><strong>Current:</strong> ${fmt(r.current,' hPa')}</div><div class="metric"><strong>Last 6h:</strong> ${fmt(r.last6,' hPa')}</div><div class="metric"><strong>Next 6h:</strong> ${fmt(r.next6,' hPa')}</div><div class="metric"><strong>Max drop:</strong> ${fmt(r.maxDrop,' hPa')}</div><div class="metric"><strong>Max rise:</strong> ${fmt(r.maxRise,' hPa')}</div><div class="metric"><strong>Volatility:</strong> ${fmt(r.volatility,' hPa')}</div><div class="metric"><strong>Avg hourly change:</strong> ${fmt(r.avgHourlyChange,' hPa')}</div><div class="metric"><strong>頭痛リスク:</strong> <span class="pill">${r.level}</span></div><div class="metric">${r.reason} (${r.state}) 湿度 ${fmt(r.humidity,'%')} · 雨 ${r.rain?'☔':'—'}</div>`;
    renderPressureTimeline(d.hourly||{}, entries);
    renderMigraineForecast(r);
  }).catch(()=>{ pressureForecastEl.innerHTML='<p class="empty">Forecast unavailable.</p>'; });
}


function emptyChartState(canvas, message='Add more entries to see this chart.'){
  if(!canvas) return;
  const card = canvas.closest('.chart-card');
  if(card){
    if(!card.querySelector('.chart-empty')){ const p=document.createElement('p'); p.className='empty chart-empty'; p.textContent=message; card.appendChild(p);} 
  }
}
function clearChartEmpty(canvas){ const card=canvas?.closest('.chart-card'); const n=card?.querySelector('.chart-empty'); if(n) n.remove(); }

function openChartModal(key){
  if(!chartModalEl || !window.Chart || !chartEls[key]) return;
  const src = chartCache[key];
  if(!src) return;
  chartModalTitleEl.textContent = src.config.data.datasets?.[0]?.label || key;
  chartModalEl.classList.remove('hidden');
  if(modalChart) modalChart.destroy();
  modalChart = new Chart(chartModalCanvasEl.getContext('2d'), JSON.parse(JSON.stringify(src.config)));
}

function upsertChart(key, config){
  if(!window.Chart || !chartEls[key]) return;
  clearChartEmpty(chartEls[key]);
  if(chartCache[key]) chartCache[key].destroy();
  chartCache[key] = new Chart(chartEls[key].getContext('2d'), config);
}

function renderTrendCharts(entries){
  if(!window.Chart) return;
  const sorted=[...entries].sort((x,y)=>x.date.localeCompare(y.date));
  const labels=sorted.map(e=>e.date);
  if(sorted.length<2){emptyChartState(chartEls.severity); if(chartCache.severity){chartCache.severity.destroy(); delete chartCache.severity;}} else upsertChart('severity',{type:'line',data:{labels,datasets:[{label:'Severity',data:sorted.map(e=>e.severity),borderColor:'#8a735d',backgroundColor:'rgba(138,115,93,.2)'}]},options:{responsive:true,maintainAspectRatio:false}});

  const pressurePts=sorted.filter(e=>e.weather?.pressure!=null).map(e=>({x:e.weather.pressure,y:e.severity}));
  if(pressurePts.length<2){emptyChartState(chartEls.pressure); if(chartCache.pressure){chartCache.pressure.destroy(); delete chartCache.pressure;}} else upsertChart('pressure',{type:'scatter',data:{datasets:[{label:'Pressure vs Severity',data:pressurePts,backgroundColor:'#6f7f5f'}]},options:{responsive:true,maintainAspectRatio:false,scales:{x:{title:{display:true,text:'Pressure'}},y:{title:{display:true,text:'Severity'}}}}});

  const sleepPts=sorted.filter(e=>e.sleep!==''&&e.sleep!=null).map(e=>({x:Number(e.sleep),y:e.severity}));
  if(sleepPts.length<2){emptyChartState(chartEls.sleep); if(chartCache.sleep){chartCache.sleep.destroy(); delete chartCache.sleep;}} else upsertChart('sleep',{type:'scatter',data:{datasets:[{label:'Sleep vs Severity',data:sleepPts,backgroundColor:'#9b856e'}]},options:{responsive:true,maintainAspectRatio:false,scales:{x:{title:{display:true,text:'Sleep (h)'}},y:{title:{display:true,text:'Severity'}}}}});

  const tc={}; const sc={}; sorted.forEach(e=>{(e.triggers||[]).forEach(t=>tc[t]=(tc[t]||0)+1); (e.symptoms||[]).forEach(t=>sc[t]=(sc[t]||0)+1);});
  if(Object.keys(tc).length<1){emptyChartState(chartEls.triggers); if(chartCache.triggers){chartCache.triggers.destroy(); delete chartCache.triggers;}} else upsertChart('triggers',{type:'bar',data:{labels:Object.keys(tc),datasets:[{label:'Trigger frequency',data:Object.values(tc),backgroundColor:'#6f7f5f'}]},options:{responsive:true,maintainAspectRatio:false}});
  if(Object.keys(sc).length<1){emptyChartState(chartEls.symptoms); if(chartCache.symptoms){chartCache.symptoms.destroy(); delete chartCache.symptoms;}} else upsertChart('symptoms',{type:'bar',data:{labels:Object.keys(sc),datasets:[{label:'Symptom frequency',data:Object.values(sc),backgroundColor:'#8a735d'}]},options:{responsive:true,maintainAspectRatio:false}});
}

function renderPressureTimeline(hourly, entries){
  if(!pressureTimelineEl) return; const p=hourly.pressure_msl||hourly.surface_pressure||[]; const t=hourly.time||[]; if(!p.length){ pressureTimelineEl.innerHTML='<p class="empty">No pressure timeline data.</p>'; return; }
  const w=500,h=150,pad=20,min=Math.min(...p),max=Math.max(...p),span=max-min||1;
  const path=p.map((v,i)=>`${i?'L':'M'} ${pad+i*(w-2*pad)/Math.max(1,p.length-1)} ${h-pad-((v-min)/span)*(h-2*pad)}`).join(' ');
  const seg=(i)=>i? (p[i]-p[i-1] < -0.8 ? 'falling' : p[i]-p[i-1] > 0.8 ? 'rising' : 'stable') : 'stable';
  pressureTimelineEl.innerHTML=`<svg viewBox="0 0 ${w} ${h}"><path d="${path}" class="line"/>${p.map((v,i)=>`<circle cx="${pad+i*(w-2*pad)/Math.max(1,p.length-1)}" cy="${h-pad-((v-min)/span)*(h-2*pad)}" r="2"><title>${t[i]||i} ${v} (${seg(i)})</title></circle>`).join('')}</svg><p>Labels: falling / stable / rising</p>`;
}
function renderMigraineForecast(r){
  if(!migraineForecastEl) return;
  const reasons=[];
  if(r.maxDrop<=-5) reasons.push('Significant pressure drop may increase risk');
  if(r.rapidFluctuation) reasons.push('Rapid fluctuation is a possible trigger');
  if((r.humidity||0)>75) reasons.push('High humidity may increase sensitivity');
  if(r.rain) reasons.push('Rainfront is a possible trigger');
  if(!reasons.length) reasons.push('Pressure conditions look relatively stable');
  const confidence = r.score>=7?'High':r.score>=3.5?'Medium':'Low';
  const atmLabels = (r.labels||[]).join(' · ');
  migraineForecastEl.innerHTML=`<div class="metric"><strong>Today risk:</strong> ${r.level}</div><div class="metric"><strong>Tomorrow risk:</strong> ${r.score>=5.5?'High':r.score>=3.2?'Moderate':'Low'}</div><div class="metric"><strong>Risk score:</strong> ${r.score}</div><div class="metric"><strong>Confidence:</strong> ${confidence}</div><div class="metric"><strong>Main reasons:</strong> ${reasons.join(' · ')}</div><div class="metric"><strong>Atmospheric signals:</strong> ${atmLabels || 'no major front signals detected'}</div><div class="metric">May increase risk; possible trigger; not medical advice.</div>`;
}
function renderPressureInsights(entries){ if(!pressureInsightsEl) return; const m=entries.filter(e=>e.severity>=6); if(!m.length){ pressureInsightsEl.innerHTML='<p class="empty">No migraine history yet.</p>'; return; } const rainDays=m.filter(e=>e.weather?.rain).length; const humid=m.filter(e=>(e.weather?.humidity||0)>75).length; pressureInsightsEl.innerHTML=`<div class="metric">Pressure on migraine days: ${fmt(avg(m.map(e=>e.weather?.pressure).filter(Boolean)),' hPa')}</div><div class="metric">6h/24h drop indicator: ${m.filter(e=>(e.weather?.pressureChange||0)<=-3).length}/${m.length}</div><div class="metric">Rain on migraine days: ${rainDays}/${m.length}</div><div class="metric">High humidity days: ${humid}/${m.length}</div>`; }

function deleteEntry(index){ if(!confirm('Delete this entry?')) return; const entries=loadEntries(); entries.splice(index,1); saveEntries(entries); refresh(); }

function renderDashboard(entries){ renderPressureForecast(entries); renderPressureInsights(entries); }
function refresh(){ const entries=loadEntries(); renderEntries(entries); renderDashboard(entries); renderTrendCharts(entries); try { renderCalendar(entries); } catch (err) { console.error('Calendar module failed during refresh (non-blocking)', err); } try { renderFiveDayForecast(entries); } catch(err){ console.error('Forecast render failed (non-blocking)', err); } applyMoodState(entries); }

form.addEventListener('submit', async (event)=>{ event.preventDefault(); const city=document.getElementById('location-city').value.trim(); if(!city){ submitStatusEl.textContent='Location required.'; return; } let location=matchedLocation; if(!location) location=await resolveLocation(); if(!location){ submitStatusEl.textContent='Location lookup failed.'; return; }
  const entry={ date:document.getElementById('entry-date').value, severity:Number(document.getElementById('severity').value), sleep:document.getElementById('sleep').value, stress:document.getElementById('stress').value, mealTime:document.getElementById('meal-time').value, caffeine:document.getElementById('caffeine').value, alcohol:document.getElementById('alcohol').value, hydration:document.getElementById('hydration').value, skippedMeals:document.getElementById('skipped-meals').checked, foodNotes:document.getElementById('food-notes').value.trim(), symptoms:selectedTags('symptom'), triggers:selectedTags('trigger'), notes:document.getElementById('notes').value.trim(), location, weather:{}, localStatus:'Saved locally', weatherFetchStatus:'pending', airQuality:{unavailable:true}, pollenFetchStatus:'pending' };
  const entries=loadEntries(); entries.push(entry); const idx=entries.length-1; saveEntries(entries); submitStatusEl.textContent='Saved locally. Weather pending.'; if(savedConfirmationEl) savedConfirmationEl.textContent='✅ Saved locally'; form.reset(); document.getElementById('entry-date').valueAsDate=new Date(); document.querySelectorAll('.tag.active').forEach(el=>el.classList.remove('active')); refresh(); refreshEntryWeather(idx);
});

if(document.getElementById('resolve-location')) document.getElementById('resolve-location').addEventListener('click', resolveLocation);
if(document.getElementById('add-custom-trigger')) document.getElementById('add-custom-trigger').addEventListener('click', ()=>{ const raw=document.getElementById('custom-trigger-input').value.trim().toLowerCase(); if(!raw) return; const c=[...defaultTriggers,...loadCustomTriggers()].map(t=>t.toLowerCase()); if(c.includes(raw)) return; const n=[...loadCustomTriggers(),raw]; saveCustomTriggers(n); createTagButtons(triggerTagsEl,[...defaultTriggers,...n],'trigger'); document.getElementById('custom-trigger-input').value=''; });

if(exportDataBtn) exportDataBtn.onclick=()=>{ const blob=new Blob([JSON.stringify(loadEntries(),null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='migraine-pattern-tracker-backup.json'; a.click(); URL.revokeObjectURL(a.href); };
if(importDataInput) importDataInput.onchange=async (e)=>{ const f=e.target.files?.[0]; if(!f) return; try{ const data=JSON.parse(await f.text()); if(!Array.isArray(data)) throw new Error('invalid'); saveEntries(data); savedConfirmationEl.textContent='✅ Imported and saved locally'; refresh(); }catch(err){ console.error(err); }};
if(clearDataBtn) clearDataBtn.onclick=()=>{ if(confirm('Clear all saved migraine data from this device?')){ saveEntries([]); refresh(); }};

const saved=loadSavedLocation(); if(saved){ document.getElementById('location-city').value=saved.city||''; document.getElementById('location-country').value=saved.country||''; matchedLocation=saved.matchedLocation||null; }
createTagButtons(symptomTagsEl, symptomOptions, 'symptom');
createTagButtons(triggerTagsEl, [...defaultTriggers,...loadCustomTriggers()], 'trigger');
bindTabs();
bindChartModal();
refresh();


(function bindSafeButtonChecks(){
  const required=['resolve-location','add-custom-trigger','export-data','import-data','clear-data'];
  required.forEach((id)=>{ if(!document.getElementById(id)) console.error('Missing required button/input:', id); });
})();


// Keep tab buttons working across refreshes.
function bindTabs(){
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panels = Array.from(document.querySelectorAll('.tab-panel'));
  tabs.forEach((tab)=>tab.addEventListener('click', ()=>{
    tabs.forEach(t=>t.classList.remove('active'));
    panels.forEach(p=>p.classList.remove('active'));
    tab.classList.add('active');
    const panel = document.getElementById(`tab-${tab.dataset.tab}`);
    if(panel) panel.classList.add('active');
  }));
}

function bindChartModal(){ document.querySelectorAll('.clickable-chart').forEach(el=>el.addEventListener('click', ()=>openChartModal(el.dataset.chart))); if(closeChartModalBtn) closeChartModalBtn.addEventListener('click', ()=>{ chartModalEl.classList.add('hidden'); if(modalChart){modalChart.destroy(); modalChart=null;} }); }


function applyMoodState(entries){
  try {
    const last = entries?.[entries.length-1];
    const risk = last?.weather?.pressureChange<=-6 ? 'high' : last?.weather?.pressureChange<=-3 ? 'moderate' : 'low';
    document.body.dataset.risk = risk;
    document.body.dataset.weather = last?.weather?.rain ? 'rain' : 'clear';
  } catch(e){ console.error('Mood state apply failed', e); }
}
