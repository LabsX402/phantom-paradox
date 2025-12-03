import { PublicKey, Logs } from "@solana/web3.js";
import { eventCoder } from "./solana";
import { EventName } from "./types";

const coder = eventCoder();

// Parse events from a single log batch
export const parseEventsFromLogs = (logs: Logs) => {
  const events: { name: string; data: any }[] = [];

  for (const line of logs.logs) {
    try {
      const evt = coder.decode(line);
      if (evt) {
        events.push(evt);
      }
    } catch {
      // not an Anchor event line, ignore
    }
  }

  return events;
};

// Type narrowing helper
export const isEvent = (
  e: { name: string; data: any },
  name: EventName
): e is { name: EventName; data: any } => e.name === name;

