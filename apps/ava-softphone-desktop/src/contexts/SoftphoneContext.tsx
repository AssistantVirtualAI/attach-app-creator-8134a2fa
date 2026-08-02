/**
 * SoftphoneContext — partage l'instance SIP unique créée dans App.tsx (SipKeepAlive)
 * avec tous les composants enfants (SoftphonePane, ActiveCallDock, etc.)
 *
 * Cela évite d'avoir deux connexions SIP parallèles sur le même poste,
 * ce qui causait des déconnexions lors des changements de page.
 */
import React, { createContext, useContext } from 'react';
import { useSoftphone } from '../hooks/useSoftphone';

// Le type de retour de useSoftphone
export type SoftphoneInstance = ReturnType<typeof useSoftphone>;

const SoftphoneContext = createContext<SoftphoneInstance | null>(null);

export function SoftphoneProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: SoftphoneInstance;
}) {
  return (
    <SoftphoneContext.Provider value={value}>
      {children}
    </SoftphoneContext.Provider>
  );
}

/**
 * Consomme l'instance SIP partagée.
 * Lance une erreur si utilisé en dehors de SoftphoneProvider.
 */
export function useSoftphoneContext(): SoftphoneInstance {
  const ctx = useContext(SoftphoneContext);
  if (!ctx) {
    throw new Error('useSoftphoneContext must be used within a SoftphoneProvider');
  }
  return ctx;
}

/**
 * Version sécurisée qui retourne null si pas de provider.
 * Utile pour les composants optionnellement connectés au SIP.
 */
export function useSoftphoneContextSafe(): SoftphoneInstance | null {
  return useContext(SoftphoneContext);
}
