import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import { addCollectionPluginV1, ruleSet, plugin } from "@metaplex-foundation/mpl-core";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { keypairIdentity, publicKey } from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import * as fs from "fs";
import * as path from "path";

// ============================================
// CONFIGURATION
// ============================================

const RPC_URL =
  "https://mainnet.helius-rpc.com/?api-key=82ef2bd1-98fa-4bf6-af02-58d9577701b5";

const KEYPAIR_PATH =
  process.env.ANCHOR_WALLET ||
  path.join(process.env.HOME || "~", ".config/solana/id.json");

// Collection to update
const COLLECTION_ADDRESS = new PublicKey("ALF7c1dxr47VKBxQf88D3uRTLs2zi7SufxVo9NmLd8P9");

// Royalty configuration
const ROYALTY_PERCENT = 5; // 5%
const ROYALTY_RECIPIENT = new PublicKey("BdBdevmuov29CegxHFmmH911DuNM5B7LrWEHsiqPRi8w");

// ============================================
// MAIN SCRIPT
// ============================================

async function main() {
  console.log("===========================================");
  console.log("  Add Royalty Plugin to Collection - Mainnet");
  console.log("===========================================\n");

  // Load keypair
  console.log("Loading keypair from:", KEYPAIR_PATH);
  const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  console.log("Authority:", payer.publicKey.toBase58());

  // Setup connection and check balance
  const connection = new Connection(RPC_URL, "confirmed");
  console.log("RPC:", RPC_URL);

  const balance = await connection.getBalance(payer.publicKey);
  console.log("Balance:", balance / 1e9, "SOL\n");

  if (balance < 0.01 * 1e9) {
    console.error("Insufficient balance. Need at least 0.01 SOL.");
    process.exit(1);
  }

  // Setup UMI
  const umi = createUmi(RPC_URL);
  const umiKeypair = fromWeb3JsKeypair(payer);
  umi.use(keypairIdentity(umiKeypair));

  // Collection in UMI format
  const collectionUmi = publicKey(COLLECTION_ADDRESS.toBase58());
  const recipientUmi = publicKey(ROYALTY_RECIPIENT.toBase58());

  // ============================================
  // Add Royalty Plugin to Collection
  // ============================================
  console.log("Adding royalty plugin to collection...");
  console.log("   Collection:", COLLECTION_ADDRESS.toBase58());
  console.log("   Royalty:", ROYALTY_PERCENT + "%");
  console.log("   Recipient:", ROYALTY_RECIPIENT.toBase58());

  const balanceBefore = await connection.getBalance(payer.publicKey);

  // Royalty is in basis points (5% = 500 basis points)
  const royaltyBasisPoints = ROYALTY_PERCENT * 100;

  await addCollectionPluginV1(umi, {
    collection: collectionUmi,
    plugin: plugin("Royalties", [
      {
        basisPoints: royaltyBasisPoints,
        creators: [
          {
            address: recipientUmi,
            percentage: 100, // 100% of royalties go to this address
          },
        ],
        ruleSet: ruleSet("None"),
      },
    ]),
  }).sendAndConfirm(umi);

  const balanceAfter = await connection.getBalance(payer.publicKey);
  console.log(
    "\n   Cost:",
    ((balanceBefore - balanceAfter) / 1e9).toFixed(6),
    "SOL"
  );
  console.log("   Royalty plugin added!\n");

  // ============================================
  // Summary
  // ============================================
  console.log("===========================================");
  console.log("  Update Complete!");
  console.log("===========================================\n");

  console.log("Collection:  ", COLLECTION_ADDRESS.toBase58());
  console.log("Royalty:     ", ROYALTY_PERCENT + "% (" + royaltyBasisPoints + " basis points)");
  console.log("Recipient:   ", ROYALTY_RECIPIENT.toBase58());

  console.log("\nView on Solana Explorer:");
  console.log(
    `https://explorer.solana.com/address/${COLLECTION_ADDRESS.toBase58()}`
  );
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
