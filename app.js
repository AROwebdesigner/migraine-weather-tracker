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

async function resolveLocation(){
  const city = document.getElementById('location-city').value.trim();
  const country = document.getElementById('location-country').value.trim();
  if(!city) return null;
  const cc = country ? `&countryCode=${encodeURIComponent(country)}` : '';
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
  const next24 = p.length>=25 ? p[24]-p[0] : 0;
  let score=0;
  if(next6<=-3 || last6<=-3) score+=1;
  if(next6<=-5 || last6<=-5) score+=2;
  if(next24<=-8) score+=2;
  if(next24<=-10) score+=3;
  if((pr[0]||0)>0) score+=1;
  if((h[0]||0)>75) score+=1;
  if(hadPrevDropMigraine) score+=1;
  const level = score>=6?'Very High':score>=4?'High':score>=2?'Moderate':'Low';
  const reason = level==='Low' ? 'Pressure is stable. Risk may be lower today.' : 'Pressure is falling quickly, which may increase migraine risk.';
  return { level, score, reason, last6, next6, next24, current:p[0], humidity:h[0], rain:(pr[0]||0)>0 };
}

async function fetchEnv(date, lat, lon){
  const prevDate = new Date(date); prevDate.setDate(prevDate.getDate()-1); const pd=prevDate.toISOString().slice(0,10);
  let weather={}, weatherFetchStatus='success', hourly={}, prevHourly={};
  try { hourly=(await fetchHourly(date,lat,lon)).hourly||{}; prevHourly=(await fetchHourly(pd,lat,lon)).hourly||{};
    weather={ temperature:avg(hourly.temperature_2m), humidity:avg(hourly.relative_humidity_2m), precipitation:(hourly.precipitation||[]).reduce((a,b)=>a+(b||0),0), pressure:avg(hourly.pressure_msl)||avg(hourly.surface_pressure), weatherCode:hourly.weather_code?.[0]??null,
      pressureChange: ((avg(hourly.pressure_msl)||0)-(avg(prevHourly.pressure_msl)||0)).toFixed ? Number(((avg(hourly.pressure_msl)||0)-(avg(prevHourly.pressure_msl)||0)).toFixed(1)) : null,
      humidityCategory:humidityCategory(avg(hourly.relative_humidity_2m)), rain:(hourly.precipitation||[]).some(v=>v>0) };
  } catch(e){ weatherFetchStatus='failed'; console.error('Weather fetch failed', e); }
  let airQuality={ unavailable:true }, pollenFetchStatus='unavailable';
  try { const a=(await fetchAir(date,lat,lon)).hourly||{}; airQuality={pm2_5:avg(a.pm2_5),pm10:avg(a.pm10),dust:avg(a.dust)}; pollenKeys.forEach(k=>airQuality[k]=avg(a[k])); pollenFetchStatus=Object.values(airQuality).some(v=>v!=null)?'success':'unavailable'; }
  catch(e){ pollenFetchStatus='failed'; console.error('Pollen fetch failed', e); }
  return { weather, weatherFetchStatus, airQuality, pollenFetchStatus, hourlySnapshot: hourly };
}

async function refreshEntryWeather(index){
  const entries=loadEntries(); const e=entries[index]; if(!e?.location) return;
  entries[index]={...e,localStatus:'Saved locally',weatherFetchStatus:'pending',pollenFetchStatus:'pending'}; saveEntries(entries); refresh();
  try{ const env=await fetchEnv(e.date,e.location.latitude,e.location.longitude); const latest=loadEntries(); latest[index]={...latest[index],...env,localStatus:'Weather added'}; saveEntries(latest); }
  catch{ const latest=loadEntries(); latest[index]={...latest[index],localStatus:'Weather failed',weatherFetchStatus:'failed',pollenFetchStatus:'failed'}; saveEntries(latest); }
  refresh();
}

function retryWeather(index){ return async ()=>{ try { submitStatusEl.textContent='Retrying weather...'; await refreshEntryWeather(index); submitStatusEl.textContent='Weather retry finished.'; } catch (e) { console.error('Retry weather failed', e); submitStatusEl.textContent='Weather failed.'; } }; }
function renderEntries(entries){ entriesEl.innerHTML=''; if(!entries.length){ entriesEl.innerHTML='<p class="empty">No entries yet.</p>'; return; } entries.slice().reverse().forEach((e,ri)=>{const idx=entries.length-1-ri; const card=document.createElement('article'); card.className='entry-item'; card.innerHTML=`<h3>${e.date} · Severity ${e.severity}/10</h3><p>気圧低下: ${fmt(e.weather?.pressureChange,' hPa')} · 湿度: ${fmt(e.weather?.humidity,'%')} · 雨: ${e.weather?.rain?'Yes':'No'} · 花粉: ${fmt(e.airQuality?.birch_pollen)}</p><p><strong>Status:</strong> ${e.localStatus||'Saved locally'} · Weather ${e.weatherFetchStatus||'pending'} · Pollen ${e.pollenFetchStatus||'pending'}</p>`; const b=document.createElement('button'); b.textContent='Retry weather data'; b.onclick=retryWeather(idx); card.appendChild(b); entriesEl.appendChild(card); }); }

function renderPressureForecast(entries){
  if(!pressureForecastEl) return;
  const loc = matchedLocation || entries.at(-1)?.location;
  if(!loc){ pressureForecastEl.innerHTML='<p class="empty">Set location to view pressure forecast.</p>'; return; }
  fetchHourly(new Date().toISOString().slice(0,10), loc.latitude, loc.longitude).then((d)=>{
    const hadPrevDropMigraine = entries.some(e=>(e.weather?.pressureChange??0)<=-3 && e.severity>=6);
    const r=calculatePressureRisk(d.hourly||{}, hadPrevDropMigraine);
    pressureForecastEl.innerHTML=`<div class="metric"><strong>Current:</strong> ${fmt(r.current,' hPa')}</div><div class="metric"><strong>Last 6h:</strong> ${fmt(r.last6,' hPa')}</div><div class="metric"><strong>Next 6h:</strong> ${fmt(r.next6,' hPa')}</div><div class="metric"><strong>Next 24h:</strong> ${fmt(r.next24,' hPa')}</div><div class="metric"><strong>頭痛リスク:</strong> <span class="pill">${r.level}</span></div><div class="metric">${r.reason} 湿度 ${fmt(r.humidity,'%')} · 雨 ${r.rain?'☔':'—'}</div>`;
    renderPressureTimeline(d.hourly||{}, entries);
    renderMigraineForecast(r);
  }).catch(()=>{ pressureForecastEl.innerHTML='<p class="empty">Forecast unavailable.</p>'; });
}
function renderPressureTimeline(hourly, entries){
  if(!pressureTimelineEl) return; const p=hourly.pressure_msl||hourly.surface_pressure||[]; const t=hourly.time||[]; if(!p.length){ pressureTimelineEl.innerHTML='<p class="empty">No pressure timeline data.</p>'; return; }
  const w=500,h=150,pad=20,min=Math.min(...p),max=Math.max(...p),span=max-min||1;
  const path=p.map((v,i)=>`${i?'L':'M'} ${pad+i*(w-2*pad)/Math.max(1,p.length-1)} ${h-pad-((v-min)/span)*(h-2*pad)}`).join(' ');
  const seg=(i)=>i? (p[i]-p[i-1] < -0.8 ? 'falling' : p[i]-p[i-1] > 0.8 ? 'rising' : 'stable') : 'stable';
  pressureTimelineEl.innerHTML=`<svg viewBox="0 0 ${w} ${h}"><path d="${path}" class="line"/>${p.map((v,i)=>`<circle cx="${pad+i*(w-2*pad)/Math.max(1,p.length-1)}" cy="${h-pad-((v-min)/span)*(h-2*pad)}" r="2"><title>${t[i]||i} ${v} (${seg(i)})</title></circle>`).join('')}</svg><p>Labels: falling / stable / rising</p>`;
}
function renderMigraineForecast(r){ if(!migraineForecastEl) return; migraineForecastEl.innerHTML=`<div class="metric"><strong>Today risk:</strong> ${r.level}</div><div class="metric"><strong>Tomorrow risk:</strong> ${r.score>=4?'High':'Moderate/Low'}</div><div class="metric"><strong>Main reason:</strong> ${r.reason}</div><div class="metric">Advice: Hydration, rest, medication awareness, reduce screen strain. May increase risk; possible trigger; not medical advice.</div>`; }
function renderPressureInsights(entries){ if(!pressureInsightsEl) return; const m=entries.filter(e=>e.severity>=6); if(!m.length){ pressureInsightsEl.innerHTML='<p class="empty">No migraine history yet.</p>'; return; } const rainDays=m.filter(e=>e.weather?.rain).length; const humid=m.filter(e=>(e.weather?.humidity||0)>75).length; pressureInsightsEl.innerHTML=`<div class="metric">Pressure on migraine days: ${fmt(avg(m.map(e=>e.weather?.pressure).filter(Boolean)),' hPa')}</div><div class="metric">6h/24h drop indicator: ${m.filter(e=>(e.weather?.pressureChange||0)<=-3).length}/${m.length}</div><div class="metric">Rain on migraine days: ${rainDays}/${m.length}</div><div class="metric">High humidity days: ${humid}/${m.length}</div>`; }

function renderDashboard(entries){ renderPressureForecast(entries); renderPressureInsights(entries); }
function refresh(){ const entries=loadEntries(); renderEntries(entries); renderDashboard(entries); }

form.addEventListener('submit', async (event)=>{ event.preventDefault(); const city=document.getElementById('location-city').value.trim(); if(!city){ submitStatusEl.textContent='Location required.'; return; } let location=matchedLocation; if(!location) location=await resolveLocation(); if(!location){ submitStatusEl.textContent='Location lookup failed.'; return; }
  const entry={ date:document.getElementById('entry-date').value, severity:Number(document.getElementById('severity').value), sleep:document.getElementById('sleep').value, stress:document.getElementById('stress').value, mealTime:document.getElementById('meal-time').value, caffeine:document.getElementById('caffeine').value, alcohol:document.getElementById('alcohol').value, hydration:document.getElementById('hydration').value, skippedMeals:document.getElementById('skipped-meals').checked, foodNotes:document.getElementById('food-notes').value.trim(), symptoms:selectedTags('symptom'), triggers:selectedTags('trigger'), notes:document.getElementById('notes').value.trim(), location, weather:{}, localStatus:'Saved locally', weatherFetchStatus:'pending', airQuality:{unavailable:true}, pollenFetchStatus:'pending' };
  const entries=loadEntries(); entries.push(entry); const idx=entries.length-1; saveEntries(entries); submitStatusEl.textContent='Saved locally. Weather pending.'; if(savedConfirmationEl) savedConfirmationEl.textContent='✅ Saved locally'; form.reset(); document.getElementById('entry-date').valueAsDate=new Date(); document.querySelectorAll('.tag.active').forEach(el=>el.classList.remove('active')); refresh(); refreshEntryWeather(idx);
});

document.getElementById('resolve-location').addEventListener('click', resolveLocation);
document.getElementById('add-custom-trigger').addEventListener('click', ()=>{ const raw=document.getElementById('custom-trigger-input').value.trim().toLowerCase(); if(!raw) return; const c=[...defaultTriggers,...loadCustomTriggers()].map(t=>t.toLowerCase()); if(c.includes(raw)) return; const n=[...loadCustomTriggers(),raw]; saveCustomTriggers(n); createTagButtons(triggerTagsEl,[...defaultTriggers,...n],'trigger'); document.getElementById('custom-trigger-input').value=''; });

if(exportDataBtn) exportDataBtn.onclick=()=>{ const blob=new Blob([JSON.stringify(loadEntries(),null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='migraine-pattern-tracker-backup.json'; a.click(); URL.revokeObjectURL(a.href); };
if(importDataInput) importDataInput.onchange=async (e)=>{ const f=e.target.files?.[0]; if(!f) return; try{ const data=JSON.parse(await f.text()); if(!Array.isArray(data)) throw new Error('invalid'); saveEntries(data); savedConfirmationEl.textContent='✅ Imported and saved locally'; refresh(); }catch(err){ console.error(err); }};
if(clearDataBtn) clearDataBtn.onclick=()=>{ if(confirm('Clear all saved migraine data from this device?')){ saveEntries([]); refresh(); }};

const saved=loadSavedLocation(); if(saved){ document.getElementById('location-city').value=saved.city||''; document.getElementById('location-country').value=saved.country||''; matchedLocation=saved.matchedLocation||null; }
createTagButtons(symptomTagsEl, symptomOptions, 'symptom');
createTagButtons(triggerTagsEl, [...defaultTriggers,...loadCustomTriggers()], 'trigger');
refresh();


(function bindSafeButtonChecks(){
  const required=['resolve-location','add-custom-trigger','export-data','import-data','clear-data'];
  required.forEach((id)=>{ if(!document.getElementById(id)) console.error('Missing required button/input:', id); });
})();
