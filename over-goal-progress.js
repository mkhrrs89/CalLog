setTimeout(() => {
  'use strict';

  if (!window.App || App.__overGoalProgressInstalled) return;
  App.__overGoalProgressInstalled = true;

  const originalRenderToday = App.renderToday;
  App.renderToday = async function(...args) {
    const html = await originalRenderToday.apply(this, args);
    const total = Number(this.totalForDate?.() || 0);
    const configuredGoal = Number(this.cache?.settings?.dailyCalorieGoal);
    const goal = Number.isFinite(configuredGoal) && configuredGoal > 0 ? configuredGoal : 1500;

    if (!(total > goal)) return html;

    return html.replace(
      /<div class="accumulation-fill(?: over-goal)?" style="width:[^"]+"><\/div>/,
      '<div class="accumulation-fill over-goal" style="width:100%"></div>'
    );
  };
}, 0);
