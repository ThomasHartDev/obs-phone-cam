export function launchUrls(httpsPort, httpPort) {
  const https = Number(httpsPort) || 8443;
  const http = Number(httpPort) || https + 1;
  return [
    `https://localhost:${https}/`,
    `http://localhost:${http}/receiver.html`,
    `http://localhost:${http}/board-receiver.html`,
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
