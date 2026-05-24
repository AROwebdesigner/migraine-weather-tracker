const STORAGE_KEYS = { entries: 'mwt_entries_v4', customTriggers: 'mwt_custom_triggers_v1', savedLocation: 'mwt_saved_location_v1' };
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

document.getElementById('entry-date').valueAsDate = new Date();

const jget=(k,d='[]')=>JSON.parse(localStorage.getItem(k)||d); const jset=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const loadEntries=()=>jget(STORAGE_KEYS.entries); const saveEntries=(v)=>jset(STORAGE_KEYS.entries,v);
const loadCustomTriggers=()=>jget(STORAGE_KEYS.customTriggers); const saveCustomTriggers=(v)=>jset(STORAGE_KEYS.customTriggers,v);
const loadSavedLocation=()=>jget(STORAGE_KEYS.savedLocation,'null'); const saveSavedLocation=(v)=>jset(STORAGE_KEYS.savedLocation,v);

function createTagButtons(container, tags, type){ container.innerHTML=''; tags.forEach(tag=>{const b=document.createElement('button'); b.type='button'; b.className='tag'; b.dataset.value=tag; b.dataset.type=type; b.textContent=tag; b.onclick=()=>b.classList.toggle('active'); container.appendChild(b);}); }
const selectedTags=(type)=>Array.from(document.querySelectorAll(`.tag[data-type="${type}"].active`)).map(el=>el.dataset.value);
const avg = (arr)=>Array.isArray(arr)&&arr.length?Number((arr.filter(v=>v!=null).reduce((s,v)=>s+v,0)/arr.filter(v=>v!=null).length).toFixed(2)):null;
function humidityCategory(h){ if(h==null||h==='') return 'Not available'; const n=Number(h); if(n>=75) return 'High'; if(n>=45) return 'Moderate'; return 'Low'; }
const fmt=(v,unit='')=>v==null||v===''?'Not available':`${Number(v).toFixed(1)}${unit}`;

async function resolveLocation(){
  const city = document.getElementById('location-city').value.trim();
  const country = document.getElementById('location-country').value.trim();
  if(!city){ locationResultEl.textContent='Please enter a city/location before weather lookup.'; return null; }
  if(!navigator.onLine){ locationResultEl.textContent='You appear offline. Location lookup unavailable.'; return null; }
  try{
    locationResultEl.textContent='Looking up location...';
    const q = encodeURIComponent(city);
    const cc = country ? `&country=${encodeURIComponent(country)}` : '';
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=en&format=json${cc}`;
    const r = await fetch(url);
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
    const [w, wp] = await Promise.all([fetch(weatherUrl), fetch(prevUrl)]);
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
    const a = await fetch(airUrl);
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

function retryWeather(index){ return async ()=>{ const entries=loadEntries(); const e=entries[index]; if(!e?.location){ return; } submitStatusEl.textContent='Retrying weather and pollen fetch...'; const env=await fetchEnv(e.date, e.location.latitude, e.location.longitude); entries[index]={...e,...env}; saveEntries(entries); submitStatusEl.textContent='Retry complete.'; refresh(); }; }
function renderEntries(entries){ entriesEl.innerHTML=''; entries.slice().reverse().forEach((e,reverseIdx)=>{ const idx=entries.length-1-reverseIdx; const card=document.createElement('article'); card.className='entry-item'; card.innerHTML=`<h3>${e.date} · Severity ${e.severity}/10</h3><p><strong>Location:</strong> ${e.location?.name || 'Not available'}, ${e.location?.country || ''}</p><p><strong>Weather:</strong> Temp ${fmt(e.weather?.temperature,'°C')}, Humidity ${fmt(e.weather?.humidity,'%')} (${e.weather?.humidityCategory||'Not available'}), Precip ${fmt(e.weather?.precipitation,' mm')}, Pressure ${fmt(e.weather?.pressure,' hPa')}, ΔPressure ${fmt(e.weather?.pressureChange,' hPa')}, Rain: ${e.weather?.rain ? 'Yes':'No'}</p><p><strong>Pollen/Air:</strong> Birch ${fmt(e.airQuality?.birch_pollen)}, Grass ${fmt(e.airQuality?.grass_pollen)}, Mugwort ${fmt(e.airQuality?.mugwort_pollen)}, Olive ${fmt(e.airQuality?.olive_pollen)}, Ragweed ${fmt(e.airQuality?.ragweed_pollen)}, Alder ${fmt(e.airQuality?.alder_pollen)}, Dust ${fmt(e.airQuality?.dust)}, PM2.5 ${fmt(e.airQuality?.pm2_5)}, PM10 ${fmt(e.airQuality?.pm10)}</p><p><strong>Fetch status:</strong> Weather ${e.weatherFetchStatus || 'unknown'} · Pollen ${e.pollenFetchStatus || 'unknown'}</p><p><strong>Env risk score:</strong> ${envRisk(e)}/10</p>`; const b=document.createElement('button'); b.type='button'; b.textContent='Retry weather data'; b.onclick=retryWeather(idx); card.appendChild(b); entriesEl.appendChild(card); }); }
function refresh(){ const entries=loadEntries(); renderEntries(entries); renderDashboard(entries); }

document.getElementById('resolve-location').addEventListener('click', resolveLocation);
document.getElementById('add-custom-trigger').addEventListener('click', ()=>{ const raw=document.getElementById('custom-trigger-input').value.trim().toLowerCase(); if(!raw) return; const combined=[...defaultTriggers,...loadCustomTriggers()].map(t=>t.toLowerCase()); if(combined.includes(raw)) return; const next=[...loadCustomTriggers(),raw]; saveCustomTriggers(next); createTagButtons(triggerTagsEl,[...defaultTriggers,...next],'trigger'); document.getElementById('custom-trigger-input').value=''; });

form.addEventListener('submit', async (event)=>{ event.preventDefault(); submitStatusEl.textContent='Saving entry...'; const city = document.getElementById('location-city').value.trim(); if(!city){ submitStatusEl.textContent='Location is required before weather fetch.'; return; } let location = matchedLocation; if(!location) location = await resolveLocation(); if(!location){ submitStatusEl.textContent='Please fix location before saving.'; return; } let env = { weather: {}, weatherFetchStatus: 'failed', airQuality: { unavailable: true }, pollenFetchStatus: 'failed' }; try { env = await fetchEnv(document.getElementById('entry-date').value, location.latitude, location.longitude); submitStatusEl.textContent = (env.weatherFetchStatus==='success') ? 'Entry saved with weather and pollen data.' : 'Entry saved. Weather or pollen data could not be fully fetched.'; } catch(err){ console.error('Unexpected env fetch error', err); submitStatusEl.textContent='Entry saved, but environmental fetch hit an unexpected error.'; }
  const entry = { date: document.getElementById('entry-date').value, severity:Number(document.getElementById('severity').value), sleep:document.getElementById('sleep').value, stress:document.getElementById('stress').value, mealTime:document.getElementById('meal-time').value, caffeine:document.getElementById('caffeine').value, alcohol:document.getElementById('alcohol').value, hydration:document.getElementById('hydration').value, skippedMeals:document.getElementById('skipped-meals').checked, foodNotes:document.getElementById('food-notes').value.trim(), symptoms:selectedTags('symptom'), triggers:selectedTags('trigger'), notes:document.getElementById('notes').value.trim(), location, ...env };
  const entries=loadEntries(); entries.push(entry); saveEntries(entries); form.reset(); document.getElementById('entry-date').valueAsDate = new Date(); document.querySelectorAll('.tag.active').forEach(el=>el.classList.remove('active')); refresh();
});

const saved=loadSavedLocation(); if(saved){ document.getElementById('location-city').value=saved.city||''; document.getElementById('location-country').value=saved.country||''; matchedLocation=saved.matchedLocation||null; if(matchedLocation){ locationResultEl.innerHTML=`Saved: <strong>${matchedLocation.name}, ${matchedLocation.country}</strong> (${matchedLocation.latitude.toFixed(4)}, ${matchedLocation.longitude.toFixed(4)})`; }}
createTagButtons(symptomTagsEl, symptomOptions, 'symptom'); createTagButtons(triggerTagsEl, [...defaultTriggers,...loadCustomTriggers()], 'trigger'); refresh();
