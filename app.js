const STORAGE_KEYS = {
  entries: 'mwt_entries_v2',
  customTriggers: 'mwt_custom_triggers_v1'
};

const symptomOptions = [
  'nausea','aura','light sensitivity','sound sensitivity','neck pain','dizziness','fatigue','vision changes','brain fog'
];
const defaultTriggers = [
  'weather change','air pressure drop','poor sleep','stress','dehydration','caffeine','screen time','bright light','exercise','skipped meals','processed food'
];

const form = document.getElementById('entry-form');
const entriesEl = document.getElementById('entries');
const dashboardEl = document.getElementById('dashboard');
const symptomTagsEl = document.getElementById('symptom-tags');
const triggerTagsEl = document.getElementById('trigger-tags');
const addCustomTriggerBtn = document.getElementById('add-custom-trigger');
const customTriggerInput = document.getElementById('custom-trigger-input');

document.getElementById('entry-date').valueAsDate = new Date();

function loadEntries() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.entries) || '[]');
}
function saveEntries(entries) {
  localStorage.setItem(STORAGE_KEYS.entries, JSON.stringify(entries));
}
function loadCustomTriggers() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.customTriggers) || '[]');
}
function saveCustomTriggers(tags) {
  localStorage.setItem(STORAGE_KEYS.customTriggers, JSON.stringify(tags));
}

function createTagButtons(container, tags, type) {
  container.innerHTML = '';
  tags.forEach((tag) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag';
    btn.dataset.value = tag;
    btn.dataset.type = type;
    btn.textContent = tag;
    btn.addEventListener('click', () => btn.classList.toggle('active'));
    container.appendChild(btn);
  });
}

function selectedTags(type) {
  return Array.from(document.querySelectorAll(`.tag[data-type="${type}"].active`)).map((el) => el.dataset.value);
}

function pattern(entries, field, label, fn = (v) => v) {
  const active = entries.filter((e) => e.severity >= 6 && e[field] !== '' && e[field] !== null && e[field] !== undefined);
  if (!active.length) return null;
  const avg = active.reduce((sum, e) => sum + Number(fn(e[field])), 0) / active.length;
  return `${label}: ${avg.toFixed(1)} (on moderate/severe migraine days)`;
}

function topTags(entries, field) {
  const counts = {};
  entries.forEach((e) => (e[field] || []).forEach((tag) => { counts[tag] = (counts[tag] || 0) + 1; }));
  return Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0, 5);
}

function renderDashboard(entries) {
  if (!entries.length) {
    dashboardEl.innerHTML = '<p>Add entries to reveal patterns.</p>';
    return;
  }
  const lines = [
    pattern(entries, 'temperature', 'Avg temperature'),
    pattern(entries, 'pressure', 'Avg pressure'),
    pattern(entries, 'humidity', 'Avg humidity'),
    pattern(entries, 'sleep', 'Avg sleep hours'),
    pattern(entries, 'stress', 'Avg stress'),
    pattern(entries, 'hydration', 'Avg hydration'),
    pattern(entries, 'caffeine', 'Avg caffeine intake')
  ].filter(Boolean);

  const skippedMealRate = entries.filter((e) => e.severity >= 6 && e.skippedMeals).length;
  const severeTotal = entries.filter((e) => e.severity >= 6).length;
  lines.push(`Skipped meals on severe days: ${skippedMealRate}/${severeTotal || 1}`);

  const symptomTop = topTags(entries, 'symptoms').map(([t, c]) => `<span class="pill">${t}: ${c}</span>`).join(' ');
  const triggerTop = topTags(entries, 'triggers').map(([t, c]) => `<span class="pill">${t}: ${c}</span>`).join(' ');

  dashboardEl.innerHTML = `
    ${lines.map((line) => `<div class="metric"><strong>${line}</strong></div>`).join('')}
    <div class="metric"><strong>Most frequent symptoms</strong>${symptomTop || '<p>None yet</p>'}</div>
    <div class="metric"><strong>Most frequent triggers (including custom)</strong>${triggerTop || '<p>None yet</p>'}</div>
  `;
}

function renderEntries(entries) {
  entriesEl.innerHTML = entries.slice().reverse().map((e) => `
    <article class="entry-item">
      <h3>${e.date} · Severity ${e.severity}/10</h3>
      <p><strong>Weather:</strong> ${e.temperature || '-'}°F, ${e.humidity || '-'}% humidity, ${e.pressure || '-'} hPa</p>
      <p><strong>Lifestyle:</strong> Sleep ${e.sleep || '-'}h, Stress ${e.stress || '-'}, Hydration ${e.hydration || '-'}, Caffeine ${e.caffeine || '-'}mg, Alcohol ${e.alcohol || '-'} drinks, Skipped meals: ${e.skippedMeals ? 'Yes' : 'No'}</p>
      <p><strong>Meal time:</strong> ${e.mealTime || '-'}</p>
      <p><strong>Food notes:</strong> ${e.foodNotes || '-'}</p>
      <p><strong>Symptoms:</strong> ${(e.symptoms || []).join(', ') || '-'}</p>
      <p><strong>Triggers:</strong> ${(e.triggers || []).join(', ') || '-'}</p>
      <p><strong>Notes:</strong> ${e.notes || '-'}</p>
    </article>
  `).join('');
}

function refresh() {
  const entries = loadEntries();
  renderEntries(entries);
  renderDashboard(entries);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const entry = {
    date: document.getElementById('entry-date').value,
    severity: Number(document.getElementById('severity').value),
    temperature: document.getElementById('temperature').value,
    humidity: document.getElementById('humidity').value,
    pressure: document.getElementById('pressure').value,
    sleep: document.getElementById('sleep').value,
    stress: document.getElementById('stress').value,
    mealTime: document.getElementById('meal-time').value,
    caffeine: document.getElementById('caffeine').value,
    alcohol: document.getElementById('alcohol').value,
    hydration: document.getElementById('hydration').value,
    skippedMeals: document.getElementById('skipped-meals').checked,
    foodNotes: document.getElementById('food-notes').value.trim(),
    symptoms: selectedTags('symptom'),
    triggers: selectedTags('trigger'),
    notes: document.getElementById('notes').value.trim()
  };
  const entries = loadEntries();
  entries.push(entry);
  saveEntries(entries);
  form.reset();
  document.getElementById('entry-date').valueAsDate = new Date();
  document.querySelectorAll('.tag.active').forEach((el) => el.classList.remove('active'));
  refresh();
});

addCustomTriggerBtn.addEventListener('click', () => {
  const raw = customTriggerInput.value.trim().toLowerCase();
  if (!raw) return;
  const combined = [...defaultTriggers, ...loadCustomTriggers()].map((t) => t.toLowerCase());
  if (combined.includes(raw)) {
    customTriggerInput.value = '';
    return;
  }
  const updated = [...loadCustomTriggers(), raw];
  saveCustomTriggers(updated);
  createTagButtons(triggerTagsEl, [...defaultTriggers, ...updated], 'trigger');
  customTriggerInput.value = '';
});

createTagButtons(symptomTagsEl, symptomOptions, 'symptom');
createTagButtons(triggerTagsEl, [...defaultTriggers, ...loadCustomTriggers()], 'trigger');
refresh();
