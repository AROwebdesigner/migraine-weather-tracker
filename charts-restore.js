// Safe analytics chart restore for Migraine Pattern Tracker
(function () {
  const STORAGE_KEY = 'mwt_entries_v1';
  const chartInstances = {};
  let modalChart = null;

  function readEntries() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  }

  function ensureChartSection() {
    const dashboard = document.getElementById('tab-dashboard');
    if (!dashboard || document.getElementById('trend-charts')) return;

    dashboard.insertAdjacentHTML('beforeend', `
      <h3>Trend Charts</h3>
      <div id="trend-charts" class="trends-grid">
        <article class="chart-card clickable-chart" data-chart="severity">
          <h4>Migraine severity over time</h4>
          <canvas id="chart-severity"></canvas>
          <p class="helper">Shows how migraine severity changes across saved entries.</p>
        </article>
        <article class="chart-card clickable-chart" data-chart="pressure">
          <h4>Pressure vs migraine severity</h4>
          <canvas id="chart-pressure"></canvas>
          <p class="helper">Compares barometric pressure with logged migraine severity.</p>
        </article>
        <article class="chart-card clickable-chart" data-chart="sleep">
          <h4>Sleep vs severity</h4>
          <canvas id="chart-sleep"></canvas>
          <p class="helper">Compares sleep duration with migraine severity.</p>
        </article>
        <article class="chart-card clickable-chart" data-chart="triggers">
          <h4>Trigger frequency</h4>
          <canvas id="chart-triggers"></canvas>
          <p class="helper">Shows how often each trigger appears in saved entries.</p>
        </article>
        <article class="chart-card clickable-chart" data-chart="symptoms">
          <h4>Symptom frequency</h4>
          <canvas id="chart-symptoms"></canvas>
          <p class="helper">Shows how often each symptom appears in saved entries.</p>
        </article>
      </div>
    `);
  }

  function ensureModal() {
    if (document.getElementById('chart-modal-v2')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="chart-modal-v2" class="chart-modal hidden">
        <div class="chart-modal-backdrop" data-close-chart-modal="true"></div>
        <div class="chart-modal-panel" role="dialog" aria-modal="true">
          <button type="button" class="chart-modal-close" data-close-chart-modal="true">Close</button>
          <h3 id="chart-modal-v2-title">Chart</h3>
          <canvas id="chart-modal-v2-canvas"></canvas>
        </div>
      </div>
    `);
    document.getElementById('chart-modal-v2').addEventListener('click', (event) => {
      if (event.target.dataset.closeChartModal === 'true') closeModal();
    });
  }

  function closeModal() {
    const modal = document.getElementById('chart-modal-v2');
    if (modal) modal.classList.add('hidden');
    if (modalChart) { modalChart.destroy(); modalChart = null; }
  }

  function injectStyles() {
    if (document.getElementById('charts-restore-style')) return;
    const style = document.createElement('style');
    style.id = 'charts-restore-style';
    style.textContent = `
      .trends-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-top: 12px; }
      .chart-card { min-height: 280px; padding: 16px; border: 1px solid var(--border, #e7d8c7); border-radius: 16px; background: var(--surface-soft, #fffaf4); }
      .chart-card canvas { width: 100% !important; height: 190px !important; }
      .chart-card.clickable-chart { cursor: zoom-in; }
      .chart-card .helper { margin-top: 10px; font-size: 0.9rem; }
      .chart-empty { margin: 24px 0; color: var(--muted, #6b6258); }
      .chart-modal.hidden { display: none; }
      .chart-modal { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; }
      .chart-modal-backdrop { position: absolute; inset: 0; background: rgba(35, 29, 23, 0.58); }
      .chart-modal-panel { position: relative; width: min(94vw, 1000px); max-height: 88vh; overflow: auto; background: var(--surface, #fffaf4); border: 1px solid var(--border, #e7d8c7); border-radius: 20px; padding: 24px; box-shadow: 0 24px 80px rgba(0,0,0,0.28); }
      #chart-modal-v2-canvas { width: 100% !important; height: 62vh !important; }
    `;
    document.head.appendChild(style);
  }

  function countItems(entries, field) {
    const counts = {};
    entries.forEach((entry) => (entry[field] || []).forEach((item) => { counts[item] = (counts[item] || 0) + 1; }));
    return counts;
  }

  function destroyChart(key) {
    if (chartInstances[key]) { chartInstances[key].destroy(); delete chartInstances[key]; }
  }

  function showEmpty(canvas, message = 'Add more entries to see this chart.') {
    if (!canvas) return;
    destroyChart(canvas.id);
    const card = canvas.closest('.chart-card');
    if (!card) return;
    let empty = card.querySelector('.chart-empty');
    if (!empty) {
      empty = document.createElement('p');
      empty.className = 'chart-empty';
      card.appendChild(empty);
    }
    empty.textContent = message;
    canvas.style.display = 'none';
  }

  function clearEmpty(canvas) {
    const card = canvas?.closest('.chart-card');
    const empty = card?.querySelector('.chart-empty');
    if (empty) empty.remove();
    if (canvas) canvas.style.display = '';
  }

  function makeChart(key, config) {
    const canvas = document.getElementById(`chart-${key}`);
    if (!canvas || !window.Chart) return;
    clearEmpty(canvas);
    destroyChart(canvas.id);
    chartInstances[canvas.id] = new Chart(canvas.getContext('2d'), config);
  }

  function renderCharts() {
    if (!window.Chart) return;
    ensureChartSection();
    const entries = readEntries().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

    const severityCanvas = document.getElementById('chart-severity');
    const pressureCanvas = document.getElementById('chart-pressure');
    const sleepCanvas = document.getElementById('chart-sleep');
    const triggerCanvas = document.getElementById('chart-triggers');
    const symptomCanvas = document.getElementById('chart-symptoms');

    if (entries.length < 2) showEmpty(severityCanvas);
    else makeChart('severity', {
      type: 'line',
      data: { labels: entries.map(e => e.date || '-'), datasets: [{ label: 'Severity', data: entries.map(e => Number(e.severity || 0)), borderColor: '#8a735d', backgroundColor: 'rgba(138,115,93,.2)' }] },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 10 } } }
    });

    const pressurePoints = entries.filter(e => e.weather?.pressure != null).map(e => ({ x: Number(e.weather.pressure), y: Number(e.severity || 0) }));
    if (pressurePoints.length < 2) showEmpty(pressureCanvas);
    else makeChart('pressure', {
      type: 'scatter',
      data: { datasets: [{ label: 'Pressure vs Severity', data: pressurePoints, backgroundColor: '#6f7f5f' }] },
      options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'Pressure (hPa)' } }, y: { title: { display: true, text: 'Severity' }, min: 0, max: 10 } } }
    });

    const sleepPoints = entries.filter(e => e.sleep !== '' && e.sleep != null).map(e => ({ x: Number(e.sleep), y: Number(e.severity || 0) })).filter(p => !Number.isNaN(p.x));
    if (sleepPoints.length < 2) showEmpty(sleepCanvas);
    else makeChart('sleep', {
      type: 'scatter',
      data: { datasets: [{ label: 'Sleep vs Severity', data: sleepPoints, backgroundColor: '#9b856e' }] },
      options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'Sleep (hours)' } }, y: { title: { display: true, text: 'Severity' }, min: 0, max: 10 } } }
    });

    const triggerCounts = countItems(entries, 'triggers');
    if (!Object.keys(triggerCounts).length) showEmpty(triggerCanvas, 'Select triggers in saved entries to see this chart.');
    else makeChart('triggers', {
      type: 'bar',
      data: { labels: Object.keys(triggerCounts), datasets: [{ label: 'Trigger frequency', data: Object.values(triggerCounts), backgroundColor: '#6f7f5f' }] },
      options: { responsive: true, maintainAspectRatio: false }
    });

    const symptomCounts = countItems(entries, 'symptoms');
    if (!Object.keys(symptomCounts).length) showEmpty(symptomCanvas, 'Select symptoms in saved entries to see this chart.');
    else makeChart('symptoms', {
      type: 'bar',
      data: { labels: Object.keys(symptomCounts), datasets: [{ label: 'Symptom frequency', data: Object.values(symptomCounts), backgroundColor: '#8a735d' }] },
      options: { responsive: true, maintainAspectRatio: false }
    });

    bindChartClicks();
  }

  function bindChartClicks() {
    document.querySelectorAll('.clickable-chart').forEach((card) => {
      if (card.dataset.chartClickBound === 'true') return;
      card.dataset.chartClickBound = 'true';
      card.addEventListener('click', () => openModal(card.dataset.chart));
    });
  }

  function openModal(key) {
    const source = chartInstances[`chart-${key}`];
    if (!source || !window.Chart) return;
    const modal = document.getElementById('chart-modal-v2');
    const title = document.getElementById('chart-modal-v2-title');
    const canvas = document.getElementById('chart-modal-v2-canvas');
    if (!modal || !title || !canvas) return;
    title.textContent = source.config.data.datasets?.[0]?.label || 'Chart';
    if (modalChart) modalChart.destroy();
    modalChart = new Chart(canvas.getContext('2d'), JSON.parse(JSON.stringify(source.config)));
    modal.classList.remove('hidden');
  }

  function init() {
    injectStyles();
    ensureChartSection();
    ensureModal();
    renderCharts();
    setInterval(renderCharts, 2000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
