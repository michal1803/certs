/* Theme: follows the system unless the viewer picks light or dark.
   Loaded in <head> so the first paint already has the right colours. */
(() => {
  const KEY = "exam-hub:theme";
  const root = document.documentElement;
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  const read = () => { try { return localStorage.getItem(KEY) || "system"; } catch (e) { return "system"; } };

  function apply(choice) {
    if (choice === "light" || choice === "dark") root.dataset.theme = choice;
    else delete root.dataset.theme;
    const isDark = choice === "dark" || (choice === "system" && dark.matches);
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
    meta.content = isDark ? "#17120f" : "#fff4e6";
  }

  apply(read());
  dark.addEventListener("change", () => apply(read()));

  window.HubTheme = {
    get: read,
    set(choice) {
      try { localStorage.setItem(KEY, choice); } catch (e) {}
      apply(choice);
    },
  };
})();
