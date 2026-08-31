export function launchUrls(httpsPort) {
  const port = Number(httpsPort) || 8443;
  const base = `https://localhost:${port}`;
  return [
    `${base}/pair.html?for=phone`,
    `${base}/pair.html?for=ipad`,
  ];
}

export function openLaunchTabs(openFn, urls, delayMs = 450) {
  if (typeof openFn !== "function") return;
  const list = Array.isArray(urls) ? urls : [];
  list.forEach((url, i) => {
    const t = setTimeout(() => openFn(url), i * delayMs);
    if (t && typeof t.unref === "function") t.unref();
  });
}
