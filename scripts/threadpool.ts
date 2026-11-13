// Each DuckDB call holds one of libuv's pool threads while it waits on R2, and
// the pool has 4 by default, so lanes past the fourth would wait for a thread.
// libuv sizes the pool on first use, so this module is imported before any other.
process.env.UV_THREADPOOL_SIZE ||= "64";
