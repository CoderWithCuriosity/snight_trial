module.exports = {
  apps: [{
    name: 'sportybet-scraper',
    script: 'scraper.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '500M',  // Restart if memory exceeds 500MB
    env: {
      NODE_ENV: 'production',
      TZ: 'Africa/Lagos'  // Force Nigeria timezone
    },
    // Auto-restart every 24 hours
    cron_restart: '0 0 * * *',
    // Log settings
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    merge_logs: true
  }]
};