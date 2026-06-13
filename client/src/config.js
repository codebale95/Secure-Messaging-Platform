import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const defaultConfig = {
  webhookUrl: null
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch (error) {
    // Fail silently, use defaults
  }
  return { ...defaultConfig };
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Failed to save config:', error);
    return false;
  }
}

export function getWebhookUrl() {
  const config = loadConfig();
  return config.webhookUrl;
}

export function setWebhookUrl(url) {
  const config = loadConfig();
  config.webhookUrl = url;
  return saveConfig(config);
}

export function clearWebhookUrl() {
  const config = loadConfig();
  config.webhookUrl = null;
  return saveConfig(config);
}
