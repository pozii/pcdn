import { ProtocolManager } from '../../core/ProtocolManager';

describe('ProtocolManager', () => {
  let protocolManager: ProtocolManager;

  describe('default configuration', () => {
    beforeEach(() => {
      protocolManager = new ProtocolManager();
    });

    it('should have HTTP/2 disabled by default', () => {
      expect(protocolManager.isHTTP2Enabled()).toBe(false);
    });

    it('should have HTTP/3 disabled by default', () => {
      expect(protocolManager.isHTTP3Enabled()).toBe(false);
    });

    it('should have WebSocket disabled by default', () => {
      expect(protocolManager.isWebSocketEnabled()).toBe(false);
    });
  });

  describe('HTTP/2 enabled', () => {
    beforeEach(() => {
      protocolManager = new ProtocolManager({ http2: true });
    });

    it('should return true for HTTP/2', () => {
      expect(protocolManager.isHTTP2Enabled()).toBe(true);
    });

    it('should include h2 in ALPN protocols', () => {
      const protocols = protocolManager.getALPNProtocols();
      expect(protocols).toContain('h2');
    });
  });

  describe('HTTP/3 enabled', () => {
    beforeEach(() => {
      protocolManager = new ProtocolManager({ http3: true });
    });

    it('should return true for HTTP/3', () => {
      expect(protocolManager.isHTTP3Enabled()).toBe(true);
    });

    it('should include h3 in ALPN protocols', () => {
      const protocols = protocolManager.getALPNProtocols();
      expect(protocols).toContain('h3');
    });
  });

  describe('WebSocket enabled', () => {
    beforeEach(() => {
      protocolManager = new ProtocolManager({ webSocket: true });
    });

    it('should return true for WebSocket', () => {
      expect(protocolManager.isWebSocketEnabled()).toBe(true);
    });
  });

  describe('getInfo', () => {
    beforeEach(() => {
      protocolManager = new ProtocolManager({
        http2: true,
        webSocket: true,
        webSocketPath: '/custom-ws'
      });
    });

    it('should return configuration info', () => {
      const info = protocolManager.getInfo();
      
      expect(info).toHaveProperty('http2', true);
      expect(info).toHaveProperty('http3', false);
      expect(info).toHaveProperty('webSocket', true);
      expect(info).toHaveProperty('webSocketPath', '/custom-ws');
      expect(info).toHaveProperty('alpnProtocols');
    });
  });
});
