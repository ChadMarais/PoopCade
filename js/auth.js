import { supabase } from "./supabase-config.js";

const AUTH_REDIRECT_URL = "https://poopcade.com/";

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getCurrentUser() {
  const session = await getSession();
  return session?.user ?? null;
}

export async function getMyProfile() {
  const { data, error } = await supabase.rpc("get_my_profile");
  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

export async function getMyBests(gameSlug = "orbit-shift") {
  const { data, error } = await supabase.rpc("get_my_bests", {
    game_slug: gameSlug,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function signInWithGoogle(redirectTo = AUTH_REDIRECT_URL) {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
    },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function deleteCurrentAccount() {
  const session = await getSession();
  if (!session?.user) throw new Error("Sign in before deleting your account.");

  const { data, error } = await supabase.functions.invoke("delete-account", {
    body: {},
  });
  if (error || data?.deleted !== true) {
    throw new Error("Your account could not be deleted. Please try again.");
  }

  // The Auth user no longer exists server-side. Clear only Supabase's local
  // session state; Poopcade never reads or removes token storage directly.
  const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
  if (signOutError) throw new Error("Your account was deleted, but this device could not be signed out cleanly.");
  return data;
}

export async function updateDisplayName(rawDisplayName) {
  const displayName = String(rawDisplayName ?? "").trim();
  if (displayName.length < 3 || displayName.length > 20) {
    throw new Error("Gamer name must be 3–20 characters.");
  }
  if (displayName.includes("@") || !/^[\p{L}\p{N} _-]+$/u.test(displayName)) {
    throw new Error("Use letters, numbers, spaces, underscores, or hyphens only.");
  }

  const user = await getCurrentUser();
  if (!user) throw new Error("Sign in before changing your gamer name.");

  const { data, error } = await supabase.rpc("update_my_display_name", {
    new_display_name: displayName,
  });

  if (error) {
    if (error.code === "23505") {
      throw new Error("That gamer name is already taken.");
    }
    if (error.code === "23514") {
      throw new Error("That gamer name does not match the naming rules.");
    }
    throw new Error("Gamer name could not be updated.");
  }
  const profile = Array.isArray(data) ? data[0] : data;
  if (!profile) throw new Error("Gamer name could not be updated.");
  return profile;
}

function setVisible(element, visible) {
  if (element) element.hidden = !visible;
}

function setMessage(element, message) {
  if (element) element.textContent = message;
}

async function renderAccountControl(root) {
  const loading = root.querySelector("[data-auth-loading]");
  const signedOut = root.querySelector("[data-auth-signed-out]");
  const signedIn = root.querySelector("[data-auth-signed-in]");
  const errorElement = root.querySelector("[data-auth-error]");

  setVisible(loading, true);
  setVisible(signedOut, false);
  setVisible(signedIn, false);
  setMessage(errorElement, "");

  try {
    const user = await getCurrentUser();
    if (!user) {
      setVisible(signedOut, true);
      return;
    }

    const profile = await getMyProfile();
    root.querySelectorAll("[data-display-name]").forEach((element) => {
      element.textContent = profile?.display_name ?? "Poopcade Player";
    });
    setVisible(signedIn, true);
  } catch {
    setVisible(signedOut, true);
    setMessage(errorElement, "Account status is temporarily unavailable.");
  } finally {
    setVisible(loading, false);
  }
}

function bindAccountControl(root) {
  if (root.dataset.authBound === "true") return;
  root.dataset.authBound = "true";

  root.querySelectorAll("[data-sign-in]").forEach((button) => {
    button.addEventListener("click", async () => {
      const errorElement = root.querySelector("[data-auth-error]");
      button.disabled = true;
      setMessage(errorElement, "");
      try {
        await signInWithGoogle();
      } catch {
        setMessage(errorElement, "Google sign-in is not available yet. Try again after authentication is configured.");
        button.disabled = false;
      }
    });
  });

  root.querySelectorAll("[data-sign-out]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await signOut();
      } catch {
        setMessage(root.querySelector("[data-auth-error]"), "Sign out failed. Please try again.");
        button.disabled = false;
      }
    });
  });
}

function renderBestCards(container, bests) {
  container.replaceChildren();
  const isNext = container.dataset.game === "next";
  if (!bests.length) {
    const empty = document.createElement("p");
    empty.className = "empty-copy";
    empty.textContent = isNext ? "No saved runs yet. The machine is waiting." : "No saved runs yet. The orbit awaits.";
    container.append(empty);
    return;
  }

  bests.forEach((best) => {
    const card = document.createElement("article");
    card.className = "best-card";

    const difficulty = document.createElement("span");
    difficulty.textContent = isNext ? "Challenges" : best.difficulty;
    const score = document.createElement("strong");
    score.textContent = Number(best.score).toLocaleString();
    const meta = document.createElement("small");
    meta.textContent = isNext ? `Challenge ${best.level} reached` : `Level ${best.level}`;

    card.append(difficulty, score, meta);
    container.append(card);
  });
}

async function renderAccountPage(page) {
  const loading = page.querySelector("[data-account-loading]");
  const signedOut = page.querySelector("[data-account-signed-out]");
  const signedIn = page.querySelector("[data-account-signed-in]");
  const pageError = page.querySelector("[data-account-error]");

  setVisible(loading, true);
  setVisible(signedOut, false);
  setVisible(signedIn, false);
  setMessage(pageError, "");

  try {
    const user = await getCurrentUser();
    if (!user) {
      setVisible(signedOut, true);
      return;
    }

    const [profile, orbitBests, nextBests] = await Promise.all([
      getMyProfile(),
      getMyBests("orbit-shift"),
      getMyBests("next"),
    ]);
    const displayName = profile?.display_name ?? "Poopcade Player";
    page.querySelectorAll("[data-page-display-name]").forEach((element) => {
      element.textContent = displayName;
    });
    const input = page.querySelector("[data-display-name-input]");
    if (input) input.value = displayName;
    const orbitContainer = page.querySelector('[data-my-bests][data-game="orbit-shift"]');
    const nextContainer = page.querySelector('[data-my-bests][data-game="next"]');
    if (orbitContainer) renderBestCards(orbitContainer, orbitBests);
    if (nextContainer) renderBestCards(nextContainer, nextBests);
    setVisible(signedIn, true);
  } catch {
    setMessage(pageError, "Your account could not be loaded. Please try again.");
  } finally {
    setVisible(loading, false);
  }
}

function bindAccountPage(page) {
  if (page.dataset.pageBound === "true") return;
  page.dataset.pageBound = "true";

  page.querySelectorAll("[data-sign-in]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await signInWithGoogle();
      } catch {
        setMessage(page.querySelector("[data-account-error]"), "Google sign-in is not available yet. Authentication still needs dashboard setup.");
        button.disabled = false;
      }
    });
  });

  page.querySelectorAll("[data-sign-out]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await signOut();
      } catch {
        setMessage(page.querySelector("[data-account-error]"), "Sign out failed. Please try again.");
        button.disabled = false;
      }
    });
  });

  const form = page.querySelector("[data-display-name-form]");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = form.querySelector("[data-display-name-input]");
    const status = form.querySelector("[data-profile-status]");
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    setMessage(status, "Saving…");
    try {
      const profile = await updateDisplayName(input.value);
      page.querySelectorAll("[data-page-display-name]").forEach((element) => {
        element.textContent = profile.display_name;
      });
      input.value = profile.display_name;
      setMessage(status, "Gamer name saved.");
    } catch (error) {
      setMessage(status, error instanceof Error ? error.message : "Gamer name could not be saved.");
    } finally {
      submit.disabled = false;
    }
  });
}

function bindDeletionPage(page) {
  if (page.dataset.pageBound === "true") return;
  page.dataset.pageBound = "true";

  page.querySelectorAll("[data-sign-in]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      setMessage(page.querySelector("[data-deletion-error]"), "");
      try {
        await signInWithGoogle("https://poopcade.com/delete-account/");
      } catch {
        setMessage(page.querySelector("[data-deletion-error]"), "Google sign-in is not available right now. Please try again later.");
        button.disabled = false;
      }
    });
  });

  page.querySelectorAll("[data-sign-out]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await signOut();
      } catch {
        setMessage(page.querySelector("[data-deletion-error]"), "Sign out failed. Please try again.");
        button.disabled = false;
      }
    });
  });
}

async function renderDeletionPage(page) {
  const loading = page.querySelector("[data-deletion-loading]");
  const signedOut = page.querySelector("[data-deletion-signed-out]");
  const signedIn = page.querySelector("[data-deletion-signed-in]");
  const errorElement = page.querySelector("[data-deletion-error]");

  setVisible(loading, true);
  setVisible(signedOut, false);
  setVisible(signedIn, false);
  setMessage(errorElement, "");

  try {
    const user = await getCurrentUser();
    if (!user) {
      setVisible(signedOut, true);
      return;
    }

    const profile = await getMyProfile();
    page.querySelectorAll("[data-page-display-name]").forEach((element) => {
      element.textContent = profile?.display_name ?? "Poopcade Player";
    });
    setVisible(signedIn, true);
  } catch {
    setVisible(signedOut, true);
    setMessage(errorElement, "Your account status could not be loaded. Please try again.");
  } finally {
    setVisible(loading, false);
  }
}

function bindDeleteAccountControl(control) {
  if (control.dataset.deleteBound === "true") return;
  control.dataset.deleteBound = "true";

  const openButton = control.querySelector("[data-delete-open]");
  const confirmation = control.querySelector("[data-delete-confirmation]");
  const confirmButton = control.querySelector("[data-delete-confirm]");
  const cancelButton = control.querySelector("[data-delete-cancel]");
  const status = control.querySelector("[data-delete-status]");

  openButton?.addEventListener("click", () => {
    openButton.hidden = true;
    confirmation.hidden = false;
    confirmButton?.focus();
  });

  cancelButton?.addEventListener("click", () => {
    confirmation.hidden = true;
    openButton.hidden = false;
    setMessage(status, "");
    openButton.focus();
  });

  confirmButton?.addEventListener("click", async () => {
    confirmButton.disabled = true;
    if (cancelButton) cancelButton.disabled = true;
    setMessage(status, "Permanently deleting your account…");
    try {
      await deleteCurrentAccount();
      window.location.assign("/?account_deleted=1");
    } catch (error) {
      setMessage(status, error instanceof Error ? error.message : "Your account could not be deleted. Please try again.");
      confirmButton.disabled = false;
      if (cancelButton) cancelButton.disabled = false;
    }
  });
}

async function refreshAuthUI() {
  const controls = Array.from(document.querySelectorAll("[data-account-control]"));
  controls.forEach(bindAccountControl);
  await Promise.all(controls.map(renderAccountControl));

  const accountPage = document.querySelector("[data-account-page]");
  if (accountPage) {
    bindAccountPage(accountPage);
    await renderAccountPage(accountPage);
  }

  const deletionPage = document.querySelector("[data-deletion-page]");
  if (deletionPage) {
    bindDeletionPage(deletionPage);
    await renderDeletionPage(deletionPage);
  }

  document.querySelectorAll("[data-delete-account-control]").forEach(bindDeleteAccountControl);
}

refreshAuthUI();

supabase.auth.onAuthStateChange(() => {
  // Avoid awaiting Supabase calls inside the auth callback itself.
  window.setTimeout(() => { void refreshAuthUI(); }, 0);
});
