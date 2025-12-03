import debug from "debug";

export const log = {
  info: debug("pg:info"),
  warn: debug("pg:warn"),
  error: debug("pg:error"),
  debug: debug("pg:debug")
};

// Export as logger for backward compatibility
export const logger = log;

// in dev, enable via env: DEBUG=pg:*

