import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), 'utf8');

describe('Lemtel mobile call-transcription boundary', () => {
  it('does not expose or invoke transcription and analysis endpoints from mobile call screens', () => {
    const activeSources = [
      'src/screens/CallDetailScreen.tsx',
      'src/screens/CallsScreen.tsx',
      'src/screens/RecordingsScreen.tsx',
      'src/screens/VoicemailScreen.tsx',
      'src/screens/SettingsScreen.tsx',
      'src/screens/MoreScreen.tsx',
      'src/components/ActiveCallSheet.tsx',
      'src/lib/mobileApi.ts',
    ].map(read).join('\n');
    expect(activeSources).not.toMatch(/ai-transcribe-call|ai-analyze-call|useCallAi|CallIntelligencePanel|AIAuditScreen|LiveTranscriptPanel|Lemtel AI live assist|Assistant Lemtel AI en direct|transcription_enabled: true|ai_summary_enabled: true/);
  });

  it('keeps recording playback on the authenticated audio helper only', () => {
    const detail = read('src/screens/CallDetailScreen.tsx');
    expect(detail).toContain('loadPbxRecordingAudioMobile');
    expect(detail).not.toContain('fetch(');
    expect(detail).not.toMatch(/transcrib|analyz|summary|coaching/i);
  });
});
