/* Theme: follows the system unless the viewer picks light or dark.
   Loaded in <head> so the first paint already has the right colours. */
(() => {
  // GitHub Pages cannot send frame-ancestors: refuse to be shown inside another site's frame.
  if (window.top !== window.self) {
    document.documentElement.style.display = "none";
    try { window.top.location = window.self.location.href; } catch (e) {}
  }
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
    meta.content = isDark ? "#111216" : "#f3f4f7";
  }

  apply(read());

  // Reading text size: standard, large or extra large (CSS --read).
  const TEXT_KEY = "exam-hub:text";
  const readText = () => { try { return localStorage.getItem(TEXT_KEY) || "normal"; } catch (e) { return "normal"; } };
  const applyText = v => { if (v === "large" || v === "xlarge") root.dataset.text = v; else delete root.dataset.text; };
  applyText(readText());
  dark.addEventListener("change", () => apply(read()));

  window.HubTheme = {
    text: readText,
    setText(v) { try { localStorage.setItem(TEXT_KEY, v); } catch (e) {} applyText(v); },
    get: read,
    set(choice) {
      try { localStorage.setItem(KEY, choice); } catch (e) {}
      apply(choice);
    },
  };
})();
