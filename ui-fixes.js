// UI fixes: chart modal content + per-entry deletion
(function () {
  const STORAGE_KEY = 'mwt_entries_v1';
  const $ = (id) => document.getElementById(id);

  function readEntries() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  }

  function writeEntries(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function ensureModal() {
    let modal = $('chart-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'chart-modal';
    modal.className = 'chart-modal hidden';
    modal.innerHTML = `
      <div class="chart-modal-backdrop" data-close-chart-modal="true"></div>
      <div class="chart-modal-panel" role="dialog" aria-modal="true">
        <button type="button" class="chart-modal-close" data-close-chart-modal="true">Close</button>
        <div id="chart-modal-body"></div>
      </div>`;
    document.body.appendChild(modal);

    modal.addEventListener('click', (event) => {
      if (event.target.dataset.closeChartModal === 'true') closeChartModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeChartModal();
    });
    return modal;
  }

  function closeChartModal() {
    const modal = $('chart-modal');
    if (modal) modal.classList.add('hidden');
  }

  function cloneChartCard(card) {
    const clone = card.cloneNode(true);
    clone.querySelectorAll('button').forEach((button) => button.remove());

    const originalCanvases = Array.from(card.querySelectorAll('canvas'));
    const clonedCanvases = Array.from(clone.querySelectorAll('canvas'));
    originalCanvases.forEach((canvas, index) => {
      try {
        const img = document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.alt = 'Expanded chart';
        img.className = 'expanded-chart-image';
        if (clonedCanvases[index]) clonedCanvases[index].replaceWith(img);
      } catch (error) {
        console.warn('Could not copy canvas chart to modal', error);
      }
    });

    clone.classList.add('expanded-chart-card');
    return clone;
  }

  function openChartModal(card) {
    const modal = ensureModal();
    const body = $('chart-modal-body');
    body.innerHTML = '';
    body.appendChild(cloneChartCard(card));
    modal.classList.remove('hidden');
  }

  function bindChartCards() {
    const possibleCards = Array.from(document.querySelectorAll('.chart-card, .trend-card, [data-chart-card]'));
    const fallbackCards = Array.from(document.querySelectorAll('#tab-dashboard .card, #tab-dashboard article, #tab-dashboard canvas')).map((el) => el.closest('article, .chart-card, .trend-card, .card')).filter(Boolean);
    const cards = Array.from(new Set([...possibleCards, ...fallbackCards]));

    cards.forEach((card) => {
      if (card.dataset.modalBound === 'true') return;
      card.dataset.modalBound = 'true';
      card.tabIndex = 0;
      card.classList.add('clickable-chart-card');
      card.addEventListener('click', (event) => {
        if (event.target.closest('button, a, input, label')) return;
        openChartModal(card);
      });
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openChartModal(card);
        }
      });
    });
  }

  function renderHistoryWithDelete() {
    const entriesEl = $('entries');
    if (!entriesEl) return;
    const entries = readEntries();
    if (!entries.length) {
      entriesEl.innerHTML = '<p class="empty">No entries yet.</p>';
      return;
    }

    function value(v, unit = '') {
      return v === null || v === undefined || v === '' ? 'Not available' : `${Number(v).toFixed(1)}${unit}`;
    }

    entriesEl.innerHTML = entries.slice().reverse().map((entry, reverseIndex) => {
      const index = entries.length - 1 - reverseIndex;
      return `
        <article class="entry-item">
          <h3>${entry.date || '-'} · Severity ${entry.severity ?? '-'}/10</h3>
          <p><strong>Pressure:</strong> ${value(entry.weather?.pressure, ' hPa')} · <strong>Pressure change:</strong> ${value(entry.weather?.pressureChange, ' hPa')}</p>
          <p><strong>Humidity:</strong> ${value(entry.weather?.humidity, '%')} · <strong>Rain:</strong> ${entry.weather?.rain ? 'Yes' : 'No'} · <strong>PM2.5:</strong> ${value(entry.airQuality?.pm2_5)} · <strong>Pollen:</strong> ${value(entry.airQuality?.birch_pollen)}</p>
          <p><strong>Symptoms:</strong> ${(entry.symptoms || []).join(', ') || '-'}</p>
          <p><strong>Triggers:</strong> ${(entry.triggers || []).join(', ') || '-'}</p>
          <p><strong>Weather:</strong> ${entry.weatherFetchStatus || 'pending'} · <strong>Pollen:</strong> ${entry.pollenFetchStatus || 'pending'}</p>
          <div class="entry-actions">
            <button type="button" data-retry-index="${index}">Retry weather</button>
            <button type="button" class="danger-button" data-delete-index="${index}">Delete entry</button>
          </div>
        </article>`;
    }).join('');

    entriesEl.querySelectorAll('[data-delete-index]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.deleteIndex);
        if (!confirm('Delete this entry?')) return;
        const updated = readEntries();
        updated.splice(index, 1);
        writeEntries(updated);
        renderHistoryWithDelete();
        if (typeof window.refresh === 'function') window.refresh();
        bindChartCards();
      });
    });
  }

  function injectStyles() {
    if ($('ui-fixes-style')) return;
    const style = document.createElement('style');
    style.id = 'ui-fixes-style';
    style.textContent = `
      .clickable-chart-card { cursor: zoom-in; }
      .chart-modal.hidden { display: none; }
      .chart-modal { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; }
      .chart-modal-backdrop { position: absolute; inset: 0; background: rgba(35, 29, 23, 0.55); }
      .chart-modal-panel { position: relative; width: min(92vw, 980px); max-height: 88vh; overflow: auto; background: var(--surface, #fffaf4); border: 1px solid var(--border, #e7d8c7); border-radius: 20px; padding: 24px; box-shadow: 0 24px 80px rgba(0,0,0,0.25); }
      .chart-modal-close { margin-bottom: 12px; }
      .expanded-chart-card canvas, .expanded-chart-card svg, .expanded-chart-image { width: 100% !important; max-height: 70vh; object-fit: contain; }
      .entry-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
      .danger-button { background: #8f4d3f !important; }
    `;
    document.head.appendChild(style);
  }

  function init() {
    injectStyles();
    ensureModal();
    bindChartCards();
    renderHistoryWithDelete();
    setInterval(bindChartCards, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
