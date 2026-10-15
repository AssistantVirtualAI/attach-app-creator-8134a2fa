import { LemtelFailoverSerializer } from '../infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs';

class TransactionalMemoryStorage {
  constructor() {
    this.values = new Map();
    this.tail = Promise.resolve();
  }

  async transaction(callback) {
    let release;
    const previous = this.tail;
    this.tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await callback({
        get: async (key) => this.values.get(key),
        put: async (key, value) => { this.values.set(key, structuredClone(value)); },
      });
    } finally { release(); }
  }
}

export function createSerializerBinding() {
  const storage = new TransactionalMemoryStorage();
  const object = new LemtelFailoverSerializer({ storage });
  const names = [], calls = [];
  const binding = {
    idFromName(name) { names.push(name); return name; },
    get(id) {
      return {
        async fetch(request) {
          calls.push({ id, path: new URL(request.url).pathname });
          return object.fetch(request);
        },
      };
    },
  };
  return { binding, calls, names, storage };
}
