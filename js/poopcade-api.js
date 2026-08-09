import { supabase } from "./supabase-config.js";
import { getCurrentUser } from "./auth.js";

async function submitGameRun(gameSlug, run) {
  const user = await getCurrentUser();
  if (!user) return { skipped: true, reason: "signed-out" };

  const { data, error } = await supabase.functions.invoke("submit-run", {
    body: { ...run, gameSlug },
  });
  if (error) throw error;
  return data;
}

export function submitOrbitShiftRun(run) {
  return submitGameRun("orbit-shift", run);
}

export function submitNextRun(run) {
  return submitGameRun("next", run);
}

export const PoopcadeAPI = Object.freeze({
  getCurrentUser,
  submitOrbitShiftRun,
  submitNextRun,
});

window.PoopcadeAPI = PoopcadeAPI;
window.dispatchEvent(new CustomEvent("poopcade-api-ready"));
