import { CDNServer } from './core/CDNServer';
import { defaultConfig } from './config/defaults';
import * as fs from 'fs-extra';
import * as path from 'path';
import { setupUnhandledErrorHandlers } from './utils/errorHandler';
import { Logger } from './utils/Logger';

// Setup unhandled error handlers
setupUnhandledErrorHandlers();

const logger = new Logger('Server');

async function loadConfig() {
  const configPath = process.env.PCDN_CONFIG || './config/pcdn.json';
  
  if (await fs.pathExists(configPath)) {
    const userConfig = await fs.readJson(configPath);
    return { ...defaultConfig, ...userConfig };
  }
  
  return {
    ...defaultConfig,
    port: parseInt(process.env.PCDN_PORT || '8080'),
    apiKey: process.env.PCDN_API_KEY || defaultConfig.apiKey
  };
}

async function main() {
  try {
    const config = await loadConfig();
    logger.info('Configuration loaded', { 
      nodeId: config.nodeId, 
      region: config.region, 
      port: config.port 
    });
    
    const server = new CDNServer(config);
    await server.start();
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

main();
