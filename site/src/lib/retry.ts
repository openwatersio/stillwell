// Retrying the build's reads of store files the store rewrote mid-read.

// DuckDB sends each range request with If-Match on the ETag it opened the file with, so a file replaced mid-read, at
// any size, fails the query with this.
const REWRITTEN = /ETag on reading file .* changed after it was opened/;

/**
 * Run a read again when the store replaced a file while it was being read. The store replaces a file whole, so the
 * next read gets the new one; the waits get past a file rewritten several times in a row. Other errors throw at once.
 */
export async function retryRewrite<T>(
  read: () => Promise<T>,
  tries = 4,
  waitMs = 2000,
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await read();
    } catch (error) {
      if (i >= tries || !REWRITTEN.test(String(error))) throw error;
      await new Promise((r) => setTimeout(r, waitMs * i));
    }
  }
}
