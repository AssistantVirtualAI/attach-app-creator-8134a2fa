# Audit des GRANT sur les migrations

_Généré le 2026-08-29T13:56:54.423Z_

- Tables créées sans GRANT dans la même migration : **70**
- Corrigées par une migration ultérieure : **16**
- Sans GRANT trouvé dans aucune migration : **54**
- Postérieures à la baseline 20260818 (bloquantes) : **0**

## ✅ GRANT ajoutés plus tard

| Table | Migration de création | GRANT ajouté par | Rôles |
| --- | --- | --- | --- |
| `public.organization_integrations` | `20251027035011_4f872f51-1e2e-42c9-bc48-ad5aed2963f3.sql` | `20251213203152_0345cae3-e4f1-4735-bc3b-5b0f5b1c8115.sql` (+3) | authenticated users
grant select on public.organization_integrations_safe to authenticated |
| `public.clients` | `20251027050537_add7cc55-bbba-4103-b4d6-f81d36a31699.sql` | `20260114190018_c80e6748-8efc-45ea-8841-f1521ae92bb1.sql` | authenticated users
grant select on public.clients_safe to authenticated |
| `public.agents` | `20251027051106_1fa092c5-b87e-4df8-a783-a94aff97bd5d.sql` | `20251210160011_3e7869aa-149a-4653-a05f-ed279af019e0.sql` (+3) | authenticated users
grant select on public.agents_safe to authenticated |
| `public.client_members` | `20251203160424_5a2920f5-e632-4286-b63a-5f50faf5eed2.sql` | `20260114190018_c80e6748-8efc-45ea-8841-f1521ae92bb1.sql` | authenticated users
grant select on public.clients_safe to authenticated |
| `public.webhook_endpoints` | `20251205230041_f7c18cf1-de18-47d3-bee2-bc61cba2343e.sql` | `20260607035738_6a007408-2fb9-4c2e-975b-05dc4c4544d6.sql` (+1) | service_role |
| `public.calendar_integrations` | `20251209153232_23e56e73-a218-49fd-b041-fac8314b0839.sql` | `20260105205138_70ffbea5-b014-4bdb-bc5c-da56b032c1f2.sql` (+3) | authenticated users
grant select on public.calendar_integrations_safe to authenticated |
| `public.phone_numbers` | `20251209164725_4abc35c4-b325-4580-b2cd-2058a0fab1b1.sql` | `20260615223700_7dd5d14d-91a3-4ef8-8e4a-af75678f9270.sql` | authenticated |
| `public.agent_mcp_servers` | `20260118002140_2140c6b1-66d8-4ca3-b30f-c68b1301a4ed.sql` | `20260621102605_ae1a7fe2-74e7-4c80-8f06-3e977409772f.sql` (+1) | (rôle non détecté) |
| `public.agent_platform_webhooks` | `20260118002140_2140c6b1-66d8-4ca3-b30f-c68b1301a4ed.sql` | `20260607035738_6a007408-2fb9-4c2e-975b-05dc4c4544d6.sql` (+1) | service_role |
| `public.pbx_integrations` | `20260605185120_608ed963-0dd0-4df3-a027-7b04678cd2c1.sql` | `20260626203506_cb7dd410-b5f1-45db-be54-f1c146188a79.sql` | authenticated |
| `public.pbx_extensions` | `20260605185120_608ed963-0dd0-4df3-a027-7b04678cd2c1.sql` | `20260609191501_f6e62cb1-7a2c-4176-aff0-9d0fedc7f5b8.sql` (+8) | service_role |
| `public.pbx_devices` | `20260605185120_608ed963-0dd0-4df3-a027-7b04678cd2c1.sql` | `20260615223700_7dd5d14d-91a3-4ef8-8e4a-af75678f9270.sql` | authenticated |
| `public.pbx_call_records` | `20260605185120_608ed963-0dd0-4df3-a027-7b04678cd2c1.sql` | `20260619080516_fcbe4aa5-c308-4ff0-b62d-59fd0edf6a1a.sql` | authenticated, service_role |
| `public.pbx_call_recordings` | `20260605185120_608ed963-0dd0-4df3-a027-7b04678cd2c1.sql` | `20260619080516_fcbe4aa5-c308-4ff0-b62d-59fd0edf6a1a.sql` | authenticated, service_role |
| `public.pbx_softphone_users` | `20260605185120_608ed963-0dd0-4df3-a027-7b04678cd2c1.sql` | `20260607035738_6a007408-2fb9-4c2e-975b-05dc4c4544d6.sql` (+6) | service_role |
| `public.pbx_sync_jobs` | `20260605185120_608ed963-0dd0-4df3-a027-7b04678cd2c1.sql` | `20260608000155_db196f29-ce75-4583-8d29-f966b971445b.sql` | authenticated, service_role |

## ❗ Aucun GRANT trouvé

| Table | Migration de création | Bloquant (post-baseline) |
| --- | --- | --- |
| `public.profiles` | `20251026211809_1530726d-d24a-4f18-ae6c-b679440f0b3a.sql` | non (héritée) |
| `public.conversations` | `20251026211809_1530726d-d24a-4f18-ae6c-b679440f0b3a.sql` | non (héritée) |
| `public.knowledge_base` | `20251026211809_1530726d-d24a-4f18-ae6c-b679440f0b3a.sql` | non (héritée) |
| `public.agent_config` | `20251026211809_1530726d-d24a-4f18-ae6c-b679440f0b3a.sql` | non (héritée) |
| `public.analytics` | `20251026211809_1530726d-d24a-4f18-ae6c-b679440f0b3a.sql` | non (héritée) |
| `public.organizations` | `20251027045313_9e2f5517-ada1-41cd-9a6a-66574f63175b.sql` | non (héritée) |
| `public.user_roles` | `20251027045313_9e2f5517-ada1-41cd-9a6a-66574f63175b.sql` | non (héritée) |
| `public.organization_members` | `20251027045313_9e2f5517-ada1-41cd-9a6a-66574f63175b.sql` | non (héritée) |
| `public.organization_api_keys` | `20251027045313_9e2f5517-ada1-41cd-9a6a-66574f63175b.sql` | non (héritée) |
| `public.webhook_events` | `20251027045926_aaf44f49-2765-448d-9b38-e48e2bae950f.sql` | non (héritée) |
| `public.billing_config` | `20251027050537_add7cc55-bbba-4103-b4d6-f81d36a31699.sql` | non (héritée) |
| `public.workflows` | `20251203160424_5a2920f5-e632-4286-b63a-5f50faf5eed2.sql` | non (héritée) |
| `public.email_templates` | `20251203160424_5a2920f5-e632-4286-b63a-5f50faf5eed2.sql` | non (héritée) |
| `public.webhook_delivery_logs` | `20251205230041_f7c18cf1-de18-47d3-bee2-bc61cba2343e.sql` | non (héritée) |
| `public.user_consents` | `20251205232409_b3f2fcb1-8dab-4111-881d-428aa8efb126.sql` | non (héritée) |
| `public.audit_logs` | `20251205232409_b3f2fcb1-8dab-4111-881d-428aa8efb126.sql` | non (héritée) |
| `public.outbound_campaigns` | `20251209150006_a37fc19f-dde2-4e8f-8bdc-22c2c438aaad.sql` | non (héritée) |
| `public.campaign_calls` | `20251209150006_a37fc19f-dde2-4e8f-8bdc-22c2c438aaad.sql` | non (héritée) |
| `public.conversation_topics` | `20251209150006_a37fc19f-dde2-4e8f-8bdc-22c2c438aaad.sql` | non (héritée) |
| `public.topic_aggregates` | `20251209150006_a37fc19f-dde2-4e8f-8bdc-22c2c438aaad.sql` | non (héritée) |
| `public.appointments` | `20251209153232_23e56e73-a218-49fd-b041-fac8314b0839.sql` | non (héritée) |
| `public.leads` | `20251209154614_2757de18-1441-487a-a69e-ca15b16b856b.sql` | non (héritée) |
| `public.performance_metrics` | `20251209154614_2757de18-1441-487a-a69e-ca15b16b856b.sql` | non (héritée) |
| `public.handoff_requests` | `20251209164725_4abc35c4-b325-4580-b2cd-2058a0fab1b1.sql` | non (héritée) |
| `public.sms_templates` | `20251209170050_a9bf90af-dddb-40d7-9842-b7b6aa1ba288.sql` | non (héritée) |
| `public.client_agent_assignments` | `20260103094804_e9ec466f-f0ee-444f-9696-39832f33a711.sql` | non (héritée) |
| `public.agent_insights` | `20260103110721_809c8bc7-2fca-46da-9c07-6d39aed79a50.sql` | non (héritée) |
| `public.agent_health_scores` | `20260103111421_aedbd661-fb5f-42e4-a8b7-39b1617bb2cf.sql` | non (héritée) |
| `public.alert_notifications` | `20260103111421_aedbd661-fb5f-42e4-a8b7-39b1617bb2cf.sql` | non (héritée) |
| `public.prompt_templates` | `20260103113544_013d68b3-c2fe-4861-a729-7cc897dc1916.sql` | non (héritée) |
| `public.agent_daily_reports` | `20260103114909_c321e175-0b82-4c54-b3b3-607122e1583d.sql` | non (héritée) |
| `public.super_admin_exceptions` | `20260104061730_a60fdb6e-4029-472b-bf6b-be1ec00c1b4a.sql` | non (héritée) |
| `public.twilio_active_calls` | `20260121164529_68fe30d4-c007-48c5-a2a9-6ea6a5979680.sql` | non (héritée) |
| `public.security_audit_runs` | `20260121194653_508b6233-3a62-4b07-9cb0-52c6a91fbf08.sql` | non (héritée) |
| `public.org_exports` | `20260121203407_4d712a7c-7f8a-4163-89e4-bd28e6ebea3b.sql` | non (héritée) |
| `public.org_notifications` | `20260121203407_4d712a7c-7f8a-4163-89e4-bd28e6ebea3b.sql` | non (héritée) |
| `public.org_role_permissions` | `20260121203407_4d712a7c-7f8a-4163-89e4-bd28e6ebea3b.sql` | non (héritée) |
| `public.org_retention_settings` | `20260121211315_bb676cca-32ab-4bb6-9aa9-3e924c3e3d51.sql` | non (héritée) |
| `public.client_credentials` | `20260121213126_d8f379c7-609c-4260-8a11-fb51307dfacb.sql` | non (héritée) |
| `public.client_member_credentials` | `20260121213126_d8f379c7-609c-4260-8a11-fb51307dfacb.sql` | non (héritée) |
| `public.custom_tags` | `20260225031147_86fa9a43-0618-4a9c-b099-181c9ed7edb0.sql` | non (héritée) |
| `public.conversation_tags` | `20260225031147_86fa9a43-0618-4a9c-b099-181c9ed7edb0.sql` | non (héritée) |
| `public.pbx_phone_number_assignments` | `20260605185120_608ed963-0dd0-4df3-a027-7b04678cd2c1.sql` | non (héritée) |
| `public.pbx_call_transcripts` | `20260605185120_608ed963-0dd0-4df3-a027-7b04678cd2c1.sql` | non (héritée) |
| `public.pbx_ai_insights` | `20260605185120_608ed963-0dd0-4df3-a027-7b04678cd2c1.sql` | non (héritée) |
| `public.pbx_ivrs` | `20260605185120_608ed963-0dd0-4df3-a027-7b04678cd2c1.sql` | non (héritée) |
| `public.pbx_ivr_options` | `20260605185120_608ed963-0dd0-4df3-a027-7b04678cd2c1.sql` | non (héritée) |
| `public.pbx_call_queues` | `20260605185120_608ed963-0dd0-4df3-a027-7b04678cd2c1.sql` | non (héritée) |
| `public.pbx_queue_agents` | `20260605185120_608ed963-0dd0-4df3-a027-7b04678cd2c1.sql` | non (héritée) |
| `public.pbx_ring_groups` | `20260605185120_608ed963-0dd0-4df3-a027-7b04678cd2c1.sql` | non (héritée) |
| `public.pbx_sms_threads` | `20260605185120_608ed963-0dd0-4df3-a027-7b04678cd2c1.sql` | non (héritée) |
| `public.pbx_sms_messages` | `20260605185120_608ed963-0dd0-4df3-a027-7b04678cd2c1.sql` | non (héritée) |
| `public.pbx_ivr_audio` | `20260605185120_608ed963-0dd0-4df3-a027-7b04678cd2c1.sql` | non (héritée) |
| `public.pbx_feature_codes` | `20260605185120_608ed963-0dd0-4df3-a027-7b04678cd2c1.sql` | non (héritée) |
