import { spawn } from "node:child_process";
import { expect, it } from "vitest";

it("spawns node and reads stdout", async () => {
  console.log("execPath:", process.execPath);
  const child = spawn(process.execPath, ["-e", "console.log('hello-from-child')"], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  await new Promise((resolve, reject) => {
    child.on("exit", (code) => resolve(code));
    setTimeout(() => reject(new Error("child never exited")), 5000);
  });
  console.log("child said:", JSON.stringify(out));
  expect(out).toContain("hello-from-child");
}, 10_000);
