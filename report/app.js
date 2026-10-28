(() => {
  "use strict";

  const APP_BOOTSTRAP_KEY = "__REPORT_APP_BOOTSTRAP__";

  // ป้องกัน init ซ้ำ
  if (window[APP_BOOTSTRAP_KEY]) {
    console.warn("[REPORT APP] App bootstrap already started.");
    return;
  }
  window[APP_BOOTSTRAP_KEY] = true;

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

  function ensureDashboardScript() {
    const existingScript = document.querySelector(
      'script[data-report-dashboard="true"]'
    );

    if (existingScript) {
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
