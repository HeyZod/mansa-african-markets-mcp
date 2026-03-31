module.exports = {
  apps: [
    {
      name: "mansa-mcp",
      script: "server.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
        NGX_API_KEY: "ngxpulse_c6maakeuc936ai8r",
        MANSA_API_KEY: "mansa_live_sk_wwvqfer8gumty7an",
      },
    },
  ],
};
