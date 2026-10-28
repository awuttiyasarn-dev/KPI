(() => {
  "use strict";

  const BOOTSTRAP_KEY = "__REPORT_APP_BOOTSTRAP__";

  if (window[BOOTSTRAP_KEY]) {
    console.warn("[REPORT APP] App bootstrap already started.");
    return;
  }

  window[BOOTSTRAP_KEY] = true;

  function ensureDashboardScript() {
    const existing = document.querySelector(
      'script[data-report-dashboard="true"]'
    );

    if (existing) {
      console.info("[REPORT APP] Dashboard script already loaded.");
      return;
    }

    const script = document.createElement("script");
    script.src = "./app_dashboard.js";
    script.async = true;
    script.defer = true;
    script.dataset.reportDashboard = "true";

    document.head.appendChild(script);
  }

  function ensureDashboardMount() {
    let mount = document.getElementById("dashboardMount");

    if (!mount) {
      mount = document.createElement("div");
      mount.id = "dashboardMount";
      mount.setAttribute("data-report-dashboard-mount", "true");
      document.body.appendChild(mount);
    }

    return mount;
  }

  function initApp() {
    ensureDashboardMount();
    ensureDashboardScript();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp, { once: true });
  } else {
    initApp();
  }
})();
