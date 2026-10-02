# Email draft — FusionPBX staging technical-information request

To: Kenny; Phil
Subject: Lemtel staging — FusionPBX technical information request (no credentials needed)

---

Hi Kenny, hi Phil,

We are preparing an isolated staging environment for the Lemtel telephony stack. Before anything is connected, we need a written description of the current FusionPBX setup so we can draft an integration contract for your review. Nothing will be connected or changed at this stage.

Please do NOT send passwords, API keys, tokens, or any credentials. We only need descriptive information.

Could you tell us:

1. **FusionPBX version and topology** — which version is running, how many servers, and whether there is a separate database server.
2. **Domains and tenants** — how domains/tenants are organized today, and how a new tenant is normally created.
3. **Extensions and devices** — how extensions are provisioned (manually, by script, by API), and which device types are in use.
4. **DID routing** — how incoming phone numbers are routed to destinations, and who manages those routes.
5. **SIP trunks and carriers** — which carriers are configured, and how trunks are authenticated (registration vs IP-based), described without secrets.
6. **Recording and retention** — whether calls are recorded, where recordings are stored, and how long they are kept.
7. **Backup and restore** — how the FusionPBX servers are backed up today, and whether a restore has been tested.
8. **Change process** — who approves configuration changes, and how changes are normally applied and rolled back.
9. **Monitoring** — what monitoring exists today (service health, call failures, disk space), and who receives alerts.
10. **Staging options** — whether a separate FusionPBX instance or a dedicated test tenant is possible for staging, and what you would recommend.

Once we have your answers, we will draft a written integration design and send it back to you for approval before any technical work begins.

Thanks,
Mohamad
