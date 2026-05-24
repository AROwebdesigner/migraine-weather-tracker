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
    if(sev==null) cells.push(`<div class="heat-cell" title="${tip}"></div>`);
    else cells.push(`<div class="heat-cell ${severityClass(sev)}" title="${tip}"></div>`);
  }
  calendarHeatmapEl.innerHTML = cells.join('');
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
  const url = `${weatherBase(date)}?latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&hourly=pressure_msl,surface_pressure,relative_humidity_2m,precipitation,temperature_2m,weather_code&timezone=auto`;
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
  if(!p.length) return { level:'Unavailable', score:0, reason:'Pressure data unavailable.' };

  const last6 = p.length>=7 ? p[p.length-1]-p[p.length-7] : 0;
  const next6 = p.length>=13 ? p[12]-p[0] : 0;
  const next24Series = p.slice(0,25);

  let maxDrop = 0;
  let maxRise = 0;
  let absChanges = [];
  for(let i=1;i<next24Series.length;i++){
    const d = next24Series[i]-next24Series[i-1];
    if(d < maxDrop) maxDrop = d;
    if(d > maxRise) maxRise = d;
    absChanges.push(Math.abs(d));
  }

  const volatility = absChanges.length ? Number(absChanges.reduce((a,b)=>a+b,0).toFixed(2)) : 0;
  const avgHourlyChange = absChanges.length ? Number((absChanges.reduce((a,b)=>a+b,0)/absChanges.length).toFixed(2)) : 0;
  const rapidFluctuation = absChanges.filter(v=>v>=1.8).length >= 3 || volatility >= 16;

  let score=0;
  if(next6<=-3 || last6<=-3 || maxDrop<=-3) score+=1;
  if(next6<=-5 || last6<=-5 || maxDrop<=-5) score+=2;
  if(maxDrop<=-8) score+=2;
  if(maxDrop<=-10) score+=3;
  if(rapidFluctuation) score+=2;
  if((pr[0]||0)>0) score+=1;
  if((h[0]||0)>75) score+=1;
  if(hadPrevDropMigraine) score+=1;

  const level = score>=7?'Very High':score>=5?'High':score>=3?'Moderate':'Low';

  let state='Stable';
  if(maxDrop<=-6) state='Significant pressure drop';
  else if(rapidFluctuation) state='Rapid fluctuation';
  else if(volatility>=8 || avgHourlyChange>=1.0) state='Mild fluctuation';

  const reason = state==='Stable'
    ? 'Pressure appears stable. Migraine risk may be lower right now.'
    : `${state} may increase migraine risk.`;

  return { level, score, reason, state, last6, next6, current:p[0], humidity:h[0], rain:(pr[0]||0)>0, maxDrop, maxRise, volatility, avgHourlyChange, rapidFluctuation };
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
  const confidence = r.score>=6?'High':r.score>=3?'Medium':'Low';
  migraineForecastEl.innerHTML=`<div class="metric"><strong>Today risk:</strong> ${r.level}</div><div class="metric"><strong>Tomorrow risk:</strong> ${r.score>=5?'High':r.score>=3?'Moderate':'Low'}</div><div class="metric"><strong>Risk score:</strong> ${r.score}</div><div class="metric"><strong>Confidence:</strong> ${confidence}</div><div class="metric"><strong>Main reasons:</strong> ${reasons.join(' · ')}</div><div class="metric">May increase risk; possible trigger; not medical advice.</div>`;
}
function renderPressureInsights(entries){ if(!pressureInsightsEl) return; const m=entries.filter(e=>e.severity>=6); if(!m.length){ pressureInsightsEl.innerHTML='<p class="empty">No migraine history yet.</p>'; return; } const rainDays=m.filter(e=>e.weather?.rain).length; const humid=m.filter(e=>(e.weather?.humidity||0)>75).length; pressureInsightsEl.innerHTML=`<div class="metric">Pressure on migraine days: ${fmt(avg(m.map(e=>e.weather?.pressure).filter(Boolean)),' hPa')}</div><div class="metric">6h/24h drop indicator: ${m.filter(e=>(e.weather?.pressureChange||0)<=-3).length}/${m.length}</div><div class="metric">Rain on migraine days: ${rainDays}/${m.length}</div><div class="metric">High humidity days: ${humid}/${m.length}</div>`; }

function deleteEntry(index){ if(!confirm('Delete this entry?')) return; const entries=loadEntries(); entries.splice(index,1); saveEntries(entries); refresh(); }

function renderDashboard(entries){ renderPressureForecast(entries); renderPressureInsights(entries); }
function refresh(){ const entries=loadEntries(); renderEntries(entries); renderDashboard(entries); renderTrendCharts(entries); try { renderCalendar(entries); } catch (err) { console.error('Calendar module failed during refresh (non-blocking)', err); } applyMoodState(entries); }

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
