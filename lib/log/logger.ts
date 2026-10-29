import { redact } from "./redact";

type Fields = Record<string, unknown>;
type Level = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(bindings: Fields): Logger;
}

function createLogger(bindings: Fields): Logger {
  const write = (level: Level, msg: string, fields?: Fields) => {
    if (level === "debug" && process.env.LOG_LEVEL !== "debug") return;
    const time = new Date().toISOString();
    let line: string;
    try {
      line = JSON.stringify({
        level,
        time,
        msg,
        ...(redact({ ...bindings, ...fields }) as Fields),
      });
    } catch {
      line = JSON.stringify({ level, time, msg, fields: "[unserializable]" });
    }
    (level === "warn" || level === "error" ? console.error : console.log)(line);
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (b) => createLogger({ ...bindings, ...b }),
  };
}

export const logger: Logger = createLogger({});
