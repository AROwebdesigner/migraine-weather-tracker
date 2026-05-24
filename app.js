const STORAGE_KEYS = { entries: 'mwt_entries_v3', customTriggers: 'mwt_custom_triggers_v1', savedLocation: 'mwt_saved_location_v1' };
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

function humidityCategory(h){ if(h==null||h==='') return 'Not available'; const n=Number(h); if(n>=75) return 'High'; if(n>=45) return 'Moderate'; return 'Low'; }
const fmt=(v,unit='')=>v==null||v===''?'Not available':`${Number(v).toFixed(1)}${unit}`;

async function resolveLocation(){
  const city = document.getElementById('location-city').value.trim();
  const country = document.getElementById('location-country').value.trim();
  if(!city){ locationResultEl.textContent='Please enter a city/location.'; return null; }
  if(!navigator.onLine){ locationResultEl.textContent='You appear offline. Location lookup unavailable.'; return null; }
  locationResultEl.textContent='Looking up location...';
  try{
    const q = encodeURIComponent(country ? `${city}, ${country}` : city);
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=en&format=json`);
    if(!r.ok) throw new Error('lookup failed');
    const data = await r.json();
    if(!data.results || !data.results.length){ locationResultEl.textContent='No location match found. Please refine city/country.'; matchedLocation=null; return null; }
    const m = data.results[0];
    matchedLocation = { name: m.name, country: m.country, latitude: m.latitude, longitude: m.longitude };
    saveSavedLocation({ city, country, matchedLocation });
    locationResultEl.innerHTML = `Matched: <strong>${m.name}, ${m.country}</strong> (${m.latitude.toFixed(4)}, ${m.longitude.toFixed(4)})`;
    return matchedLocation;
  } catch { locationResultEl.textContent='Location lookup failed. Please try again.'; return null; }
}

async function fetchEnv(date, lat, lon){
  if(!navigator.onLine) throw new Error('offline');
  const weatherUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&daily=temperature_2m_mean,relative_humidity_2m_mean,precipitation_sum,surface_pressure_mean,weather_code&timezone=auto`;
  const prev = new Date(date); prev.setDate(prev.getDate()-1); const pd = prev.toISOString().slice(0,10);
  const weatherPrevUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${pd}&end_date=${pd}&daily=surface_pressure_mean&timezone=auto`;
  const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&hourly=pm2_5,pm10,dust,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen&timezone=auto`;
  const [w,wp,a] = await Promise.all([fetch(weatherUrl), fetch(weatherPrevUrl), fetch(airUrl)]);
  if(!w.ok || !wp.ok) throw new Error('weather-api-failed');
  const wd = await w.json(); const wpd = await wp.json();
  const d = wd.daily || {}; const p = wpd.daily || {};
  const temp = d.temperature_2m_mean?.[0] ?? null; const humidity = d.relative_humidity_2m_mean?.[0] ?? null; const precip = d.precipitation_sum?.[0] ?? null;
  const pressure = d.surface_pressure_mean?.[0] ?? null; const prevPressure = p.surface_pressure_mean?.[0] ?? null;
  const pressureChange = (pressure != null && prevPressure != null) ? Number((pressure - prevPressure).toFixed(1)) : null;
  let aq = null;
  if(a.ok){
    const ad = await a.json(); const h = ad.hourly || {};
    const avg = (arr)=>Array.isArray(arr)&&arr.length?Number((arr.reduce((s,v)=>s+(v??0),0)/arr.filter(v=>v!=null).length).toFixed(2)):null;
    aq = { pm2_5: avg(h.pm2_5), pm10: avg(h.pm10), dust: avg(h.dust) };
    pollenKeys.forEach(k=>{ aq[k]=avg(h[k]); });
  } else { aq = { unavailable: true }; }

  return { weather: { temperature: temp, humidity, precipitation: precip, pressure, weatherCode: d.weather_code?.[0] ?? null, pressureChange, humidityCategory: humidityCategory(humidity), rain: (precip ?? 0) > 0 }, airQuality: aq };
}

function envRisk(entry){
  let score = 0;
  if((entry.weather?.pressureChange ?? 0) <= -4) score += 2;
  if(entry.weather?.humidityCategory === 'High') score += 1;
  if(entry.weather?.rain) score += 1;
  const pollenVals = pollenKeys.map(k=>entry.airQuality?.[k]).filter(v=>v!=null);
  if(pollenVals.some(v=>v>=30)) score += 2;
  if((entry.airQuality?.pm2_5 ?? 0) >= 25) score += 1;
  if((entry.airQuality?.pm10 ?? 0) >= 50) score += 1;
  return Math.min(score, 10);
}

function renderDashboard(entries){
  if(!entries.length){ dashboardEl.innerHTML='<p>Add entries to reveal patterns.</p>'; return; }
  const severe=entries.filter(e=>e.severity>=6); const pct=(n,d)=>d?`${((n/d)*100).toFixed(0)}%`:'0%';
  const highHumidity=severe.filter(e=>e.weather?.humidityCategory==='High').length;
  const rain=severe.filter(e=>e.weather?.rain).length;
  const pressureDrop=severe.filter(e=>(e.weather?.pressureChange??999)<=-4).length;
  const highPollen=severe.filter(e=>pollenKeys.some(k=>(e.airQuality?.[k]??0)>=30)).length;
  const pmBad=severe.filter(e=>(e.airQuality?.pm2_5??0)>=25||(e.airQuality?.pm10??0)>=50).length;
  const avgRisk = (entries.reduce((s,e)=>s+envRisk(e),0)/entries.length).toFixed(1);
  dashboardEl.innerHTML = `<div class="metric"><strong>Pressure drops on severe days:</strong> ${pressureDrop}/${severe.length} (${pct(pressureDrop,severe.length)})</div>
  <div class="metric"><strong>High humidity on severe days:</strong> ${highHumidity}/${severe.length} (${pct(highHumidity,severe.length)})</div>
  <div class="metric"><strong>Rain on severe days:</strong> ${rain}/${severe.length} (${pct(rain,severe.length)})</div>
  <div class="metric"><strong>High pollen on severe days:</strong> ${highPollen}/${severe.length} (${pct(highPollen,severe.length)})</div>
  <div class="metric"><strong>PM2.5/PM10 elevated on severe days:</strong> ${pmBad}/${severe.length} (${pct(pmBad,severe.length)})</div>
  <div class="metric"><strong>Average environmental risk score:</strong> ${avgRisk}/10</div>`;
}

function renderEntries(entries){
  entriesEl.innerHTML = entries.slice().reverse().map(e=>`<article class="entry-item"><h3>${e.date} · Severity ${e.severity}/10</h3>
  <p><strong>Location:</strong> ${e.location?.name || 'Not available'}, ${e.location?.country || ''}</p>
  <p><strong>Weather:</strong> Temp ${fmt(e.weather?.temperature,'°C')}, Humidity ${fmt(e.weather?.humidity,'%')} (${e.weather?.humidityCategory||'Not available'}), Precip ${fmt(e.weather?.precipitation,' mm')}, Pressure ${fmt(e.weather?.pressure,' hPa')}, ΔPressure ${fmt(e.weather?.pressureChange,' hPa')}, Rain: ${e.weather?.rain ? 'Yes':'No'}</p>
  <p><strong>Pollen/Air:</strong> Birch ${fmt(e.airQuality?.birch_pollen)}, Grass ${fmt(e.airQuality?.grass_pollen)}, Mugwort ${fmt(e.airQuality?.mugwort_pollen)}, Olive ${fmt(e.airQuality?.olive_pollen)}, Ragweed ${fmt(e.airQuality?.ragweed_pollen)}, Alder ${fmt(e.airQuality?.alder_pollen)}, Dust ${fmt(e.airQuality?.dust)}, PM2.5 ${fmt(e.airQuality?.pm2_5)}, PM10 ${fmt(e.airQuality?.pm10)}</p>
  <p><strong>Lifestyle:</strong> Sleep ${e.sleep||'-'}h, Stress ${e.stress||'-'}, Hydration ${e.hydration||'-'}, Caffeine ${e.caffeine||'-'}mg, Alcohol ${e.alcohol||'-'}, Skipped meals: ${e.skippedMeals?'Yes':'No'}</p>
  <p><strong>Food notes:</strong> ${e.foodNotes||'-'} | <strong>Symptoms:</strong> ${(e.symptoms||[]).join(', ')||'-'} | <strong>Triggers:</strong> ${(e.triggers||[]).join(', ')||'-'}</p>
  <p><strong>Env risk score:</strong> ${envRisk(e)}/10</p></article>`).join('');
}

function refresh(){ const entries=loadEntries(); renderEntries(entries); renderDashboard(entries); }

document.getElementById('resolve-location').addEventListener('click', resolveLocation);
document.getElementById('add-custom-trigger').addEventListener('click', ()=>{ const raw=document.getElementById('custom-trigger-input').value.trim().toLowerCase(); if(!raw) return; const combined=[...defaultTriggers,...loadCustomTriggers()].map(t=>t.toLowerCase()); if(combined.includes(raw)) return; const next=[...loadCustomTriggers(),raw]; saveCustomTriggers(next); createTagButtons(triggerTagsEl,[...defaultTriggers,...next],'trigger'); document.getElementById('custom-trigger-input').value=''; });

form.addEventListener('submit', async (event)=>{
  event.preventDefault(); submitStatusEl.textContent='Saving entry...';
  let location = matchedLocation;
  if(!location) location = await resolveLocation();
  if(!location){ submitStatusEl.textContent='Please fix location before saving.'; return; }

  let env = { weather: {}, airQuality: { unavailable: true } };
  try { env = await fetchEnv(document.getElementById('entry-date').value, location.latitude, location.longitude); }
  catch(err){
    if(err.message==='offline') submitStatusEl.textContent='Offline: entry saved without fresh weather/pollen data.';
    else submitStatusEl.textContent='Weather API failed. Entry saved with available manual data.';
  }

  const entry = { date: document.getElementById('entry-date').value, severity:Number(document.getElementById('severity').value), sleep:document.getElementById('sleep').value, stress:document.getElementById('stress').value, mealTime:document.getElementById('meal-time').value, caffeine:document.getElementById('caffeine').value, alcohol:document.getElementById('alcohol').value, hydration:document.getElementById('hydration').value, skippedMeals:document.getElementById('skipped-meals').checked, foodNotes:document.getElementById('food-notes').value.trim(), symptoms:selectedTags('symptom'), triggers:selectedTags('trigger'), notes:document.getElementById('notes').value.trim(), location, ...env };
  const entries=loadEntries(); entries.push(entry); saveEntries(entries);
  form.reset(); document.getElementById('entry-date').valueAsDate = new Date(); document.querySelectorAll('.tag.active').forEach(el=>el.classList.remove('active')); submitStatusEl.textContent = submitStatusEl.textContent || 'Entry saved with weather and pollen data.'; refresh();
});

const saved=loadSavedLocation(); if(saved){ document.getElementById('location-city').value=saved.city||''; document.getElementById('location-country').value=saved.country||''; matchedLocation=saved.matchedLocation||null; if(matchedLocation){ locationResultEl.innerHTML=`Saved: <strong>${matchedLocation.name}, ${matchedLocation.country}</strong> (${matchedLocation.latitude.toFixed(4)}, ${matchedLocation.longitude.toFixed(4)})`; }}
createTagButtons(symptomTagsEl, symptomOptions, 'symptom'); createTagButtons(triggerTagsEl, [...defaultTriggers,...loadCustomTriggers()], 'trigger'); refresh();
