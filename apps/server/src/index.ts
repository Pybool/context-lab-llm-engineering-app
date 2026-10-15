import { loadConfig } from './config.js';
import { JsonStore } from './store.js';
import { createApp } from './app.js';

const cfg = await loadConfig();
const store = await JsonStore.open();
const app = createApp({ store });

// Keep the lab on the local machine, never exposed on 0.0.0.0.
app.listen(cfg.http.port, '127.0.0.1', () => {
  console.log(`LLM QA API: http://127.0.0.1:${cfg.http.port}`);
  console.log('Server configuration: apps/server/config/lab.config.json (hot reloaded)');
});
