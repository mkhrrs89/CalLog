(() => {
  const originalDownloadBlob = App.downloadBlob;

  const easternExportStamp = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(date);
    const value = type => parts.find(part => part.type === type)?.value || '';
    const dayPeriod = value('dayPeriod').toUpperCase();
    return `${value('year')}-${value('month')}-${value('day')}-${value('hour')}-${value('minute')}-${dayPeriod}-ET`;
  };

  App.downloadBlob = function(content, filename, type) {
    const stampedFilename = filename.replace(
      /^(foodlog-(?:backup|entries|foods))-\d{4}-\d{2}-\d{2}(\.[^.]+)$/,
      `$1-${easternExportStamp()}$2`
    );
    return originalDownloadBlob.call(this, content, stampedFilename, type);
  };
})();
