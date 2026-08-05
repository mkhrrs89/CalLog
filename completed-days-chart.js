(() => {
  'use strict';

  if (!window.App || App.__completedDaysChartInstalled) return;
  App.__completedDaysChartInstalled = true;

  const originalBuildDateSeries = App.buildDateSeries;
  App.buildDateSeries = function(startKey, endKey, totalsMap) {
    const completedDates = new Set(
      this.cache.days
        .filter(day => day.complete && day.date >= startKey && day.date <= endKey)
        .map(day => day.date)
    );

    return originalBuildDateSeries
      .call(this, startKey, endKey, totalsMap)
      .filter(item => completedDates.has(item.date));
  };

  const originalRenderStats = App.renderStats;
  App.renderStats = async function(...args) {
    const html = await originalRenderStats.apply(this, args);
    return html.replace(
      '<span class="tiny muted">Empty days shown as 0</span>',
      '<span class="tiny muted">Complete days only</span>'
    );
  };
})();
