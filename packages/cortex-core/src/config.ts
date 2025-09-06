import Ajv from 'ajv';
import { join } from 'path';

export interface CortexConfig {
  notesPath: string;
  templatesPath: string;
  databasePath: string;
  aiProvider: 'openai' | 'anthropic' | 'ollama';
  embeddingModel: string;
  chatModel: string;
  apiKeys: {
    openai?: string;
    anthropic?: string;
  };
  autoCommit: boolean;
  daemon: {
    enabled: boolean;
    port: number;
  };
}

const configSchema = {
  type: 'object',
  properties: {
    notesPath: { type: 'string' },
    templatesPath: { type: 'string' },
    databasePath: { type: 'string' },
    aiProvider: { type: 'string', enum: ['openai', 'anthropic', 'ollama'] },
    embeddingModel: { type: 'string' },
    chatModel: { type: 'string' },
    apiKeys: {
      type: 'object',
      properties: {
        openai: { type: 'string' },
        anthropic: { type: 'string' }
      },
      additionalProperties: false
    },
    autoCommit: { type: 'boolean' },
    daemon: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        port: { type: 'number', minimum: 1024, maximum: 65535 }
      },
      required: ['enabled', 'port'],
      additionalProperties: false
    }
  },
  required: ['notesPath', 'templatesPath', 'databasePath', 'aiProvider', 'embeddingModel', 'chatModel', 'apiKeys', 'autoCommit', 'daemon'],
  additionalProperties: false
};

export class ConfigManager {
  private static ajv = new Ajv();
  private static validate = ConfigManager.ajv.compile(configSchema);
  
  static getDefaultConfig(): CortexConfig {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    const cortexDir = join(homeDir, '.cortex');
    
    return {
      notesPath: join(cortexDir, 'notes'),
      templatesPath: join(cortexDir, 'templates'),
      databasePath: join(cortexDir, 'cortex.db'),
      aiProvider: 'openai',
      embeddingModel: 'text-embedding-ada-002',
      chatModel: 'gpt-4',
      apiKeys: {
        openai: process.env.OPENAI_API_KEY,
        anthropic: process.env.ANTHROPIC_API_KEY
      },
      autoCommit: true,
      daemon: {
        enabled: true,
        port: 3001
      }
    };
  }
  
  static async load(): Promise<CortexConfig> {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    const configPath = join(homeDir, '.cortex', 'config.json');
    
    try {
      const file = Bun.file(configPath);
      const exists = await file.exists();
      
      if (!exists) {
        const defaultConfig = this.getDefaultConfig();
        await this.save(defaultConfig);
        return defaultConfig;
      }
      
      const configData = await file.json() as CortexConfig;
      
      // Validate against schema
      const isValid = this.validate(configData);
      if (!isValid) {
        throw new Error(`Invalid configuration: ${JSON.stringify(this.validate.errors, null, 2)}`);
      }
      
      return configData;
    } catch (error) {
      console.warn(`Failed to load config from ${configPath}:`, error);
      return this.getDefaultConfig();
    }
  }
  
  static async save(config: CortexConfig): Promise<void> {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    const cortexDir = join(homeDir, '.cortex');
    const configPath = join(cortexDir, 'config.json');
    
    // Validate config before saving
    const isValid = this.validate(config);
    if (!isValid) {
      throw new Error(`Invalid configuration: ${JSON.stringify(this.validate.errors, null, 2)}`);
    }
    
    // Ensure directory exists
    await Bun.write(cortexDir + '/.gitkeep', '');
    
    // Write config file
    await Bun.write(configPath, JSON.stringify(config, null, 2));
  }
  
  static async get(key: keyof CortexConfig): Promise<any> {
    const config = await this.load();
    return config[key];
  }
  
  static async set(key: keyof CortexConfig, value: any): Promise<void> {
    const config = await this.load();
    (config as any)[key] = value;
    await this.save(config);
  }
}