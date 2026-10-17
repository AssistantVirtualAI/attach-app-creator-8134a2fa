// Lemtel platform signer — inert bootstrap only.
// The deployed Worker has no public route and this module deliberately refuses
// every request. It does not read a secret, sign data, call another service,
// persist state, emit logs, or control infrastructure.

const noStoreHeaders = Object.freeze({
  'cache-control': 'no-store',
  'content-type': 'text/plain; charset=utf-8',
  'x-content-type-options': 'nosniff',
});

const notFound = () => new Response('', { status: 404, headers: noStoreHeaders });

export default Object.freeze({
  async fetch() {
    return notFound();
  },
});
