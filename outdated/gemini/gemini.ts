import { Plugin } from "@utils/pluginBase";
import { Api } from "telegram";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import Database from "better-sqlite3";

const CONFIG_KEYS = {
  GEMINI_API_KEY: "gemini_api_key",
  GEMINI_BASE_URL: "gemini_base_url", 
  GEMINI_CHAT_MODEL: "gemini_chat_model",
  GEMINI_SEARCH_MODEL: "gemini_search_model",
  GEMINI_IMAGE_MODEL: "gemini_image_model",
  GEMINI_TTS_MODEL: "gemini_tts_model",
  GEMINI_TTS_VOICE: "gemini_tts_voice",
  GEMINI_CHAT_ACTIVE_PROMPT: "gemini_chat_active_prompt",
  GEMINI_SEARCH_ACTIVE_PROMPT: "gemini_search_active_prompt",
  GEMINI_TTS_ACTIVE_PROMPT: "gemini_tts_active_prompt",
  GEMINI_MAX_TOKENS: "gemini_max_tokens",
  GEMINI_PROMPTS: "gemini_prompts",
  GEMINI_CONTEXT_ENABLED: "gemini_context_enabled",
  GEMINI_CHAT_HISTORY: "gemini_chat_history",
  GEMINI_TELEGRAPH_ENABLED: "gemini_telegraph_enabled",
  GEMINI_TELEGRAPH_LIMIT: "gemini_telegraph_limit",
  GEMINI_TELEGRAPH_TOKEN: "gemini_telegraph_token",
  GEMINI_TELEGRAPH_POSTS: "gemini_telegraph_posts",
  GEMINI_COLLAPSIBLE_QUOTE_ENABLED: "gemini_collapsible_quote_enabled"
};

const DEFAULT_CONFIG = {
  [CONFIG_KEYS.GEMINI_BASE_URL]: "https://generativelanguage.googleapis.com",
  [CONFIG_KEYS.GEMINI_CHAT_MODEL]: "gemini-2.0-flash",
  [CONFIG_KEYS.GEMINI_SEARCH_MODEL]: "gemini-2.0-flash",
  [CONFIG_KEYS.GEMINI_IMAGE_MODEL]: "gemini-2.0-flash-preview-image-generation",
  [CONFIG_KEYS.GEMINI_TTS_MODEL]: "gemini-2.5-flash-preview-tts",
  [CONFIG_KEYS.GEMINI_TTS_VOICE]: "Kore",
  [CONFIG_KEYS.GEMINI_MAX_TOKENS]: "0",
  [CONFIG_KEYS.GEMINI_PROMPTS]: "{}",
  [CONFIG_KEYS.GEMINI_CONTEXT_ENABLED]: "off",
  [CONFIG_KEYS.GEMINI_CHAT_HISTORY]: "[]",
  [CONFIG_KEYS.GEMINI_TELEGRAPH_ENABLED]: "off",
  [CONFIG_KEYS.GEMINI_TELEGRAPH_LIMIT]: "0",
  [CONFIG_KEYS.GEMINI_TELEGRAPH_POSTS]: "{}",
  [CONFIG_KEYS.GEMINI_COLLAPSIBLE_QUOTE_ENABLED]: "off"
};

const CONFIG_DB_PATH = path.join((globalThis as any).process?.cwd?.() || ".", "assets", "gemini_config.db");

if (!fs.existsSync(path.dirname(CONFIG_DB_PATH))) {
  fs.mkdirSync(path.dirname(CONFIG_DB_PATH), { recursive: true });
}

class ConfigManager {
  private static db: Database.Database;
  private static initialized = false;

  private static init(): void {
    if (this.initialized) return;
    try {
      this.db = new Database(CONFIG_DB_PATH);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      this.initialized = true;
    } catch (error) {
      console.error("初始化配置数据库失败:", error);
    }
  }

  static get(key: string, defaultValue?: string): string {
    this.init();
    try {
      const stmt = this.db.prepare("SELECT value FROM config WHERE key = ?");
      const row = stmt.get(key) as { value: string } | undefined;
      
      if (row) {
        return row.value;
      }
    } catch (error) {
      console.error("读取配置失败:", error);
    }
    return defaultValue || DEFAULT_CONFIG[key] || "";
  }

  static set(key: string, value: string): void {
    this.init();
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO config (key, value, updated_at) 
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `);
      stmt.run(key, value);
    } catch (error) {
      console.error("保存配置失败:", error);
    }
  }

  static getAll(): { [key: string]: string } {
    this.init();
    try {
      const stmt = this.db.prepare("SELECT key, value FROM config");
      const rows = stmt.all() as { key: string; value: string }[];
      
      const config: { [key: string]: string } = {};
      rows.forEach(row => {
        config[row.key] = row.value;
      });
      return config;
    } catch (error) {
      console.error("读取所有配置失败:", error);
      return {};
    }
  }

  static delete(key: string): void {
    this.init();
    try {
      const stmt = this.db.prepare("DELETE FROM config WHERE key = ?");
      stmt.run(key);
    } catch (error) {
      console.error("删除配置失败:", error);
    }
  }

  static close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}

class Utils {
  static censorUrl(url: string | null): string {
    if (!url) return "默认";
    return url.replace(/(?<=\/\/)[^\/]+/, '***');
  }

  static getUtf16Length(text: string): number {
    return Buffer.from(text, 'utf16le').length / 2;
  }

  static removeGeminiFooter(text: string): string {
    const lines = text.split('\n');
    if (lines.length > 0 && lines[lines.length - 1].includes("Powered by Gemini")) {
      lines.pop();
    }
    return lines.join('\n');
  }

  static escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  static sanitizeHtmlForTelegraph(htmlContent: string): string {
    const allowedTags = new Set([
      'a', 'aside', 'b', 'blockquote', 'br', 'code', 'em', 'figcaption',
      'figure', 'h3', 'h4', 'hr', 'i', 'iframe', 'img', 'li', 'ol', 'p',
      'pre', 's', 'strong', 'u', 'ul', 'video'
    ]);

    return htmlContent.replace(/<(\/?)[\w\d]+([^>]*)>/g, (match) => {
      const tagName = match.match(/<\/?([\w\d]+)/)?.[1];
      if (tagName && allowedTags.has(tagName.toLowerCase())) {
        return match;
      }
      return '';
    });
  }

  static removeEmoji(text: string): string {
    return text
      .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
      .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
      .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
      .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
      .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
      .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')
      .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')
      .replace(/[\u{2600}-\u{26FF}]/gu, '')
      .replace(/[\u{2700}-\u{27BF}]/gu, '')
      .replace(/[\u{1F780}-\u{1F7FF}]/gu, '')
      .replace(/[\u{1F800}-\u{1F8FF}]/gu, '')
      .replace(/[\u{FE0F}\u{200D}]/gu, '')
      .trim();
  }

  static validateConfig(key: string, value: string): { isValid: boolean; error?: string } {
    if (value.length > 10000) {
      return { isValid: false, error: "输入值过长，最大允许10000字符" };
    }

    const validators = {
      [CONFIG_KEYS.GEMINI_API_KEY]: (v: string) => {
        if (!v || v.trim().length === 0) return "API密钥不能为空";
        if (v.length < 10) return "API密钥格式无效";
        if (!/^[A-Za-z0-9_-]+$/.test(v)) return "API密钥包含无效字符";
        return null;
      },
      [CONFIG_KEYS.GEMINI_MAX_TOKENS]: (v: string) => {
        const tokens = parseInt(v);
        if (isNaN(tokens) || tokens < 0) return "Token数量必须为非负整数";
        if (tokens > 1000000) return "Token数量过大，最大允许1000000";
        return null;
      },
      [CONFIG_KEYS.GEMINI_BASE_URL]: (v: string) => {
        if (v && !v.startsWith('http')) return "URL必须以http://或https://开头";
        if (v && v.length > 500) return "URL长度过长";

        if (v) {
          try {
            new URL(v);
          } catch {
            return "URL格式无效";
          }
        }
        return null;
      },
      [CONFIG_KEYS.GEMINI_TELEGRAPH_LIMIT]: (v: string) => {
        const limit = parseInt(v);
        if (isNaN(limit) || limit < 0) return "限制必须为非负整数";
        if (limit > 100000) return "限制值过大，最大允许100000";
        return null;
      },
      [CONFIG_KEYS.GEMINI_CONTEXT_ENABLED]: (v: string) => {
        if (v !== "on" && v !== "off") return "值必须为 'on' 或 'off'";
        return null;
      },
      [CONFIG_KEYS.GEMINI_TELEGRAPH_ENABLED]: (v: string) => {
        if (v !== "on" && v !== "off") return "值必须为 'on' 或 'off'";
        return null;
      },
      [CONFIG_KEYS.GEMINI_COLLAPSIBLE_QUOTE_ENABLED]: (v: string) => {
        if (v !== "on" && v !== "off") return "值必须为 'on' 或 'off'";
        return null;
      }
    };
    const validator = validators[key];
    if (validator) {
      const error = validator(value);
      return error ? { isValid: false, error } : { isValid: true };
    }
    return { isValid: true };
  }

  static getAudioExtension(mimeType?: string): string {
    if (!mimeType) return 'mp3';
    if (mimeType.includes('wav')) return 'wav';
    if (mimeType.includes('mp3')) return 'mp3';
    if (mimeType.includes('ogg')) return 'ogg';
    if (mimeType.includes('m4a')) return 'm4a';
    return 'mp3';
  }

  static async sendImageBuffer(
    msg: Api.Message,
    imageData: Buffer,
    caption: string
  ): Promise<void> {
    const imageFile = Object.assign(imageData, {
      name: 'gemini.png'
    });
    
    await msg.client?.sendFile(msg.peerId, {
      file: imageFile,
      caption,
      parseMode: "html",
      replyTo: msg.id
    });
  }

  static async sendAudioBuffer(
    msg: Api.Message,
    audioData: Buffer,
    caption: string,
    mimeType?: string
  ): Promise<void> {
    let processedAudio = audioData;
    if (mimeType && mimeType.includes('L16') && mimeType.includes('pcm')) {
      processedAudio = this.convertToWav(audioData, mimeType);
    }
    const audioFile = Object.assign(processedAudio, {
      name: 'gemini.ogg'
    });

    await msg.client?.sendFile(msg.peerId, {
      file: audioFile,
      caption,
      parseMode: "html",
      replyTo: msg.id,
      attributes: [new Api.DocumentAttributeAudio({
        duration: 0,
        voice: true
      })]
    });
  }

  static convertToWav(rawData: string | Buffer, mimeType: string): Buffer {
    const options = this.parseMimeType(mimeType);
    const buffer = typeof rawData === 'string' ? Buffer.from(rawData, 'base64') : rawData;
    const wavHeader = this.createWavHeader(buffer.length, options);
    return Buffer.concat([wavHeader, buffer]);
  }

  static parseMimeType(mimeType: string): WavConversionOptions {
    const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
    const [_, format] = fileType.split('/');

    const options: Partial<WavConversionOptions> = {
      numChannels: 1,
      sampleRate: 24000,
      bitsPerSample: 16
    };

    if (format && format.startsWith('L')) {
      const bits = parseInt(format.slice(1), 10);
      if (!isNaN(bits)) {
        options.bitsPerSample = bits;
      }
    }

    for (const param of params) {
      const [key, value] = param.split('=').map(s => s.trim());
      if (key === 'rate') {
        options.sampleRate = parseInt(value, 10);
      }
    }

    return options as WavConversionOptions;
  }

  static createWavHeader(dataLength: number, options: WavConversionOptions): Buffer {
    const { numChannels, sampleRate, bitsPerSample } = options;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const buffer = Buffer.alloc(44);

    buffer.write('RIFF', 0);                      
    buffer.writeUInt32LE(36 + dataLength, 4);     
    buffer.write('WAVE', 8);                      
    buffer.write('fmt ', 12);                     
    buffer.writeUInt32LE(16, 16);                 
    buffer.writeUInt16LE(1, 20);                  
    buffer.writeUInt16LE(numChannels, 22);        
    buffer.writeUInt32LE(sampleRate, 24);         
    buffer.writeUInt32LE(byteRate, 28);           
    buffer.writeUInt16LE(blockAlign, 32);         
    buffer.writeUInt16LE(bitsPerSample, 34);      
    buffer.write('data', 36);                     
    buffer.writeUInt32LE(dataLength, 40);         

    return buffer;
  }

  static handleError(error: any, context: string): string {
    const timestamp = new Date().toISOString();
    const errorMessage = error?.message || '未知错误';
    const errorStack = error?.stack || '';


    console.error(`[${timestamp}] [${context}] 错误: ${errorMessage}`);
    if (errorStack && process.env.NODE_ENV === 'development') {
      console.error(`[${timestamp}] [${context}] 堆栈: ${errorStack}`);
    }

    let userMessage = errorMessage;
    if (error?.code === 'ENOENT') {
      userMessage = '文件不存在或无法访问';
    } else if (error?.code === 'EACCES') {
      userMessage = '权限不足，无法访问文件';
    } else if (error?.code === 'EMFILE' || error?.code === 'ENFILE') {
      userMessage = '系统文件句柄不足，请稍后重试';
    } else if (error?.code === 'ENOSPC') {
      userMessage = '磁盘空间不足';
    } else if (errorMessage.includes('timeout') || errorMessage.includes('超时')) {
      userMessage = '操作超时，请检查网络连接';
    } else if (errorMessage.includes('network') || errorMessage.includes('网络')) {
      userMessage = '网络连接失败，请检查网络设置';
    }

    return `❌ ${context}失败: ${userMessage}`;
  }
}

interface HttpResponse {
  status: number;
  data: any;
  headers: any;
}

interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  data?: any;
  timeout?: number;
}

interface WavConversionOptions {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

class HttpClient {

  static cleanResponseText(text: string): string {
    if (!text) return text;
    return text
      .replace(/^\uFEFF/, '')
      .replace(/\uFFFD/g, '')
      .replace(/[\uFFFC\uFFFF\uFFFE]/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/[\uDC00-\uDFFF]/g, '')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
      .normalize('NFKC')
      .normalize('NFKC');
  }

  static async makeRequest(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      try {
        const parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          reject(new Error('不支持的协议'));
          return;
        }
      } catch {
        reject(new Error('无效的URL'));
        return;
      }

      const { method = 'GET', headers = {}, data, timeout = 30000 } = options;
      const isHttps = url.startsWith('https:');
      const client = isHttps ? https : http;
      
      const req = client.request(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TeleBox/1.0',
          ...headers
        },
        timeout
      }, (res: any) => {

        res.setEncoding('utf8');
        let body = '';
        let dataLength = 0;
        const maxResponseSize = 10 * 1024 * 1024;

        res.on('data', (chunk: string) => {
          dataLength += chunk.length;
          if (dataLength > maxResponseSize) {
            req.destroy();
            reject(new Error('响应数据过大'));
            return;
          }
          body += chunk;
        });
        
        res.on('end', () => {
          try {

            const cleanBody = HttpClient.cleanResponseText(body);
            const parsedData = cleanBody ? JSON.parse(cleanBody) : {};
            resolve({
              status: res.statusCode || 0,
              data: parsedData,
              headers: res.headers
            });
          } catch (error) {

            resolve({
              status: res.statusCode || 0,
              data: HttpClient.cleanResponseText(body),
              headers: res.headers
            });
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`网络请求失败: ${error.message}`));
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });

      if (data) {
        if (typeof data === 'object') {
          const jsonData = JSON.stringify(data);
          if (jsonData.length > 1024 * 1024) {
            reject(new Error('请求体过大'));
            return;
          }
          req.write(jsonData);
        } else if (typeof data === 'string') {
          if (data.length > 1024 * 1024) {
            reject(new Error('请求体过大'));
            return;
          }
          req.write(data);
        }
      }

      req.end();
    });
  }
}

class TelegraphClient {
  private accessToken: string | null = null;

  async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;

    const token = ConfigManager.get(CONFIG_KEYS.GEMINI_TELEGRAPH_TOKEN);
    if (token) {
      this.accessToken = token;
      return token;
    }

    const response = await HttpClient.makeRequest('https://api.telegra.ph/createAccount', {
      method: 'POST',
      data: {
        short_name: 'PagerMaid-Gemini'
      }
    });

    if (response.status === 200 && response.data.ok) {
      const accessToken = response.data.result.access_token;
      this.accessToken = accessToken;
      ConfigManager.set(CONFIG_KEYS.GEMINI_TELEGRAPH_TOKEN, accessToken);
      return accessToken;
    }

    throw new Error('Failed to create Telegraph account');
  }

  async createPage(title: string, htmlContent: string): Promise<{ url: string; path: string }> {
    const token = await this.getAccessToken();
    
    const response = await HttpClient.makeRequest('https://api.telegra.ph/createPage', {
      method: 'POST',
      data: {
        access_token: token,
        title,
        content: [{ tag: 'div', children: [htmlContent] }]
      }
    });

    if (response.status === 200 && response.data.ok) {
      return {
        url: response.data.result.url || '',
        path: response.data.result.path || ''
      };
    }

    throw new Error('Failed to create Telegraph page');
  }

  async editPage(path: string, title: string, htmlContent: string): Promise<boolean> {
    try {
      const token = await this.getAccessToken();
      
      const response = await HttpClient.makeRequest('https://api.telegra.ph/editPage', {
        method: 'POST',
        data: {
          access_token: token,
          path,
          title,
          content: [{ tag: 'div', children: [htmlContent] }]
        }
      });

      return response.status === 200 && response.data.ok;
    } catch {
      return false;
    }
  }
}

class GeminiClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string | null) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl ?? DEFAULT_CONFIG[CONFIG_KEYS.GEMINI_BASE_URL];
  }

  async generateContent(params: {
    model: string;
    contents: any[];
    systemInstruction?: string;
    safetySettings?: any[];
    maxOutputTokens?: number;
    tools?: any[];
  }): Promise<{ text: string; candidates: any[] }> {
    const url = `${this.baseUrl}/v1beta/models/${params.model}:generateContent`;
    
    const headers: Record<string, string> = {
      'x-goog-api-key': this.apiKey
    };

    const requestData: any = {
      contents: params.contents,
      generationConfig: {}
    };

    if (params.systemInstruction) {
      requestData.systemInstruction = { parts: [{ text: params.systemInstruction }] };
    }

    if (params.safetySettings) {
      requestData.safetySettings = params.safetySettings;
    }

    if (params.maxOutputTokens && params.maxOutputTokens > 0) {
      requestData.generationConfig.maxOutputTokens = params.maxOutputTokens;
    }

    if (params.tools) {
      requestData.tools = params.tools;
    }

    const response = await HttpClient.makeRequest(url, {
      method: 'POST',
      headers,
      data: requestData
    });

    if (response.status !== 200 || response.data?.error) {

      
      const errorMessage = response.data?.error?.message || 
                          response.data?.error || 
                          `HTTP错误: ${response.status} Bad Request`;
      // 隐藏可能包含API密钥的敏感信息
      const sanitizedMsg = String(errorMessage).replace(/api_key:[A-Za-z0-9_-]+/g, 'api_key:***');
      throw new Error(sanitizedMsg);
    }

    const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const text = HttpClient.cleanResponseText(rawText);
    return {
      text,
      candidates: response.data?.candidates || []
    };
  }

  async generateImage(params: {
    model: string;
    contents: any[];
  }): Promise<{ text?: string; imageData?: Buffer }> {
    const url = `${this.baseUrl}/v1beta/models/${params.model}:generateContent`;
    
    const headers: Record<string, string> = {
      'x-goog-api-key': this.apiKey
    };

    const requestData = {
      contents: params.contents,
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE']
      }
    };

    const response = await HttpClient.makeRequest(url, {
      method: 'POST',
      headers,
      data: requestData
    });

    if (response.status !== 200 || response.data?.error) {
      const errorMsg = response.data?.error?.message || JSON.stringify(response.data);
      // 隐藏可能包含API密钥的敏感信息
      const sanitizedMsg = errorMsg.replace(/api_key:[A-Za-z0-9_-]+/g, 'api_key:***');
      throw new Error(`API Error: ${response.status} - ${sanitizedMsg}`);
    }

    const parts = response.data?.candidates?.[0]?.content?.parts || [];
    let text: string | undefined;
    let imageData: Buffer | undefined;

    for (const part of parts) {
      if (part?.text) {
        text = HttpClient.cleanResponseText(part.text);
      } else if (part?.inlineData?.data) {
        imageData = Buffer.from(part.inlineData.data, 'base64');
      }
    }

    return { text, imageData };
  }

  async generateTTS(params: {
    model: string;
    contents: any[];
    voiceName?: string;
  }): Promise<{ audioData?: Buffer[]; audioMimeType?: string }> {

    const url = `${this.baseUrl}/v1beta/models/${params.model}:generateContent`;
    
    const headers: Record<string, string> = {
      'x-goog-api-key': this.apiKey,
      'Content-Type': 'application/json'
    };

    const voiceName = params.voiceName || DEFAULT_CONFIG[CONFIG_KEYS.GEMINI_TTS_VOICE];
    
    const textContent = params.contents[0]?.parts?.[0]?.text || '';
    if (!textContent.trim()) {
      throw new Error('TTS 需要有效的文本内容');
    }

    const requestData = {
      contents: [{
        role: 'user',
        parts: [{ text: textContent }]
      }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voiceName
            }
          }
        }
      }
    };

    const response = await HttpClient.makeRequest(url, {
      method: 'POST',
      headers,
      data: requestData,
      timeout: 60000
    });

    if (response.status !== 200) {
      const errorMsg = response.data?.error?.message || 'Unknown error';
      if (response.status === 429) {
        throw new Error('API配额已用完，请检查您的计费详情');
      }
      const sanitizedMsg = errorMsg.replace(/api_key:[A-Za-z0-9_-]+/g, 'api_key:***');
      throw new Error(`HTTP错误 ${response.status}: ${sanitizedMsg}`);
    }

    if (response.data?.error) {
      const errorMsg = response.data.error.message || JSON.stringify(response.data.error);
      const sanitizedMsg = errorMsg.replace(/api_key:[A-Za-z0-9_-]+/g, 'api_key:***');
      throw new Error(`API错误: ${sanitizedMsg}`);
    }

    const candidate = response.data?.candidates?.[0];
    
    if (candidate) {
      const part = candidate?.content?.parts?.[0];
      if (part?.inlineData?.data) {
        const audioBuffer = Buffer.from(part.inlineData.data, 'base64');
        const audioMimeType = part.inlineData.mimeType || 'audio/wav';
        return { audioData: [audioBuffer], audioMimeType };
      }
    }

    if (response.data?.candidates?.[0]?.finishReason === 'OTHER') {
      throw new Error('TTS服务暂时不可用，请稍后重试');
    }
    
    throw new Error('TTS服务返回了无效的响应格式');
  }

  async listModels(): Promise<string[]> {
    const url = `${this.baseUrl}/v1beta/models`;
    
    const headers: Record<string, string> = {
      'x-goog-api-key': this.apiKey
    };

    const response = await HttpClient.makeRequest(url, {
      method: 'GET',
      headers
    });

    if (response.status !== 200 || response.data?.error) {
      const errorMsg = response.data?.error?.message || JSON.stringify(response.data);
      const sanitizedMsg = errorMsg.replace(/api_key:[A-Za-z0-9_-]+/g, 'api_key:***');
      throw new Error(`API Error: ${response.status} - ${sanitizedMsg}`);
    }

    return (response.data?.models || []).map((model: any) => 
      model.name?.replace('models/', '') || model.name
    );
  }
}

const CONFIG_MAP = {
  'apikey': { key: CONFIG_KEYS.GEMINI_API_KEY, name: 'API Key' },
  'baseurl': { key: CONFIG_KEYS.GEMINI_BASE_URL, name: '基础 URL' },
  'maxtokens': { key: CONFIG_KEYS.GEMINI_MAX_TOKENS, name: '最大Token数' },
  'chatmodel': { key: CONFIG_KEYS.GEMINI_CHAT_MODEL, name: '聊天模型' },
  'searchmodel': { key: CONFIG_KEYS.GEMINI_SEARCH_MODEL, name: '搜索模型' },
  'imagemodel': { key: CONFIG_KEYS.GEMINI_IMAGE_MODEL, name: '图片模型' },
  'ttsmodel': { key: CONFIG_KEYS.GEMINI_TTS_MODEL, name: 'TTS模型' },
  'ttsvoice': { key: CONFIG_KEYS.GEMINI_TTS_VOICE, name: 'TTS语音' },
  'context': { key: CONFIG_KEYS.GEMINI_CONTEXT_ENABLED, name: '上下文' },
  'telegraph': { key: CONFIG_KEYS.GEMINI_TELEGRAPH_ENABLED, name: 'Telegraph' },
  'collapse': { key: CONFIG_KEYS.GEMINI_COLLAPSIBLE_QUOTE_ENABLED, name: '折叠引用' }
};

const MODEL_TYPE_MAP = {
  'chat': { key: CONFIG_KEYS.GEMINI_CHAT_MODEL, name: '聊天' },
  'search': { key: CONFIG_KEYS.GEMINI_SEARCH_MODEL, name: '搜索' },
  'image': { key: CONFIG_KEYS.GEMINI_IMAGE_MODEL, name: '图片' },
  'tts': { key: CONFIG_KEYS.GEMINI_TTS_MODEL, name: 'TTS' }
};

const PROMPT_TYPE_MAP = {
  'chat': { key: CONFIG_KEYS.GEMINI_CHAT_ACTIVE_PROMPT, name: '聊天' },
  'search': { key: CONFIG_KEYS.GEMINI_SEARCH_ACTIVE_PROMPT, name: '搜索' },
  'tts': { key: CONFIG_KEYS.GEMINI_TTS_ACTIVE_PROMPT, name: 'TTS' }
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getConfig(key: string, defaultValue?: string): string {
  return ConfigManager.get(key, defaultValue || DEFAULT_CONFIG[key] || "");
}

function createSafetySettings(): any[] {
  return [
    'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_DANGEROUS_CONTENT', 
    'HARM_CATEGORY_HARASSMENT',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    'HARM_CATEGORY_CIVIC_INTEGRITY'
  ].map(category => ({ category, threshold: 'BLOCK_NONE' }));
}

function markdownToHtml(text: string): string {
  let result = text;

  const htmlTags: string[] = [];
  let tagIndex = 0;
  result = result.replace(/<\/?[a-zA-Z][^>]*>/g, (match) => {
    htmlTags.push(match);
    return `__HTML_TAG_${tagIndex++}__`;
  });
  
  result = result
    .replace(/&/g, "&amp;")
    .replace(/</g, "<")
    .replace(/>/g, ">");
  
  htmlTags.forEach((tag, index) => {
    result = result.replace(`__HTML_TAG_${index}__`, tag);
  });
  
  result = result
    .replace(/```(\w+)?\n([\s\S]*?)```/g, (_match, _lang, code) => {
      const escapedCode = code.replace(/</g, '<').replace(/>/g, '>').replace(/&amp;/g, '&');
      return `<pre><code>${Utils.escapeHtml(escapedCode)}</code></pre>`;
    })
    .replace(/`([^`]+)`/g, (_match, code) => {
      const escapedCode = code.replace(/</g, '<').replace(/>/g, '>').replace(/&amp;/g, '&');
      return `<code>${Utils.escapeHtml(escapedCode)}</code>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
    .replace(/__([^_]+)__/g, '<b>$1</b>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^### (.+)$/gm, '<b>$1</b>')
    .replace(/^## (.+)$/gm, '<b>$1</b>')
    .replace(/^# (.+)$/gm, '<b>$1</b>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  return result;
}

async function getGeminiClient(): Promise<GeminiClient> {
  const apiKey = getConfig(CONFIG_KEYS.GEMINI_API_KEY);
  if (!apiKey) {
    throw new Error("未设置 Gemini API 密钥。请使用 gemini apikey <密钥> 命令设置。");
  }
  
  const baseUrl = getConfig(CONFIG_KEYS.GEMINI_BASE_URL) || null;
  return new GeminiClient(apiKey, baseUrl);
}

async function callGeminiChat(
  prompt: string,
  useSearch: boolean = false,
  imageData?: string
): Promise<string> {
  const client = await getGeminiClient();
  const modelKey = useSearch ? CONFIG_KEYS.GEMINI_SEARCH_MODEL : CONFIG_KEYS.GEMINI_CHAT_MODEL;
  const modelName = getConfig(modelKey);

  const activePromptKey = useSearch ? CONFIG_KEYS.GEMINI_SEARCH_ACTIVE_PROMPT : CONFIG_KEYS.GEMINI_CHAT_ACTIVE_PROMPT;
  const systemPromptName = getConfig(activePromptKey);
  const prompts = JSON.parse(getConfig(CONFIG_KEYS.GEMINI_PROMPTS, "{}"));
  const systemPrompt = systemPromptName ? prompts[systemPromptName] || "你是一个乐于助人的人工智能助手。" : "你是一个乐于助人的人工智能助手。";

  const baseParts: any[] = [{ text: prompt }];
  if (imageData) {
    baseParts.push({ inlineData: { mimeType: "image/png", data: imageData } });
  }
  let contents: any[] = [{ role: "user", parts: baseParts }];

  if (getConfig(CONFIG_KEYS.GEMINI_CONTEXT_ENABLED) === "on" && !useSearch) {
    const history = JSON.parse(getConfig(CONFIG_KEYS.GEMINI_CHAT_HISTORY, "[]"));
    const cleanHistory = history.filter((item: any) => {
      return item.role && item.parts && item.parts.every((part: any) => 
        part.text && typeof part.text === 'string' && !part.inlineData
      );
    });
    
    if (history.length > 0 && history.some((item: any) => !item.role)) {

      ConfigManager.set(CONFIG_KEYS.GEMINI_CHAT_HISTORY, "[]");
    } else {
      contents = [...cleanHistory, ...contents];
    }
  }

  const maxTokens = parseInt(getConfig(CONFIG_KEYS.GEMINI_MAX_TOKENS, "0"));
  const tools = useSearch ? [{ googleSearch: {} }] : undefined;

  let response;
  try {
    response = await client.generateContent({
      model: modelName,
      contents,
      systemInstruction: systemPrompt,
      safetySettings: createSafetySettings(),
      maxOutputTokens: maxTokens > 0 ? maxTokens : undefined,
      tools
    });

  } catch (error: any) {

    throw error;
  }

  if (getConfig(CONFIG_KEYS.GEMINI_CONTEXT_ENABLED) === "on" && !useSearch) {
    const history = JSON.parse(getConfig(CONFIG_KEYS.GEMINI_CHAT_HISTORY, "[]"));
    history.push(
      { role: "user", parts: [{ text: prompt }] }, 
      { role: "model", parts: [{ text: response.text }] }
    );
    
    const maxHistoryLength = 20; 
    if (history.length > maxHistoryLength) {
      history.splice(0, history.length - maxHistoryLength);
    }
    
    ConfigManager.set(CONFIG_KEYS.GEMINI_CHAT_HISTORY, JSON.stringify(history));
  }

  return response.text;
}

function formatResponse(question: string, answer: string): string {
  const isCollapsibleEnabled = getConfig(CONFIG_KEYS.GEMINI_COLLAPSIBLE_QUOTE_ENABLED) === "on";
  let finalText = "";

  if (question.trim()) {
    const htmlQuestion = markdownToHtml(question);
    const quoteTag = isCollapsibleEnabled ? "<blockquote expandable>" : "<blockquote>";
    finalText += `<b>Q:</b>\n${quoteTag}${htmlQuestion}</blockquote>\n\n`;
  }

  const htmlAnswer = markdownToHtml(answer);
  const quoteTag = isCollapsibleEnabled ? "<blockquote expandable>" : "<blockquote>";
  finalText += `<b>A:</b>\n${quoteTag}${htmlAnswer}</blockquote>`;

  return finalText;
}

async function downloadAndProcessImage(
  client: any,
  message: Api.Message,
  infoMessage: Api.Message
): Promise<string> {
  await infoMessage.edit({ text: "下载图片..." });
  let mediaMsg = message;
  const replyMsg = await message.getReplyMessage();
  if (!message.media && replyMsg?.media) {
    mediaMsg = replyMsg;
  }

  if (!mediaMsg.media) {
    throw new Error("未找到图片");
  }

  const buffer = await client.downloadMedia(mediaMsg.media, { 
    workers: 1,
    progressCallback: (received: number, total: number) => {
      const percent = (received * 100 / total);
      infoMessage.edit({
        text: `下载图片 ${percent.toFixed(1)}%`
      }).catch(() => {});
    }
  });

  if (!buffer) {
    throw new Error("图片下载失败");
  }

  await infoMessage.edit({ text: "下载图片 100%" });

  return (buffer as Buffer).toString('base64');
}

function extractQuestionFromArgs(args: string[], replyMsg?: Api.Message | null): { userQuestion: string; displayQuestion: string; apiQuestion: string } {
  const userQuestion = args.join(" ");
  
  if (!userQuestion && replyMsg?.text) {
    const replyText = Utils.removeEmoji(replyMsg.text.trim());
    return {
      userQuestion: "",
      displayQuestion: replyText,
      apiQuestion: replyText
    };
  } else if (userQuestion && replyMsg?.text) {
    const cleanUserQuestion = Utils.removeEmoji(userQuestion);
    const replyText = Utils.removeEmoji(replyMsg.text.trim());
    return {
      userQuestion: cleanUserQuestion,
      displayQuestion: cleanUserQuestion,
      apiQuestion: `原消息内容: ${replyText}\n\n问题: ${cleanUserQuestion}`
    };
  } else {
    const cleanUserQuestion = Utils.removeEmoji(userQuestion);
    return {
      userQuestion: cleanUserQuestion,
      displayQuestion: cleanUserQuestion,
      apiQuestion: cleanUserQuestion
    };
  }
}

async function handleSearch(msg: Api.Message, args: string[]): Promise<void> {
  const replyMsg = await msg.getReplyMessage();
  const { userQuestion, displayQuestion, apiQuestion } = extractQuestionFromArgs(args, replyMsg);
  
  if (!apiQuestion) {
    await msg.edit({ text: "❌ 请提供搜索查询或回复一条有文字内容的消息" });
    return;
  }

  await msg.edit({ text: "🔍 搜索中..." });
  const answer = await callGeminiChat(apiQuestion, true);
  const formattedText = formatResponse(displayQuestion, answer);
  
  if (replyMsg) {
    await msg.client?.sendMessage(msg.peerId, {
      message: formattedText + "\n\n<i>Powered by Gemini with Google Search</i>",
      linkPreview: false,
      parseMode: "html",
      replyTo: replyMsg.id
    });

    try {
      await msg.delete();
    } catch {}
  } else {
    await msg.edit({ 
      text: formattedText + "\n\n<i>Powered by Gemini with Google Search</i>",
      linkPreview: false,
      parseMode: "html"
    });
  }
}

async function handleImage(msg: Api.Message, args: string[]): Promise<void> {
  const replyMsg = await msg.getReplyMessage();
  const { userQuestion, displayQuestion, apiQuestion } = extractQuestionFromArgs(args, replyMsg);
  
  if (!apiQuestion) {
    await msg.edit({ text: "❌ 请提供图片生成提示或回复一条有文字内容的消息" });
    return;
  }

  await msg.edit({ text: "🎨 生成图片中..." });
  
  try {
    const client = await getGeminiClient();
    const response = await client.generateImage({
      model: getConfig(CONFIG_KEYS.GEMINI_IMAGE_MODEL),
      contents: [{ parts: [{ text: apiQuestion }] }]
    });

    if (!response.imageData) {
      await msg.edit({ text: "❌ 图片生成失败" });
      return;
    }

    const replyMsg = await msg.getReplyMessage();
    const imageFile = Object.assign(response.imageData, {
      name: 'gemini.png'
    });
    
    if (replyMsg) {
      await msg.client?.sendFile(msg.peerId, {
        file: imageFile,
        caption: `<b>提示:</b> ${Utils.escapeHtml(displayQuestion || apiQuestion)}\n\n<i>Powered by Gemini Image Generation</i>`,
        parseMode: "html",
        replyTo: replyMsg.id
      });
  
      try {
        await msg.delete();
      } catch {}
    } else {
      await msg.edit({
        file: imageFile,
        text: `<b>提示:</b> ${Utils.escapeHtml(displayQuestion || apiQuestion)}\n\n<i>Powered by Gemini Image Generation</i>`,
        parseMode: "html"
      });
    }
    
  } catch (error: any) {
    await msg.edit({ text: Utils.handleError(error, '图片生成') });
  }
}

async function processAudioGeneration(
msg: Api.Message, text: string, p0: string,
replyMsg?: Api.Message | null): Promise<void> {
  const client = await getGeminiClient();
  const modelName = ConfigManager.get(CONFIG_KEYS.GEMINI_TTS_MODEL, DEFAULT_CONFIG[CONFIG_KEYS.GEMINI_TTS_MODEL]);
  const voiceName = ConfigManager.get(CONFIG_KEYS.GEMINI_TTS_VOICE, DEFAULT_CONFIG[CONFIG_KEYS.GEMINI_TTS_VOICE]);

  const response = await client.generateTTS({
    model: modelName,
    contents: [{ parts: [{ text }] }],
    voiceName
  });

  if (!response.audioData?.length) {
    throw new Error('没有收到音频数据');
  }

  const combinedAudio = Buffer.concat(response.audioData);
  if (combinedAudio.length === 0) {
    throw new Error('合并后的音频数据为空');
  }

  if (replyMsg) {
    let processedAudio: any = combinedAudio;
    
    if (response.audioMimeType && response.audioMimeType.includes('L16') && response.audioMimeType.includes('pcm')) {
      processedAudio = Utils.convertToWav(combinedAudio, response.audioMimeType) as any;
    }

    const audioFile = Object.assign(processedAudio as any, {
      name: 'gemini.ogg'
    });

    await msg.client?.sendFile(msg.peerId, {
      file: audioFile,
      caption: `<b>文本:</b> ${Utils.escapeHtml(text)}\n\n<i>Powered by Gemini TTS (${voiceName})</i>`,
      parseMode: "html",
      replyTo: replyMsg.id,
      attributes: [new Api.DocumentAttributeAudio({
        duration: 0,
        voice: true
      })]
    });

    try {
      await msg.delete();
    } catch {}
  } else {
    let processedAudio: any = combinedAudio;
    
    if (response.audioMimeType && response.audioMimeType.includes('L16') && response.audioMimeType.includes('pcm')) {
      processedAudio = Utils.convertToWav(combinedAudio, response.audioMimeType) as any;
    }

    const audioFile = Object.assign(processedAudio as any, {
      name: 'gemini.ogg'
    });

    await msg.client?.sendFile(msg.peerId, {
      file: audioFile,
      caption: `<b>文本:</b> ${Utils.escapeHtml(text)}\n\n<i>Powered by Gemini TTS (${voiceName})</i>`,
      parseMode: "html",
      attributes: [new Api.DocumentAttributeAudio({
        duration: 0,
        voice: true
      })]
    });

    try {
      await msg.delete();
    } catch {}
  }
}

async function handleTTS(msg: Api.Message, args: string[]): Promise<void> {
  const replyMsg = await msg.getReplyMessage();
  const { userQuestion, displayQuestion, apiQuestion } = extractQuestionFromArgs(args, replyMsg);
  
  if (!apiQuestion) {
    await msg.edit({ text: "❌ 请提供要转换为语音的文本或回复一条有文字内容的消息" });
    return;
  }

  await msg.edit({ text: "🗣️ 生成语音中..." });
  
  try {
    await processAudioGeneration(msg, apiQuestion, 'TTS Handler', replyMsg);
  } catch (error: any) {
    await msg.edit({ text: `❌ 语音生成失败: ${error.message || '未知错误'}` });
  }
}

async function handleQuestionWithAudio(
  msg: Api.Message, 
  question: string, 
  displayQuestion: string,
  useSearch: boolean, 
  context: string,
  replyMsg?: Api.Message | null
): Promise<void> {
  try {
    const answer = await callGeminiChat(question, useSearch);
    
    await msg.edit({ text: "🗣️ 转换为语音中..." });
    
    const formattedText = formatResponse(displayQuestion, answer);
    const voiceName = ConfigManager.get(CONFIG_KEYS.GEMINI_TTS_VOICE, DEFAULT_CONFIG[CONFIG_KEYS.GEMINI_TTS_VOICE]);
    const searchText = useSearch ? ' with Google Search' : '';
    
    try {
      const client = await getGeminiClient();
      const audioResponse = await client.generateTTS({
        model: getConfig(CONFIG_KEYS.GEMINI_TTS_MODEL),
        contents: [{ parts: [{ text: answer }] }],
        voiceName
      });
      
      if (audioResponse.audioData?.length) {
        const combinedAudio = Buffer.concat(audioResponse.audioData);
        
        if (combinedAudio.length > 0) {
  
          if (replyMsg) {
            let processedAudio: any = combinedAudio;

            if (audioResponse.audioMimeType && audioResponse.audioMimeType.includes('L16') && audioResponse.audioMimeType.includes('pcm')) {
              processedAudio = Utils.convertToWav(combinedAudio, audioResponse.audioMimeType) as any;
            }

            const audioFile = Object.assign(processedAudio as any, {
              name: 'gemini.ogg'
            });

            await msg.client?.sendFile(msg.peerId, {
              file: audioFile,
              caption: formattedText + `\n\n<i>Powered by Gemini${searchText} Audio (${voiceName})</i>`,
              parseMode: "html",
              replyTo: replyMsg.id,
              attributes: [new Api.DocumentAttributeAudio({
                duration: 0,
                voice: true
              })]
            });

            try {
              await msg.delete();
            } catch {}
          } else {
            await Utils.sendAudioBuffer(
              msg,
              combinedAudio,
              formattedText + `\n\n<i>Powered by Gemini${searchText} Audio (${voiceName})</i>`,
              audioResponse.audioMimeType
            );
          }
        } else {
          throw new Error('音频数据为空');
        }
      } else {
        throw new Error('未收到音频数据');
      }
    } catch (audioError: any) {

      const errorMessage = audioError.message || '未知错误';
      if (replyMsg) {
        await msg.client?.sendMessage(msg.peerId, {
          message: formattedText + `\n\n<i>Powered by Gemini${searchText} (${errorMessage}，仅显示文本)</i>`,
          linkPreview: false,
          parseMode: "html",
          replyTo: replyMsg.id
        });

        try {
          await msg.delete();
        } catch {}
      } else {
        await msg.edit({ 
          text: formattedText + `\n\n<i>Powered by Gemini${searchText} (${errorMessage}，仅显示文本)</i>`,
          linkPreview: false,
          parseMode: "html"
        });
      }
    }
  } catch (error: any) {
    await msg.edit({ text: Utils.handleError(error, `${useSearch ? '搜索' : ''}音频回答生成`) });
  }
}

async function handleAudio(msg: Api.Message, args: string[]): Promise<void> {
  const replyMsg = await msg.getReplyMessage();
  const { userQuestion, displayQuestion, apiQuestion } = extractQuestionFromArgs(args, replyMsg);
  
  if (!apiQuestion) {
    await msg.edit({ text: "❌ 请提供问题或回复一条有文字内容的消息" });
    return;
  }

  await handleQuestionWithAudio(msg, apiQuestion, displayQuestion, false, 'Audio', replyMsg);
}

async function handleSearchAudio(msg: Api.Message, args: string[]): Promise<void> {
  const replyMsg = await msg.getReplyMessage();
  const { userQuestion, displayQuestion, apiQuestion } = extractQuestionFromArgs(args, replyMsg);
  
  if (!apiQuestion) {
    await msg.edit({ text: "❌ 请提供搜索查询或回复一条有文字内容的消息" });
    return;
  }

  await msg.edit({ text: "🔍 搜索中..." });
  await handleQuestionWithAudio(msg, apiQuestion, displayQuestion, true, 'Search Audio', replyMsg);
}

async function handleSettings(msg: Api.Message): Promise<void> {
  const switchToText = (value: string): string => value === "on" ? "开启" : "关闭";
  const tokensToText = (value: string): string => value === "0" ? "无限制" : value;
  
  const settings = {
    "基础 URL": Utils.censorUrl(getConfig(CONFIG_KEYS.GEMINI_BASE_URL)),
    "聊天模型": getConfig(CONFIG_KEYS.GEMINI_CHAT_MODEL),
    "搜索模型": getConfig(CONFIG_KEYS.GEMINI_SEARCH_MODEL),
    "图片模型": getConfig(CONFIG_KEYS.GEMINI_IMAGE_MODEL),
    "TTS模型": getConfig(CONFIG_KEYS.GEMINI_TTS_MODEL),
    "TTS语音": getConfig(CONFIG_KEYS.GEMINI_TTS_VOICE),
    "最大Token数": tokensToText(getConfig(CONFIG_KEYS.GEMINI_MAX_TOKENS)),
    "上下文启用": switchToText(getConfig(CONFIG_KEYS.GEMINI_CONTEXT_ENABLED)),
    "Telegraph启用": switchToText(getConfig(CONFIG_KEYS.GEMINI_TELEGRAPH_ENABLED)),
    "折叠引用": switchToText(getConfig(CONFIG_KEYS.GEMINI_COLLAPSIBLE_QUOTE_ENABLED))
  };

  const settingsText = "<b>Gemini 设置:</b>\n\n" + Object.entries(settings)
    .map(([key, value]) => `<b>• ${key}:</b> <code>${value}</code>`)
    .join("\n");

  await msg.edit({ text: settingsText, parseMode: "html" });
}

async function handleModelList(msg: Api.Message): Promise<void> {
  await msg.edit({ text: "🔍 获取可用模型..." });
  
  try {
    const client = await getGeminiClient();
    const models = await client.listModels();
    
    const modelText = `<b>可用模型:</b>\n\n${models.map(model => `• <code>${model}</code>`).join("\n")}`;
    await msg.edit({ text: modelText, parseMode: "html" });
  } catch (error: any) {
    await msg.edit({ text: Utils.handleError(error, '获取模型') });
  }
}

async function handleContextClear(msg: Api.Message): Promise<void> {
  ConfigManager.set(CONFIG_KEYS.GEMINI_CHAT_HISTORY, "[]");
  await msg.edit({ text: "✅ 对话历史已清除" });
}

async function handleContextShow(msg: Api.Message): Promise<void> {
  const history = JSON.parse(ConfigManager.get(CONFIG_KEYS.GEMINI_CHAT_HISTORY, "[]"));
  const isEnabled = ConfigManager.get(CONFIG_KEYS.GEMINI_CONTEXT_ENABLED) === "on";
  
  if (history.length === 0) {
    await msg.edit({ 
      text: `<b>对话上下文状态:</b> ${isEnabled ? "已启用" : "已禁用"}\n\n<b>对话历史:</b> 空`, 
      parseMode: "html" 
    });
    return;
  }
  
  let displayText = `<b>对话上下文状态:</b> ${isEnabled ? "已启用" : "已禁用"}\n\n<b>对话历史</b> (${history.length / 2} 轮对话):\n\n`;

  const maxRounds = 5;
  const startIndex = Math.max(0, history.length - maxRounds * 2);
  
  for (let i = startIndex; i < history.length; i += 2) {
    const userMsg = history[i]?.parts?.[0]?.text || "";
    const assistantMsg = history[i + 1]?.parts?.[0]?.text || "";
    
    const roundNum = Math.floor(i / 2) + 1;
    const truncatedUserMsg = userMsg.length > 100 ? userMsg.substring(0, 100) + "..." : userMsg;
    const truncatedAssistantMsg = assistantMsg.length > 200 ? assistantMsg.substring(0, 200) + "..." : assistantMsg;
    
    displayText += `<b>第${roundNum}轮:</b>\n`;
    displayText += `<b>Q:</b> ${Utils.escapeHtml(truncatedUserMsg)}\n`;
    displayText += `<b>A:</b> ${Utils.escapeHtml(truncatedAssistantMsg)}\n\n`;
  }
  
  if (history.length > maxRounds * 2) {
    displayText += `<i>... 还有 ${Math.floor((history.length - maxRounds * 2) / 2)} 轮更早的对话</i>`;
  }
  
  await msg.edit({ text: displayText, parseMode: "html" });
}

async function handleTelegraph(msg: Api.Message, args: string[]): Promise<void> {
  const subCommand = args[0];
  
  switch (subCommand) {
    case "on":
      ConfigManager.set(CONFIG_KEYS.GEMINI_TELEGRAPH_ENABLED, "on");
      await msg.edit({ text: "✅ Telegraph集成已启用", parseMode: "html" });
      break;
    case "off":
      ConfigManager.set(CONFIG_KEYS.GEMINI_TELEGRAPH_ENABLED, "off");
      await msg.edit({ text: "✅ Telegraph集成已禁用", parseMode: "html" });
      break;
    case "limit":
      if (args[1]) {
        const validation = Utils.validateConfig(CONFIG_KEYS.GEMINI_TELEGRAPH_LIMIT, args[1]);
        if (!validation.isValid) {
          await msg.edit({ text: `❌ ${validation.error}` });
          return;
        }
        ConfigManager.set(CONFIG_KEYS.GEMINI_TELEGRAPH_LIMIT, args[1]);
        await msg.edit({ text: `✅ Telegraph字符限制已设置为 ${args[1]}`, parseMode: "html" });
      } else {
        await msg.edit({ text: "❌ 用法: gemini telegraph limit <数字>" });
      }
      break;
    case "list":
      const posts = JSON.parse(ConfigManager.get(CONFIG_KEYS.GEMINI_TELEGRAPH_POSTS, "{}"));
      if (Object.keys(posts).length === 0) {
        await msg.edit({ text: html`<b>尚未创建Telegraph文章。</b>`, parseMode: "html" });
        return;
      }
      
      const postsList = Object.entries(posts)
        .map(([id, data]: [string, any]) => `• <code>${id}</code>: <a href="https://telegra.ph/${data.path}">${Utils.escapeHtml(data.title)}</a>`)
        .join("\n");
      
      await msg.edit({ 
        text: `<b>已创建的Telegraph文章:</b>\n\n${postsList}`, 
        parseMode: "html",
        linkPreview: false
      });
      break;
    case "del":
      const delTarget = args[1];
      if (!delTarget) {
        await msg.edit({ text: "❌ 用法: gemini telegraph del [id|all]" });
        return;
      }
      
      const currentPosts = JSON.parse(ConfigManager.get(CONFIG_KEYS.GEMINI_TELEGRAPH_POSTS, "{}"));
      
      if (delTarget === "all") {
        ConfigManager.set(CONFIG_KEYS.GEMINI_TELEGRAPH_POSTS, "{}");
        await msg.edit({ text: "✅ 已删除所有Telegraph文章", parseMode: "html" });
      } else {
        if (currentPosts[delTarget]) {
          delete currentPosts[delTarget];
          ConfigManager.set(CONFIG_KEYS.GEMINI_TELEGRAPH_POSTS, JSON.stringify(currentPosts));
          await msg.edit({ text: `✅ 已删除Telegraph文章 <code>${delTarget}</code>`, parseMode: "html" });
        } else {
          await msg.edit({ text: `❌ 未找到ID为 <code>${delTarget}</code> 的Telegraph文章`, parseMode: "html" });
        }
      }
      break;
    default:
      await msg.edit({ text: "❌ 用法: gemini telegraph [on|off|limit|list|del]" });
  }
}

async function handleCollapse(msg: Api.Message, args: string[]): Promise<void> {
  const setting = args[0];
  
  if (setting === "on") {
    ConfigManager.set(CONFIG_KEYS.GEMINI_COLLAPSIBLE_QUOTE_ENABLED, "on");
    await msg.edit({ text: "✅ 折叠引用已启用", parseMode: "html" });
  } else if (setting === "off") {
    ConfigManager.set(CONFIG_KEYS.GEMINI_COLLAPSIBLE_QUOTE_ENABLED, "off");
    await msg.edit({ text: "✅ 折叠引用已禁用", parseMode: "html" });
  } else {
    await msg.edit({ text: "❌ 用法: gemini collapse [on|off]" });
  }
}

async function handlePrompt(msg: Api.Message, args: string[]): Promise<void> {
  const [subCommand, ...subArgs] = args;
  const prompts = JSON.parse(ConfigManager.get(CONFIG_KEYS.GEMINI_PROMPTS, "{}"));
  
  switch (subCommand) {
    case "add":
      if (subArgs.length < 2) {
        await msg.edit({ text: "❌ 用法: gemini prompt add <名称> <提示内容>" });
        return;
      }
      const [name, ...promptParts] = subArgs;
      prompts[name] = promptParts.join(" ");
      ConfigManager.set(CONFIG_KEYS.GEMINI_PROMPTS, JSON.stringify(prompts));
      await msg.edit({ text: `✅ 系统提示 '${name}' 已添加`, parseMode: "html" });
      break;
      
    case "del":
      const delName = subArgs[0];
      if (!delName) {
        await msg.edit({ text: "❌ 用法: gemini prompt del <名称>" });
        return;
      }
      if (delName in prompts) {
        delete prompts[delName];
        ConfigManager.set(CONFIG_KEYS.GEMINI_PROMPTS, JSON.stringify(prompts));
        await msg.edit({ text: `✅ 系统提示 '${delName}' 已删除`, parseMode: "html" });
      } else {
        await msg.edit({ text: `❌ 未找到系统提示 '${delName}'` });
      }
      break;
      
    case "list":
      if (Object.keys(prompts).length === 0) {
        await msg.edit({ text: html`<b>未保存任何系统提示。</b>`, parseMode: "html" });
        return;
      }
      const promptsList = Object.entries(prompts)
        .map(([name, content]) => `• <code>${name}</code>:\n<pre><code>${Utils.escapeHtml(content as string)}</code></pre>`)
        .join("\n\n");
      await msg.edit({ text: `<b>可用的系统提示:</b>\n\n${promptsList}`, parseMode: "html" });
      break;
      
    case "set":
      const [promptType, setName] = subArgs;
      if (!promptType || !setName) {
        await msg.edit({ text: "❌ 用法: gemini prompt set [chat|search|tts] <名称>" });
        return;
      }
      
      if (!(setName in prompts)) {
        await msg.edit({ text: `❌ 未找到系统提示 '${setName}'` });
        return;
      }
      
      const promptConfig = PROMPT_TYPE_MAP[promptType as keyof typeof PROMPT_TYPE_MAP];
      if (promptConfig) {
        ConfigManager.set(promptConfig.key, setName);
        await msg.edit({ text: `✅ 当前${promptConfig.name}系统提示已设置为: <code>${setName}</code>`, parseMode: "html" });
      } else {
        await msg.edit({ text: "❌ 用法: gemini prompt set [chat|search|tts] <名称>" });
      }
      break;
      
    default:
      await msg.edit({ text: "❌ 用法: gemini prompt [add|del|list|set]" });
  }
}

async function handleModel(msg: Api.Message, args: string[]): Promise<void> {
  const subCommand = args[0];
  
  if (subCommand === "list") {
    await handleModelList(msg);
    return;
  }
  
  if (subCommand === "set" && args.length >= 3) {
    const modelType = args[1];
    const modelName = args[2];
    const modelConfig = MODEL_TYPE_MAP[modelType as keyof typeof MODEL_TYPE_MAP];
    
    if (modelConfig) {
      ConfigManager.set(modelConfig.key, modelName);
      await msg.edit({ 
        text: `✅ Gemini ${modelConfig.name}模型已设置为: <code>${modelName}</code>`, 
        parseMode: "html" 
      });
    } else {
      await msg.edit({ text: "❌ 用法: gemini model set [chat|search|image|tts] <模型名称>" });
    }
  } else {
    await msg.edit({ text: "❌ 用法: gemini model [list|set]" });
  }
}

async function handleTTSVoice(msg: Api.Message, args: string[]): Promise<void> {
  if (args.length === 0) {
    await msg.edit({ text: "❌ 用法: gemini ttsvoice <语音名称> 或 gemini ttsvoice list" });
    return;
  }
  
  if (args[0].toLowerCase() === 'list') {
    const availableVoices = [
      "Achernar", "Achird", "Algenib", "Algieba", "Alnilam", "Aoede", "Autonoe", "Callirrhoe",
      "Charon", "Despina", "Enceladus", "Erinome", "Fenrir", "Gacrux", "Iapetus", "Kore",
      "Laomedeia", "Leda", "Orus", "Puck", "Pulcherrima", "Rasalgethi", "Sadachbia",
      "Sadaltager", "Schedar", "Sulafat", "Umbriel", "Vindemiatrix", "Zephyr", "Zubenelgenubi"
    ];
    
    const currentVoice = getConfig(CONFIG_KEYS.GEMINI_TTS_VOICE);
    let voiceList = "🎵 <b>可用的 TTS 音色列表:</b>\n\n";
    
    availableVoices.forEach(voice => {
      if (voice === currentVoice) {
        voiceList += `• <b>${voice}</b> ✅ (当前使用)\n`;
      } else {
        voiceList += `• ${voice}\n`;
      }
    });
    
    voiceList += "\n💡 使用 <code>gemini ttsvoice &lt;音色名称&gt;</code> 来设置音色";
    
    await msg.edit({ text: voiceList, parseMode: "html" });
    return;
  }
  
  const voiceName = args.join(" ");
  
  const availableVoices = [
    "Achernar", "Achird", "Algenib", "Algieba", "Alnilam", "Aoede", "Autonoe", "Callirrhoe",
    "Charon", "Despina", "Enceladus", "Erinome", "Fenrir", "Gacrux", "Iapetus", "Kore",
    "Laomedeia", "Leda", "Orus", "Puck", "Pulcherrima", "Rasalgethi", "Sadachbia",
    "Sadaltager", "Schedar", "Sulafat", "Umbriel", "Vindemiatrix", "Zephyr", "Zubenelgenubi"
  ];
  
  if (!availableVoices.includes(voiceName)) {
    await msg.edit({ 
      text: `❌ 无效的音色名称: <code>${voiceName}</code>\n\n💡 使用 <code>gemini ttsvoice list</code> 查看所有可用音色`, 
      parseMode: "html" 
    });
    return;
  }
  
  ConfigManager.set(CONFIG_KEYS.GEMINI_TTS_VOICE, voiceName);
  await msg.edit({ text: `✅ Gemini TTS 语音已设置为: <code>${voiceName}</code>`, parseMode: "html" });
}

async function handleGeminiRequest(msg: Api.Message): Promise<void> {
  const [, ...args] = msg.message.slice(1).split(" ");
  const subCommand = args[0];
  const subArgs = args.slice(1);

  try {
    
    switch (subCommand) {
      case "search":
        await handleSearch(msg, subArgs);
        return;
      case "image":
        await handleImage(msg, subArgs);
        return;
      case "tts":
        await handleTTS(msg, subArgs);
        return;
      case "audio":
        await handleAudio(msg, subArgs);
        return;
      case "searchaudio":
        await handleSearchAudio(msg, subArgs);
        return;
      case "settings":
        await handleSettings(msg);
        return;
      case "model":
        await handleModel(msg, subArgs);
        return;
      case "ttsvoice":
        await handleTTSVoice(msg, subArgs);
        return;
      case "context":
        if (subArgs[0] === "clear") {
          await handleContextClear(msg);
        } else if (subArgs[0] === "on") {
          ConfigManager.set(CONFIG_KEYS.GEMINI_CONTEXT_ENABLED, "on");
          await msg.edit({ text: "✅ 对话上下文已启用" });
        } else if (subArgs[0] === "off") {
          ConfigManager.set(CONFIG_KEYS.GEMINI_CONTEXT_ENABLED, "off");
          await msg.edit({ text: "✅ 对话上下文已禁用" });
        } else if (subArgs[0] === "show") {
          await handleContextShow(msg);
        } else {
          await msg.edit({ text: "❌ 用法: gemini context [on|off|clear|show]" });
        }
        return;
      case "telegraph":
        await handleTelegraph(msg, subArgs);
        return;
      case "collapse":
        await handleCollapse(msg, subArgs);
        return;
      case "prompt":
        await handlePrompt(msg, subArgs);
        return;
    }

    if (args.length === 2 && ['apikey', 'baseurl', 'maxtokens', 'chatmodel', 'searchmodel', 'imagemodel', 'ttsmodel', 'context', 'telegraph', 'collapse'].includes(args[0])) {
      const configKey = args[0];
      const configValue = args[1].trim();
      const configInfo = CONFIG_MAP[configKey as keyof typeof CONFIG_MAP];
      
      if (!configInfo) {
        await msg.edit({ text: "❌ 未知的配置项" });
        return;
      }
      
      if (configInfo.key !== CONFIG_KEYS.GEMINI_API_KEY) {
        const validation = Utils.validateConfig(configInfo.key, configValue);
        if (!validation.isValid) {
          await msg.edit({ text: `❌ ${validation.error}` });
          return;
        }
      }
      
      ConfigManager.set(configInfo.key, configValue);
      const displayValue = configInfo.key === CONFIG_KEYS.GEMINI_API_KEY 
        ? configValue.substring(0, 8) + "..."
        : configValue;
      
      await msg.edit({ 
        text: `✅ 已设置 ${configInfo.name}: \`${displayValue}\``,
        parseMode: "markdown"
      });
      
      await sleep(5000);
      try {
        await msg.delete();
      } catch (deleteError) {
  
      }
      return;
    }
    
    if (args.length === 2 && args[0] === 'ttsvoice' && args[1].toLowerCase() !== 'list') {
      const configValue = args[1].trim();
      const configInfo = CONFIG_MAP['ttsvoice'];
      

      const validation = Utils.validateConfig(configInfo.key, configValue);
      if (!validation.isValid) {
        await msg.edit({ text: `❌ ${validation.error}` });
        return;
      }
      
      ConfigManager.set(configInfo.key, configValue);
      
      await msg.edit({ 
        text: `✅ 已设置 ${configInfo.name}: \`${configValue}\``,
        parseMode: "markdown"
      });
      
      await sleep(5000);
      try {
        await msg.delete();
      } catch (deleteError) {
  
      }
      return;
    }

    let userQuestion = args.join(" ");
    const replyMsg = await msg.getReplyMessage();
    let displayQuestion = "";
    let apiQuestion = "";

    const hasMedia = msg.media || (replyMsg?.media);
    const useVision = hasMedia;

    if (useVision) {

      await msg.edit({ text: "🤔 下载图片中..." });
      const imageBase64 = await downloadAndProcessImage(
        msg.client,
        msg,
        msg
      );

      if (!userQuestion && replyMsg?.text) {

        const replyText = Utils.removeEmoji(replyMsg.text.trim());
        displayQuestion = replyText;
        apiQuestion = replyText;
      } else if (userQuestion && replyMsg?.text) {

        const cleanUserQuestion = Utils.removeEmoji(userQuestion);
        const replyText = Utils.removeEmoji(replyMsg.text.trim());
        displayQuestion = cleanUserQuestion;
        apiQuestion = `关于这张图片，原消息内容: ${replyText}\n\n问题: ${cleanUserQuestion}`;
      } else if (userQuestion) {

        const cleanUserQuestion = Utils.removeEmoji(userQuestion);
        displayQuestion = cleanUserQuestion;
        apiQuestion = cleanUserQuestion;
      } else {

        displayQuestion = "";
        apiQuestion = "用中文描述此图片";
      }

      await msg.edit({ text: "🤔 思考中..." });      
      const answer = await callGeminiChat(apiQuestion, false, imageBase64);
      const formattedText = formatResponse(displayQuestion, answer);
      if (replyMsg) {
        await msg.client?.sendMessage(msg.peerId, {
          message: formattedText + "\n\n<i>Powered by Gemini</i>",
          linkPreview: false,
          parseMode: "html",
          replyTo: replyMsg.id
        });

        try {
          await msg.delete();
        } catch {}
      } else {
        await msg.edit({ 
          text: formattedText + "\n\n<i>Powered by Gemini</i>",
          linkPreview: false,
          parseMode: "html"
        });
      }

    } else {

      if (!userQuestion && replyMsg?.text) {

        const replyText = replyMsg.text.trim();
        if (!replyText) {
          await msg.edit({ text: "❌ 请直接提问或回复一条有文字内容的消息" });
          return;
        }
        displayQuestion = replyText;
        apiQuestion = replyText;
      } else if (userQuestion && replyMsg?.text) {

        const replyText = replyMsg.text.trim();
        displayQuestion = userQuestion;
        apiQuestion = `原消息内容: ${replyText}\n\n问题: ${userQuestion}`;
      } else if (userQuestion) {

        displayQuestion = userQuestion;
        apiQuestion = userQuestion;
      } else {

        await msg.edit({ text: "❌ 请直接提问或回复一条有文字内容的消息" });
        return;
      }

      await msg.edit({ text: "🤔 思考中..." });
      const answer = await callGeminiChat(apiQuestion, false);
      const formattedText = formatResponse(displayQuestion, answer);
      
      if (replyMsg) {
        await msg.client?.sendMessage(msg.peerId, {
          message: formattedText + "\n\n<i>Powered by Gemini</i>",
          linkPreview: false,
          parseMode: "html",
          replyTo: replyMsg.id
        });

        try {
          await msg.delete();
        } catch {}
      } else {
        await msg.edit({ 
          text: formattedText + "\n\n<i>Powered by Gemini</i>",
          linkPreview: false,
          parseMode: "html"
        });
      }
    }

  } catch (error: any) {
    const errorMsg = Utils.handleError(error, 'Gemini处理');
    await msg.edit({ text: errorMsg });
    await sleep(10000);
    try {
      await msg.delete();
    } catch (deleteError) {
      
    }
  }
}

class GeminiPlugin extends Plugin {
  description: string = `🤖 Google Gemini AI 插件
需要设置API密钥才能使用。

━━━ 核心功能 ━━━
• <code>gemini [query]</code> - 与模型聊天（默认功能）
• <code>gemini search [query]</code> - 使用Gemini AI支持的Google搜索
• <code>gemini image [prompt]</code> - 生成或编辑图片
• <code>gemini tts [text]</code> - 将文本转换为语音
• <code>gemini audio [query]</code> - 与模型聊天并转换为语音回答
• <code>gemini searchaudio [query]</code> - 搜索并转换为语音回答

━━━ 设置管理 ━━━
• <code>gemini settings</code> - 显示当前配置
• <code>gemini apikey &lt;密钥&gt;</code> - 设置Gemini API密钥
• <code>gemini baseurl &lt;地址&gt;</code> - 设置自定义API基础URL（留空清除）
• <code>gemini maxtokens &lt;数量&gt;</code> - 设置最大输出token数（0表示无限制）
• <code>gemini chatmodel &lt;模型名&gt;</code> - 设置聊天模型
• <code>gemini searchmodel &lt;模型名&gt;</code> - 设置搜索模型
• <code>gemini imagemodel &lt;模型名&gt;</code> - 设置图片生成模型
• <code>gemini ttsmodel &lt;模型名&gt;</code> - 设置TTS模型
• <code>gemini ttsvoice &lt;语音名&gt;</code> - 设置TTS语音
• <code>gemini ttsvoice list</code> - 列出所有可用的TTS音色
• <code>gemini collapse &lt;on|off&gt;</code> - 开启或关闭折叠引用

━━━ 模型管理 ━━━
• <code>gemini model list</code> - 列出可用模型
• <code>gemini model set [chat|search|image|tts] &lt;名称&gt;</code> - 设置各类型模型（备用方式）

━━━ 提示词管理 ━━━
• <code>gemini prompt list</code> - 列出所有已保存的系统提示
• <code>gemini prompt add &lt;名称&gt; &lt;内容&gt;</code> - 添加新的系统提示
• <code>gemini prompt del &lt;名称&gt;</code> - 删除系统提示
• <code>gemini prompt set [chat|search|tts] &lt;名称&gt;</code> - 设置激活的系统提示

━━━ 上下文管理 ━━━
• <code>gemini context [on|off]</code> - 开启或关闭对话上下文（默认关闭）
• <code>gemini context clear</code> - 清除对话历史
• <code>gemini context show</code> - 显示对话历史

━━━ Telegraph集成 ━━━
• <code>gemini telegraph on</code> - 开启Telegraph集成（默认关闭）
• <code>gemini telegraph off</code> - 关闭Telegraph集成
• <code>gemini telegraph limit &lt;数量&gt;</code> - 设置Telegraph文章字符限制
• <code>gemini telegraph list</code> - 列出已创建的Telegraph文章
• <code>gemini telegraph del [id|all]</code> - 删除指定或全部Telegraph文章`;

  cmdHandlers: Record<string, (msg: Api.Message) => Promise<void>> = {
    gemini: handleGeminiRequest,
  };
}

export default new GeminiPlugin();
