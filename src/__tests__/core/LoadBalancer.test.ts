import { LoadBalancer } from '../../core/LoadBalancer';
import { EdgeNode } from '../../types';

describe('LoadBalancer', () => {
  let loadBalancer: LoadBalancer;

  beforeEach(() => {
    const nodes: EdgeNode[] = [
      { id: 'node-1', host: 'localhost', port: 8081, region: 'us-east', weight: 100, healthy: true },
      { id: 'node-2', host: 'localhost', port: 8082, region: 'us-west', weight: 100, healthy: true },
      { id: 'node-3', host: 'localhost', port: 8083, region: 'eu-west', weight: 50, healthy: false }
    ];
    loadBalancer = new LoadBalancer(nodes);
  });

  describe('getHealthyNodes', () => {
    it('should return only healthy nodes', () => {
      const healthy = loadBalancer.getHealthyNodes();
      
      expect(healthy).toHaveLength(2);
      expect(healthy.every(n => n.healthy)).toBe(true);
    });
  });

  describe('getAllNodes', () => {
    it('should return only healthy nodes', () => {
      const all = loadBalancer.getAllNodes();
      
      // Constructor filters out unhealthy nodes
      expect(all).toHaveLength(2);
    });
  });

  describe('getNode', () => {
    it('should return a healthy node', () => {
      const node = loadBalancer.getNode();
      
      expect(node).toBeDefined();
      expect(node?.healthy).toBe(true);
    });

    it('should return null when no healthy nodes', () => {
      loadBalancer.updateNodeHealth('node-1', false);
      loadBalancer.updateNodeHealth('node-2', false);
      
      const node = loadBalancer.getNode();
      expect(node).toBeNull();
    });
  });

  describe('updateNodeHealth', () => {
    it('should update node health status', () => {
      const allNodes = loadBalancer.getAllNodes();
      // Constructor already filtered out node-3 (unhealthy)
      expect(allNodes).toHaveLength(2);
      
      loadBalancer.updateNodeHealth('node-1', false);
      
      const healthy = loadBalancer.getHealthyNodes();
      expect(healthy).toHaveLength(1);
      expect(healthy[0].id).toBe('node-2');
    });
  });
});
