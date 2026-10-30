/** Reserve before playing; a failed generation/playback releases only this job's claim. */
export async function playHandoffGreeting(options: {
  automatic: boolean;
  claim: () => Promise<boolean>;
  play: () => Promise<void>;
  release: () => Promise<void>;
}) {
  const claimed = options.automatic ? await options.claim() : false;
  if (options.automatic && !claimed) return false;
  try {
    await options.play();
    return true;
  } catch (error) {
    if (claimed) await options.release();
    throw error;
  }
}