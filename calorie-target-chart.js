(() => {
  'use strict';

  if (!window.App || App.__calorieTargetChartInstalled) return;
  App.__calorieTargetChartInstalled = true;

  const TARGET_KEY = 'dailyCalorieTarget';
  const targetValue = () => {
    const possibleValues = [
      App.cache.settings[TARGET_KEY],
      App.cache.settings.calorieTarget,
      App.cache.settings.caloricTarget,
      App.cache.settings.calorieGoal,
      App.cache.settings.dailyCalorieGoal,
    ];
    const value = possibleValues.map(Number).find(number => Number.isFinite(number) && number > 0);
    return value ? Math.round(value) : 0;
  };

  const originalRenderSettings = App.renderSettings;
  App.renderSettings = async function(...args) {
    let html = await originalRenderSettings.apply(this, args);
    const target = targetValue();
    const field = `
      <label>Daily calorie target
        <input
          type="number"
          min="1"
          step="25"
          inputmode="numeric"
          value="${target || ''}"
          placeholder="e.g. 2,000"
          onchange="App.saveDailyCalorieTarget(this.value)"
        />
        <span class="field-help">Shown as an orange reference line on the Daily calories graph. Leave blank to hide it.</span>
      </label>`;

    html = html.replace('<div class="settings-list">', `<div class="settings-list">${field}`);
    return html;
  };

  App.saveDailyCalorieTarget = async function(rawValue) {
    const text = String(rawValue ?? '').trim().replace(/,/g, '');
    const target = text === '' ? 0 : Number(text);

    if (!Number.isInteger(target) || target < 0) {
      this.showToast('Enter a whole-number calorie target');
      await this.render();
      return;
    }

    await this.setSetting(TARGET_KEY, target);
    this.showToast(target ? `Calorie target set to ${this.formatNumber(target)}` : 'Calorie target removed');
  };

  const originalLineChart = App.lineChart;
  App.lineChart = function(series, unit = '') {
    const target = targetValue();
    if (unit !== 'calories' || !target || !series.length) {
      return originalLineChart.call(this, series, unit);
    }

    const width = Math.max(360, Math.min(980, series.length * 28));
    const height = 210;
    const pad = { l: 42, r: 12, t: 14, b: 34 };
    const max = Math.max(1, target, ...series.map(item => item.value));
    const x = index => pad.l + (series.length === 1 ? 0 : index / (series.length - 1) * (width - pad.l - pad.r));
    const y = value => height - pad.b - value / max * (height - pad.t - pad.b);
    const points = series.map((item, index) => `${x(index)},${y(item.value)}`).join(' ');
    const area = `${pad.l},${height - pad.b} ${points} ${x(series.length - 1)},${height - pad.b}`;
    const labelEvery = Math.max(1, Math.ceil(series.length / 6));
    const targetY = y(target);
    const targetLabelY = targetY < pad.t + 15 ? targetY + 14 : targetY - 6;

    return `
      <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily calories chart with a target of ${this.attr(target)} calories">
        ${[0, .25, .5, .75, 1].map(tick => {
          const yy = y(max * tick);
          return `<line class="chart-grid" x1="${pad.l}" y1="${yy}" x2="${width - pad.r}" y2="${yy}"/><text class="chart-label" x="${pad.l - 6}" y="${yy + 3}" text-anchor="end">${this.formatNumber(max * tick)}</text>`;
        }).join('')}
        <polygon class="chart-area" points="${area}"/>
        <polyline class="chart-line" points="${points}"/>
        <line class="calorie-target-line" x1="${pad.l}" y1="${targetY}" x2="${width - pad.r}" y2="${targetY}">
          <title>Calorie target: ${this.formatNumber(target)}</title>
        </line>
        <text class="calorie-target-label" x="${width - pad.r - 4}" y="${targetLabelY}" text-anchor="end">Target ${this.formatNumber(target)}</text>
        ${series.map((item, index) => `<circle class="chart-dot" cx="${x(index)}" cy="${y(item.value)}" r="${series.length > 50 ? 2 : 3}"><title>${this.esc(item.label)}: ${this.formatNumber(item.value)} calories</title></circle>`).join('')}
        ${series.map((item, index) => index % labelEvery === 0 || index === series.length - 1 ? `<text class="chart-label" x="${x(index)}" y="${height - 10}" text-anchor="middle">${this.esc(item.label)}</text>` : '').join('')}
      </svg>`;
  };

  const originalRenderStats = App.renderStats;
  App.renderStats = async function(...args) {
    let html = await originalRenderStats.apply(this, args);
    const target = targetValue();
    if (!target) return html;

    html = html.replace(
      '<span class="tiny muted">Complete days only</span>',
      `<span class="tiny muted calorie-target-legend"><span aria-hidden="true"></span>Complete days only · Target ${this.formatNumber(target)} cal</span>`
    );
    return html;
  };
})();
