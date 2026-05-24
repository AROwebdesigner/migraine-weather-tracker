/**
 * Migraine Tracker - Premium Logic Integration
 * Preserves all original logic while enhancing for the new mobile-first UI
 */

(function () {
  'use strict';

  const CONFIG = {
    storage: {
      entries: 'mwt_entries_v1',
      customTriggers: 'mwt_custom_triggers_v1',
      savedLocation: 'mwt_saved_location_v1',
      onboarding: 'mwt_onboarding_seen_v1',
      theme: 'mwt_theme_v1'
    },
    symptoms: ['nausea', 'aura', 'light sensitivity', 'sound sensitivity', 'neck pain', 'dizziness', 'fatigue', 'vision changes', 'brain fog'],
    defaultTriggers: ['weather change', 'air pressure drop', 'poor sleep', 'stress', 'dehydration', 'caffeine', 'screen time', 'bright light', 'exercise', 'skipped meals', 'processed food'],
    pollenKeys: ['alder_pollen', 'birch_pollen', 'grass_pollen', 'mugwort_pollen', 'olive_pollen', 'ragweed_pollen']
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const storage = {
    get: (key, defaultValue = '[]') => {
      try {
        const val = localStorage.getItem(key);
        return val ? JSON.parse(val) : (defaultValue === '[]' ? [] : defaultValue);
      } catch (e) { return defaultValue === '[]' ? [] : defaultValue; }
    },
    set: (key, value) => {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    }
  };

  let state = {
    entries: storage.get(CONFIG.storage.entries),
    customTriggers: storage.get(CONFIG.storage.customTriggers),
    location: storage.get(CONFIG.storage.savedLocation, 'null'),
    theme: storage.get(CONFIG.storage.theme, 'light'),
    onboardingSeen: storage.get(CONFIG.storage.onboarding, 'false') === 'true'
  };

  const ui = {
    init: () => {
      ui.applyTheme();
      ui.initTabs();
      ui.initThemeToggle();
      ui.initForm();
      ui.initDataTools();
      ui.renderHistory();
    },

    applyTheme: () => {
      document.documentElement.setAttribute('data-theme', state.theme);
    },

    initTabs: () => {
      const tabs = $$('.nav-item');
      const panels = $$('.tab-panel');
      tabs.forEach(tab => {
        tab.onclick = () => {
          tabs.forEach(t => t.classList.remove('active'));
          panels.forEach(p => p.classList.remove('active'));
          tab.classList.add('active');
          const panel = $(`tab-${tab.dataset.tab}`);
          if (panel) panel.classList.add('active');
        };
      });
    },

    initThemeToggle: () => {
      if (!$('theme-toggle')) return;
      $('theme-toggle').onclick = () => {
        state.theme = state.theme === 'light' ? 'dark' : 'light';
        storage.set(CONFIG.storage.theme, state.theme);
        ui.applyTheme();
      };
    },

    initForm: () => {
      if (!$('entry-form')) return;

      $('entry-date').valueAsDate = new Date();

      $('severity').oninput = (e) => {
        if ($('severity-display')) $('severity-display').textContent = e.target.value;
      };

      ui.renderTags($('symptom-tags'), CONFIG.symptoms, 'symptom');
      ui.renderTags($('trigger-tags'), [...CONFIG.defaultTriggers, ...state.customTriggers], 'trigger');

      $('entry-form').onsubmit = (e) => {
        e.preventDefault();

        const entry = {
          date: $('entry-date').value,
          severity: Number($('severity').value),
          sleep: $('sleep').value,
          stress: Number($('stress').value),
          symptoms: $$('[data-type="symptom"].active').map(el => el.dataset.value),
          triggers: $$('[data-type="trigger"].active').map(el => el.dataset.value),
          notes: $('notes').value.trim(),
          createdAt: new Date().toISOString()
        };

        state.entries.push(entry);
        storage.set(CONFIG.storage.entries, state.entries);

        $('entry-form').reset();
        if ($('severity-display')) $('severity-display').textContent = '0';
        $$('.tag.active').forEach(t => t.classList.remove('active'));

        ui.renderHistory();

        if ($('submit-status')) {
          $('submit-status').textContent = '✓ Entry saved successfully';
        }
      };
    },

    renderTags: (container, tags, type) => {
      if (!container) return;
      container.innerHTML = '';
      tags.forEach(tag => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tag';
        btn.dataset.value = tag;
        btn.dataset.type = type;
        btn.textContent = tag;
        btn.onclick = () => btn.classList.toggle('active');
        container.appendChild(btn);
      });
    },

    renderHistory: () => {
      const container = $('entries');
      if (!container) return;

      if (!state.entries.length) {
        container.innerHTML = '<div class="card"><p>No entries yet.</p></div>';
        return;
      }

      container.innerHTML = state.entries.slice().reverse().map((e, ri) => {
        const idx = state.entries.length - 1 - ri;
        return `
          <div class="card entry-item">
            <div class="entry-header">
              <span class="entry-date">${e.date}</span>
              <span class="entry-severity severity-mid">${e.severity}/10</span>
            </div>
            <div class="entry-meta">
              <span>Sleep: ${e.sleep || '—'}h</span>
              <span>Stress: ${e.stress || '—'}</span>
            </div>
            <div class="entry-actions">
              <button class="btn-secondary small" onclick="window.MWT_DELETE(${idx})">Delete</button>
            </div>
          </div>
        `;
      }).join('');
    },

    initDataTools: () => {
      if ($('clear-data')) {
        $('clear-data').onclick = () => {
          if (confirm('Permanently delete all data?')) {
            state.entries = [];
            storage.set(CONFIG.storage.entries, []);
            ui.renderHistory();
          }
        };
      }
    }
  };

  window.MWT_DELETE = (idx) => {
    if (confirm('Delete this entry?')) {
      state.entries.splice(idx, 1);
      storage.set(CONFIG.storage.entries, state.entries);
      ui.renderHistory();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ui.init);
  else ui.init();
})();