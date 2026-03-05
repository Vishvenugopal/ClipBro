const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

class AIEngine {
  constructor(db, clipsDir, dataDir) {
    this.db = db;
    this.clipsDir = clipsDir;
    this.dataDir = dataDir;
  }

  getSettings() {
    return {
      provider: this.db.getSetting('aiProvider') || 'ollama',
      apiKey: this.db.getSetting('aiApiKey') || '',
      model: this.db.getSetting('aiModel') || 'llava',
      endpoint: this.db.getSetting('aiEndpoint') || 'http://127.0.0.1:11434'
    };
  }

  saveSettings(settings) {
    const map = {
      provider: 'aiProvider',
      apiKey: 'aiApiKey',
      model: 'aiModel',
      endpoint: 'aiEndpoint'
    };
    const toSave = {};
    for (const [k, v] of Object.entries(settings)) {
      if (map[k]) toSave[map[k]] = v;
    }
    return this.db.saveSettings(toSave);
  }

  async analyzeImage(clipId, prompt) {
    const clip = this.db.getClip(clipId);
    if (!clip || clip.type !== 'image') return { error: 'Not an image clip' };

    const settings = this.getSettings();
    if (settings.provider === 'none') {
      return { error: 'No AI provider configured. Go to Settings > AI to set up.' };
    }
    if ((settings.provider === 'openai' || settings.provider === 'custom') && !settings.apiKey) {
      return { error: 'API key required for this provider. Go to Settings > AI to set up.' };
    }

    try {
      const imageData = fs.readFileSync(clip.filePath);
      const base64 = imageData.toString('base64');
      const mimeType = 'image/png';

      if (settings.provider === 'openai') {
        return await this.openaiVision(base64, mimeType, prompt, settings);
      } else if (settings.provider === 'ollama') {
        return await this.ollamaVision(base64, prompt, settings);
      } else if (settings.provider === 'custom') {
        return await this.customEndpoint(base64, mimeType, prompt, settings);
      }

      return { error: 'Unknown AI provider' };
    } catch (err) {
      return { error: err.message };
    }
  }

  openaiVision(base64, mimeType, prompt, settings) {
    const body = JSON.stringify({
      model: settings.model || 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt || 'Describe this image in detail.' },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
        ]
      }],
      max_tokens: 1000
    });

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey}`
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) resolve({ error: json.error.message });
            else resolve({ result: json.choices[0].message.content });
          } catch { resolve({ error: 'Failed to parse response' }); }
        });
      });
      req.on('error', e => resolve({ error: e.message }));
      req.write(body);
      req.end();
    });
  }

  ollamaVision(base64, prompt, settings) {
    const endpoint = settings.endpoint || 'http://127.0.0.1:11434';
    const url = new URL('/api/generate', endpoint);
    const body = JSON.stringify({
      model: settings.model || 'llava',
      prompt: prompt || 'Describe this image in detail.',
      images: [base64],
      stream: false
    });

    const client = url.protocol === 'https:' ? https : http;
    return new Promise((resolve) => {
      const req = client.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({ result: json.response || 'No response' });
          } catch { resolve({ error: 'Failed to parse Ollama response' }); }
        });
      });
      req.on('error', e => resolve({ error: `Ollama not reachable: ${e.message}` }));
      req.write(body);
      req.end();
    });
  }

  customEndpoint(base64, mimeType, prompt, settings) {
    if (!settings.endpoint) return Promise.resolve({ error: 'No custom endpoint configured' });
    const url = new URL(settings.endpoint);
    const body = JSON.stringify({
      model: settings.model || 'default',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt || 'Describe this image.' },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
        ]
      }]
    });

    const client = url.protocol === 'https:' ? https : http;
    return new Promise((resolve) => {
      const req = client.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { 'Authorization': `Bearer ${settings.apiKey}` } : {})
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const msg = json.choices?.[0]?.message?.content || json.response || json.result || JSON.stringify(json);
            resolve({ result: msg });
          } catch { resolve({ error: 'Failed to parse response' }); }
        });
      });
      req.on('error', e => resolve({ error: e.message }));
      req.write(body);
      req.end();
    });
  }

  async analyzeText(clipId, prompt) {
    const clip = this.db.getClip(clipId);
    if (!clip) return { error: 'Clip not found' };

    const textContent = clip.content || clip.extractedText || '';
    if (!textContent) return { error: 'No text content in this clip' };

    const settings = this.getSettings();
    if (settings.provider === 'none') {
      return { error: 'No AI provider configured. Go to Settings > AI to set up.' };
    }
    if ((settings.provider === 'openai' || settings.provider === 'custom') && !settings.apiKey) {
      return { error: 'API key required for this provider. Go to Settings > AI to set up.' };
    }

    try {
      const fullPrompt = `${prompt}\n\n---\n${textContent}`;

      if (settings.provider === 'openai') {
        return await this.openaiText(fullPrompt, settings);
      } else if (settings.provider === 'ollama') {
        return await this.ollamaText(fullPrompt, settings);
      } else if (settings.provider === 'custom') {
        return await this.customText(fullPrompt, settings);
      }
      return { error: 'Unknown AI provider' };
    } catch (err) {
      return { error: err.message };
    }
  }

  openaiText(prompt, settings) {
    const body = JSON.stringify({
      model: settings.model || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000
    });

    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey}`
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) resolve({ error: json.error.message });
            else resolve({ result: json.choices[0].message.content });
          } catch { resolve({ error: 'Failed to parse response' }); }
        });
      });
      req.on('error', e => resolve({ error: e.message }));
      req.write(body);
      req.end();
    });
  }

  ollamaText(prompt, settings) {
    const endpoint = settings.endpoint || 'http://127.0.0.1:11434';
    const url = new URL('/api/generate', endpoint);
    const body = JSON.stringify({
      model: settings.model || 'llama3',
      prompt,
      stream: false
    });

    const client = url.protocol === 'https:' ? https : http;
    return new Promise((resolve) => {
      const req = client.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({ result: json.response || 'No response' });
          } catch { resolve({ error: 'Failed to parse Ollama response' }); }
        });
      });
      req.on('error', e => resolve({ error: `Ollama not reachable: ${e.message}` }));
      req.write(body);
      req.end();
    });
  }

  customText(prompt, settings) {
    if (!settings.endpoint) return Promise.resolve({ error: 'No custom endpoint configured' });
    const url = new URL(settings.endpoint);
    const body = JSON.stringify({
      model: settings.model || 'default',
      messages: [{ role: 'user', content: prompt }]
    });

    const client = url.protocol === 'https:' ? https : http;
    return new Promise((resolve) => {
      const req = client.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { 'Authorization': `Bearer ${settings.apiKey}` } : {})
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const msg = json.choices?.[0]?.message?.content || json.response || json.result || JSON.stringify(json);
            resolve({ result: msg });
          } catch { resolve({ error: 'Failed to parse response' }); }
        });
      });
      req.on('error', e => resolve({ error: e.message }));
      req.write(body);
      req.end();
    });
  }

  async searchWeb(clipId, useAI = false) {
    const clip = this.db.getClip(clipId);
    if (!clip) return { error: 'Clip not found' };

    const { shell } = require('electron');

    if (clip.type === 'image' && clip.filePath) {
      // Open Google Lens for reverse image search
      shell.openExternal('https://lens.google.com/');
      return { result: 'Opened Google Lens. Drag your image to search.', provider: 'google-lens' };
    } else if (clip.content) {
      const q = encodeURIComponent(clip.content.substring(0, 200));
      shell.openExternal(`https://www.google.com/search?q=${q}`);
      return { result: 'Opened Google Search', provider: 'google' };
    }

    return { error: 'Nothing to search' };
  }
}

module.exports = AIEngine;
