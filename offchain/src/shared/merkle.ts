import { PublicKey } from "@solana/web3.js";
import { query } from "./db";
import { MerkleTree } from "merkletreejs"; // We might need this, or use spl-account-compression's logic
import keccak256 from "keccak";

// Simple in-memory cache for trees (for demo purposes)
// In prod, this would be a Redis/DB backed structure
const trees: Record<string, MerkleTree> = {};

export class TreeManager {
  static async getTree(treeAddress: string): Promise<MerkleTree> {
    if (trees[treeAddress]) return trees[treeAddress];

    // Rebuild from DB
    const { rows } = await query(
      `SELECT leaf_hash, leaf_index FROM merkle_leaves WHERE tree = $1 ORDER BY leaf_index ASC`,
      [treeAddress]
    );

    const leaves = rows.map(r => Buffer.from(r.leaf_hash, 'hex'));
    // Pad with empty leaves if needed, or use sparse tree logic
    // For simplicity in this demo, we assume a standard tree
    // Solana's SPL Compression uses specific empty node values. 
    // We will approximate by just building a tree from existing leaves.
    // NOTE: This is a simplified indexer. A real one mirrors the on-chain structure exactly.
    
    const tree = new MerkleTree(leaves, (x: Buffer) => keccak256(x), { sortPairs: false, hashLeaves: false });
    trees[treeAddress] = tree;
    return tree;
  }

  static async appendLeaf(treeAddress: string, leafIndex: number, leafHash: string, data: any) {
    // Save to DB
    await query(
      `
        INSERT INTO merkle_leaves (tree, leaf_index, leaf_hash, data)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (tree, leaf_index) DO NOTHING
      `,
      [treeAddress, leafIndex, leafHash, JSON.stringify(data)]
    );

    // Update cache
    const tree = await this.getTree(treeAddress);
    tree.addLeaf(Buffer.from(leafHash, 'hex'));
  }

  static async getProof(treeAddress: string, leafIndex: number) {
    const tree = await this.getTree(treeAddress);
    // We need the leaf value to get the proof
    const { rows } = await query(
      `SELECT leaf_hash FROM merkle_leaves WHERE tree = $1 AND leaf_index = $2`,
      [treeAddress, leafIndex]
    );
    if (!rows.length) return null;
    
    const leaf = Buffer.from(rows[0].leaf_hash, 'hex');
    const proof = tree.getHexProof(leaf);
    return {
        root: tree.getHexRoot(),
        proof,
        leaf: '0x' + leaf.toString('hex')
    };
  }
}

