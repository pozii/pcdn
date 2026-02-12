import { WebSocketServer, WebSocket, RawData } from 'ws';
import { IncomingMessage } from 'http';
import { ProtocolConfig } from '../types';
import { Logger } from '../utils/Logger';

interface WSClient {
  id: string;
  ws: WebSocket;
  ip: string;
  connectedAt: Date;
  lastActivity: Date;
  subscriptions: Set<string>;
}

interface WebSocketMessage {
  type: string;
  channel?: string;
  data?: any;
  timestamp?: number;
  sender?: string;
}

export class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WSClient> = new Map();
  private config: ProtocolConfig;
  private logger: Logger;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(config: ProtocolConfig = {}) {
    this.config = {
      webSocket: false,
      webSocketPath: '/ws',
      maxWebSocketConnections: 1000,
      webSocketTimeout: 30000,
      ...config
    };
    this.logger = new Logger('WebSocketManager');
  }

  /**
   * Initialize WebSocket server
   */
  initialize(server: any): void {
    if (!this.config.webSocket) {
      this.logger.debug('WebSocket support is disabled');
      return;
    }

    try {
      this.wss = new WebSocketServer({ 
        server,
        path: this.config.webSocketPath,
        maxPayload: 1024 * 1024, // 1MB max payload
        perMessageDeflate: {
          zlibDeflateOptions: {
            chunkSize: 1024,
            memLevel: 7,
            level: 3
          },
          zlibInflateOptions: {
            chunkSize: 10 * 1024
          },
          clientNoContextTakeover: true,
          serverNoContextTakeover: true,
          serverMaxWindowBits: 10,
          concurrencyLimit: 10
        }
      });

      this.setupEventHandlers();
      this.startHeartbeat();

      this.logger.info(`WebSocket server initialized on path: ${this.config.webSocketPath}`);
    } catch (error) {
      this.logger.error('Failed to initialize WebSocket server', { error });
    }
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupEventHandlers(): void {
    if (!this.wss) return;

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    this.wss.on('error', (error: Error) => {
      this.logger.error('WebSocket server error', { error });
    });

    this.wss.on('close', () => {
      this.logger.info('WebSocket server closed');
    });
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    // Check connection limit
    if (this.clients.size >= (this.config.maxWebSocketConnections || 1000)) {
      this.logger.warn('Max WebSocket connections reached, rejecting new connection');
      ws.close(1013, 'Server is at capacity');
      return;
    }

    const clientId = this.generateClientId();
    const clientIp = this.getClientIp(req);

    const client: WSClient = {
      id: clientId,
      ws,
      ip: clientIp,
      connectedAt: new Date(),
      lastActivity: new Date(),
      subscriptions: new Set()
    };

    this.clients.set(clientId, client);

    this.logger.info('WebSocket client connected', { 
      clientId, 
      ip: clientIp,
      totalClients: this.clients.size 
    });

    // Send welcome message
    this.sendToClient(clientId, {
      type: 'connected',
      data: {
        clientId,
        serverTime: Date.now(),
        protocol: 'websocket'
      },
      timestamp: Date.now()
    });

    // Setup client event handlers
    ws.on('message', (data: RawData) => {
      this.handleMessage(clientId, data);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      this.handleDisconnect(clientId, code, reason);
    });

    ws.on('error', (error: Error) => {
      this.handleError(clientId, error);
    });

    ws.on('pong', () => {
      const client = this.clients.get(clientId);
      if (client) {
        client.lastActivity = new Date();
        this.clients.set(clientId, client);
      }
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(clientId: string, data: RawData): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.lastActivity = new Date();

    try {
      const message: WebSocketMessage = JSON.parse(data.toString());
      
      this.logger.debug('WebSocket message received', { 
        clientId, 
        type: message.type,
        channel: message.channel 
      });

      switch (message.type) {
        case 'subscribe':
          this.handleSubscribe(clientId, message.channel);
          break;
        
        case 'unsubscribe':
          this.handleUnsubscribe(clientId, message.channel);
          break;
        
        case 'ping':
          this.sendToClient(clientId, {
            type: 'pong',
            timestamp: Date.now()
          });
          break;
        
        case 'stats':
          this.sendStats(clientId);
          break;
        
        default:
          // Broadcast to channel subscribers
          if (message.channel) {
            this.broadcastToChannel(message.channel, {
              ...message,
              sender: clientId,
              timestamp: Date.now()
            }, clientId);
          }
      }
    } catch (error) {
      this.logger.error('Failed to parse WebSocket message', { clientId, error });
      this.sendToClient(clientId, {
        type: 'error',
        data: { message: 'Invalid message format' },
        timestamp: Date.now()
      });
    }
  }

  /**
   * Handle subscription request
   */
  private handleSubscribe(clientId: string, channel: string | undefined): void {
    if (!channel) return;

    const client = this.clients.get(clientId);
    if (client) {
      client.subscriptions.add(channel);
      this.sendToClient(clientId, {
        type: 'subscribed',
        channel,
        timestamp: Date.now()
      });
      this.logger.debug('Client subscribed to channel', { clientId, channel });
    }
  }

  /**
   * Handle unsubscribe request
   */
  private handleUnsubscribe(clientId: string, channel: string | undefined): void {
    if (!channel) return;

    const client = this.clients.get(clientId);
    if (client) {
      client.subscriptions.delete(channel);
      this.sendToClient(clientId, {
        type: 'unsubscribed',
        channel,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(clientId: string, code: number, reason: Buffer): void {
    this.clients.delete(clientId);
    this.logger.info('WebSocket client disconnected', { 
      clientId, 
      code,
      reason: reason.toString(),
      remainingClients: this.clients.size 
    });
  }

  /**
   * Handle client error
   */
  private handleError(clientId: string, error: Error): void {
    this.logger.error('WebSocket client error', { clientId, error });
    const client = this.clients.get(clientId);
    if (client) {
      client.ws.terminate();
      this.clients.delete(clientId);
    }
  }

  /**
   * Send message to specific client
   */
  sendToClient(clientId: string, message: WebSocketMessage): boolean {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(JSON.stringify(message));
        return true;
      } catch (error) {
        this.logger.error('Failed to send message to client', { clientId, error });
      }
    }
    return false;
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message: WebSocketMessage, excludeClientId?: string): void {
    const messageStr = JSON.stringify(message);
    
    this.clients.forEach((client, clientId) => {
      if (clientId !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(messageStr);
        } catch (error) {
          this.logger.error('Failed to broadcast message', { clientId, error });
        }
      }
    });
  }

  /**
   * Broadcast to channel subscribers
   */
  broadcastToChannel(channel: string, message: WebSocketMessage, excludeClientId?: string): void {
    const messageStr = JSON.stringify(message);
    
    this.clients.forEach((client, clientId) => {
      if (clientId !== excludeClientId && 
          client.subscriptions.has(channel) && 
          client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(messageStr);
        } catch (error) {
          this.logger.error('Failed to broadcast to channel', { clientId, channel, error });
        }
      }
    });
  }

  /**
   * Send server statistics to client
   */
  private sendStats(clientId: string): void {
    this.sendToClient(clientId, {
      type: 'stats',
      data: {
        connectedClients: this.clients.size,
        serverTime: Date.now(),
        uptime: process.uptime()
      },
      timestamp: Date.now()
    });
  }

  /**
   * Start heartbeat to check client connections
   */
  private startHeartbeat(): void {
    const interval = 30000; // 30 seconds

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeout = this.config.webSocketTimeout || 30000;

      this.clients.forEach((client, clientId) => {
        // Check if client is still alive
        if (now - client.lastActivity.getTime() > timeout) {
          this.logger.debug('Client timeout, terminating connection', { clientId });
          client.ws.terminate();
          this.clients.delete(clientId);
          return;
        }

        // Send ping
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.ping();
        }
      });
    }, interval);
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `ws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get client IP from request
   */
  private getClientIp(req: IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      return (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
  }

  /**
   * Get connection statistics
   */
  getStats(): object {
    return {
      totalConnections: this.clients.size,
      maxConnections: this.config.maxWebSocketConnections,
      path: this.config.webSocketPath
    };
  }

  /**
   * Close all connections and stop server
   */
  async shutdown(): Promise<void> {
    this.stopHeartbeat();

    // Close all client connections
    this.clients.forEach((client) => {
      client.ws.close(1001, 'Server shutting down');
    });
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      return new Promise((resolve) => {
        this.wss!.close(() => {
          this.logger.info('WebSocket server shut down');
          resolve();
        });
      });
    }
  }
}
