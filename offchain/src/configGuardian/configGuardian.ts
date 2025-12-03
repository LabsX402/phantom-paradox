import dotenv from "dotenv";
dotenv.config();

import { getProgram } from "../shared/solana";
import { PublicKey } from "@solana/web3.js";

const INTERVAL_MS = 60 * 1000; // 1min

// Hard assumptions – change to match your Config account + seeds
const CONFIG_PDA_BASE58 = process.env.CONFIG_PDA || "";

const SAFE_MAX_FEE_BPS = 1000; // 10%
const EXPECTED_AUTHORITY = process.env.EXPECTED_CONFIG_AUTHORITY || "";

const tick = async () => {
  console.log("[ConfigGuardian] Checking config invariants…");
  const program = getProgram();

  if (!CONFIG_PDA_BASE58) {
    console.warn("[ConfigGuardian] CONFIG_PDA not set.");
    return;
  }

  try {
    const configPda = new PublicKey(CONFIG_PDA_BASE58);

    // @ts-ignore type cast to your actual config type
    const cfg: any = await program.account.globalConfig.fetch(configPda);

    // Example invariants:
    if (cfg.protocolFeeBps > SAFE_MAX_FEE_BPS) {
      console.error(
        "[ConfigGuardian] ALERT: protocolFeeBps too high:",
        cfg.protocolFeeBps
      );
    }

    if (EXPECTED_AUTHORITY && cfg.governance.toBase58() !== EXPECTED_AUTHORITY) {
      console.error(
        "[ConfigGuardian] ALERT: config governance mismatch:",
        cfg.governance.toBase58()
      );
    }
  } catch (e) {
    console.error("[ConfigGuardian] Error fetching config:", e);
  }
};

const main = async () => {
  await tick();
  setInterval(tick, INTERVAL_MS);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

