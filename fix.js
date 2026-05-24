// Runtime reliability patch for Migraine Pattern Tracker
// Keeps tab buttons, robust location lookup, local-first saving, and more reliable weather fetching.

(function () {
  const STORAGE_KEY = 'mwt_entries_v1';
  const SAVED_LOCATION_KEY = 'mwt_saved_location_v1';
  const $ = (id) => document.getElementById(id);

  const countryMap = {
    uk: 'GB', gb: 'GB', england: 'GB', britain: 'GB', 'united kingdom': 'GB',
    japan: 'JP', jp: 'JP', 日本: 'JP',
    us: 'US', usa: 'US', 'united states': 'US', america: 'US',
    france: 'FR', germany: 'DE', spain: 'ES', italy: 'IT', canada: 'CA', australia: 'AU'
  };

  function readEntries() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  }

  function writeEntries(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function normalizeCountry(value) {
    if (!value) return '';
    const raw = value.trim();
    const lower = raw.toLowerCase();
    if (/^[a-z]{2}$/i.test(raw)) return countryMap[lower] || raw.toUpperCase();
    return countryMap[lower] || '';
  }

  async function fetchWithTimeout(url, ms = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try { return await fetch(url, { signal: controller.signal }); }
    finally { clearTimeout(timer); }
  }

  function avg(values) {
    const nums = (values || []).filter((v) => v !== null && v !== undefined && !Number.isNaN(Number(v))).map(Number);
    return nums.length ? Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2)) : null;
  }

  function fmt(v, unit = '') {
    return v === null || v === undefined || v === '' ? 'Not available' : `${Number(v).toFixed(1)}${unit}`;
  }

  function weatherBase(date) {
    const today = new Date().toISOString().slice(0, 10);
    return date < today ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  }

  async function robustFetchHourly(date, lat, lon) {
    const base = weatherBase(date);
    const common = `latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&timezone=auto`;
    const attempts = [
      `${base}?${common}&hourly=pressure_msl,surface_pressure,relative_humidity_2m,precipitation,temperature_2m,weather_code`,
      `${base}?${common}&hourly=pressure_msl,relative_humidity_2m,precipitation,temperature_2m`,
      `${base}?${common}&hourly=surface_pressure,relative_humidity_2m,precipitation,temperature_2m`
    ];

    let lastError = null;
    for (const url of attempts) {
      try {
        const response = await fetchWithTimeout(url, 12000);
        if (!response.ok) {
          lastError = new Error(`Weather HTTP ${response.status}: ${url}`);
          continue;
        }
        const data = await response.json();
        if (data?.hourly && (data.hourly.pressure_msl || data.hourly.surface_pressure)) return data;
        lastError = new Error(`Weather response missing pressure data: ${url}`);
      } catch (error) {
        lastError = error;
        console.error('Weather attempt failed', { url, error });
      }
    }
    throw lastError || new Error('Weather fetch failed');
  }

  async function robustFetchAir(date, lat, lon) {
    const variables = 'pm2_5,pm10,dust,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen';
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&hourly=${variables}&timezone=auto`;
    const response = await fetchWithTimeout(url, 12000);
    if (!response.ok) throw new Error(`Air HTTP ${response.status}`);
    return response.json();
  }

  async function robustResolveLocation() {
    const city = $('location-city')?.value.trim();
    const country = $('location-country')?.value.trim();
    const result = $('location-result');
    if (!city) {
      if (result) result.textContent = 'Enter a city first, for example Tokyo or London.';
      return null;
    }
    if (result) result.textContent = 'Looking up location...';
    const countryCode = normalizeCountry(country);
    const attempts = [];
    if (countryCode) attempts.push(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=3&language=en&format=json&countryCode=${countryCode}`);
    attempts.push(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=3&language=en&format=json`);

    for (const url of attempts) {
      try {
        const response = await fetchWithTimeout(url, 12000);
        if (!response.ok) continue;
        const data = await response.json();
        const match = data.results?.[0];
        if (match) {
          const location = { name: match.name, country: match.country, latitude: match.latitude, longitude: match.longitude, admin1: match.admin1 || '' };
          localStorage.setItem(SAVED_LOCATION_KEY, JSON.stringify({ city, country, matchedLocation: location }));
          window.mwtResolvedLocation = location;
          if (result) result.innerHTML = `Matched: <strong>${location.name}, ${location.country}</strong> (${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)})`;
          return location;
        }
      } catch (error) {
        console.error('Location lookup attempt failed', error);
      }
    }
    if (result) result.textContent = 'No location found. Try London + GB, Tokyo + JP, or leave country blank.';
    return null;
  }

  async function robustFetchEnv(date, lat, lon) {
    const prev = new Date(date);
    prev.setDate(prev.getDate() - 1);
    const prevDate = prev.toISOString().slice(0, 10);

    let weather = {};
    let weatherFetchStatus = 'success';
    let hourly = {};

    try {
      const [current, previous] = await Promise.all([
        robustFetchHourly(date, lat, lon),
        robustFetchHourly(prevDate, lat, lon)
      ]);
      hourly = current.hourly || {};
      const prevHourly = previous.hourly || {};
      const pressure = avg(hourly.pressure_msl) ?? avg(hourly.surface_pressure);
      const prevPressure = avg(prevHourly.pressure_msl) ?? avg(prevHourly.surface_pressure);
      const precipitation = (hourly.precipitation || []).reduce((sum, value) => sum + (Number(value) || 0), 0);
      weather = {
        temperature: avg(hourly.temperature_2m),
        humidity: avg(hourly.relative_humidity_2m),
        precipitation,
        pressure,
        weatherCode: hourly.weather_code?.[0] ?? null,
        pressureChange: pressure != null && prevPressure != null ? Number((pressure - prevPressure).toFixed(1)) : null,
        humidityCategory: avg(hourly.relative_humidity_2m) >= 75 ? 'High' : avg(hourly.relative_humidity_2m) >= 45 ? 'Moderate' : 'Low',
        rain: precipitation > 0
      };
    } catch (error) {
      weatherFetchStatus = 'failed';
      console.error('Weather fetch failed after all attempts', { date, lat, lon, error });
    }

    let airQuality = { unavailable: true };
    let pollenFetchStatus = 'unavailable';
    try {
      const air = (await robustFetchAir(date, lat, lon)).hourly || {};
      airQuality = {
        pm2_5: avg(air.pm2_5), pm10: avg(air.pm10), dust: avg(air.dust),
        alder_pollen: avg(air.alder_pollen), birch_pollen: avg(air.birch_pollen), grass_pollen: avg(air.grass_pollen),
        mugwort_pollen: avg(air.mugwort_pollen), olive_pollen: avg(air.olive_pollen), ragweed_pollen: avg(air.ragweed_pollen)
      };
      pollenFetchStatus = Object.values(airQuality).some((v) => v != null) ? 'success' : 'unavailable';
    } catch (error) {
      pollenFetchStatus = 'failed';
      console.error('Pollen fetch failed', error);
    }

    return { weather, weatherFetchStatus, airQuality, pollenFetchStatus, hourlySnapshot: hourly };
  }

  function selectedTags(type) {
    return Array.from(document.querySelectorAll(`.tag[data-type="${type}"].active`)).map((tag) => tag.dataset.value);
  }

  function renderBasicHistory() {
    const entriesEl = $('entries');
    if (!entriesEl) return;
    const entries = readEntries();
    if (!entries.length) { entriesEl.innerHTML = '<p class="empty">No entries yet.</p>'; return; }
    entriesEl.innerHTML = entries.slice().reverse().map((entry, reverseIndex) => {
      const index = entries.length - 1 - reverseIndex;
      return `<article class="entry-item">
        <h3>${entry.date} · Severity ${entry.severity}/10</h3>
        <p><strong>Pressure:</strong> ${fmt(entry.weather?.pressure, ' hPa')} · <strong>Pressure change:</strong> ${fmt(entry.weather?.pressureChange, ' hPa')}</p>
        <p><strong>Humidity:</strong> ${fmt(entry.weather?.humidity, '%')} · <strong>Rain:</strong> ${entry.weather?.rain ? 'Yes' : 'No'} · <strong>PM2.5:</strong> ${fmt(entry.airQuality?.pm2_5)} · <strong>Pollen:</strong> ${fmt(entry.airQuality?.birch_pollen)}</p>
        <p><strong>Weather:</strong> ${entry.weatherFetchStatus || 'pending'} · <strong>Pollen:</strong> ${entry.pollenFetchStatus || 'pending'}</p>
        <p><strong>Status:</strong> ${entry.weatherFetchStatus === 'success' ? 'Weather success' : 'Weather failed — saved locally. Retry available.'}</p>
        <button type="button" data-retry-index="${index}">Retry weather</button>
      </article>`;
    }).join('');

    entriesEl.querySelectorAll('[data-retry-index]').forEach((button) => {
      button.addEventListener('click', async () => {
        const index = Number(button.dataset.retryIndex);
        await refreshEntryWeather(index);
      });
    });
  }

  async function refreshEntryWeather(index) {
    const entries = readEntries();
    const entry = entries[index];
    if (!entry?.location) return;
    entries[index] = { ...entry, weatherFetchStatus: 'pending', pollenFetchStatus: 'pending', localStatus: 'Saved locally' };
    writeEntries(entries);
    renderBasicHistory();
    const env = await robustFetchEnv(entry.date, entry.location.latitude, entry.location.longitude);
    const latest = readEntries();
    latest[index] = { ...latest[index], ...env, localStatus: env.weatherFetchStatus === 'success' ? 'Weather added' : 'Saved locally' };
    writeEntries(latest);
    renderBasicHistory();
  }

  function bindTabs() {
    const tabs = Array.from(document.querySelectorAll('.tab'));
    const panels = Array.from(document.querySelectorAll('.tab-panel'));
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((item) => item.classList.remove('active'));
        panels.forEach((panel) => panel.classList.remove('active'));
        tab.classList.add('active');
        const panel = document.getElementById(`tab-${tab.dataset.tab}`);
        if (panel) panel.classList.add('active');
      });
    });
  }

  function bindLocationButton() {
    const button = $('resolve-location');
    if (!button) return;
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      await robustResolveLocation();
    }, true);
  }

  function bindSafeSave() {
    const form = $('entry-form');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const status = $('submit-status');
      let location = window.mwtResolvedLocation;
      if (!location) {
        try { location = JSON.parse(localStorage.getItem(SAVED_LOCATION_KEY) || 'null')?.matchedLocation || null; }
        catch { location = null; }
      }
      if (!location) location = await robustResolveLocation();

      const entry = {
        date: $('entry-date')?.value || new Date().toISOString().slice(0, 10),
        severity: Number($('severity')?.value || 0),
        sleep: $('sleep')?.value || '', stress: $('stress')?.value || '', mealTime: $('meal-time')?.value || '',
        caffeine: $('caffeine')?.value || '', alcohol: $('alcohol')?.value || '', hydration: $('hydration')?.value || '',
        skippedMeals: Boolean($('skipped-meals')?.checked), foodNotes: $('food-notes')?.value.trim() || '',
        symptoms: selectedTags('symptom'), triggers: selectedTags('trigger'), notes: $('notes')?.value.trim() || '',
        location, weather: {}, airQuality: {}, localStatus: 'Saved locally',
        weatherFetchStatus: location ? 'pending' : 'unavailable', pollenFetchStatus: location ? 'pending' : 'unavailable',
        createdAt: new Date().toISOString()
      };
      const entries = readEntries();
      entries.push(entry);
      const index = entries.length - 1;
      writeEntries(entries);
      if (status) status.textContent = location ? '✅ Saved locally. Weather pending.' : '✅ Saved locally without weather location.';
      const confirmation = $('saved-confirmation');
      if (confirmation) confirmation.textContent = '✅ Saved locally';
      form.reset();
      if ($('entry-date')) $('entry-date').valueAsDate = new Date();
      document.querySelectorAll('.tag.active').forEach((tag) => tag.classList.remove('active'));
      renderBasicHistory();
      if (location) refreshEntryWeather(index);
    }, true);
  }

  function init() {
    bindTabs();
    bindLocationButton();
    bindSafeSave();
    renderBasicHistory();
    console.log('Runtime weather reliability patch loaded');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
