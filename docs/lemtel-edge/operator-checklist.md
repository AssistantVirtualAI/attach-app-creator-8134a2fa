# Lemtel Edge - operator checklist

- [ ] Never enable an Edge gate before the prior validation gate is passed.
- [ ] Every gate change goes through a separately approved phase and an auditable change.
- [ ] An operational rollback path exists and is tested before any gate is enabled.
- [ ] No customer data in any pre-pilot test.
- [ ] No secret pasted into chat or committed to Git.

Pending gate: the Phase 1 Docker runtime validation from `docs/lemtel-control-plane/local-development.md` is still pending. It must pass before any Edge container, deployment, FusionPBX integration, client cutover or pilot call.
