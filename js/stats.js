import { supabase } from "./supabase-config.js";

async function loadTotalPlayers(counter) {
  const value = counter.querySelector("[data-total-players-value]");

  try {
    const { data, error } = await supabase.rpc("get_total_players");
    if (error) throw error;

    const total = Number(data);
    if (!Number.isSafeInteger(total) || total < 0) throw new Error("Invalid player count");

    value.textContent = new Intl.NumberFormat().format(total);
    counter.dataset.state = "ready";
    counter.setAttribute("aria-label", `${total.toLocaleString()} total players`);
  } catch {
    value.textContent = "—";
    counter.dataset.state = "unavailable";
    counter.setAttribute("aria-label", "Total player count unavailable");
  }
}

document.querySelectorAll("[data-total-players]").forEach((counter) => {
  void loadTotalPlayers(counter);
});
