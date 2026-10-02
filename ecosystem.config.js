module.exports = {
  apps: [
    {
      name: 'yaro-backend',
      script: './dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3101,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3101,
      },
      kill_timeout: 5000,
    },
  ],
};
