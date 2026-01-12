import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import { createV1 } from "@metaplex-foundation/mpl-core";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { generateSigner, keypairIdentity, publicKey } from "@metaplex-foundation/umi";
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

// Existing collection address
const COLLECTION_ADDRESS = new PublicKey("ALF7c1dxr47VKBxQf88D3uRTLs2zi7SufxVo9NmLd8P9");

// NFT metadata - note: /parcel100001 format (no slash before ID)
const TEST_PARCEL_ID = 100001;
const NFT_NAME = `Test Parcel #${TEST_PARCEL_ID}`;
const NFT_URI = `https://million-dollar-api-staging.seva-e96.workers.dev/parcel${TEST_PARCEL_ID}`;

// ============================================
// MAIN SCRIPT
// ============================================

async function main() {
  console.log("===========================================");
  console.log("  Mint NFT to Existing Collection - Mainnet");
  console.log("===========================================\n");

  // Load keypair
  console.log("Loading keypair from:", KEYPAIR_PATH);
  const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  console.log("Deployer:", payer.publicKey.toBase58());

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

  // ============================================
  // Mint NFT to existing collection
  // ============================================
  console.log("Minting NFT to existing collection...");
  console.log("   Collection:", COLLECTION_ADDRESS.toBase58());
  console.log("   Name:", NFT_NAME);
  console.log("   URI:", NFT_URI);
  console.log("   Owner: YOU (deployer)");

  const assetSigner = generateSigner(umi);
  console.log("   Asset Address:", assetSigner.publicKey.toString());

  const balanceBefore = await connection.getBalance(payer.publicKey);

  await createV1(umi, {
    asset: assetSigner,
    collection: collectionUmi,
    name: NFT_NAME,
    uri: NFT_URI,
    owner: umiKeypair.publicKey,
  }).sendAndConfirm(umi);

  const balanceAfter = await connection.getBalance(payer.publicKey);
  console.log(
    "   Cost:",
    ((balanceBefore - balanceAfter) / 1e9).toFixed(6),
    "SOL"
  );
  console.log("   NFT minted!\n");

  // ============================================
  // Summary
  // ============================================
  console.log("===========================================");
  console.log("  Mint Complete!");
  console.log("===========================================\n");

  console.log("Collection:  ", COLLECTION_ADDRESS.toBase58());
  console.log("NFT Asset:   ", assetSigner.publicKey.toString());
  console.log("NFT URI:     ", NFT_URI);

  console.log("\nView on Solana Explorer:");
  console.log(
    `NFT: https://explorer.solana.com/address/${assetSigner.publicKey.toString()}`
  );
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
