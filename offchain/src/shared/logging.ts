// logging.ts
import fs from "fs";
import path from "path";

export interface FullEvent {
  ts: string;
  kind: string;
  programId: string;
  auctionPda?: string;
  playerPubkey?: string;
  txSig?: string;
  details: any;
}

export interface PublicEvent {
  ts: string;
  kind: string;
  auction?: number;        // numeric ID instead of PDA
  player?: number;        // index instead of pubkey
  details: any;           // no program id, no raw keys
}

export class RunLogger {
  private full: FullEvent[] = [];
  private pub: PublicEvent[] = [];
  private start = Date.now();
  private auctionMap = new Map<string, number>();
  private playerMap = new Map<string, number>();
  private auctionCounter = 0;
  private playerCounter = 0;

  private getAuctionId(pda: string): number {
    if (!this.auctionMap.has(pda)) {
      this.auctionMap.set(pda, ++this.auctionCounter);
    }
    return this.auctionMap.get(pda)!;
  }

  private getPlayerId(pk: string): number {
    if (!this.playerMap.has(pk)) {
      this.playerMap.set(pk, ++this.playerCounter);
    }
    return this.playerMap.get(pk)!;
  }

  logAuctionEvent(args: {
    kind: string;
    programId: string;
    auctionPda?: string;
    playerPubkey?: string;
    txSig?: string;
    details?: any;
  }) {
    const ts = new Date().toISOString();
    const { kind, programId, auctionPda, playerPubkey, txSig, details } = args;

    // full log
    this.full.push({
      ts,
      kind,
      programId,
      auctionPda,
      playerPubkey,
      txSig,
      details: details ?? {},
    });

    // public log (anonymized)
    const auctionId = auctionPda ? this.getAuctionId(auctionPda) : undefined;
    const playerId = playerPubkey ? this.getPlayerId(playerPubkey) : undefined;

    this.pub.push({
      ts,
      kind,
      auction: auctionId,
      player: playerId,
      details: details ?? {},
    });
  }

  async flush() {
    const dir = path.join(process.cwd(), "logs");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const stamp = new Date(this.start).toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(
      path.join(dir, `full_run_${stamp}.json`),
      JSON.stringify(this.full, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      path.join(dir, `public_run_${stamp}.json`),
      JSON.stringify(this.pub, null, 2),
      "utf8"
    );

    console.log(`\n✅ Logs written to:`);
    console.log(`   - logs/full_run_${stamp}.json`);
    console.log(`   - logs/public_run_${stamp}.json`);
  }
}

