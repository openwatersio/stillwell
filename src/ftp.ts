import { connect, type Socket } from "node:net";

/**
 * A reply BOM's FTP server gave that isn't a success: 550 for a file that
 * isn't there, and others (a full server, a refused login) that a retry
 * may clear.
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
  const deadline = AbortSignal.timeout(timeoutMs);
  const control = connect({ host: hostname, port: Number(port) || 21 });
  let data: Socket | undefined;
  const close = () => {
    control.destroy();
    data?.destroy();
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
    data = connect({ host: hostname, port: Number(m[5]) * 256 + Number(m[6]) });
    const chunks: Buffer[] = [];
    const received = new Promise<void>((resolve, reject) => {
      data!.on("data", (chunk: Buffer) => chunks.push(chunk));
      data!.on("end", resolve);
      data!.on("error", reject);
    });
    received.catch(() => {});
    await command(control, reply, `RETR ${decodeURIComponent(pathname)}`, 150, 125);
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

/** A control connection's replies, one at a time; a reply's lines run to the first `code text`. */
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
      const lines = buffer.split("\r\n");
      // The last element is a line not yet ended.
      const end = lines.findIndex((l, i) => i < lines.length - 1 && /^\d{3} /.test(l));
      if (end >= 0) {
        buffer = lines.slice(end + 1).join("\r\n");
        const text = lines.slice(0, end + 1).join("\n");
        return { code: Number(text.slice(0, 3)), text };
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
