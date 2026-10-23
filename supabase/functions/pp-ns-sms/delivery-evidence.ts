/** Local display copies must not erase the provider's explicit delivery state. */
export function mergeDeliveryEvidence(preferred: Record<string, any>, provider: Record<string, any> | null) {
  return { ...preferred, provider_status: provider?.status ?? preferred.provider_status };
}