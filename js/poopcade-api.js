import { supabase } from "./supabase-config.js";
import { getCurrentUser } from "./auth.js";

export async function submitOrbitShiftRun(run) {
  const user = await getCurrentUser();
  if (!user) return { skipped: true, reason: "signed-out" };

  const { data, error } = await supabase.functions.invoke("submit-run", {
    body: run,
  });
  if (error) throw error;
  return data;
}

export const PoopcadeAPI = Object.freeze({
  getCurrentUser,
  submitOrbitShiftRun,
});

window.PoopcadeAPI = PoopcadeAPI;
window.dispatchEvent(new CustomEvent("poopcade-api-ready"));
