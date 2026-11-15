import { connect, type Socket } from "node:net";

/** The most a file may hold; a larger one is refused rather than read into memory. */
const MAX_BYTES = 64 * 1024 * 1024;

/**
 * A reply the server gave that isn't a success: 550 for a file that isn't
 * there, and others (4xx, a full server or a dropped session) that a retry may clear.
 */
export class FtpError extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

/**
 * One file from an anonymous FTP server, `ftp://host/path`, over a passive
 * data connection. `fetch` doesn't speak FTP, and the files are small, so this
 * reads each whole.
 */
export async function ftpGet(url: string, timeoutMs = 300_000): Promise<Buffer> {
  const { protocol, hostname, port, pathname } = new URL(url);
  if (protocol !== "ftp:") throw new Error(`Not an FTP URL: ${url}`);
  const path = decodeURIComponent(pathname);
  // A line break in the path would end the RETR command and start another.
  if (/[\r\n\0]/.test(path)) throw new Error(`Not an FTP path: ${url}`);
  const deadline = AbortSignal.timeout(timeoutMs);
  const control = connect({ host: hostname, port: Number(port) || 21 });
  let data: Socket | undefined;
  const close = () => {
    control.destroy();
    // With an error, so a transfer waiting on the data socket settles.
    data?.destroy(new Error("FTP request timed out"));
  };
  deadline.addEventListener("abort", close);
  try {
    const reply = replies(control, deadline);
    await expect(reply, 220);
    await command(control, reply, "USER anonymous", 331);
    await command(control, reply, "PASS anonymous@", 230);
    await command(control, reply, "TYPE I", 200);
    const pasv = await command(control, reply, "PASV", 227);
    const m = /(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/.exec(pasv);
    if (!m) throw new FtpError(`FTP ${hostname} answered PASV with ${pasv}`, 227);
    // The control connection's host, not the address in the reply, which a NAT may misstate.
    const socket = connect({ host: hostname, port: Number(m[5]) * 256 + Number(m[6]) });
    data = socket;
    const chunks: Buffer[] = [];
    let size = 0;
    const received = new Promise<void>((resolve, reject) => {
      let ended = false;
      socket.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        size += chunk.length;
        if (size > MAX_BYTES) socket.destroy(new Error(`FTP file is over ${MAX_BYTES} bytes`));
      });
      socket.on("end", () => {
        ended = true;
        resolve();
      });
      socket.on("error", reject);
      // A connection that closes without ending is a cut transfer.
      socket.on("close", () => ended || reject(new Error("FTP data connection closed early")));
    });
    received.catch(() => {});
    await command(control, reply, `RETR ${path}`, 150, 125);
    await received;
    await expect(reply, 226);
    control.write("QUIT\r\n");
    return Buffer.concat(chunks);
  } catch (error) {
    if (deadline.aborted) throw new DOMException("The operation timed out", "TimeoutError");
    throw error;
  } finally {
    deadline.removeEventListener("abort", close);
    close();
  }
}

type Reply = () => Promise<{ code: number; text: string }>;

/**
 * A control connection's replies, one at a time. A reply is a line `code text`,
 * or lines from `code-text` to the first line starting `code `.
 */
function replies(socket: Socket, signal: AbortSignal): Reply {
  let buffer = "";
  let failure: Error | undefined;
  let wake: (() => void) | undefined;
  socket.setEncoding("latin1");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    wake?.();
  });
  const fail = (error: Error) => {
    failure = error;
    wake?.();
  };
  socket.on("error", fail);
  socket.on("close", () => fail(new Error("FTP control connection closed")));
  return async () => {
    for (;;) {
      // The last element is a line not yet ended.
      const lines = buffer.split("\r\n");
      const first = lines[0]!;
      if (lines.length > 1) {
        if (!/^\d{3}[ -]/.test(first)) throw new Error(`FTP sent ${first.slice(0, 60)}`);
        const code = first.slice(0, 3);
        const end =
          first[3] === " "
            ? 0
            : lines.findIndex((l, i) => i > 0 && i < lines.length - 1 && l.startsWith(`${code} `));
        if (end >= 0) {
          buffer = lines.slice(end + 1).join("\r\n");
          return { code: Number(code), text: lines.slice(0, end + 1).join("\n") };
        }
      }
      if (failure) throw failure;
      if (signal.aborted) throw new Error("FTP request timed out");
      await new Promise<void>((resolve) => (wake = resolve));
    }
  };
}

async function expect(reply: Reply, ...codes: number[]): Promise<string> {
  const { code, text } = await reply();
  if (!codes.includes(code)) throw new FtpError(`FTP replied ${text}`, code);
  return text;
}

async function command(
  socket: Socket,
  reply: Reply,
  line: string,
  ...codes: number[]
): Promise<string> {
  socket.write(`${line}\r\n`);
  return expect(reply, ...codes);
}
