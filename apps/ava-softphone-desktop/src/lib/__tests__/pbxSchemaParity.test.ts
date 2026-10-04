// Verifies parity between the desktop edit-sheet schemas, the validators, and
// the rows returned by FusionPBX. Sample rows mirror what the portal forms
// expect, so any missing schema field == parity bug in desktop or popup.
import { describe, it, expect } from 'vitest';
import {
  EXTENSION_GROUPS, QUEUE_GROUPS, IVR_GROUPS, RING_GROUP_GROUPS,
  CONFERENCE_GROUPS, HOLD_MUSIC_GROUPS, GATEWAY_GROUPS, DIALPLAN_GROUPS,
} from '../pbxFieldSchemas';
import {
  EXTENSION_RULES, QUEUE_RULES, IVR_RULES, RING_GROUP_RULES,
  validateRecord, runRule,
} from '../pbxValidators';

const keysOf = (groups: any[]) =>
  groups.flatMap((g: any) => g.fields.map((f: any) => f.key));

// Sample rows shaped like the FusionPBX REST response — populated with the
// exact field set the portal forms read/write today.
const SAMPLE_EXTENSION = {
  extension_uuid: 'ext-1', extension: '1001', password: 'SuperPass123',
  effective_caller_id_name: 'John', effective_caller_id_number: '1001',
  outbound_caller_id_name: 'Acme', outbound_caller_id_number: '+15145551234',
  description: 'Desk phone',
  voicemail_enabled: true, voicemail_password: '1234',
  voicemail_mail_to: 'john@acme.com', voicemail_attach_file: 'true',
  voicemail_file: 'keep', voicemail_local_after_email: 'true',
  call_timeout: 30, call_group: '', user_context: 'default',
  accountcode: '', toll_allow: 'domestic', hold_music: 'default',
  do_not_disturb: 'false', enabled: 'true',
  forward_all_enabled: 'false', forward_all_destination: '',
  forward_busy_enabled: 'false', forward_busy_destination: '',
  forward_no_answer_enabled: 'false', forward_no_answer_destination: '',
};

const SAMPLE_QUEUE = {
  call_center_queue_uuid: 'q-1',
  queue_name: 'Sales', queue_extension: '5000', queue_description: '',
  queue_enabled: 'true', queue_strategy: 'longest-idle-agent',
  queue_moh_sound: '$${hold_music}', queue_record_template: '', queue_time_base_score: 'queue',
  queue_max_wait_time: 0, queue_max_wait_time_with_no_agent: 0,
  queue_max_wait_time_with_no_agent_time_reached: 0,
  queue_wrap_up_time: 10, queue_agent_no_answer_delay_time: 5,
  queue_tier_rules_apply: 'false', queue_tier_rule_wait_second: 0,
  queue_tier_rule_wait_multiply_level: 'false', queue_tier_rule_no_agent_no_wait: 'false',
  queue_abandoned_resume_allowed: 'false', queue_discard_abandoned_after: 60,
  queue_timeout_action: 'transfer:200 XML default', queue_cid_prefix: '[Sales]',
  queue_announce_sound: '', queue_announce_frequency: 30,
};

const SAMPLE_IVR = {
  ivr_menu_uuid: 'ivr-1', ivr_menu_name: 'Main', ivr_menu_extension: '7000',
  ivr_menu_description: '', ivr_menu_enabled: 'true', ivr_menu_direct_dial: 'true',
  ivr_menu_greet_long: '', ivr_menu_greet_short: '',
  ivr_menu_invalid_sound: '', ivr_menu_exit_sound: '',
  ivr_menu_timeout: 10000, ivr_menu_max_failures: 3, ivr_menu_max_timeouts: 3,
  ivr_menu_digit_len: 4, ivr_menu_inter_digit_timeout: 2000,
  ivr_menu_ringback: '', ivr_menu_caller_id_name_prefix: '',
  ivr_menu_exit_action: 'hangup', ivr_menu_exit_data: '',
};

const SAMPLE_RING_GROUP = {
  ring_group_uuid: 'rg-1', ring_group_name: 'Support', ring_group_extension: '6000',
  ring_group_description: '', ring_group_enabled: 'true', ring_group_context: 'default',
  ring_group_strategy: 'simultaneous', ring_group_call_timeout: 25,
  ring_group_ringback: '${us-ring}', ring_group_cid_name_prefix: '',
  ring_group_cid_number_prefix: '', ring_group_distinctive_ring: '',
  ring_group_destinations: '1001,1002,1003',
  ring_group_timeout_app: 'voicemail', ring_group_timeout_data: '',
  ring_group_forward_enabled: 'false', ring_group_forward_destination: '',
  ring_group_missed_call_app: 'email', ring_group_missed_call_data: 'alerts@acme.com',
  ring_group_moh_sound: 'local_stream://default',
};

describe('PBX schema parity (desktop ↔ portal ↔ popup)', () => {
  const cases: Array<{ name: string; groups: any[]; sample: any }> = [
    { name: 'extension', groups: EXTENSION_GROUPS, sample: SAMPLE_EXTENSION },
    { name: 'queue', groups: QUEUE_GROUPS, sample: SAMPLE_QUEUE },
    { name: 'ivr', groups: IVR_GROUPS, sample: SAMPLE_IVR },
    { name: 'ring_group', groups: RING_GROUP_GROUPS, sample: SAMPLE_RING_GROUP },
  ];

  for (const c of cases) {
    it(`${c.name}: every schema field exists on the FusionPBX sample row`, () => {
      const missing = keysOf(c.groups)
        // Form-only relation to pbx_queue_agents, not a FusionPBX queue column.
        // AdminView strips it from the queue payload and saves agents separately.
        .filter((k) => k !== '_queue_agents')
        // tts-greeting fields are admin-side only; they map to a filename column
        // that may be absent on a freshly-created row.
        .filter((k) => !(k in c.sample))
        .filter((k) => !k.match(/_greet_|_invalid_sound|_exit_sound|_announce_sound/));
      expect(missing).toEqual([]);
    });

    it(`${c.name}: every group has a non-empty label and a unique key`, () => {
      const all: string[] = [];
      for (const g of c.groups) {
        expect(g.section).toBeTruthy();
        for (const f of g.fields) {
          expect(f.key).toBeTruthy();
          expect(f.label).toBeTruthy();
          all.push(f.key);
        }
      }
      const dups = all.filter((k, i) => all.indexOf(k) !== i);
      expect(dups).toEqual([]);
    });
  }

  it('schemas cover all simpler resources (smoke)', () => {
    expect(keysOf(CONFERENCE_GROUPS).length).toBeGreaterThan(0);
    expect(keysOf(HOLD_MUSIC_GROUPS).length).toBeGreaterThan(0);
    expect(keysOf(GATEWAY_GROUPS).length).toBeGreaterThan(0);
    expect(keysOf(DIALPLAN_GROUPS).length).toBeGreaterThan(0);
  });
});

describe('PBX validation parity', () => {
  it('extension: rejects empty extension and short password', () => {
    const errs = validateRecord({ extension: '', password: 'short' }, EXTENSION_RULES);
    expect(errs.extension).toBe('Required');
    expect(errs.password).toMatch(/8/);
  });

  it('extension: rejects bad email and bad caller-id number', () => {
    const errs = validateRecord(
      { extension: '1001', password: 'SuperPass123', voicemail_mail_to: 'nope', outbound_caller_id_number: 'abc' },
      EXTENSION_RULES,
    );
    expect(errs.voicemail_mail_to).toBe('Invalid email');
    expect(errs.outbound_caller_id_number).toBeTruthy();
  });

  it('extension: accepts the full valid sample row', () => {
    const errs = validateRecord(SAMPLE_EXTENSION, EXTENSION_RULES);
    expect(errs).toEqual({});
  });

  it('queue: enforces strategy enum and wait-time range', () => {
    const errs = validateRecord(
      { queue_name: 'X', queue_strategy: 'made-up', queue_max_wait_time: 999999 },
      QUEUE_RULES,
    );
    expect(errs.queue_strategy).toBeTruthy();
    expect(errs.queue_max_wait_time).toBeTruthy();
  });

  it('queue: accepts the full valid sample row', () => {
    expect(validateRecord(SAMPLE_QUEUE, QUEUE_RULES)).toEqual({});
  });

  it('ivr: rejects out-of-range max_failures and digit_len', () => {
    const errs = validateRecord(
      { ivr_menu_name: 'Main', ivr_menu_max_failures: 999, ivr_menu_digit_len: 0 },
      IVR_RULES,
    );
    expect(errs.ivr_menu_max_failures).toBeTruthy();
    expect(errs.ivr_menu_digit_len).toBeTruthy();
  });

  it('ivr: accepts the full valid sample row', () => {
    expect(validateRecord(SAMPLE_IVR, IVR_RULES)).toEqual({});
  });

  it('ring_group: enforces strategy enum and email format', () => {
    const errs = validateRecord(
      { ring_group_name: 'X', ring_group_strategy: 'nope', ring_group_missed_call_data: 'not-an-email' },
      RING_GROUP_RULES,
    );
    expect(errs.ring_group_strategy).toBeTruthy();
    expect(errs.ring_group_missed_call_data).toBe('Invalid email');
  });

  it('ring_group: accepts the full valid sample row', () => {
    expect(validateRecord(SAMPLE_RING_GROUP, RING_GROUP_RULES)).toEqual({});
  });

  it('runRule: required/regex/range/enum behave independently', () => {
    expect(runRule({ kind: 'required' }, '')).toBe('Required');
    expect(runRule({ kind: 'required' }, 'x')).toBeNull();
    expect(runRule({ kind: 'regex', pattern: /^\d+$/, message: 'digits' }, 'abc')).toBe('digits');
    expect(runRule({ kind: 'range', min: 1, max: 10 }, 20)).toMatch(/Max/);
    expect(runRule({ kind: 'enum', values: ['a', 'b'] }, 'c')).toBeTruthy();
    expect(runRule({ kind: 'email' }, 'a@b.co')).toBeNull();
  });
});
