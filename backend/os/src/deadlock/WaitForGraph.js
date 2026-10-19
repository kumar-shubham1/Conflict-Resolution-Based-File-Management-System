'use strict';

/**
 * Wait-for graph. Nodes are process ids; edge waiter -> holder means
 * "waiter is blocked on a file currently locked by holder" (PRD section 7.2).
 */
class WaitForGraph {
  constructor() {
    this._edges = [];
  }

  addEdge(waiter, holder, fileId, createdAt = 0) {
    if (waiter === holder) return false; // a process never waits for itself
    if (this._edges.some((e) => e.waiter === waiter && e.holder === holder && e.fileId === fileId)) {
      return false;
    }
    this._edges.push({ waiter, holder, fileId, createdAt });
    return true;
  }

  removeEdgesForFile(fileId) {
    this._edges = this._edges.filter((e) => e.fileId !== fileId);
  }

  removeEdgesByWaiter(waiter) {
    this._edges = this._edges.filter((e) => e.waiter !== waiter);
  }

  removeEdgesInvolving(pid) {
    this._edges = this._edges.filter((e) => e.waiter !== pid && e.holder !== pid);
  }

  edges() {
    return this._edges.map((e) => ({ ...e }));
  }

  /**
   * Depth-first cycle search. Deterministic: nodes and neighbours are visited in
   * ascending id order. Returns the process ids on the cycle (e.g. [1, 2]) or null.
   */
  findCycle() {
    const adjacency = new Map();
    for (const e of this._edges) {
      if (!adjacency.has(e.waiter)) adjacency.set(e.waiter, []);
      adjacency.get(e.waiter).push(e.holder);
    }
    for (const list of adjacency.values()) list.sort((a, b) => a - b);

    const VISITING = 1;
    const DONE = 2;
    const color = new Map();
    const stack = [];

    const visit = (node) => {
      color.set(node, VISITING);
      stack.push(node);
      for (const next of adjacency.get(node) || []) {
        if (color.get(next) === VISITING) return stack.slice(stack.indexOf(next));
        if (!color.has(next)) {
          const found = visit(next);
          if (found) return found;
        }
      }
      stack.pop();
      color.set(node, DONE);
      return null;
    };

    const starts = [...adjacency.keys()].sort((a, b) => a - b);
    for (const start of starts) {
      if (!color.has(start)) {
        const cycle = visit(start);
        if (cycle) return cycle;
      }
    }
    return null;
  }
}

module.exports = { WaitForGraph };
