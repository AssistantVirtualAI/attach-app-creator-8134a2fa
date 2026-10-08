import React from 'react';
import DesktopReadOnlyWorkspace from '../components/DesktopReadOnlyWorkspace';

/** Development-only route that renders the exact safe workspace shown after a
 * successful Lemtel session bootstrap when telephony is not yet provisioned. */
export default function WorkspacePreview() {
  return (
    <DesktopReadOnlyWorkspace
      email="preview@lemtel.example"
      organizationId="preview-organization"
      onRetry={() => undefined}
      onSignOut={() => undefined}
    />
  );
}
