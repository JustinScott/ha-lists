import { spawn } from "node:child_process";
import { mkdtemp, mkdir, cp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";

// A fresh configuration and loopback port prevent tests from touching a real HA.
export async function startNative(python, components, configuration, onboarding) {
  const directory = await mkdtemp(join(tmpdir(), "ha-lists-test-"));
  let process;
  let output = "";
  try {
    await mkdir(join(directory, ".storage"));
    await writeFile(join(directory, "configuration.yaml"), configuration);
    await writeFile(join(directory, ".storage/onboarding"), onboarding);
    await cp(components, join(directory, "custom_components"), { recursive: true });
    const socket = createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = socket.address().port;
    await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
    await writeFile(join(directory, "configuration.yaml"),
      `${configuration}\nhttp:\n  server_host: 127.0.0.1\n  server_port: ${port}\n`);
    process = spawn(python, ["-m", "homeassistant", "-c", directory, "--skip-pip"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    process.stdout.on("data", (data) => { output = (output + data).slice(-16000); });
    process.stderr.on("data", (data) => { output = (output + data).slice(-16000); });
    await once(process, "spawn");
    return {
      base: `http://127.0.0.1:${port}/`,
      logs: () => output,
      async close() {
        if (process.exitCode === null && process.signalCode === null) {
          const exited = once(process, "exit");
          const timer = setTimeout(() => process.kill("SIGKILL"), 10000);
          process.kill("SIGTERM");
          try { await exited; } finally { clearTimeout(timer); }
        }
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    process?.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
