import { execSync } from "node:child_process";

/** 释放 wrangler / vite 常用端口，避免 Address already in use */
const ports = [8788, 8789, 5173, 5174, 5175, 5176];

function pidsOnPort(port) {
  try {
    const out = execSync(`lsof -ti :${port}`, { encoding: "utf8" });
    return out
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

let killed = 0;
for (const port of ports) {
  for (const pid of pidsOnPort(port)) {
    try {
      process.kill(Number(pid), "SIGKILL");
      killed++;
    } catch {
      // ignore
    }
  }
}

if (killed > 0) {
  console.log(`[kill-dev-ports] freed ${killed} process(es) on ports: ${ports.join(", ")}`);
} else {
  console.log("[kill-dev-ports] no listeners on common dev ports");
}
