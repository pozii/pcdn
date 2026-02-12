import http2 from 'http2';
import https from 'https';
import http from 'http';
import { Application } from 'express';
import { ProtocolConfig, SSLConfigType } from '../types';
import { Logger } from '../utils/Logger';

export class ProtocolManager {
  private config: ProtocolConfig;
  private sslConfig: SSLConfigType;
  private logger: Logger;

  constructor(config: ProtocolConfig = {}, sslConfig: SSLConfigType = { enabled: false }) {
    this.config = {
      http2: false,
      http3: false,
      webSocket: false,
      webSocketPath: '/ws',
      maxWebSocketConnections: 1000,
      webSocketTimeout: 30000,
      quicPort: 8443,
      ...config
    };
    this.sslConfig = sslConfig;
    this.logger = new Logger('ProtocolManager');
  }

  /**
   * Creates an HTTP/2 server
   */
  createHTTP2Server(app: Application, sslOptions?: https.ServerOptions): http2.Http2SecureServer | null {
    if (!this.config.http2) return null;

    if (!sslOptions || !sslOptions.key || !sslOptions.cert) {
      this.logger.warn('HTTP/2 requires SSL certificates. Skipping HTTP/2 server.');
      return null;
    }

    try {
      const server = http2.createSecureServer({
        ...sslOptions,
        allowHTTP1: true // Allow fallback to HTTP/1.1
      });

      // Handle HTTP/2 requests and delegate to Express
      server.on('request', (req, res) => {
        app(req as any, res as any);
      });

      this.logger.info('HTTP/2 server created successfully');
      return server;
    } catch (error) {
      this.logger.error('Failed to create HTTP/2 server', { error });
      return null;
    }
  }

  /**
   * Creates HTTP/3 (QUIC) server
   * Note: Requires Node.js with QUIC support (experimental)
   */
  createHTTP3Server(app: Application, sslOptions?: https.ServerOptions): any {
    if (!this.config.http3) return null;

    // HTTP/3 is still experimental in Node.js
    // This is a placeholder implementation for when QUIC support becomes stable
    this.logger.warn('HTTP/3 (QUIC) support is experimental and requires specific Node.js builds');
    
    // TODO: Implement HTTP/3 once Node.js QUIC support is stable
    // const quic = await import('node:quic');
    
    return null;
  }

  /**
   * Gets the appropriate server based on configuration
   */
  createServer(app: Application, sslOptions?: https.ServerOptions): http.Server | https.Server | http2.Http2SecureServer | null {
    // Priority: HTTP/3 > HTTP/2 > HTTPS > HTTP
    
    if (this.config.http3 && sslOptions) {
      const http3Server = this.createHTTP3Server(app, sslOptions);
      if (http3Server) return http3Server;
    }

    if (this.config.http2 && sslOptions) {
      const http2Server = this.createHTTP2Server(app, sslOptions);
      if (http2Server) return http2Server;
    }

    if (sslOptions && sslOptions.key && sslOptions.cert) {
      return https.createServer(sslOptions, app);
    }

    return http.createServer(app);
  }

  /**
   * Setup WebSocket upgrade handling
   */
  setupWebSocketHandling(server: http.Server | https.Server): void {
    if (!this.config.webSocket) return;

    server.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
      
      if (pathname === this.config.webSocketPath) {
        this.handleWebSocketUpgrade(request, socket, head);
      } else {
        socket.destroy();
      }
    });

    this.logger.info(`WebSocket server configured on path: ${this.config.webSocketPath}`);
  }

  /**
   * Handle WebSocket upgrade requests
   */
  private handleWebSocketUpgrade(request: any, socket: any, head: any): void {
    // WebSocket implementation would go here
    // For now, we just acknowledge the upgrade capability
    this.logger.debug('WebSocket upgrade request received', { 
      path: request.url,
      headers: request.headers 
    });
  }

  /**
   * Get ALPN protocols for negotiation
   */
  getALPNProtocols(): string[] {
    const protocols: string[] = ['http/1.1'];
    
    if (this.config.http2) {
      protocols.unshift('h2');
    }
    
    if (this.config.http3) {
      protocols.unshift('h3');
    }

    return protocols;
  }

  /**
   * Check if HTTP/2 is enabled
   */
  isHTTP2Enabled(): boolean {
    return this.config.http2 || false;
  }

  /**
   * Check if HTTP/3 is enabled
   */
  isHTTP3Enabled(): boolean {
    return this.config.http3 || false;
  }

  /**
   * Check if WebSocket is enabled
   */
  isWebSocketEnabled(): boolean {
    return this.config.webSocket || false;
  }

  /**
   * Get configuration info
   */
  getInfo(): object {
    return {
      http2: this.isHTTP2Enabled(),
      http3: this.isHTTP3Enabled(),
      webSocket: this.isWebSocketEnabled(),
      webSocketPath: this.config.webSocketPath,
      quicPort: this.config.quicPort,
      alpnProtocols: this.getALPNProtocols()
    };
  }
}
