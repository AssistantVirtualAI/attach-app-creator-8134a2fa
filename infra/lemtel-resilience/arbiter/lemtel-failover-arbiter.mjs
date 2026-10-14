// Independent Cloudflare Workers bootstrap for the Lemtel failover arbiter.
// This version is intentionally deny-by-default: it performs no provider request,
// no fencing, no promotion, no runtime start and no traffic-routing mutation.
const state = Object.freeze({
  version: 'lemtel_failover_arbiter_v1',
  mode: 'deny_by_default_bootstrap',
  observation: 'not_configured',
  automatic_fencing_enabled: false,
  automatic_promotion_enabled: false,
  automatic_traffic_failover_enabled: false,
  automatic_failback_enabled: false,
  decision: 'deny',
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    if (path === '/healthz' || path === '/status') return json(state);
    return json({ error: 'not_found' }, 404);
  },
  async scheduled() {
    // Deliberately no I/O. A scheduler proves the component is independent without taking actions.
    console.log(JSON.stringify({ event: 'arbiter_tick', mode: state.mode, decision: state.decision }));
  },
};
