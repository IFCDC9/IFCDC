/** Boot overlay helpers — hide the HTML splash once React mounts */

function getBootEl(): HTMLElement | null {
  let el = document.getElementById("app-boot");
  if (!el) {
    el = document.createElement("div");
    el.id = "app-boot";
    el.style.cssText =
      "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0a0a0a;color:#f5c842;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:1rem;";
    document.body.prepend(el);
  }
  return el;
}

export function markAppMounted() {
  (window as unknown as { __IFCDC_APP_MOUNTED__?: boolean }).__IFCDC_APP_MOUNTED__ = true;
  const clear = (window as unknown as { __IFCDC_CLEAR_BOOT_TIMER__?: () => void }).__IFCDC_CLEAR_BOOT_TIMER__;
  clear?.();
  document.getElementById("app-boot")?.remove();
}

export function showBootError(message: string) {
  const el = getBootEl();
  el.innerHTML = `
    <div style="text-align:center;padding:2rem;max-width:420px">
      <p style="color:#ef4444;margin-bottom:0.75rem">Headquarters failed to start</p>
      <p style="color:#888;font-size:0.85rem;margin-bottom:1rem">${message.replace(/</g, "&lt;")}</p>
      <a href="/login" style="color:#f5c842;margin:0 0.5rem">Go to Login</a>
      <a href="/hq" style="color:#f5c842;margin:0 0.5rem">Go to HQ</a>
      <br/><button type="button" onclick="location.reload()" style="margin-top:1rem;padding:0.5rem 1rem;background:#f5c842;border:none;border-radius:4px;cursor:pointer;color:#0a0a0a;font-weight:600">Retry</button>
    </div>`;
}
