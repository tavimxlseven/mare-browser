"use strict";

const sheetStack = [];
function appRoute(guard = false) {
  return { mare: true, guard, owner: currentUser?.id || null, view, selected };
}
function clearSearch() {
  searchVersion++;
  searchController?.abort();
  searchController = null;
  results = [];
  $("query").value = "";
  $("query").blur();
}
function collapseActivity() {
  $("island-body").hidden = true;
  $("island-toggle").setAttribute("aria-expanded", "false");
  $("island").classList.remove("expanded");
}
function navigateView(nextView, selection = null, replace = false) {
  const changed = view !== nextView || selected !== selection;
  if (view === "search" && nextView !== "search") clearSearch();
  view = ["library", "search", "offline"].includes(nextView)
    ? nextView
    : "library";
  selected = selection;
  collapseActivity();
  render();
  if (changed) {
    history[replace ? "replaceState" : "pushState"](
      appRoute(),
      "",
      location.pathname,
    );
    animateView();
  }
}
function openSheet(dialog) {
  clearTimeout(dialog.closeTimer);
  dialog.classList.remove("closing");
  const previous = sheetStack.indexOf(dialog);
  if (previous !== -1) sheetStack.splice(previous, 1);
  sheetStack.push(dialog);
  if (!dialog.open) dialog.showModal();
}
function closeSheet(dialog) {
  const index = sheetStack.indexOf(dialog);
  if (index !== -1) sheetStack.splice(index, 1);
  hideSheet(dialog);
}
document.addEventListener(
  "cancel",
  (event) => {
    if (event.target instanceof HTMLDialogElement) {
      event.preventDefault();
      closeSheet(event.target);
    }
  },
  true,
);
window.addEventListener("popstate", (event) => {
  if ($("app").hidden) return;
  const current = appRoute();
  const dialog = [...sheetStack]
    .reverse()
    .find((d) => d.open && !d.classList.contains("closing"));
  if (dialog || !$("island-body").hidden) {
    if (dialog) closeSheet(dialog);
    else collapseActivity();
    history.pushState(current, "", location.pathname);
    return;
  }
  const state = event.state;
  if (!state?.mare || state.guard || state.owner !== current.owner) {
    clearSearch();
    view = "library";
    selected = null;
    render();
    history.replaceState(appRoute(true), "", location.pathname);
    history.pushState(appRoute(), "", location.pathname);
    return;
  }
  if (view === "search" && state.view !== "search") clearSearch();
  view = ["library", "search", "offline"].includes(state.view)
    ? state.view
    : "library";
  selected = state.selected;
  render();
  animateView();
});

// A same-origin home entry lets Android Back unwind the app before leaving it.
if (!history.state?.mare) {
  history.replaceState(appRoute(true), "", location.pathname);
  history.pushState(appRoute(), "", location.pathname);
} else history.replaceState(appRoute(), "", location.pathname);
$("search-form").autocomplete = "off";
$("query").autocomplete = "off";
$("query").setAttribute("autocorrect", "off");
$("query").setAttribute("autocapitalize", "none");
window.addEventListener("pageshow", () => {
  if (view !== "search") clearSearch();
});
