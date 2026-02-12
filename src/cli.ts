#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import mime from 'mime-types';
import FormData from 'form-data';

const program = new Command();
const API_URL = process.env.PCDN_API_URL || 'http://localhost:8080';
const API_KEY = process.env.PCDN_API_KEY || 'default-api-key-change-in-production';

program
  .name('pcdn')
  .description('Professional CDN CLI - Enterprise Content Delivery')
  .version('1.0.0');

program
  .command('upload')
  .description('Upload file(s) to CDN')
  .argument('<files...>', 'Files to upload')
  .option('-r, --recursive', 'Upload directories recursively')
  .option('-p, --prefix <prefix>', 'Add prefix to CDN path')
  .action(async (files: string[], options) => {
    const spinner = ora('Uploading files...').start();
    
    try {
      const uploaded: Array<{ file: string; url: string }> = [];
      
      for (const file of files) {
        const filePath = path.resolve(file);
        
        if (!(await fs.pathExists(filePath))) {
          console.log(chalk.red(`❌ File not found: ${file}`));
          continue;
        }
        
        const stat = await fs.stat(filePath);
        
        if (stat.isDirectory()) {
          if (options.recursive) {
            const dirFiles = await fs.readdir(filePath, { recursive: true });
            for (const dirFile of dirFiles) {
              const fullPath = path.join(filePath, dirFile as string);
              if ((await fs.stat(fullPath)).isFile()) {
                const result = await uploadFile(fullPath, options.prefix);
                uploaded.push(result);
              }
            }
          } else {
            console.log(chalk.yellow(`⚠️  Skipping directory: ${file} (use -r for recursive)`));
          }
        } else {
          const result = await uploadFile(filePath, options.prefix);
          uploaded.push(result);
        }
      }
      
      spinner.succeed(chalk.green(`Uploaded ${uploaded.length} file(s)`));
      
      uploaded.forEach(({ file, url }) => {
        console.log(chalk.blue('📄'), chalk.white(file));
        console.log(chalk.blue('🔗'), chalk.cyan(url));
        console.log();
      });
      
    } catch (error) {
      spinner.fail(chalk.red('Upload failed'));
      console.error(error);
      process.exit(1);
    }
  });

async function uploadFile(filePath: string, prefix?: string): Promise<{ file: string; url: string }> {
  const content = await fs.readFile(filePath);
  const filename = prefix ? path.join(prefix, path.basename(filePath)) : path.basename(filePath);
  const contentType = mime.lookup(filePath) || 'application/octet-stream';
  
  const response = await axios.post(`${API_URL}/api/upload`, {
    filename,
    content: content.toString('base64'),
    contentType
  }, {
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json'
    }
  });
  
  return {
    file: filePath,
    url: response.data.cdnUrl
  };
}

program
  .command('invalidate')
  .description('Invalidate cache by pattern')
  .argument('<pattern>', 'Pattern to invalidate (regex supported)')
  .option('-a, --all', 'Purge all cache')
  .action(async (pattern: string, options) => {
    const spinner = ora('Invalidating cache...').start();
    
    try {
      if (options.all) {
        const response = await axios.post(`${API_URL}/api/cache/purge`, {}, {
          headers: { 'X-API-Key': API_KEY }
        });
        spinner.succeed(chalk.green(`Purged ${response.data.purged} cache entries`));
      } else {
        const response = await axios.post(`${API_URL}/api/cache/invalidate`, {
          pattern
        }, {
          headers: { 'X-API-Key': API_KEY }
        });
        spinner.succeed(chalk.green(`Invalidated ${response.data.invalidated} cache entries`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Invalidation failed'));
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('stats')
  .description('Show CDN statistics')
  .option('-j, --json', 'Output as JSON')
  .action(async (options) => {
    try {
      const response = await axios.get(`${API_URL}/api/stats`, {
        headers: { 'X-API-Key': API_KEY }
      });
      
      const stats = response.data;
      
      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }
      
      console.log(chalk.bold.blue('\n📊 PCDN Statistics\n'));
      
      console.log(chalk.bold('Performance:'));
      console.log(`  Total Requests: ${chalk.cyan(stats.totalRequests.toLocaleString())}`);
      console.log(`  Cache Hits: ${chalk.green(stats.cacheHits.toLocaleString())}`);
      console.log(`  Cache Misses: ${chalk.yellow(stats.cacheMisses.toLocaleString())}`);
      console.log(`  Hit Rate: ${chalk.magenta(stats.hitRate.toFixed(2) + '%')}`);
      console.log(`  Bandwidth: ${chalk.cyan(formatBytes(stats.totalBandwidth))}`);
      console.log(`  Active Connections: ${chalk.cyan(stats.activeConnections)}`);
      
      console.log(chalk.bold('\nCache:'));
      console.log(`  Max Size: ${chalk.cyan(formatBytes(stats.cache.size))}`);
      console.log(`  Current Size: ${chalk.cyan(formatBytes(stats.cache.currentSize))}`);
      console.log(`  Entries: ${chalk.cyan(stats.cache.entries)}`);
      console.log(`  Usage: ${chalk.yellow(((stats.cache.currentSize / stats.cache.size) * 100).toFixed(2) + '%')}`);
      
      console.log(chalk.bold('\nNodes:'));
      stats.nodes.forEach((node: any) => {
        const status = node.healthy ? chalk.green('●') : chalk.red('●');
        console.log(`  ${status} ${node.id} (${node.region}) - ${node.host}:${node.port}`);
      });
      
      console.log(chalk.bold('\nUptime:'));
      console.log(`  ${chalk.cyan(formatDuration(stats.uptime))}\n`);
      
    } catch (error) {
      console.error(chalk.red('❌ Failed to fetch stats'));
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('nodes')
  .description('List all CDN nodes')
  .action(async () => {
    try {
      const response = await axios.get(`${API_URL}/api/nodes`, {
        headers: { 'X-API-Key': API_KEY }
      });
      
      console.log(chalk.bold.blue('\n🌐 PCDN Nodes\n'));
      
      response.data.nodes.forEach((node: any) => {
        const status = node.healthy ? chalk.green('HEALTHY') : chalk.red('UNHEALTHY');
        console.log(`${chalk.bold(node.id)}`);
        console.log(`  Region: ${chalk.cyan(node.region)}`);
        console.log(`  Address: ${chalk.cyan(`${node.host}:${node.port}`)}`);
        console.log(`  Weight: ${chalk.cyan(node.weight)}`);
        console.log(`  Status: ${status}`);
        console.log();
      });
      
      console.log(`Total: ${response.data.nodes.length} | Healthy: ${chalk.green(response.data.healthy)}\n`);
      
    } catch (error) {
      console.error(chalk.red('❌ Failed to fetch nodes'));
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('origin')
  .description('Origin pull management')
  .option('-s, --status', 'Show origin status')
  .option('-p, --pull <path>', 'Pull file from origin')
  .option('-f, --prefetch <urls>', 'Prefetch multiple URLs (comma-separated)')
  .action(async (options) => {
    try {
      if (options.status) {
        const response = await axios.get(`${API_URL}/api/origin/status`, {
          headers: { 'X-API-Key': API_KEY }
        });
        
        console.log(chalk.bold.blue('\n🌐 Origin Status\n'));
        console.log(`Enabled: ${response.data.enabled ? chalk.green('Yes') : chalk.red('No')}`);
        console.log(`URL: ${chalk.cyan(response.data.originUrl || 'Not configured')}`);
        
        if (response.data.config) {
          console.log(`\nConfiguration:`);
          console.log(`  Cache on Pull: ${response.data.config.cacheOnPull ? chalk.green('Yes') : chalk.red('No')}`);
          console.log(`  Timeout: ${chalk.cyan(response.data.config.timeout)}ms`);
          console.log(`  Retry Attempts: ${chalk.cyan(response.data.config.retryAttempts)}`);
          console.log(`  Follow Redirects: ${response.data.config.followRedirects ? chalk.green('Yes') : chalk.red('No')}`);
        }
        console.log();
      } else if (options.pull) {
        const spinner = ora(`Pulling ${options.pull} from origin...`).start();
        
        const response = await axios.post(`${API_URL}/api/origin/pull`, {
          path: options.pull
        }, {
          headers: { 'X-API-Key': API_KEY }
        });
        
        if (response.data.success) {
          spinner.succeed(chalk.green(`Successfully pulled from origin`));
          console.log(chalk.blue('📄'), chalk.white(options.pull));
          console.log(chalk.blue('🔗'), chalk.cyan(response.data.cdnUrl));
          console.log(chalk.blue('📦'), `Size: ${chalk.cyan(formatBytes(response.data.size))}`);
          console.log(chalk.blue('💾'), `Cached: ${response.data.cached ? chalk.green('Yes') : chalk.red('No')}`);
        } else {
          spinner.fail(chalk.red('Failed to pull from origin'));
        }
      } else if (options.prefetch) {
        const urls = options.prefetch.split(',').map((u: string) => u.trim());
        const spinner = ora(`Prefetching ${urls.length} URLs...`).start();
        
        const response = await axios.post(`${API_URL}/api/origin/prefetch`, {
          urls
        }, {
          headers: { 'X-API-Key': API_KEY }
        });
        
        spinner.succeed(chalk.green(`Prefetched ${response.data.successful}/${response.data.total} URLs`));
        
        response.data.results.forEach((result: any) => {
          if (result.success) {
            console.log(chalk.green('✅'), result.url);
          } else {
            console.log(chalk.red('❌'), result.url);
          }
        });
      } else {
        console.log(chalk.yellow('Use --status, --pull <path>, or --prefetch <urls>'));
      }
    } catch (error) {
      console.error(chalk.red('❌ Command failed'));
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('serve')
  .description('Start CDN server')
  .option('-p, --port <port>', 'Port to listen on', '8080')
  .option('-c, --config <config>', 'Config file path')
  .action(async (options) => {
    console.log(chalk.blue('🚀 Starting PCDN server...'));
    
    process.env.PCDN_PORT = options.port;
    if (options.config) {
      process.env.PCDN_CONFIG = options.config;
    }
    
    await import('./server');
  });

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

program.parse();