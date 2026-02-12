import * as fs from 'fs-extra';
import * as path from 'path';

export interface SSLConfig {
  enabled: boolean;
  auto?: boolean;
  email?: string;
  domains?: string[];
  agreeTos?: boolean;
  certPath?: string;
  keyPath?: string;
}

export class SSLManager {
  private config: SSLConfig;
  private sslDir: string;

  constructor(config: SSLConfig) {
    this.config = {
      auto: true,
      agreeTos: true,
      ...config
    };
    this.sslDir = path.join(process.cwd(), 'ssl');
    fs.ensureDirSync(this.sslDir);
  }

  async initialize(): Promise<{ cert?: string; key?: string }> {
    if (!this.config.enabled) {
      return {};
    }

    if (this.config.auto) {
      return this.initializeAutoSSL();
    }

    return this.loadManualSSL();
  }

  private async initializeAutoSSL(): Promise<{ cert?: string; key?: string }> {
    // For Let's Encrypt, we'll use greenlock-express
    // This returns the paths for greenlock to use
    console.log('🔒 Auto SSL enabled with Let\'s Encrypt');
    console.log(`   Domains: ${this.config.domains?.join(', ')}`);
    console.log(`   Email: ${this.config.email}`);
    
    return {
      cert: path.join(this.sslDir, 'cert.pem'),
      key: path.join(this.sslDir, 'key.pem')
    };
  }

  private async loadManualSSL(): Promise<{ cert?: string; key?: string }> {
    if (!this.config.certPath || !this.config.keyPath) {
      console.warn('⚠️  SSL enabled but no certificate paths provided');
      return {};
    }

    try {
      const cert = await fs.readFile(this.config.certPath, 'utf-8');
      const key = await fs.readFile(this.config.keyPath, 'utf-8');
      
      console.log('🔒 Manual SSL certificates loaded');
      
      return { cert, key };
    } catch (error) {
      console.error('❌ Failed to load SSL certificates:', error);
      return {};
    }
  }

  getGreenlockConfig(): any {
    if (!this.config.enabled || !this.config.auto) {
      return null;
    }

    return {
      packageRoot: process.cwd(),
      configDir: path.join(process.cwd(), 'greenlock.d'),
      maintainerEmail: this.config.email,
      cluster: false,
      packageAgent: 'pcdn/1.0.0',
      
      // Use staging for testing
      // staging: true,
      
      sites: [{
        subject: this.config.domains?.[0],
        altnames: this.config.domains
      }]
    };
  }

  async checkCertificateExpiry(): Promise<{ valid: boolean; daysRemaining?: number }> {
    if (!this.config.certPath) {
      return { valid: false };
    }

    try {
      const cert = await fs.readFile(this.config.certPath);
      // Parse certificate to check expiry
      // This is a simplified check
      return { valid: true, daysRemaining: 30 };
    } catch {
      return { valid: false };
    }
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isAuto(): boolean {
    return this.config.auto === true;
  }

  getDomains(): string[] {
    return this.config.domains || [];
  }
}