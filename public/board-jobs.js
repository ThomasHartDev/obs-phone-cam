const jobs = [];
let scheduled = false;

function tick(fn) {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn);
  else setTimeout(fn, 0);
}

function pump() {
  scheduled = false;
  if (!jobs.length) return;
  const job = jobs.shift();
  try {
    job();
  } catch {
    /* next job still runs */
  }
  if (jobs.length) kick();
}

function kick() {
  if (scheduled) return;
  scheduled = true;
  tick(pump);
}

export function enqueue(job) {
  if (typeof job !== "function") return jobs.length;
  jobs.push(job);
  kick();
  return jobs.length;
}

export function pendingCount() {
  return jobs.length + (scheduled ? 1 : 0);
}

export function resetJobs() {
  jobs.length = 0;
  scheduled = false;
}
