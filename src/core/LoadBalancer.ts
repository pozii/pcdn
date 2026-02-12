import { EdgeNode } from '../types';

export class LoadBalancer {
  private nodes: EdgeNode[];
  private currentIndex: number = 0;

  constructor(nodes: EdgeNode[]) {
    this.nodes = nodes.filter(n => n.healthy);
  }

  addNode(node: EdgeNode): void {
    this.nodes.push(node);
  }

  removeNode(nodeId: string): void {
    this.nodes = this.nodes.filter(n => n.id !== nodeId);
  }

  updateNodeHealth(nodeId: string, healthy: boolean): void {
    const node = this.nodes.find(n => n.id === nodeId);
    if (node) {
      node.healthy = healthy;
    }
  }

  getNode(region?: string): EdgeNode | null {
    let availableNodes = this.nodes.filter(n => n.healthy);
    
    if (region) {
      const regionNodes = availableNodes.filter(n => n.region === region);
      if (regionNodes.length > 0) {
        availableNodes = regionNodes;
      }
    }

    if (availableNodes.length === 0) {
      return null;
    }

    const totalWeight = availableNodes.reduce((sum, n) => sum + n.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const node of availableNodes) {
      random -= node.weight;
      if (random <= 0) {
        return node;
      }
    }
    
    return availableNodes[0];
  }

  getAllNodes(): EdgeNode[] {
    return [...this.nodes];
  }

  getHealthyNodes(): EdgeNode[] {
    return this.nodes.filter(n => n.healthy);
  }
}